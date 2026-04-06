import type { Order, AnomalyResult, AnomalyType } from '../models/store.js';

const MS_PER_DAY = 86_400_000;

function safeTimestamp(dateStr: string): number {
  const ts = new Date(dateStr).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

interface OrderStats {
  avgTotal: number;
  stdDevTotal: number;
  avgItemQty: number;
  stdDevItemQty: number;
  avgOrdersPerDay: number;
}

/**
 * Compute baseline order statistics for anomaly comparison.
 */
function computeOrderStats(orders: Order[]): OrderStats {
  const validOrders = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'refunded');
  if (validOrders.length === 0) {
    return { avgTotal: 0, stdDevTotal: 0, avgItemQty: 0, stdDevItemQty: 0, avgOrdersPerDay: 0 };
  }

  const totals = validOrders.map((o) => o.total);
  const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
  const stdDevTotal = Math.sqrt(
    totals.reduce((sum, v) => sum + (v - avgTotal) ** 2, 0) / Math.max(1, totals.length - 1)
  );

  const itemQtys = validOrders.map((o) => o.items.reduce((sum, i) => sum + i.quantity, 0));
  const avgItemQty = itemQtys.reduce((a, b) => a + b, 0) / itemQtys.length;
  const stdDevItemQty = Math.sqrt(
    itemQtys.reduce((sum, v) => sum + (v - avgItemQty) ** 2, 0) / Math.max(1, itemQtys.length - 1)
  );

  // Orders per day
  const timestamps = validOrders.map((o) => safeTimestamp(o.created_at));
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const daySpan = Math.max(1, (maxTs - minTs) / MS_PER_DAY);
  const avgOrdersPerDay = validOrders.length / daySpan;

  return { avgTotal, stdDevTotal, avgItemQty, stdDevItemQty, avgOrdersPerDay };
}

/**
 * Check for order velocity spikes — unusually many orders in a short window.
 */
function checkVelocitySpike(order: Order, allOrders: Order[], stats: OrderStats): boolean {
  const orderTs = safeTimestamp(order.created_at);
  const windowMs = 3600_000; // 1-hour window
  const nearbyOrders = allOrders.filter((o) => {
    const ts = safeTimestamp(o.created_at);
    return Math.abs(ts - orderTs) <= windowMs && o.id !== order.id;
  });

  // If the hourly rate is 5× the daily average, flag it
  const hourlyRate = nearbyOrders.length;
  const expectedHourly = stats.avgOrdersPerDay / 24;
  return expectedHourly > 0 && hourlyRate > Math.max(5, expectedHourly * 5);
}

/**
 * Check if the order was placed during off-hours (midnight to 5am local).
 */
function checkOffHours(order: Order): boolean {
  const hour = new Date(order.created_at).getUTCHours();
  return hour >= 0 && hour < 5;
}

/**
 * Check if a new customer (first order) placed a high-value order.
 */
function checkNewCustomerHighValue(order: Order, allOrders: Order[], stats: OrderStats): boolean {
  if (!order.customer_id) return false;
  const customerOrders = allOrders.filter((o) => o.customer_id === order.customer_id);
  const isFirstOrder = customerOrders.length <= 1;
  return isFirstOrder && order.total > stats.avgTotal * 3;
}

/**
 * Detect anomalies in a single order.
 */
function analyzeOrder(order: Order, allOrders: Order[], stats: OrderStats): AnomalyResult | null {
  const flags: string[] = [];
  const anomalyTypes: AnomalyType[] = [];
  let riskScore = 0;

  // 1. High value — more than 3 standard deviations above mean
  if (stats.stdDevTotal > 0 && order.total > stats.avgTotal + 3 * stats.stdDevTotal) {
    anomalyTypes.push('high_value');
    flags.push(`Order total $${order.total.toFixed(2)} is ${((order.total - stats.avgTotal) / stats.stdDevTotal).toFixed(1)}σ above average`);
    riskScore += 30;
  }

  // 2. Unusual item quantity
  const totalQty = order.items.reduce((sum, i) => sum + i.quantity, 0);
  if (stats.stdDevItemQty > 0 && totalQty > stats.avgItemQty + 3 * stats.stdDevItemQty) {
    anomalyTypes.push('unusual_quantity');
    flags.push(`${totalQty} items ordered — ${((totalQty - stats.avgItemQty) / stats.stdDevItemQty).toFixed(1)}σ above average`);
    riskScore += 25;
  }

  // 3. Velocity spike
  if (checkVelocitySpike(order, allOrders, stats)) {
    anomalyTypes.push('velocity_spike');
    flags.push('Unusual order volume detected in a short time window');
    riskScore += 20;
  }

  // 4. Off-hours ordering
  if (checkOffHours(order)) {
    anomalyTypes.push('off_hours');
    flags.push('Order placed during off-hours (00:00-05:00 UTC)');
    riskScore += 10;
  }

  // 5. New customer + high value
  if (checkNewCustomerHighValue(order, allOrders, stats)) {
    anomalyTypes.push('new_customer_high_value');
    flags.push('First-time customer with unusually high order value');
    riskScore += 25;
  }

  // 6. Missing customer info
  if (!order.customer_email && !order.customer_id) {
    flags.push('No customer email or ID associated');
    riskScore += 10;
  }

  if (anomalyTypes.length === 0 && riskScore < 15) return null;

  riskScore = Math.min(100, riskScore);
  const riskLevel = riskScore <= 25 ? 'low' as const
    : riskScore <= 50 ? 'medium' as const
    : riskScore <= 75 ? 'high' as const
    : 'critical' as const;

  let action: string;
  if (riskLevel === 'critical') {
    action = 'Hold order for manual review. Verify payment method and contact customer before fulfilling.';
  } else if (riskLevel === 'high') {
    action = 'Flag for review. Verify shipping address matches billing. Consider additional verification.';
  } else if (riskLevel === 'medium') {
    action = 'Monitor closely. No immediate action needed but track for patterns.';
  } else {
    action = 'Low risk. Standard processing.';
  }

  return {
    order_id: order.id,
    order_number: order.order_number,
    anomaly_types: anomalyTypes,
    risk_score: riskScore,
    risk_level: riskLevel,
    total: order.total,
    customer_email: order.customer_email,
    flags,
    recommended_action: action,
  };
}

/**
 * Detect anomalies across all orders for a store.
 */
export function detectAnomalies(orders: Order[]): AnomalyResult[] {
  if (orders.length < 5) return []; // Need baseline data

  const stats = computeOrderStats(orders);
  const results: AnomalyResult[] = [];

  // Only analyze recent orders (last 30 days)
  const cutoff = Date.now() - 30 * MS_PER_DAY;
  const recentOrders = orders.filter((o) => safeTimestamp(o.created_at) >= cutoff);

  for (const order of recentOrders) {
    if (order.status === 'cancelled' || order.status === 'refunded') continue;
    const result = analyzeOrder(order, orders, stats);
    if (result) results.push(result);
  }

  return results.sort((a, b) => b.risk_score - a.risk_score);
}
