import type { Product, Order, ForecastResult } from '../models/store.js';

const MS_PER_DAY = 86_400_000;

interface SalesDataPoint {
  date: string;
  quantity: number;
}

/**
 * Compute daily sales for a product over the given order history.
 */
function computeDailySales(productId: string, orders: Order[], daysBack: number): SalesDataPoint[] {
  const now = Date.now();
  const cutoff = now - daysBack * MS_PER_DAY;
  const dailyMap = new Map<string, number>();

  for (const order of orders) {
    const ts = new Date(order.created_at).getTime();
    if (ts < cutoff || order.status === 'cancelled' || order.status === 'refunded') continue;

    for (const item of order.items) {
      if (item.product_id === productId) {
        const dateKey = new Date(order.created_at).toISOString().slice(0, 10);
        dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + item.quantity);
      }
    }
  }

  // Fill in zero-sale days
  const result: SalesDataPoint[] = [];
  for (let d = 0; d < daysBack; d++) {
    const dateKey = new Date(now - d * MS_PER_DAY).toISOString().slice(0, 10);
    result.push({ date: dateKey, quantity: dailyMap.get(dateKey) ?? 0 });
  }

  return result.reverse();
}

/**
 * Simple moving average over the last N data points.
 */
function movingAverage(data: number[], window: number): number {
  if (data.length === 0) return 0;
  const slice = data.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Standard deviation for safety stock calculation.
 */
function stdDev(data: number[]): number {
  if (data.length < 2) return 0;
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const variance = data.reduce((sum, val) => sum + (val - mean) ** 2, 0) / (data.length - 1);
  return Math.sqrt(variance);
}

/**
 * Forecast inventory depletion for a single product.
 *
 * Uses 30-day moving average for sales velocity, standard deviation for safety stock,
 * and calculates reorder point based on assumed 7-day lead time.
 */
export function forecastProduct(product: Product, orders: Order[], daysBack = 30): ForecastResult {
  const dailySales = computeDailySales(product.id, orders, daysBack);
  const quantities = dailySales.map((d) => d.quantity);

  const avgDaily = movingAverage(quantities, daysBack);
  const salesStdDev = stdDev(quantities);

  // Safety stock: 1.65 × σ × √leadTime (95% service level, 7-day lead time)
  const leadTimeDays = 7;
  const safetyStock = Math.ceil(1.65 * salesStdDev * Math.sqrt(leadTimeDays));

  // Reorder point: (avg daily sales × lead time) + safety stock
  const reorderPoint = Math.ceil(avgDaily * leadTimeDays + safetyStock);

  // Days of stock remaining
  const currentStock = product.inventory_quantity;
  const daysOfStock = avgDaily > 0 ? currentStock / avgDaily : null;

  // Depletion date
  let depletionDate: string | null = null;
  if (daysOfStock !== null && Number.isFinite(daysOfStock)) {
    depletionDate = new Date(Date.now() + daysOfStock * MS_PER_DAY).toISOString().slice(0, 10);
  }

  // Suggested reorder quantity: 30 days of avg sales + safety stock - current stock
  const targetStock = Math.ceil(avgDaily * 30 + safetyStock);
  const suggestedReorder = Math.max(0, targetStock - currentStock);

  // Risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  let detail: string;

  if (currentStock <= 0) {
    riskLevel = 'critical';
    detail = 'Out of stock — immediate restock needed';
  } else if (daysOfStock !== null && daysOfStock <= 3) {
    riskLevel = 'critical';
    detail = `Only ${Math.round(daysOfStock)} day(s) of stock remaining`;
  } else if (daysOfStock !== null && daysOfStock <= 7) {
    riskLevel = 'high';
    detail = `${Math.round(daysOfStock)} days of stock — below lead time threshold`;
  } else if (currentStock <= reorderPoint) {
    riskLevel = 'medium';
    detail = `Stock at or below reorder point (${reorderPoint} units)`;
  } else if (daysOfStock !== null && daysOfStock <= 14) {
    riskLevel = 'medium';
    detail = `${Math.round(daysOfStock)} days of stock — approaching reorder point`;
  } else {
    riskLevel = 'low';
    detail = daysOfStock !== null
      ? `${Math.round(daysOfStock)} days of stock remaining`
      : 'No recent sales data — unable to forecast depletion';
  }

  return {
    product_id: product.id,
    product_title: product.title,
    sku: product.sku,
    current_stock: currentStock,
    avg_daily_sales: Math.round(avgDaily * 100) / 100,
    days_of_stock: daysOfStock !== null ? Math.round(daysOfStock) : null,
    depletion_date: depletionDate,
    reorder_point: reorderPoint,
    suggested_reorder_qty: suggestedReorder,
    safety_stock: safetyStock,
    risk_level: riskLevel,
    detail,
  };
}

/**
 * Forecast inventory for all products in a store.
 */
export function forecastAll(products: Product[], orders: Order[], daysBack = 30): ForecastResult[] {
  return products
    .filter((p) => p.status === 'active')
    .map((p) => forecastProduct(p, orders, daysBack))
    .sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return riskOrder[a.risk_level] - riskOrder[b.risk_level];
    });
}
