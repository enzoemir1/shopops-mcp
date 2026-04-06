import type { ProductPerformance } from '../models/store.js';
import { storage } from '../services/storage.js';
import { validateUUID, NotFoundError } from '../utils/errors.js';

const MS_PER_DAY = 86_400_000;

export interface ProductPerformanceSummary {
  store_id: string;
  period_days: number;
  total_products: number;
  total_revenue: number;
  category_a: number;
  category_b: number;
  category_c: number;
  products: ProductPerformance[];
}

/**
 * ABC analysis: categorize products by revenue contribution.
 * A = top 80% revenue, B = next 15%, C = bottom 5%.
 */
export async function getProductPerformance(storeId: string, periodDays = 30): Promise<ProductPerformanceSummary> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const products = await storage.getProducts(storeId);
  const orders = await storage.getOrders(storeId);

  const now = Date.now();
  const cutoff = now - periodDays * MS_PER_DAY;
  const olderCutoff = now - 2 * periodDays * MS_PER_DAY;

  const recentOrders = orders.filter((o) =>
    new Date(o.created_at).getTime() >= cutoff &&
    o.status !== 'cancelled' && o.status !== 'refunded'
  );
  const olderOrders = orders.filter((o) => {
    const ts = new Date(o.created_at).getTime();
    return ts >= olderCutoff && ts < cutoff && o.status !== 'cancelled' && o.status !== 'refunded';
  });

  // Aggregate per-product metrics
  const productMetrics = new Map<string, { unitsSold: number; revenue: number; prevUnitsSold: number }>();

  for (const order of recentOrders) {
    for (const item of order.items) {
      const existing = productMetrics.get(item.product_id) ?? { unitsSold: 0, revenue: 0, prevUnitsSold: 0 };
      existing.unitsSold += item.quantity;
      existing.revenue += item.total;
      productMetrics.set(item.product_id, existing);
    }
  }

  for (const order of olderOrders) {
    for (const item of order.items) {
      const existing = productMetrics.get(item.product_id) ?? { unitsSold: 0, revenue: 0, prevUnitsSold: 0 };
      existing.prevUnitsSold += item.quantity;
      productMetrics.set(item.product_id, existing);
    }
  }

  const totalRevenue = [...productMetrics.values()].reduce((sum, m) => sum + m.revenue, 0);

  // Build performance records sorted by revenue
  const perfRecords: ProductPerformance[] = [];
  for (const product of products) {
    const metrics = productMetrics.get(product.id);
    if (!metrics && product.status !== 'active') continue;

    const unitsSold = metrics?.unitsSold ?? 0;
    const revenue = metrics?.revenue ?? 0;
    const prevUnits = metrics?.prevUnitsSold ?? 0;
    const cost = product.cost_price !== null ? product.cost_price * unitsSold : null;
    const profit = cost !== null ? revenue - cost : null;
    const marginPercent = revenue > 0 && cost !== null ? Math.round(((revenue - cost) / revenue) * 10000) / 100 : null;

    // Trend: compare with previous period
    let trend: 'rising' | 'stable' | 'declining';
    if (prevUnits === 0 && unitsSold > 0) trend = 'rising';
    else if (prevUnits === 0 && unitsSold === 0) trend = 'stable';
    else {
      const changeRate = (unitsSold - prevUnits) / Math.max(1, prevUnits);
      trend = changeRate > 0.15 ? 'rising' : changeRate < -0.15 ? 'declining' : 'stable';
    }

    perfRecords.push({
      product_id: product.id,
      product_title: product.title,
      sku: product.sku,
      units_sold: unitsSold,
      revenue: Math.round(revenue * 100) / 100,
      cost,
      profit: profit !== null ? Math.round(profit * 100) / 100 : null,
      margin_percent: marginPercent,
      abc_category: 'C', // placeholder, calculated below
      revenue_share_percent: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 10000) / 100 : 0,
      avg_daily_units: Math.round((unitsSold / periodDays) * 100) / 100,
      trend,
    });
  }

  // Sort by revenue descending for ABC
  perfRecords.sort((a, b) => b.revenue - a.revenue);

  // ABC categorization
  let cumulativeShare = 0;
  for (const rec of perfRecords) {
    cumulativeShare += rec.revenue_share_percent;
    if (cumulativeShare <= 80) rec.abc_category = 'A';
    else if (cumulativeShare <= 95) rec.abc_category = 'B';
    else rec.abc_category = 'C';
  }

  return {
    store_id: storeId,
    period_days: periodDays,
    total_products: perfRecords.length,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    category_a: perfRecords.filter((p) => p.abc_category === 'A').length,
    category_b: perfRecords.filter((p) => p.abc_category === 'B').length,
    category_c: perfRecords.filter((p) => p.abc_category === 'C').length,
    products: perfRecords,
  };
}
