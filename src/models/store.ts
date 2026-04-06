import { z } from 'zod/v4';

// ── Store Platform ────────────────────────────────────────────────
export const PlatformSchema = z.enum(['shopify', 'woocommerce']);
export type Platform = z.infer<typeof PlatformSchema>;

export const StoreConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  platform: PlatformSchema,
  url: z.string().url(),
  api_key: z.string().min(1),
  api_secret: z.string().optional(),
  connected_at: z.string(),
  last_sync_at: z.string().nullable(),
  product_count: z.number().int().min(0),
  order_count: z.number().int().min(0),
  customer_count: z.number().int().min(0),
});
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

export const StoreConnectInputSchema = z.object({
  name: z.string().min(1).describe('Store display name'),
  platform: PlatformSchema.describe('E-commerce platform'),
  url: z.string().url().describe('Store URL (e.g. https://your-store.myshopify.com)'),
  api_key: z.string().min(1).describe('API access token or consumer key'),
  api_secret: z.string().optional().describe('API secret (required for WooCommerce)'),
});
export type StoreConnectInput = z.infer<typeof StoreConnectInputSchema>;

// ── Product ───────────────────────────────────────────────────────
export const ProductSchema = z.object({
  id: z.string(),
  store_id: z.string().uuid(),
  external_id: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  price: z.number().min(0),
  compare_at_price: z.number().min(0).nullable(),
  cost_price: z.number().min(0).nullable(),
  currency: z.string().default('USD'),
  inventory_quantity: z.number().int(),
  category: z.string().nullable(),
  status: z.enum(['active', 'draft', 'archived']),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

// ── Order ─────────────────────────────────────────────────────────
export const OrderStatusSchema = z.enum([
  'pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderItemSchema = z.object({
  product_id: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  quantity: z.number().int().min(1),
  unit_price: z.number().min(0),
  total: z.number().min(0),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  store_id: z.string().uuid(),
  external_id: z.string(),
  order_number: z.string(),
  customer_id: z.string().nullable(),
  customer_email: z.string().email().nullable(),
  status: OrderStatusSchema,
  subtotal: z.number().min(0),
  tax_total: z.number().min(0),
  shipping_total: z.number().min(0),
  discount_total: z.number().min(0),
  total: z.number().min(0),
  currency: z.string().default('USD'),
  items: z.array(OrderItemSchema),
  shipping_country: z.string().nullable(),
  shipping_city: z.string().nullable(),
  payment_method: z.string().nullable(),
  ip_address: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

// ── Customer ──────────────────────────────────────────────────────
export const CustomerSchema = z.object({
  id: z.string(),
  store_id: z.string().uuid(),
  external_id: z.string(),
  email: z.string().email(),
  name: z.string(),
  total_orders: z.number().int().min(0),
  total_spent: z.number().min(0),
  first_order_at: z.string().nullable(),
  last_order_at: z.string().nullable(),
  avg_order_value: z.number().min(0),
  country: z.string().nullable(),
  city: z.string().nullable(),
  tags: z.array(z.string()),
  created_at: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

// ── RFM Segmentation ──────────────────────────────────────────────
export const RFMSegmentSchema = z.enum([
  'champions', 'loyal', 'potential', 'at_risk', 'new', 'hibernating', 'lost',
]);
export type RFMSegment = z.infer<typeof RFMSegmentSchema>;

export const RFMResultSchema = z.object({
  customer_id: z.string(),
  customer_name: z.string(),
  customer_email: z.string(),
  recency_score: z.number().int().min(1).max(5),
  frequency_score: z.number().int().min(1).max(5),
  monetary_score: z.number().int().min(1).max(5),
  rfm_score: z.number(),
  segment: RFMSegmentSchema,
  total_orders: z.number().int(),
  total_spent: z.number(),
  last_order_days_ago: z.number().int(),
  recommended_action: z.string(),
});
export type RFMResult = z.infer<typeof RFMResultSchema>;

// ── Inventory Forecast ────────────────────────────────────────────
export const ForecastResultSchema = z.object({
  product_id: z.string(),
  product_title: z.string(),
  sku: z.string().nullable(),
  current_stock: z.number().int(),
  avg_daily_sales: z.number(),
  days_of_stock: z.number().nullable(),
  depletion_date: z.string().nullable(),
  reorder_point: z.number().int(),
  suggested_reorder_qty: z.number().int(),
  safety_stock: z.number().int(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  detail: z.string(),
});
export type ForecastResult = z.infer<typeof ForecastResultSchema>;

// ── Pricing Analysis ──────────────────────────────────────────────
export const PricingAnalysisSchema = z.object({
  product_id: z.string(),
  product_title: z.string(),
  current_price: z.number(),
  cost_price: z.number().nullable(),
  margin_percent: z.number().nullable(),
  compare_at_price: z.number().nullable(),
  discount_percent: z.number().nullable(),
  avg_units_per_day: z.number(),
  revenue_per_day: z.number(),
  price_elasticity_hint: z.string(),
  suggested_price: z.number().nullable(),
  suggestion_reason: z.string(),
});
export type PricingAnalysis = z.infer<typeof PricingAnalysisSchema>;

// ── Anomaly Detection ─────────────────────────────────────────────
export const AnomalyTypeSchema = z.enum([
  'high_value', 'velocity_spike', 'unusual_quantity',
  'off_hours', 'new_customer_high_value',
]);
export type AnomalyType = z.infer<typeof AnomalyTypeSchema>;

export const AnomalyResultSchema = z.object({
  order_id: z.string(),
  order_number: z.string(),
  anomaly_types: z.array(AnomalyTypeSchema),
  risk_score: z.number().min(0).max(100),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  total: z.number(),
  customer_email: z.string().nullable(),
  flags: z.array(z.string()),
  recommended_action: z.string(),
});
export type AnomalyResult = z.infer<typeof AnomalyResultSchema>;

// ── ABC Product Performance ───────────────────────────────────────
export const ABCCategorySchema = z.enum(['A', 'B', 'C']);

export const ProductPerformanceSchema = z.object({
  product_id: z.string(),
  product_title: z.string(),
  sku: z.string().nullable(),
  units_sold: z.number().int(),
  revenue: z.number(),
  cost: z.number().nullable(),
  profit: z.number().nullable(),
  margin_percent: z.number().nullable(),
  abc_category: ABCCategorySchema,
  revenue_share_percent: z.number(),
  avg_daily_units: z.number(),
  trend: z.enum(['rising', 'stable', 'declining']),
});
export type ProductPerformance = z.infer<typeof ProductPerformanceSchema>;

// ── Reports ───────────────────────────────────────────────────────
export const DailyReportSchema = z.object({
  store_id: z.string().uuid(),
  date: z.string(),
  total_orders: z.number().int(),
  total_revenue: z.number(),
  avg_order_value: z.number(),
  new_customers: z.number().int(),
  returning_customers: z.number().int(),
  top_products: z.array(z.object({
    title: z.string(),
    units: z.number().int(),
    revenue: z.number(),
  })),
  low_stock_alerts: z.array(z.object({
    title: z.string(),
    current_stock: z.number().int(),
    days_left: z.number().nullable(),
  })),
  anomaly_count: z.number().int(),
  summary: z.string(),
});
export type DailyReport = z.infer<typeof DailyReportSchema>;

export const WeeklyReportSchema = z.object({
  store_id: z.string().uuid(),
  week_start: z.string(),
  week_end: z.string(),
  total_orders: z.number().int(),
  total_revenue: z.number(),
  avg_order_value: z.number(),
  revenue_change_percent: z.number(),
  order_change_percent: z.number(),
  top_segments: z.array(z.object({
    segment: RFMSegmentSchema,
    count: z.number().int(),
    revenue: z.number(),
  })),
  trending_products: z.array(z.object({
    title: z.string(),
    units_change: z.number().int(),
    trend: z.enum(['rising', 'stable', 'declining']),
  })),
  insights: z.array(z.string()),
  summary: z.string(),
});
export type WeeklyReport = z.infer<typeof WeeklyReportSchema>;
