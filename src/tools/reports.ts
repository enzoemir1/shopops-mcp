import type { DailyReport, WeeklyReport, RFMSegment } from '../models/store.js';
import { storage } from '../services/storage.js';
import { forecastAll } from '../services/forecasting.js';
import { segmentCustomers } from '../services/rfm.js';
import { detectAnomalies } from '../services/anomaly.js';
import { validateUUID, NotFoundError } from '../utils/errors.js';

const MS_PER_DAY = 86_400_000;

export async function generateDailyReport(storeId: string, date?: string): Promise<DailyReport> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${targetDate}T00:00:00Z`).getTime();
  const dayEnd = dayStart + MS_PER_DAY;

  const allOrders = await storage.getOrders(storeId);
  const dayOrders = allOrders.filter((o) => {
    const ts = new Date(o.created_at).getTime();
    return ts >= dayStart && ts < dayEnd && o.status !== 'cancelled' && o.status !== 'refunded';
  });

  const totalRevenue = dayOrders.reduce((sum, o) => sum + o.total, 0);
  const avgOrderValue = dayOrders.length > 0 ? totalRevenue / dayOrders.length : 0;

  // Count new vs returning
  const customerOrderCounts = new Map<string, number>();
  for (const order of allOrders) {
    if (!order.customer_id || order.status === 'cancelled') continue;
    const ts = new Date(order.created_at).getTime();
    if (ts < dayStart) {
      customerOrderCounts.set(order.customer_id, (customerOrderCounts.get(order.customer_id) ?? 0) + 1);
    }
  }

  let newCustomers = 0;
  let returningCustomers = 0;
  const seenCustomers = new Set<string>();
  for (const order of dayOrders) {
    if (!order.customer_id || seenCustomers.has(order.customer_id)) continue;
    seenCustomers.add(order.customer_id);
    if ((customerOrderCounts.get(order.customer_id) ?? 0) > 0) {
      returningCustomers++;
    } else {
      newCustomers++;
    }
  }

  // Top products
  const productSales = new Map<string, { title: string; units: number; revenue: number }>();
  for (const order of dayOrders) {
    for (const item of order.items) {
      const existing = productSales.get(item.product_id);
      if (existing) {
        existing.units += item.quantity;
        existing.revenue += item.total;
      } else {
        productSales.set(item.product_id, { title: item.title, units: item.quantity, revenue: item.total });
      }
    }
  }
  const topProducts = [...productSales.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)
    .map((p) => ({ title: p.title, units: p.units, revenue: Math.round(p.revenue * 100) / 100 }));

  // Low stock alerts
  const products = await storage.getProducts(storeId);
  const forecasts = forecastAll(products, allOrders);
  const lowStockAlerts = forecasts
    .filter((f) => f.risk_level === 'critical' || f.risk_level === 'high')
    .slice(0, 5)
    .map((f) => ({ title: f.product_title, current_stock: f.current_stock, days_left: f.days_of_stock }));

  // Anomalies
  const anomalies = detectAnomalies(allOrders);
  const anomalyCount = anomalies.filter((a) => a.risk_level === 'high' || a.risk_level === 'critical').length;

  // Summary
  const summaryParts: string[] = [];
  summaryParts.push(`${dayOrders.length} orders totaling $${totalRevenue.toFixed(2)}`);
  if (newCustomers > 0) summaryParts.push(`${newCustomers} new customer(s)`);
  if (lowStockAlerts.length > 0) summaryParts.push(`${lowStockAlerts.length} product(s) need restocking`);
  if (anomalyCount > 0) summaryParts.push(`${anomalyCount} order anomaly alert(s)`);

  return {
    store_id: storeId,
    date: targetDate,
    total_orders: dayOrders.length,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    avg_order_value: Math.round(avgOrderValue * 100) / 100,
    new_customers: newCustomers,
    returning_customers: returningCustomers,
    top_products: topProducts,
    low_stock_alerts: lowStockAlerts,
    anomaly_count: anomalyCount,
    summary: summaryParts.join('. ') + '.',
  };
}

export async function generateWeeklyReport(storeId: string): Promise<WeeklyReport> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const now = Date.now();
  const weekEnd = new Date(now).toISOString().slice(0, 10);
  const weekStart = new Date(now - 7 * MS_PER_DAY).toISOString().slice(0, 10);

  const allOrders = await storage.getOrders(storeId);
  const thisWeek = allOrders.filter((o) => {
    const ts = new Date(o.created_at).getTime();
    return ts >= now - 7 * MS_PER_DAY && o.status !== 'cancelled' && o.status !== 'refunded';
  });
  const prevWeek = allOrders.filter((o) => {
    const ts = new Date(o.created_at).getTime();
    return ts >= now - 14 * MS_PER_DAY && ts < now - 7 * MS_PER_DAY && o.status !== 'cancelled' && o.status !== 'refunded';
  });

  const thisRevenue = thisWeek.reduce((sum, o) => sum + o.total, 0);
  const prevRevenue = prevWeek.reduce((sum, o) => sum + o.total, 0);
  const avgOrderValue = thisWeek.length > 0 ? thisRevenue / thisWeek.length : 0;
  const revenueChange = prevRevenue > 0 ? Math.round(((thisRevenue - prevRevenue) / prevRevenue) * 10000) / 100 : 0;
  const orderChange = prevWeek.length > 0 ? Math.round(((thisWeek.length - prevWeek.length) / prevWeek.length) * 10000) / 100 : 0;

  // Segment summary
  const customers = await storage.getCustomers(storeId);
  const rfmResults = segmentCustomers(customers, allOrders);
  const segmentMap = new Map<string, { count: number; revenue: number }>();
  for (const r of rfmResults) {
    const existing = segmentMap.get(r.segment) ?? { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += r.total_spent;
    segmentMap.set(r.segment, existing);
  }
  const topSegments = [...segmentMap.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([segment, data]) => ({
      segment: segment as RFMSegment,
      count: data.count,
      revenue: Math.round(data.revenue * 100) / 100,
    }));

  // Product trends
  const thisWeekProducts = new Map<string, { title: string; units: number }>();
  const prevWeekProducts = new Map<string, { title: string; units: number }>();
  for (const order of thisWeek) {
    for (const item of order.items) {
      const ex = thisWeekProducts.get(item.product_id) ?? { title: item.title, units: 0 };
      ex.units += item.quantity;
      thisWeekProducts.set(item.product_id, ex);
    }
  }
  for (const order of prevWeek) {
    for (const item of order.items) {
      const ex = prevWeekProducts.get(item.product_id) ?? { title: item.title, units: 0 };
      ex.units += item.quantity;
      prevWeekProducts.set(item.product_id, ex);
    }
  }

  const trendingProducts = [...thisWeekProducts.entries()]
    .map(([id, data]) => {
      const prev = prevWeekProducts.get(id)?.units ?? 0;
      const change = data.units - prev;
      const trend = change > 2 ? 'rising' as const : change < -2 ? 'declining' as const : 'stable' as const;
      return { title: data.title, units_change: change, trend };
    })
    .sort((a, b) => Math.abs(b.units_change) - Math.abs(a.units_change))
    .slice(0, 5);

  // Insights
  const insights: string[] = [];
  if (revenueChange > 10) insights.push(`Revenue up ${revenueChange}% vs last week — strong growth`);
  else if (revenueChange < -10) insights.push(`Revenue down ${Math.abs(revenueChange)}% vs last week — needs attention`);
  else insights.push('Revenue is stable compared to last week');

  const risingProducts = trendingProducts.filter((p) => p.trend === 'rising');
  if (risingProducts.length > 0) insights.push(`${risingProducts.length} product(s) trending upward: ${risingProducts.map((p) => p.title).join(', ')}`);

  const atRisk = rfmResults.filter((r) => r.segment === 'at_risk' || r.segment === 'lost');
  if (atRisk.length > 0) insights.push(`${atRisk.length} customer(s) at risk of churning — consider win-back campaigns`);

  return {
    store_id: storeId,
    week_start: weekStart,
    week_end: weekEnd,
    total_orders: thisWeek.length,
    total_revenue: Math.round(thisRevenue * 100) / 100,
    avg_order_value: Math.round(avgOrderValue * 100) / 100,
    revenue_change_percent: revenueChange,
    order_change_percent: orderChange,
    top_segments: topSegments,
    trending_products: trendingProducts,
    insights,
    summary: insights.join('. ') + '.',
  };
}
