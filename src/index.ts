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
import { handleToolError, validateUUID } from './utils/errors.js';

// ── Server ────────────────────────────────────────────────────────
const server = new McpServer({
  name: 'shopops-mcp',
  version: '1.0.0',
});

// ── Tool: store_connect ───────────────────────────────────────────
server.registerTool(
  'store_connect',
  {
    title: 'Connect Store',
    description: 'Connect a Shopify or WooCommerce store. Fetches initial product, order, and customer data. Use action "connect" to add a new store, "sync" to refresh data, or "list" to see connected stores.',
    inputSchema: z.object({
      action: z.enum(['connect', 'sync', 'list']).describe('Action to perform'),
      name: z.string().optional().describe('Store display name (required for connect)'),
      platform: PlatformSchema.optional().describe('E-commerce platform (required for connect)'),
      url: z.string().optional().describe('Store URL (required for connect)'),
      api_key: z.string().optional().describe('API access token (required for connect)'),
      api_secret: z.string().optional().describe('API secret (required for WooCommerce connect)'),
      store_id: z.string().optional().describe('Store ID (required for sync)'),
    }),
  },
  async ({ action, name, platform, url, api_key, api_secret, store_id }) => {
    try {
      if (action === 'list') {
        const stores = await storage.getStores();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(stores.map((s) => ({
            id: s.id, name: s.name, platform: s.platform, url: s.url,
            products: s.product_count, orders: s.order_count, customers: s.customer_count,
            last_sync: s.last_sync_at,
          })), null, 2) }],
        };
      }

      if (action === 'sync') {
        if (!store_id) return { content: [{ type: 'text' as const, text: 'store_id is required for sync' }], isError: true };
        validateUUID(store_id, 'store');
        const result = await syncStore(store_id);
        return { content: [{ type: 'text' as const, text: `Store synced: ${result.products} products, ${result.orders} orders, ${result.customers} customers` }] };
      }

      // connect
      if (!name || !platform || !url || !api_key) {
        return { content: [{ type: 'text' as const, text: 'name, platform, url, and api_key are required for connect' }], isError: true };
      }
      const result = await connectStore({ name, platform, url, api_key, api_secret });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          message: `Store "${result.store.name}" connected successfully`,
          store_id: result.store.id,
          synced: result.synced,
        }, null, 2) }],
      };
    } catch (e) { return handleToolError(e); }
  }
);

// ── Tool: inventory_status ────────────────────────────────────────
server.registerTool(
  'inventory_status',
  {
    title: 'Inventory Status',
    description: 'Get current inventory levels for a store. Shows out-of-stock and low-stock products sorted by urgency.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
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
    description: 'Analyze product pricing with margin calculation, sales velocity, and AI-powered price optimization suggestions.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
      product_id: z.string().optional().describe('Specific product ID (omit for all)'),
    }),
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
    description: 'Get AI pricing optimization recommendations for products. Filters to only products where a price change is suggested, sorted by potential revenue impact.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
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
          change_percent: p.suggested_price !== null
            ? Math.round(((p.suggested_price - p.current_price) / p.current_price) * 10000) / 100
            : 0,
          reason: p.suggestion_reason,
          daily_revenue: p.revenue_per_day,
        }));
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
    description: 'Identify customers at risk of churning. Returns at-risk, hibernating, and lost customers with win-back recommendations.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
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
    description: 'Detect suspicious orders using statistical anomaly detection. Flags high-value orders, velocity spikes, unusual quantities, off-hours purchases, and new-customer high-value orders.',
    inputSchema: z.object({
      store_id: z.string().uuid().describe('Store ID'),
    }),
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
      date: z.string().optional().describe('Date (YYYY-MM-DD, defaults to today)'),
    }),
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

// ── Transport ─────────────────────────────────────────────────────
const isHTTP = process.env.PORT || process.env.MCPIZE;

if (isHTTP) {
  const port = parseInt(process.env.PORT ?? '8080', 10);

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  const httpServer = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'shopops-mcp', version: '1.0.0' }));
      return;
    }

    if ((req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE') && req.url === '/mcp') {
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  await server.connect(transport);

  httpServer.listen(port, () => {
    console.error(`[ShopOps MCP] HTTP server listening on port ${port}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ShopOps MCP] Running on stdio');
}
