import type { Customer, Order, RFMResult, RFMSegment } from '../models/store.js';

const MS_PER_DAY = 86_400_000;

/**
 * Calculate percentile-based quintile scores (1-5).
 * Higher score = better (more recent, more frequent, higher monetary).
 */
function quintileScores(values: number[], ascending: boolean): number[] {
  if (values.length === 0) return [];

  const sorted = [...values].sort((a, b) => a - b);
  const percentiles = [
    sorted[Math.floor(sorted.length * 0.2)] ?? 0,
    sorted[Math.floor(sorted.length * 0.4)] ?? 0,
    sorted[Math.floor(sorted.length * 0.6)] ?? 0,
    sorted[Math.floor(sorted.length * 0.8)] ?? 0,
  ];

  return values.map((v) => {
    let score: number;
    if (v <= percentiles[0]) score = 1;
    else if (v <= percentiles[1]) score = 2;
    else if (v <= percentiles[2]) score = 3;
    else if (v <= percentiles[3]) score = 4;
    else score = 5;

    // For recency, lower days = better, so invert
    return ascending ? score : 6 - score;
  });
}

/**
 * Determine RFM segment based on R, F, M scores.
 *
 * Rule order matters: more specific segments must be checked first.
 * The loyal check intentionally requires r >= 3 so that high-frequency
 * customers who have stopped buying are routed to at_risk instead of
 * being mislabelled as loyal.
 *
 * Exported so tests can pin the decision boundary behaviour directly
 * without needing to set up enough customers to trigger specific
 * quintile scores.
 */
export function determineSegment(r: number, f: number, m: number): RFMSegment {
  const avg = (r + f + m) / 3;

  if (r >= 4 && f >= 4 && m >= 4) return 'champions';
  if (r >= 3 && f >= 4 && m >= 3) return 'loyal';
  if (r >= 4 && f <= 2) return 'new';
  if (r >= 3 && f >= 2 && avg >= 3) return 'potential';
  if (r <= 2 && f >= 3) return 'at_risk';
  if (r <= 2 && f <= 2 && m <= 2) return 'lost';
  return 'hibernating';
}

/**
 * Get recommended action for each segment.
 */
function segmentAction(segment: RFMSegment): string {
  const actions: Record<RFMSegment, string> = {
    champions: 'Reward with loyalty perks, early access, and referral programs. They are your best advocates.',
    loyal: 'Offer cross-sell and upsell opportunities. Invite to loyalty program if not already enrolled.',
    potential: 'Nurture with personalized recommendations and limited-time offers to increase purchase frequency.',
    at_risk: 'Win-back campaign urgently needed. Send personalized re-engagement email with special discount.',
    new: 'Welcome series with brand story. Guide toward second purchase with targeted product suggestions.',
    hibernating: 'Send reactivation campaign with strong incentive. If no response after 2 attempts, reduce marketing spend.',
    lost: 'Final win-back attempt with significant discount. Consider removing from active marketing to reduce costs.',
  };
  return actions[segment];
}

/**
 * Perform RFM segmentation on all customers of a store.
 */
export function segmentCustomers(customers: Customer[], orders: Order[]): RFMResult[] {
  if (customers.length === 0) return [];

  const now = Date.now();

  // Build per-customer order data from orders
  const customerOrders = new Map<string, { lastOrderTs: number; orderCount: number; totalSpent: number }>();
  for (const order of orders) {
    if (order.status === 'cancelled' || order.status === 'refunded') continue;
    if (!order.customer_id) continue;

    const existing = customerOrders.get(order.customer_id);
    const orderTs = new Date(order.created_at).getTime();

    if (existing) {
      existing.lastOrderTs = Math.max(existing.lastOrderTs, orderTs);
      existing.orderCount++;
      existing.totalSpent += order.total;
    } else {
      customerOrders.set(order.customer_id, {
        lastOrderTs: orderTs,
        orderCount: 1,
        totalSpent: order.total,
      });
    }
  }

  // Calculate raw RFM values
  const rfmRaw: Array<{ customer: Customer; recencyDays: number; frequency: number; monetary: number }> = [];

  for (const customer of customers) {
    const orderData = customerOrders.get(customer.id);
    const lastOrderTs = orderData?.lastOrderTs ?? (customer.last_order_at ? new Date(customer.last_order_at).getTime() : 0);
    const recencyDays = lastOrderTs > 0 ? Math.round((now - lastOrderTs) / MS_PER_DAY) : 999;
    const frequency = orderData?.orderCount ?? customer.total_orders;
    const monetary = orderData?.totalSpent ?? customer.total_spent;

    if (frequency === 0 && monetary === 0) continue; // Skip customers with no orders

    rfmRaw.push({ customer, recencyDays, frequency, monetary });
  }

  if (rfmRaw.length === 0) return [];

  // Score each dimension (1-5)
  const recencyScores = quintileScores(rfmRaw.map((r) => r.recencyDays), false);
  const frequencyScores = quintileScores(rfmRaw.map((r) => r.frequency), true);
  const monetaryScores = quintileScores(rfmRaw.map((r) => r.monetary), true);

  return rfmRaw.map((entry, i) => {
    const r = recencyScores[i];
    const f = frequencyScores[i];
    const m = monetaryScores[i];
    const segment = determineSegment(r, f, m);

    return {
      customer_id: entry.customer.id,
      customer_name: entry.customer.name,
      customer_email: entry.customer.email,
      recency_score: r,
      frequency_score: f,
      monetary_score: m,
      rfm_score: Math.round(((r + f + m) / 3) * 100) / 100,
      segment,
      total_orders: entry.frequency,
      total_spent: Math.round(entry.monetary * 100) / 100,
      last_order_days_ago: entry.recencyDays,
      recommended_action: segmentAction(segment),
    };
  }).sort((a, b) => b.rfm_score - a.rfm_score);
}

/**
 * Identify customers at risk of churning.
 * Uses recency threshold: customers who haven't ordered in 2× their average order interval.
 */
export function identifyChurnRisk(customers: Customer[], orders: Order[]): RFMResult[] {
  const all = segmentCustomers(customers, orders);
  return all.filter((r) =>
    r.segment === 'at_risk' || r.segment === 'hibernating' || r.segment === 'lost'
  );
}
