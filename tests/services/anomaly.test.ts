import { describe, it, expect } from 'vitest';
import { detectAnomalies } from '../../src/services/anomaly.js';
import type { Order } from '../../src/models/store.js';

const storeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeOrder(id: string, total: number, daysAgo: number, overrides: Partial<Order> = {}): Order {
  const date = new Date(Date.now() - daysAgo * 86400000);
  return {
    id, store_id: storeId, external_id: id, order_number: `#${id}`,
    customer_id: `c_${id}`, customer_email: `${id}@test.com`,
    status: 'delivered', subtotal: total, tax_total: 0, shipping_total: 0, discount_total: 0, total,
    currency: 'USD',
    items: [{ product_id: 'p_001', title: 'Widget', sku: null, quantity: 1, unit_price: total, total }],
    shipping_country: 'US', shipping_city: 'NY', payment_method: 'stripe', ip_address: '1.2.3.4',
    created_at: date.toISOString(), updated_at: date.toISOString(),
    ...overrides,
  };
}

describe('Anomaly Detection', () => {
  it('should detect high-value anomalies', () => {
    const orders: Order[] = [];
    // 20 normal orders (~$50)
    for (let i = 0; i < 20; i++) {
      orders.push(makeOrder(`normal_${i}`, 45 + Math.random() * 10, i + 1));
    }
    // 1 high-value order
    orders.push(makeOrder('high_value', 5000, 0));

    const anomalies = detectAnomalies(orders);
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    const highVal = anomalies.find((a) => a.order_id === 'high_value');
    expect(highVal).toBeDefined();
    expect(highVal!.anomaly_types).toContain('high_value');
  });

  it('should return empty for insufficient data', () => {
    const orders = [makeOrder('o1', 50, 1), makeOrder('o2', 55, 2)];
    const anomalies = detectAnomalies(orders);
    expect(anomalies).toEqual([]);
  });

  it('should not flag normal orders', () => {
    const orders: Order[] = [];
    for (let i = 0; i < 30; i++) {
      orders.push(makeOrder(`o_${i}`, 50, i));
    }
    const anomalies = detectAnomalies(orders);
    // All orders are similar — few or no anomalies
    expect(anomalies.length).toBeLessThan(5);
  });
});
