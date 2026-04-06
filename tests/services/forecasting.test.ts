import { describe, it, expect } from 'vitest';
import { forecastProduct, forecastAll } from '../../src/services/forecasting.js';
import type { Product, Order } from '../../src/models/store.js';

const storeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeProduct(stock: number): Product {
  return {
    id: 'p_001', store_id: storeId, external_id: '1', title: 'Widget', sku: 'W-001',
    price: 19.99, compare_at_price: null, cost_price: 8.00, currency: 'USD',
    inventory_quantity: stock, category: 'Gadgets', status: 'active',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
  };
}

function makeOrders(dailySales: number, days: number): Order[] {
  const orders: Order[] = [];
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < dailySales; s++) {
      orders.push({
        id: `o_${d}_${s}`, store_id: storeId, external_id: `${d}_${s}`, order_number: `#${d}_${s}`,
        customer_id: null, customer_email: null, status: 'delivered',
        subtotal: 19.99, tax_total: 0, shipping_total: 0, discount_total: 0, total: 19.99,
        currency: 'USD',
        items: [{ product_id: 'p_001', title: 'Widget', sku: 'W-001', quantity: 1, unit_price: 19.99, total: 19.99 }],
        shipping_country: 'US', shipping_city: 'NY', payment_method: null, ip_address: null,
        created_at: new Date(now - d * 86400000).toISOString(),
        updated_at: new Date(now - d * 86400000).toISOString(),
      });
    }
  }
  return orders;
}

describe('Forecasting', () => {
  it('should forecast depletion for steady sales', () => {
    const product = makeProduct(100);
    const orders = makeOrders(5, 30); // 5 units/day for 30 days
    const forecast = forecastProduct(product, orders);

    expect(forecast.avg_daily_sales).toBeCloseTo(5, 0);
    expect(forecast.days_of_stock).toBe(20); // 100 / 5
    expect(forecast.depletion_date).toBeTruthy();
    expect(forecast.reorder_point).toBeGreaterThan(0);
    expect(forecast.safety_stock).toBeGreaterThanOrEqual(0);
  });

  it('should mark out-of-stock as critical', () => {
    const product = makeProduct(0);
    const orders = makeOrders(2, 30);
    const forecast = forecastProduct(product, orders);

    expect(forecast.risk_level).toBe('critical');
    expect(forecast.current_stock).toBe(0);
  });

  it('should handle zero sales gracefully', () => {
    const product = makeProduct(100);
    const forecast = forecastProduct(product, []);

    expect(forecast.avg_daily_sales).toBe(0);
    expect(forecast.days_of_stock).toBeNull();
    expect(forecast.risk_level).toBe('low');
  });

  it('should sort forecasts by risk level', () => {
    const products = [
      { ...makeProduct(100), id: 'p_ok' },
      { ...makeProduct(0), id: 'p_critical' },
      { ...makeProduct(5), id: 'p_low' },
    ];
    const orders = makeOrders(3, 30);
    const results = forecastAll(products, orders);

    expect(results[0].product_id).toBe('p_critical');
  });
});
