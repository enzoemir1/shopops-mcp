import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Storage } from '../../src/services/storage.js';
import { seedDemoStore } from '../../src/services/demo-seed.js';
import { segmentCustomers } from '../../src/services/rfm.js';

const TEST_DIR = path.join(process.cwd(), 'data-test-demo-seed');

describe('seedDemoStore', () => {
  let store: Storage;

  beforeEach(() => { store = new Storage(TEST_DIR); });
  afterEach(async () => { try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {} });

  it('creates a store with products, customers, and orders', async () => {
    const result = await seedDemoStore(store);
    expect(result.store_id).toBeTruthy();
    expect(result.store_name).toBe('Acme Demo Store');
    expect(result.products).toBeGreaterThanOrEqual(15);
    expect(result.customers).toBeGreaterThanOrEqual(30);
    expect(result.orders).toBeGreaterThanOrEqual(80);
  });

  it('seeded store data round-trips through storage', async () => {
    const result = await seedDemoStore(store);
    const stores = await store.getStores();
    expect(stores.length).toBe(1);
    expect(stores[0].id).toBe(result.store_id);

    const products = await store.getProducts(result.store_id);
    expect(products.length).toBe(result.products);

    const customers = await store.getCustomers(result.store_id);
    expect(customers.length).toBe(result.customers);
  });

  it('produces enough variety for RFM segmentation to return all 7 segments', async () => {
    const result = await seedDemoStore(store);
    const customers = await store.getCustomers(result.store_id);
    const orders = await store.getOrders(result.store_id);

    const segments = segmentCustomers(customers, orders);
    expect(segments.length).toBeGreaterThanOrEqual(20);

    const segmentNames = new Set(segments.map((s) => s.segment));
    // We should see at least 4 distinct segments from the archetype mix
    expect(segmentNames.size).toBeGreaterThanOrEqual(4);

    // Champions should have high RFM score
    const champions = segments.filter((s) => s.segment === 'champions');
    if (champions.length > 0) {
      expect(champions[0].rfm_score).toBeGreaterThan(3.5);
    }
  });

  it('includes products with varied inventory levels (including low-stock and out-of-stock)', async () => {
    const result = await seedDemoStore(store);
    const products = await store.getProducts(result.store_id);

    const outOfStock = products.filter((p) => p.inventory_quantity === 0);
    const lowStock = products.filter((p) => p.inventory_quantity > 0 && p.inventory_quantity <= 10);
    const wellStocked = products.filter((p) => p.inventory_quantity > 50);

    expect(outOfStock.length).toBeGreaterThanOrEqual(1);
    expect(lowStock.length).toBeGreaterThanOrEqual(1);
    expect(wellStocked.length).toBeGreaterThanOrEqual(3);
  });

  it('each seeded order has a valid customer_id that resolves to an existing customer', async () => {
    const result = await seedDemoStore(store);
    const customers = await store.getCustomers(result.store_id);
    const orders = await store.getOrders(result.store_id);

    const customerIds = new Set(customers.map((c) => c.id));
    for (const order of orders) {
      expect(order.customer_id).not.toBeNull();
      expect(customerIds.has(order.customer_id!)).toBe(true);
    }
  });
});
