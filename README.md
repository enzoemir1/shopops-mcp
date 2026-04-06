# ShopOps MCP

**AI-powered server that implements the Model Context Protocol (MCP) for managing Shopify and WooCommerce stores.**

---

## Features

- **Store connectors** for Shopify and WooCommerce.
- **11 MCP tools** covering inventory, pricing, customers, orders, product performance and reporting.
- **4 MCP resources** exposing store overview, inventory, recent orders and top customers.
- Inventory forecasting using moving-average demand plus safety-stock calculation.
- RFM-based customer segmentation (7 distinct segments).
- AI-driven pricing analysis and optimization.
- Order anomaly / fraud detection.
- ABC analysis of product performance.
- Automated daily and weekly reports.
- Dual transport: local `stdio` and Streamable HTTP (MCPize).
- TypeScript, `@modelcontextprotocol/sdk` v1.29+, Zod v4.
- Free tier, plus $25 and $45 paid plans.

---

## Quick Start

```bash
# 1. Install the package
npm i shopops-mcp

# 2. Create a .env file (see Configuration section)
cp .env.example .env

# 3. Run the server (local stdio mode)
npx shopops-mcp run --transport stdio

# 4. Or start the HTTP endpoint (MCPize deployment)
npx shopops-mcp run --transport http --port 8080
```

The server will read the environment variables, connect to the configured store(s), and expose the MCP tools and resources.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `store_connect` | Establishes a connection to a Shopify or WooCommerce store and validates credentials. |
| `inventory_status` | Returns current stock levels, back-order flags and low-stock alerts. |
| `inventory_forecast` | Projects future inventory requirements using moving-average demand and safety-stock buffers. |
| `pricing_analyze` | Generates a price elasticity report and identifies under-/over-priced SKUs. |
| `pricing_optimize` | Suggests optimal price points based on AI-driven demand forecasts and competitor data. |
| `customers_segment` | Performs RFM analysis and assigns customers to one of seven segments. |
| `customers_churn` | Scores customers for churn risk and provides retention recommendations. |
| `order_anomalies` | Detects potentially fraudulent or erroneous orders using pattern-recognition models. |
| `product_performance` | Conducts ABC analysis and returns contribution metrics per product class. |
| `report_daily` | Generates a JSON/CSV daily operations summary (sales, inventory, alerts). |
| `report_weekly` | Generates a weekly performance report with trend visualisations. |

---

## MCP Resources

| Resource | Description |
|----------|-------------|
| `store://overview` | High-level store metrics: total sales, orders, customers, and gross margin. |
| `store://inventory` | Full inventory catalogue with quantity on hand, reserved stock and forecasted shortages. |
| `store://orders/recent` | List of the most recent 100 orders with status, total value and payment method. |
| `store://customers/top` | Top 50 customers ranked by lifetime value, purchase frequency and recency. |

---

## Configuration

Create a `.env` file at the project root. The following variables are required:

| Variable | Required for | Description |
|----------|--------------|-------------|
| `SHOPIFY_API_KEY` | Shopify | Private app API key. |
| `SHOPIFY_API_PASSWORD` | Shopify | Private app password. |
| `SHOPIFY_STORE_DOMAIN` | Shopify | Store domain (e.g., `myshop.myshopify.com`). |
| `WOOCOMMERCE_CONSUMER_KEY` | WooCommerce | REST API consumer key. |
| `WOOCOMMERCE_CONSUMER_SECRET` | WooCommerce | REST API consumer secret. |
| `WOOCOMMERCE_STORE_URL` | WooCommerce | Store URL (e.g., `https://example.com`). |
| `MCP_PORT` | HTTP transport | Port for the Streamable HTTP endpoint (default `8080`). |
| `MCP_LOG_LEVEL` | All | Logging verbosity (`error`, `warn`, `info`, `debug`). |
| `MCP_PRICING_MODEL` | Pricing tools | Select pricing model (`basic`, `advanced`). |
| `MCP_FORECAST_WINDOW_DAYS` | Inventory forecast | Number of days to forecast (default `30`). |

Optional variables:

| Variable | Description |
|----------|-------------|
| `MCP_ENABLE_ANONYMIZATION` | When set to `true`, personally identifiable data is masked in reports. |
| `MCP_REPORT_S3_BUCKET` | If provided, daily/weekly reports are uploaded to the specified S3 bucket. |

---

## License

ShopOps MCP is released under the **MIT License**. See `LICENSE` for full terms.

---

*Author: Automatia BCN*
