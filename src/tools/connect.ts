import { v4 as uuidv4 } from 'uuid';
import type { StoreConfig, StoreConnectInput } from '../models/store.js';
import { storage } from '../services/storage.js';
import { testShopifyConnection, fetchShopifyProducts, fetchShopifyOrders, fetchShopifyCustomers } from '../services/shopify.js';
import { testWooConnection, fetchWooProducts, fetchWooOrders, fetchWooCustomers } from '../services/woocommerce.js';
import { DuplicateError, NotFoundError, PlatformError } from '../utils/errors.js';

export async function connectStore(input: StoreConnectInput): Promise<{ store: Omit<StoreConfig, 'api_key' | 'api_secret'>; synced: { products: number; orders: number; customers: number } }> {
  // Check for duplicate
  const existing = await storage.getStoreByUrl(input.url);
  if (existing) throw new DuplicateError('store URL', input.url);

  // Test connection
  if (input.platform === 'shopify') {
    await testShopifyConnection(input.url, input.api_key);
  } else {
    if (!input.api_secret) throw new PlatformError('WooCommerce', 'api_secret is required for WooCommerce');
    await testWooConnection(input.url, input.api_key, input.api_secret);
  }

  const storeId = uuidv4();
  const now = new Date().toISOString();

  // Fetch initial data
  let products, orders, customers;
  if (input.platform === 'shopify') {
    [products, orders, customers] = await Promise.all([
      fetchShopifyProducts(storeId, input.url, input.api_key),
      fetchShopifyOrders(storeId, input.url, input.api_key),
      fetchShopifyCustomers(storeId, input.url, input.api_key),
    ]);
  } else {
    [products, orders, customers] = await Promise.all([
      fetchWooProducts(storeId, input.url, input.api_key, input.api_secret!),
      fetchWooOrders(storeId, input.url, input.api_key, input.api_secret!),
      fetchWooCustomers(storeId, input.url, input.api_key, input.api_secret!),
    ]);
  }

  // Store data
  await Promise.all([
    storage.upsertProducts(products),
    storage.upsertOrders(orders),
    storage.upsertCustomers(customers),
  ]);

  const store: StoreConfig = {
    id: storeId,
    name: input.name,
    platform: input.platform,
    url: input.url,
    api_key: input.api_key,
    api_secret: input.api_secret,
    connected_at: now,
    last_sync_at: now,
    product_count: products.length,
    order_count: orders.length,
    customer_count: customers.length,
  };

  await storage.addStore(store);

  // Redact credentials from response
  const { api_key: _ak, api_secret: _as, ...safeStore } = store;

  return {
    store: safeStore,
    synced: { products: products.length, orders: orders.length, customers: customers.length },
  };
}

export async function syncStore(storeId: string): Promise<{ products: number; orders: number; customers: number }> {
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  let products, orders, customers;
  if (store.platform === 'shopify') {
    [products, orders, customers] = await Promise.all([
      fetchShopifyProducts(store.id, store.url, store.api_key),
      fetchShopifyOrders(store.id, store.url, store.api_key),
      fetchShopifyCustomers(store.id, store.url, store.api_key),
    ]);
  } else {
    if (!store.api_secret) throw new PlatformError('WooCommerce', 'Missing API secret');
    [products, orders, customers] = await Promise.all([
      fetchWooProducts(store.id, store.url, store.api_key, store.api_secret),
      fetchWooOrders(store.id, store.url, store.api_key, store.api_secret),
      fetchWooCustomers(store.id, store.url, store.api_key, store.api_secret),
    ]);
  }

  await Promise.all([
    storage.upsertProducts(products),
    storage.upsertOrders(orders),
    storage.upsertCustomers(customers),
  ]);

  await storage.updateStore(storeId, {
    last_sync_at: new Date().toISOString(),
    product_count: products.length,
    order_count: orders.length,
    customer_count: customers.length,
  });

  return { products: products.length, orders: orders.length, customers: customers.length };
}
