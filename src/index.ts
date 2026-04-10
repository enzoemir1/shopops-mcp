import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { z } from 'zod/v4';

import { PlatformSchema } from './models/store.js';
import { storage } from './services/storage.js';
import { connectStore, syncStore } from './tools/connect.js';
import { getInventoryStatus, getInventoryForecast } from './tools/inventory.js';
import { analyzePricing } from './tools/pricing.js';
import { getCustomerSegments, getChurnRisk } from './tools/customers.js';
import { getOrderAnomalies } from './tools/orders.js';
import { getProductPerformance } from './tools/products.js';
import { generateDailyReport, generateWeeklyReport } from './tools/reports.js';
import { seedDemoStore } from './services/demo-seed.js';
import { handleToolError, validateUUID } from './utils/errors.js';

// ── Server ────────────────────────────────────────────────────────
const SERVER_VERSION = '1.2.2';

const server = new McpServer({
  name: 'shopops-mcp',
  version: SERVER_VERSION,
});

// ── Tool: store_connect ───────────────────────────────────────────
server.registerTool(
  'store_connect',
  {
    title: 'Connect Store',
    description: 'Manage Shopify or WooCommerce store connections. action="connect" adds a new store and performs an initial sync of products, orders, and customers; action="sync" refreshes cached data for an existing store; action="list" returns all connected stores with their sync counts. Returns a JSON payload with store metadata (id, name, platform, url, counts, last_sync) — credentials are never returned.',
    inputSchema: z.object({
      action: z.enum(['connect', 'sync', 'list']).describe('connect = add new store, sync = refresh existing store, list = show all stores'),
      name: z.string().min(1).optional().describe('Human-readable store name (required for connect, e.g. "My Shop")'),
      platform: PlatformSchema.optional().describe('"shopify" or "woocommerce" (required for connect)'),
      url: z.string().url().optional().describe('Store base URL starting with https:// (required for connect, e.g. "https://myshop.myshopify.com")'),
      api_key: z.string().min(1).optional().describe('Platform API access token (required for connect)'),
      api_secret: z.string().min(1).optional().describe('Platform API secret — REQUIRED for woocommerce, ignored for shopify'),
      store_id: z.string().uuid().optional().describe('Existing store UUID (required for sync)'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async ({ action, name, platform, url, api_key, api_secret, store_id }) => {
    try {
      if (action === 'list') {
        const stores = await storage.getStores();
        if (stores.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No stores are connected yet. Use action="connect" with name, platform, url, and api_key to add one.' }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            total: stores.length,
            stores: stores.map((s) => ({
              id: s.id, name: s.name, platform: s.platform, url: s.url,
              products: s.product_count, orders: s.order_count, customers: s.customer_count,
              last_sync: s.last_sync_at,
            })),
          }, null, 2) }],
        };
      }

      if (action === 'sync') {
        if (!store_id) {
          return { content: [{ type: 'text' as const, text: 'store_id is required for action="sync". Use action="list" to find connected store IDs.' }], isError: true };
        }
        const result = await syncStore(store_id);
        return { content: [{ type: 'text' as const, text: `Store synced successfully — ${result.products} products, ${result.orders} orders, ${result.customers} customers refreshed.` }] };
      }

      // connect
      const missing: string[] = [];
      if (!name) missing.push('name');
      if (!platform) missing.push('platform');
      if (!url) missing.push('url');
      if (!api_key) missing.push('api_key');
      if (missing.length > 0) {
        return { content: [{ type: 'text' as const, text: `Missing required field(s) for connect: ${missing.join(', ')}. Required: name, platform, url, api_key. WooCommerce also needs api_secret.` }], isError: true };
      }
      if (platform === 'woocommerce' && !api_secret) {
        return { content: [{ type: 'text' as const, text: 'api_secret is required when platform="woocommerce" (WooCommerce REST API uses consumer_key + consumer_secret).' }], isError: true };
      }
      const result = await connectStore({ name: name!, platform: platform!, url: url!, api_key: api_key!, api_secret });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          message: `Store "${result.store.name}" connected successfully.`,
          store_id: result.store.id,
          synced: result.synced,
          next_steps: 'Use inventory_status, customers_segment, or report_daily with this store_id to start analyzing.',
        }, null, 2) }],
      };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: store_demo_seed ─────────────────────────────────────────
