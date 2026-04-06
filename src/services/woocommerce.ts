import type { Product, Order, Customer } from '../models/store.js';
import { PlatformError } from '../utils/errors.js';

const FETCH_TIMEOUT = 15_000;

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PlatformError('WooCommerce', `Request timed out after ${timeoutMs}ms`);
    }
    throw new PlatformError('WooCommerce', `Network error: ${err instanceof Error ? err.message : 'unknown'}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WooCommerce REST API v3 authentication via query parameters.
 * Note: WooCommerce requires HTTPS for query-param auth in production.
 * For HTTP (localhost), it uses basic auth internally — but the API itself
 * documents consumer_key/secret as query params for the REST API.
 */
function wooAuth(baseUrl: string, endpoint: string, key: string, secret: string): string {
  const url = new URL(`${baseUrl}/wp-json/wc/v3/${endpoint}`);
  url.searchParams.set('consumer_key', key);
  url.searchParams.set('consumer_secret', secret);
  return url.toString();
}

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  status: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_quantity: number | null;
  categories: Array<{ name: string }>;
  date_created: string;
  date_modified: string;
}

interface WooOrder {
  id: number;
  number: string;
  status: string;
  customer_id: number;
  billing: { email: string };
  shipping: { country: string; city: string };
  subtotal?: string;
  total_tax: string;
  shipping_total: string;
  discount_total: string;
  total: string;
  currency: string;
  payment_method: string;
  customer_ip_address: string;
  date_created: string;
  date_modified: string;
  line_items: Array<{
    product_id: number;
    name: string;
    sku: string;
    quantity: number;
    price: number;
    subtotal: string;
  }>;
}

interface WooCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  total_spent: string;
  billing: { country: string; city: string };
  date_created: string;
}

function mapWooStatus(status: string): 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' {
  const map: Record<string, 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded'> = {
    pending: 'pending',
    processing: 'processing',
    'on-hold': 'pending',
    completed: 'delivered',
    cancelled: 'cancelled',
    refunded: 'refunded',
    failed: 'cancelled',
  };
  return map[status] ?? 'pending';
}

export async function fetchWooProducts(storeId: string, baseUrl: string, key: string, secret: string): Promise<Product[]> {
  const url = wooAuth(baseUrl, 'products?per_page=100', key, secret);
  const res = await fetchWithTimeout(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('WooCommerce', `Failed to fetch products: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as WooProduct[];
  return data.map((wp) => ({
    id: `${storeId}_p_${wp.id}`,
    store_id: storeId,
    external_id: String(wp.id),
    title: wp.name,
    sku: wp.sku || null,
    price: parseFloat(wp.price) || 0,
    compare_at_price: wp.regular_price && wp.sale_price ? parseFloat(wp.regular_price) : null,
    cost_price: null,
    currency: 'USD',
    inventory_quantity: wp.stock_quantity ?? 0,
    category: wp.categories[0]?.name || null,
    status: wp.status === 'publish' ? 'active' as const : wp.status === 'draft' ? 'draft' as const : 'archived' as const,
    created_at: wp.date_created,
    updated_at: wp.date_modified,
  }));
}

export async function fetchWooOrders(storeId: string, baseUrl: string, key: string, secret: string): Promise<Order[]> {
  const url = wooAuth(baseUrl, 'orders?per_page=100', key, secret);
  const res = await fetchWithTimeout(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('WooCommerce', `Failed to fetch orders: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as WooOrder[];
  return data.map((wo) => ({
    id: `${storeId}_o_${wo.id}`,
    store_id: storeId,
    external_id: String(wo.id),
    order_number: wo.number,
    customer_id: wo.customer_id ? `${storeId}_c_${wo.customer_id}` : null,
    customer_email: wo.billing.email || null,
    status: mapWooStatus(wo.status),
    subtotal: wo.line_items.reduce((sum, li) => sum + parseFloat(li.subtotal), 0),
    tax_total: parseFloat(wo.total_tax) || 0,
    shipping_total: parseFloat(wo.shipping_total) || 0,
    discount_total: parseFloat(wo.discount_total) || 0,
    total: parseFloat(wo.total) || 0,
    currency: wo.currency || 'USD',
    items: wo.line_items.map((li) => ({
      product_id: `${storeId}_p_${li.product_id}`,
      title: li.name,
      sku: li.sku || null,
      quantity: li.quantity,
      unit_price: li.price,
      total: parseFloat(li.subtotal),
    })),
    shipping_country: wo.shipping.country || null,
    shipping_city: wo.shipping.city || null,
    payment_method: wo.payment_method || null,
    ip_address: wo.customer_ip_address || null,
    created_at: wo.date_created,
    updated_at: wo.date_modified,
  }));
}

export async function fetchWooCustomers(storeId: string, baseUrl: string, key: string, secret: string): Promise<Customer[]> {
  const url = wooAuth(baseUrl, 'customers?per_page=100', key, secret);
  const res = await fetchWithTimeout(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('WooCommerce', `Failed to fetch customers: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as WooCustomer[];
  return data.map((wc) => ({
    id: `${storeId}_c_${wc.id}`,
    store_id: storeId,
    external_id: String(wc.id),
    email: wc.email,
    name: `${wc.first_name ?? ''} ${wc.last_name ?? ''}`.trim() || wc.email,
    total_orders: wc.orders_count,
    total_spent: parseFloat(wc.total_spent) || 0,
    first_order_at: null,
    last_order_at: null,
    avg_order_value: wc.orders_count > 0 ? (parseFloat(wc.total_spent) || 0) / wc.orders_count : 0,
    country: wc.billing.country || null,
    city: wc.billing.city || null,
    tags: [],
    created_at: wc.date_created,
  }));
}

export async function testWooConnection(baseUrl: string, key: string, secret: string): Promise<{ store_name: string }> {
  const url = wooAuth(baseUrl, '', key, secret);
  const res = await fetchWithTimeout(url, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('WooCommerce', `Connection failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { store: { name: string } } | { description: string };
  const name = 'store' in data ? data.store.name : ('description' in data ? data.description : 'WooCommerce Store');
  return { store_name: name };
}
