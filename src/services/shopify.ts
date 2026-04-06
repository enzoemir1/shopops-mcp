import type { Product, Order, Customer } from '../models/store.js';
import { PlatformError } from '../utils/errors.js';

const FETCH_TIMEOUT = 15_000;

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PlatformError('Shopify', `Request timed out after ${timeoutMs}ms`);
    }
    throw new PlatformError('Shopify', `Network error: ${err instanceof Error ? err.message : 'unknown'}`);
  } finally {
    clearTimeout(timer);
  }
}

interface ShopifyProduct {
  id: number;
  title: string;
  status: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  variants: Array<{
    id: number;
    sku: string | null;
    price: string;
    compare_at_price: string | null;
    inventory_quantity: number;
  }>;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  email: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  subtotal_price: string;
  total_tax: string;
  total_shipping_price_set?: { shop_money: { amount: string } };
  total_discounts: string;
  total_price: string;
  currency: string;
  customer?: { id: number; email: string };
  shipping_address?: { country: string; city: string };
  payment_gateway_names?: string[];
  browser_ip: string | null;
  created_at: string;
  updated_at: string;
  line_items: Array<{
    product_id: number;
    title: string;
    sku: string | null;
    quantity: number;
    price: string;
  }>;
}

interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  total_spent: string;
  default_address?: { country: string; city: string };
  tags: string;
  created_at: string;
}

function mapOrderStatus(financial: string, fulfillment: string | null): 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' {
  if (financial === 'refunded') return 'refunded';
  if (financial === 'voided') return 'cancelled';
  if (fulfillment === 'fulfilled') return 'delivered';
  if (fulfillment === 'partial') return 'shipped';
  if (financial === 'paid') return 'processing';
  return 'pending';
}

export async function fetchShopifyProducts(storeId: string, storeUrl: string, token: string): Promise<Product[]> {
  const baseUrl = storeUrl.replace(/\/$/, '');
  const url = `${baseUrl}/admin/api/2024-01/products.json?limit=250`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('Shopify', `Failed to fetch products: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { products: ShopifyProduct[] };
  const products: Product[] = [];

  for (const sp of data.products) {
    const variant = sp.variants[0];
    if (!variant) continue;

    products.push({
      id: `${storeId}_p_${sp.id}`,
      store_id: storeId,
      external_id: String(sp.id),
      title: sp.title,
      sku: variant.sku || null,
      price: parseFloat(variant.price) || 0,
      compare_at_price: variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
      cost_price: null,
      currency: 'USD',
      inventory_quantity: variant.inventory_quantity ?? 0,
      category: sp.product_type || null,
      status: sp.status === 'active' ? 'active' : sp.status === 'draft' ? 'draft' : 'archived',
      created_at: sp.created_at,
      updated_at: sp.updated_at,
    });
  }

  return products;
}

export async function fetchShopifyOrders(storeId: string, storeUrl: string, token: string): Promise<Order[]> {
  const baseUrl = storeUrl.replace(/\/$/, '');
  const url = `${baseUrl}/admin/api/2024-01/orders.json?limit=250&status=any`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('Shopify', `Failed to fetch orders: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { orders: ShopifyOrder[] };
  return data.orders.map((so) => ({
    id: `${storeId}_o_${so.id}`,
    store_id: storeId,
    external_id: String(so.id),
    order_number: String(so.order_number),
    customer_id: so.customer ? `${storeId}_c_${so.customer.id}` : null,
    customer_email: so.email || so.customer?.email || null,
    status: mapOrderStatus(so.financial_status, so.fulfillment_status),
    subtotal: parseFloat(so.subtotal_price) || 0,
    tax_total: parseFloat(so.total_tax) || 0,
    shipping_total: so.total_shipping_price_set ? parseFloat(so.total_shipping_price_set.shop_money.amount) : 0,
    discount_total: parseFloat(so.total_discounts) || 0,
    total: parseFloat(so.total_price) || 0,
    currency: so.currency || 'USD',
    items: so.line_items.map((li) => ({
      product_id: `${storeId}_p_${li.product_id}`,
      title: li.title,
      sku: li.sku || null,
      quantity: li.quantity,
      unit_price: parseFloat(li.price) || 0,
      total: li.quantity * (parseFloat(li.price) || 0),
    })),
    shipping_country: so.shipping_address?.country || null,
    shipping_city: so.shipping_address?.city || null,
    payment_method: so.payment_gateway_names?.[0] || null,
    ip_address: so.browser_ip || null,
    created_at: so.created_at,
    updated_at: so.updated_at,
  }));
}

export async function fetchShopifyCustomers(storeId: string, storeUrl: string, token: string): Promise<Customer[]> {
  const baseUrl = storeUrl.replace(/\/$/, '');
  const url = `${baseUrl}/admin/api/2024-01/customers.json?limit=250`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('Shopify', `Failed to fetch customers: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { customers: ShopifyCustomer[] };
  return data.customers.map((sc) => ({
    id: `${storeId}_c_${sc.id}`,
    store_id: storeId,
    external_id: String(sc.id),
    email: sc.email,
    name: `${sc.first_name ?? ''} ${sc.last_name ?? ''}`.trim() || sc.email,
    total_orders: sc.orders_count,
    total_spent: parseFloat(sc.total_spent) || 0,
    first_order_at: null,
    last_order_at: null,
    avg_order_value: sc.orders_count > 0 ? (parseFloat(sc.total_spent) || 0) / sc.orders_count : 0,
    country: sc.default_address?.country || null,
    city: sc.default_address?.city || null,
    tags: sc.tags ? sc.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    created_at: sc.created_at,
  }));
}

export async function testShopifyConnection(storeUrl: string, token: string): Promise<{ shop_name: string }> {
  const baseUrl = storeUrl.replace(/\/$/, '');
  const url = `${baseUrl}/admin/api/2024-01/shop.json`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new PlatformError('Shopify', `Connection failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { shop: { name: string } };
  return { shop_name: data.shop.name };
}
