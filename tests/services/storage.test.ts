import { describe, it, expect, beforeEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { storage } from '../../src/services/storage.js';
import type { StoreConfig, Product, Order, Customer } from '../../src/models/store.js';

const DATA_DIR = join(process.cwd(), 'data');

function makeStore(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'Test Store',
    platform: 'shopify',
    url: 'https://test.myshopify.com',
    api_key: 'shpat_test',
    connected_at: new Date().toISOString(),
    last_sync_at: null,
    product_count: 0,
    order_count: 0,
    customer_count: 0,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p_001',
    store_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    external_id: '1001',
    title: 'Test Product',
    sku: 'TP-001',
    price: 29.99,
    compare_at_price: null,
    cost_price: 10.00,
    currency: 'USD',
    inventory_quantity: 50,
    category: 'Electronics',
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o_001',
    store_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    external_id: '2001',
    order_number: '#1001',
    customer_id: 'c_001',
    customer_email: 'test@example.com',
    status: 'delivered',
    subtotal: 29.99,
    tax_total: 3.00,
    shipping_total: 5.00,
    discount_total: 0,
    total: 37.99,
    currency: 'USD',
    items: [{ product_id: 'p_001', title: 'Test Product', sku: 'TP-001', quantity: 1, unit_price: 29.99, total: 29.99 }],
    shipping_country: 'US',
    shipping_city: 'New York',
    payment_method: 'stripe',
    ip_address: '1.2.3.4',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c_001',
    store_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    external_id: '3001',
    email: 'test@example.com',
    name: 'Test Customer',
    total_orders: 5,
    total_spent: 189.95,
    first_order_at: '2025-01-01T00:00:00Z',
    last_order_at: '2026-03-01T00:00:00Z',
    avg_order_value: 37.99,
    country: 'US',
    city: 'New York',
    tags: ['vip'],
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await rm(DATA_DIR, { recursive: true, force: true });
});

describe('Storage', () => {
  it('should add and retrieve a store', async () => {
    const store = makeStore();
    await storage.addStore(store);
    const found = await storage.getStoreById(store.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Store');
  });

  it('should find store by URL', async () => {
    await storage.addStore(makeStore());
    const found = await storage.getStoreByUrl('https://test.myshopify.com');
    expect(found).toBeDefined();
    expect(found!.id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('should update store', async () => {
    await storage.addStore(makeStore());
    const updated = await storage.updateStore('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { product_count: 42 });
    expect(updated!.product_count).toBe(42);
  });

  it('should upsert products', async () => {
    const p1 = makeProduct({ id: 'p_001' });
    const p2 = makeProduct({ id: 'p_002', title: 'Product 2' });
    await storage.upsertProducts([p1, p2]);
    const products = await storage.getProducts('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(products).toHaveLength(2);

    await storage.upsertProducts([{ ...p1, price: 39.99 }]);
    const updated = await storage.getProductById('p_001');
    expect(updated!.price).toBe(39.99);
  });

  it('should upsert and query recent orders', async () => {
    const now = new Date();
    const o1 = makeOrder({ id: 'o_001', created_at: now.toISOString() });
    const o2 = makeOrder({ id: 'o_002', order_number: '#1002', created_at: new Date(now.getTime() - 86400000).toISOString() });
    await storage.upsertOrders([o1, o2]);
    const recent = await storage.getRecentOrders('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 1);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('o_001');
  });

  it('should upsert and retrieve top customers', async () => {
    const c1 = makeCustomer({ id: 'c_001', total_spent: 500 });
    const c2 = makeCustomer({ id: 'c_002', email: 'c2@test.com', total_spent: 200 });
    await storage.upsertCustomers([c1, c2]);
    const top = await storage.getTopCustomers('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 1);
    expect(top).toHaveLength(1);
    expect(top[0].total_spent).toBe(500);
  });

  it('should filter orders by date range', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 86400000);
    await storage.upsertOrders([
      makeOrder({ id: 'o_new', created_at: now.toISOString() }),
      makeOrder({ id: 'o_old', created_at: old.toISOString() }),
    ]);
    const recent = await storage.getOrdersByDateRange(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      new Date(now.getTime() - 7 * 86400000).toISOString(),
      now.toISOString()
    );
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('o_new');
  });

  it('should return empty arrays for non-existent data', async () => {
    const stores = await storage.getStores();
    expect(stores).toEqual([]);
  });
});