server.registerTool(
  'store_demo_seed',
  {
    title: 'Seed Demo Store',
    description: 'Create a realistic demo store populated with 20 products, 40 customers across 6 archetype buckets (champions, loyal, new, at-risk, hibernating, one-off), and 150+ orders spanning the last 6 months. Use this to explore ShopOps without real Shopify or WooCommerce credentials — every tool (inventory_status, customers_segment, order_anomalies, report_weekly, etc.) will return meaningful output on the returned store_id. Safe to call multiple times; each call creates a new demo store with a unique ID. Returns the store_id plus product/customer/order counts.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async () => {
    try {
      const result = await seedDemoStore();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: inventory_status ────────────────────────────────────────
server.registerTool(
  'inventory_status',
  {
    title: 'Inventory Status',
    description: 'Snapshot of current stock levels for a connected store. Returns a summary object with total product count, out-of-stock count, low-stock count (≤10 units), plus two arrays: out_of_stock and low_stock — each containing product id, title, sku, quantity, and status. Items are sorted by urgency (lowest quantity first). Read-only and idempotent.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id }) => {
    try {
      const result = await getInventoryStatus(store_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: inventory_forecast ──────────────────────────────────────
server.registerTool(
  'inventory_forecast',
  {
    title: 'Inventory Forecast',
    description: 'Predict stock depletion dates using moving-average sales velocity. Returns reorder points, safety stock levels, and suggested reorder quantities for each product.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
      product_id: z.string().optional().describe('Specific product ID (omit for all products)'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id, product_id }) => {
    try {
      const result = await getInventoryForecast(store_id, product_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: pricing_analyze ─────────────────────────────────────────
server.registerTool(
  'pricing_analyze',
  {
    title: 'Pricing Analysis',
    description: 'Analyze pricing across products with margin calculation, sales velocity, and rule-based price optimization suggestions. Returns an array where each element contains product_title, current_price, cost, margin_percent, daily_units_sold, revenue_per_day, suggested_price (or null if no change recommended), and suggestion_reason. Pass product_id to scope to a single product, omit for full catalog.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
      product_id: z.string().optional().describe('Specific product ID (omit for all)'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id, product_id }) => {
    try {
      const result = await analyzePricing(store_id, product_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: pricing_optimize ────────────────────────────────────────
server.registerTool(
  'pricing_optimize',
  {
    title: 'Pricing Optimization',
    description: 'Filtered pricing recommendations — only products where a price change is suggested. Returns a summary with total_suggestions count and an optimizations array (product, current_price, suggested_price, change_percent, reason, daily_revenue), sorted by absolute change_percent (biggest moves first). Use this instead of pricing_analyze when you only want actionable changes.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id }) => {
    try {
      const result = await analyzePricing(store_id);
      const optimizations = result
        .filter((p) => p.suggested_price !== null)
        .map((p) => ({
          product: p.product_title,
          current_price: p.current_price,
          suggested_price: p.suggested_price,
          change_percent: p.suggested_price !== null && p.current_price > 0
            ? Math.round(((p.suggested_price - p.current_price) / p.current_price) * 10000) / 100
            : 0,
          reason: p.suggestion_reason,
          daily_revenue: p.revenue_per_day,
        }))
        .sort((a, b) => Math.abs(b.change_percent) - Math.abs(a.change_percent));
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        store_id,
        total_suggestions: optimizations.length,
        optimizations,
      }, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: customers_segment ───────────────────────────────────────
server.registerTool(
  'customers_segment',
  {
    title: 'Customer Segmentation',
    description: 'RFM (Recency, Frequency, Monetary) customer segmentation. Categorizes customers into segments: Champions, Loyal, Potential, At Risk, New, Hibernating, Lost — with actionable recommendations.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id }) => {
    try {
      const result = await getCustomerSegments(store_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: customers_churn ─────────────────────────────────────────
server.registerTool(
  'customers_churn',
  {
    title: 'Churn Risk',
    description: 'Identify customers at risk of churning based on RFM recency + frequency signals. Returns an object with at_risk, hibernating, and lost arrays — each contains customer id, name, email, last_order_date, days_since_last_order, total_spent, total_orders, and a win_back_recommendation string. Use this for targeted re-engagement campaigns.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id }) => {
    try {
      const result = await getChurnRisk(store_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: order_anomalies ─────────────────────────────────────────
server.registerTool(
  'order_anomalies',
  {
    title: 'Order Anomaly Detection',
    description: 'Statistical anomaly detection on recent orders. Flags high-value orders (>3σ from mean), velocity spikes (customer ordering unusually fast), unusual quantities, off-hours purchases (2am-5am), and new-customer high-value orders. Returns an array of anomalies with order_id, anomaly_type, severity (low/medium/high), reason, and recommended_action. Useful for fraud detection and revenue spike investigation.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id }) => {
    try {
      const result = await getOrderAnomalies(store_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: product_performance ─────────────────────────────────────
server.registerTool(
  'product_performance',
  {
    title: 'Product Performance (ABC Analysis)',
    description: 'Product performance report with ABC analysis. Category A = top 80% revenue, B = next 15%, C = bottom 5%. Includes trends, margins, and daily sales velocity.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
      period_days: z.number().int().min(7).max(90).default(30).describe('Analysis period in days (default 30)'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id, period_days }) => {
    try {
      const result = await getProductPerformance(store_id, period_days);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: report_daily ────────────────────────────────────────────
server.registerTool(
  'report_daily',
  {
    title: 'Daily Report',
    description: 'Daily operational report: orders, revenue, top products, new vs returning customers, low stock alerts, and anomaly count.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format').optional().describe('Date in YYYY-MM-DD format (defaults to today)'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id, date }) => {
    try {
      const result = await generateDailyReport(store_id, date);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: report_weekly ───────────────────────────────────────────
server.registerTool(
  'report_weekly',
  {
    title: 'Weekly Report',
    description: 'Weekly trend report: revenue/order changes vs previous week, customer segment distribution, trending products, and AI-generated insights.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ store_id }) => {
    try {
      const result = await generateWeeklyReport(store_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Resources ─────────────────────────────────────────────────────
server.registerResource(
  'store_overview',
  'store://overview',
  { title: 'Store Overview', description: 'Connected stores summary with product/order/customer counts' },
  async () => {
    const stores = await storage.getStores();
    return {
      contents: [{
        uri: 'store://overview',
        text: JSON.stringify(stores.map((s) => ({
          id: s.id, name: s.name, platform: s.platform,
          products: s.product_count, orders: s.order_count, customers: s.customer_count,
          last_sync: s.last_sync_at,
        })), null, 2),
      }],
    };
  }
);

server.registerResource(
  'store_inventory',
  'store://inventory',
  { title: 'Inventory Alerts', description: 'Products with low or zero stock across all stores' },
  async () => {
    const stores = await storage.getStores();
    const alerts: Array<{ store: string; product: string; sku: string | null; quantity: number }> = [];

    for (const store of stores) {
      const products = await storage.getProducts(store.id);
      for (const p of products) {
        if (p.status === 'active' && p.inventory_quantity <= 10) {
          alerts.push({ store: store.name, product: p.title, sku: p.sku, quantity: p.inventory_quantity });
        }
      }
    }
    alerts.sort((a, b) => a.quantity - b.quantity);

    return {
      contents: [{
        uri: 'store://inventory',
        text: JSON.stringify(alerts, null, 2),
      }],
    };
  }
);

server.registerResource(
  'store_recent_orders',
  'store://orders/recent',
  { title: 'Recent Orders', description: 'Last 20 orders across all stores' },
  async () => {
    const stores = await storage.getStores();
    const allRecent: Array<{ store: string; order_number: string; total: number; status: string; date: string }> = [];

    for (const store of stores) {
      const orders = await storage.getRecentOrders(store.id, 20);
      for (const o of orders) {
        allRecent.push({
          store: store.name, order_number: o.order_number,
          total: o.total, status: o.status, date: o.created_at,
        });
      }
    }
    allRecent.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      contents: [{
        uri: 'store://orders/recent',
        text: JSON.stringify(allRecent.slice(0, 20), null, 2),
      }],
    };
  }
);

server.registerResource(
  'store_top_customers',
  'store://customers/top',
  { title: 'Top Customers', description: 'Top 20 customers by total spending across all stores' },
  async () => {
    const stores = await storage.getStores();
    const allTop: Array<{ store: string; name: string; email: string; total_spent: number; orders: number }> = [];

    for (const store of stores) {
      const customers = await storage.getTopCustomers(store.id, 20);
      for (const c of customers) {
        allTop.push({
          store: store.name, name: c.name, email: c.email,
          total_spent: c.total_spent, orders: c.total_orders,
        });
      }
    }
    allTop.sort((a, b) => b.total_spent - a.total_spent);

    return {
      contents: [{
        uri: 'store://customers/top',
        text: JSON.stringify(allTop.slice(0, 20), null, 2),
      }],
    };
  }
);

// ── Smithery Sandbox ──────────────────────────────────────────────
let _sandboxMode = false;
export function createSandboxServer() {
  _sandboxMode = true;
  return server;
}

// ── Prompts ──────────────────────────────────────────────────────

server.registerPrompt(
  'inventory_alert',
  { title: 'Inventory Health Check', description: 'Scan inventory for low stock, stockout risks, and reorder recommendations using demand forecasting.' },
  async () => ({
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'I\'ll run a complete inventory health check.\n\n1. Use `inventory_status` to find current stock levels\n2. Run `inventory_forecast` to predict depletion dates\n3. Flag products at risk of stockout\n4. Generate reorder recommendations with quantities\n\nShall I start scanning your inventory?' },
    }],
  }),
);

server.registerPrompt(
  'sales_summary',
  { title: 'Sales Performance Summary', description: 'Generate a comprehensive sales report with product performance, customer segments, and trend analysis.' },
  async () => ({
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'Let me prepare your sales performance summary.\n\n1. Run `report_daily` for today\'s metrics\n2. Use `product_performance` for ABC analysis\n3. Check `customers_segment` for RFM breakdown\n4. Review `order_anomalies` for unusual patterns\n\nReady to generate the full report?' },
    }],
  }),
);

server.registerPrompt(
  'customer_retention',
  { title: 'Customer Retention Analysis', description: 'Identify at-risk customers, analyze churn signals, and generate retention strategies using RFM segmentation.' },
  async () => ({
    messages: [{
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'I\'ll analyze your customer retention health.\n\n1. Use `customers_segment` to identify RFM segments\n2. Run `customers_churn` to score churn risk\n3. Find at-risk and hibernating customers\n4. Generate targeted retention recommendations\n\nWhich store should I analyze?' },
    }],
  }),
);

// ── Transport ─────────────────────────────────────────────────────
async function main() {
  const isHTTP = process.env.PORT || process.env.MCPIZE;

  if (isHTTP) {
    const port = parseInt(process.env.PORT ?? '8080', 10);

    const httpServer = createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', server: 'shopops-mcp', version: SERVER_VERSION }));
        return;
      }

      if ((req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE') && req.url === '/mcp') {
        try {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          try { await server.close(); } catch { /* not connected yet */ }
          await server.connect(transport);
          await transport.handleRequest(req, res);
        } catch (err) {
          console.error('[ShopOps MCP] Request error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    httpServer.listen(port, () => {
      console.error(`[ShopOps MCP] HTTP server listening on port ${port}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[ShopOps MCP] Running on stdio');
  }
}

setTimeout(() => {
  if (!_sandboxMode) {
    main().catch((err) => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
  }
}, 0);
