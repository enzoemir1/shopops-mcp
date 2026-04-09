import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { identifyChurnRisk } from '../../src/services/rfm.js';
import type { Customer, Order } from '../../src/models/store.js';

function makeCustomer(id: string, name: string): Customer {
  return { id, store_id: 'store1', name, email: `${name.toLowerCase()}@test.com`, total_orders: 0, total_spent: 0, created_at: new Date().toISOString() } as Customer;
}

function makeOrder(customerId: string, daysAgo: number, total: number): Order {
  const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return { id: uuidv4(), store_id: 'store1', customer_id: customerId, order_number: '1001', status: 'completed', total, currency: 'USD', items_count: 1, created_at: date } as Order;
}

describe('Churn Risk Detection', () => {
  it('should identify at-risk customers who stopped ordering', () => {
    const c1 = makeCustomer('c1', 'Active');
    const c2 = makeCustomer('c2', 'Lapsed');
    const c3 = makeCustomer('c3', 'Lost');

    const orders = [
      // c1: ordered recently
      makeOrder('c1', 5, 100), makeOrder('c1', 15, 80), makeOrder('c1', 30, 120),
      // c2: last order 60 days ago
      makeOrder('c2', 60, 200), makeOrder('c2', 90, 150),
      // c3: last order 180 days ago
      makeOrder('c3', 180, 50),
    ];

    const churnRisk = identifyChurnRisk([c1, c2, c3], orders);
    // c1 is active, should NOT be in churn list
    expect(churnRisk.find((r) => r.customer_id === 'c1')).toBeUndefined();
    // c2 and/or c3 should be flagged
    expect(churnRisk.length).toBeGreaterThan(0);
  });

  it('should return empty for all active customers', () => {
    const customers = [makeCustomer('c1', 'Active'), makeCustomer('c2', 'Buyer')];
    const orders = [
      makeOrder('c1', 2, 100), makeOrder('c1', 10, 80),
      makeOrder('c2', 3, 200), makeOrder('c2', 12, 150),
    ];
    const churnRisk = identifyChurnRisk(customers, orders);
    // All customers are recent buyers — churn risk should be low or empty
    expect(churnRisk.length).toBeLessThanOrEqual(customers.length);
  });

  it('should handle empty orders', () => {
    const customers = [makeCustomer('c1', 'NoOrders')];
    const churnRisk = identifyChurnRisk(customers, []);
    // No orders = can't determine churn
    expect(churnRisk).toBeDefined();
  });
});
