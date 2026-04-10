import { describe, it, expect } from 'vitest';
import { segmentCustomers, identifyChurnRisk, determineSegment } from '../../src/services/rfm.js';
import type { Customer, Order } from '../../src/models/store.js';

const storeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeCustomer(id: string, totalOrders: number, totalSpent: number, lastOrderDaysAgo: number): Customer {
  const lastOrder = new Date(Date.now() - lastOrderDaysAgo * 86400000);
  return {
    id, store_id: storeId, external_id: id, email: `${id}@test.com`, name: `Customer ${id}`,
    total_orders: totalOrders, total_spent: totalSpent,
    first_order_at: '2024-01-01T00:00:00Z', last_order_at: lastOrder.toISOString(),
    avg_order_value: totalSpent / Math.max(1, totalOrders),
    country: 'US', city: 'NY', tags: [], created_at: '2024-01-01T00:00:00Z',
  };
}

function makeOrder(id: string, customerId: string, total: number, daysAgo: number): Order {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return {
    id, store_id: storeId, external_id: id, order_number: `#${id}`,
    customer_id: customerId, customer_email: `${customerId}@test.com`,
    status: 'delivered', subtotal: total, tax_total: 0, shipping_total: 0, discount_total: 0, total,
    currency: 'USD', items: [], shipping_country: 'US', shipping_city: 'NY',
    payment_method: 'stripe', ip_address: null, created_at: date.toISOString(), updated_at: date.toISOString(),
  };
}

describe('RFM Segmentation', () => {
  it('should segment customers into groups', () => {
    const customers = [
      makeCustomer('c1', 20, 5000, 2),   // Champion: recent, frequent, high spend
      makeCustomer('c2', 15, 3000, 5),   // Loyal
      makeCustomer('c3', 1, 50, 3),      // New
      makeCustomer('c4', 10, 2000, 120), // At risk: old but was frequent
      makeCustomer('c5', 2, 100, 200),   // Lost
      makeCustomer('c6', 8, 1500, 10),   // Potential
      makeCustomer('c7', 3, 300, 150),   // Hibernating
    ];

    const orders: Order[] = [];
    // Generate orders matching customer profiles
    for (let i = 0; i < 20; i++) orders.push(makeOrder(`o_c1_${i}`, 'c1', 250, i * 2));
    for (let i = 0; i < 15; i++) orders.push(makeOrder(`o_c2_${i}`, 'c2', 200, i * 3));
    orders.push(makeOrder('o_c3_1', 'c3', 50, 3));
    for (let i = 0; i < 10; i++) orders.push(makeOrder(`o_c4_${i}`, 'c4', 200, 120 + i * 5));
    for (let i = 0; i < 2; i++) orders.push(makeOrder(`o_c5_${i}`, 'c5', 50, 200 + i));
    for (let i = 0; i < 8; i++) orders.push(makeOrder(`o_c6_${i}`, 'c6', 187.5, 10 + i * 5));
    for (let i = 0; i < 3; i++) orders.push(makeOrder(`o_c7_${i}`, 'c7', 100, 150 + i));

    const results = segmentCustomers(customers, orders);
    expect(results.length).toBe(7);

    // Each customer should have RFM scores 1-5
    for (const r of results) {
      expect(r.recency_score).toBeGreaterThanOrEqual(1);
      expect(r.recency_score).toBeLessThanOrEqual(5);
      expect(r.frequency_score).toBeGreaterThanOrEqual(1);
      expect(r.frequency_score).toBeLessThanOrEqual(5);
      expect(r.monetary_score).toBeGreaterThanOrEqual(1);
      expect(r.monetary_score).toBeLessThanOrEqual(5);
      expect(r.recommended_action).toBeTruthy();
    }
  });

  it('should return empty for no customers', () => {
    const results = segmentCustomers([], []);
    expect(results).toEqual([]);
  });

  it('should identify churn risk customers', () => {
    const customers = [
      makeCustomer('c1', 20, 5000, 2),
      makeCustomer('c2', 10, 2000, 120),
      makeCustomer('c3', 2, 100, 200),
    ];
    const orders: Order[] = [];
    for (let i = 0; i < 20; i++) orders.push(makeOrder(`o1_${i}`, 'c1', 250, i * 2));
    for (let i = 0; i < 10; i++) orders.push(makeOrder(`o2_${i}`, 'c2', 200, 120 + i));
    for (let i = 0; i < 2; i++) orders.push(makeOrder(`o3_${i}`, 'c3', 50, 200 + i));

    const atRisk = identifyChurnRisk(customers, orders);
    // At least the old customers should be at risk
    expect(atRisk.length).toBeGreaterThanOrEqual(1);
  });

  it('determineSegment routes frequent-but-old customers to at_risk, not loyal (regression)', () => {
    // Before the fix, any customer with F>=4 and M>=3 was labelled "loyal"
    // regardless of recency. That meant a customer who ordered a lot six
    // months ago still looked "loyal" and never triggered a win-back.
    // The fix adds an r >= 3 guard to the loyal clause.
    expect(determineSegment(1, 5, 4)).toBe('at_risk');   // old frequent → at_risk
    expect(determineSegment(2, 4, 3)).toBe('at_risk');   // old frequent → at_risk
    expect(determineSegment(3, 5, 4)).toBe('loyal');     // mostly-fresh frequent → loyal
    expect(determineSegment(5, 5, 5)).toBe('champions'); // peak in all dims
    expect(determineSegment(5, 1, 1)).toBe('new');       // fresh first-timer
    expect(determineSegment(1, 1, 1)).toBe('lost');      // stale in all dims
  });
});
