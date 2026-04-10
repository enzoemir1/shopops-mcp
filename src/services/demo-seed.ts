import { v4 as uuidv4 } from 'uuid';
import { storage as defaultStorage, Storage } from './storage.js';
import type { StoreConfig, Product, Order, Customer, OrderItem } from '../models/store.js';

/**
 * Seed a realistic demo store so users (and tests) can explore ShopOps
 * without real Shopify or WooCommerce credentials.
 *
 * The generated dataset is deterministic in shape — same counts every
 * run — but uses the current time as the "now" anchor so that recency
 * buckets in RFM segmentation stay meaningful.
 *
 * Produces enough variety for every ShopOps tool to yield interesting
 * output: champions vs hibernating customers, low-stock products,
 * ABC-distributed revenue, and a few order anomalies.
 */

const PRODUCT_TEMPLATES: Array<{
  title: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  demand: number; // weight for order generation
}> = [
  { title: 'Wireless Noise-Cancelling Headphones', category: 'Electronics', price: 249.00, cost: 120.00, stock: 58, demand: 9 },
  { title: 'Mechanical Keyboard — TKL RGB', category: 'Electronics', price: 159.00, cost: 74.00, stock: 32, demand: 7 },
  { title: 'USB-C Hub 8-in-1', category: 'Electronics', price: 59.00, cost: 22.00, stock: 145, demand: 8 },
  { title: 'Portable SSD 1TB', category: 'Electronics', price: 119.00, cost: 68.00, stock: 4, demand: 6 }, // low stock
  { title: 'Smart Desk Lamp', category: 'Home', price: 79.00, cost: 28.00, stock: 0, demand: 5 }, // out of stock
  { title: 'Ergonomic Office Chair', category: 'Home', price: 399.00, cost: 185.00, stock: 12, demand: 4 },
  { title: 'Standing Desk Converter', category: 'Home', price: 249.00, cost: 105.00, stock: 24, demand: 3 },
  { title: 'Ceramic Coffee Grinder', category: 'Home', price: 89.00, cost: 34.00, stock: 78, demand: 5 },
  { title: 'Wool Blend Throw Blanket', category: 'Home', price: 65.00, cost: 21.00, stock: 120, demand: 4 },
  { title: 'Merino Wool Sweater', category: 'Apparel', price: 135.00, cost: 48.00, stock: 45, demand: 6 },
  { title: 'Leather Sneakers', category: 'Apparel', price: 189.00, cost: 72.00, stock: 38, demand: 7 },
  { title: 'Organic Cotton T-Shirt (3-pack)', category: 'Apparel', price: 55.00, cost: 18.00, stock: 210, demand: 8 },
  { title: 'Canvas Backpack — 25L', category: 'Apparel', price: 95.00, cost: 36.00, stock: 62, demand: 5 },
  { title: 'Stainless Steel Water Bottle', category: 'Lifestyle', price: 38.00, cost: 12.00, stock: 185, demand: 9 },
  { title: 'Bamboo Cutting Board', category: 'Kitchen', price: 42.00, cost: 14.00, stock: 95, demand: 4 },
  { title: 'Chef\'s Knife 8"', category: 'Kitchen', price: 129.00, cost: 52.00, stock: 17, demand: 3 },
  { title: 'French Press 1L', category: 'Kitchen', price: 49.00, cost: 16.00, stock: 88, demand: 5 },
  { title: 'Yoga Mat Pro 6mm', category: 'Fitness', price: 72.00, cost: 24.00, stock: 9, demand: 6 }, // low stock
  { title: 'Resistance Bands Set', category: 'Fitness', price: 34.00, cost: 10.00, stock: 150, demand: 7 },
  { title: 'Foam Roller', category: 'Fitness', price: 45.00, cost: 15.00, stock: 68, demand: 4 },
];

const CUSTOMER_NAMES = [
  'Sarah Chen', 'Marcus Johnson', 'Priya Patel', 'Luca Rossi', 'Ana García',
  'Kenji Tanaka', 'Emma Wilson', 'Omar Hassan', 'Sofia Lindström', 'David Park',
  'Fatima Al-Zahra', 'Ryan O\'Brien', 'Yuki Watanabe', 'Isabella Martinez', 'Chen Wei',
  'Adebayo Okonkwo', 'Nadia Ivanova', 'Hiroshi Nakamura', 'Amara Okafor', 'Diego Hernandez',
  'Mei Lin', 'Jakub Kowalski', 'Aisha Rahman', 'Liam O\'Connor', 'Freya Andersen',
  'Rohan Gupta', 'Elena Volkov', 'Mateo Silva', 'Zara Ahmed', 'Leon Zhou',
  'Olivia Murphy', 'Carlos Mendoza', 'Hana Suzuki', 'Aiden Kim', 'Lucia Romano',
  'Kwame Mensah', 'Sophie Dubois', 'Ivan Petrov', 'Nikita Iyer', 'Mia Kobayashi',
];

const COUNTRIES = ['US', 'UK', 'DE', 'FR', 'CA', 'AU', 'JP', 'NL', 'ES', 'SE'];
const CITIES: Record<string, string[]> = {
  US: ['San Francisco', 'New York', 'Austin', 'Seattle', 'Denver'],
  UK: ['London', 'Manchester', 'Edinburgh', 'Bristol'],
  DE: ['Berlin', 'Munich', 'Hamburg'],
  FR: ['Paris', 'Lyon', 'Bordeaux'],
  CA: ['Toronto', 'Vancouver', 'Montreal'],
  AU: ['Sydney', 'Melbourne', 'Brisbane'],
  JP: ['Tokyo', 'Osaka', 'Kyoto'],
  NL: ['Amsterdam', 'Rotterdam'],
  ES: ['Barcelona', 'Madrid', 'Valencia'],
  SE: ['Stockholm', 'Gothenburg'],
};

/**
 * Customer archetypes: each produces a different RFM profile.
 * The seed function distributes customers across these archetypes so
 * that customers_segment returns interesting output.
 */
type Archetype = 'champion' | 'loyal' | 'new' | 'at_risk' | 'hibernating' | 'one_off';

const ARCHETYPE_MIX: Array<{ archetype: Archetype; count: number }> = [
  { archetype: 'champion', count: 6 },     // recent, frequent, high spend
  { archetype: 'loyal', count: 8 },        // somewhat recent, frequent, mid spend
  { archetype: 'new', count: 6 },          // very recent, 1 order
  { archetype: 'at_risk', count: 7 },      // frequent historically, not recent
  { archetype: 'hibernating', count: 9 },  // old, low frequency
  { archetype: 'one_off', count: 4 },      // one order, old
];

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

function archetypeParams(archetype: Archetype) {
  // Each archetype defines [order_count_range, days_ago_range, avg_spend_range]
  switch (archetype) {
    case 'champion':    return { orderCount: [8, 14], daysAgo: [1, 7],    avgSpend: [120, 260] };
    case 'loyal':       return { orderCount: [4, 7],  daysAgo: [8, 25],   avgSpend: [60, 140] };
    case 'new':         return { orderCount: [1, 1],  daysAgo: [1, 10],   avgSpend: [40, 150] };
    case 'at_risk':     return { orderCount: [5, 9],  daysAgo: [45, 90],  avgSpend: [80, 180] };
    case 'hibernating': return { orderCount: [2, 4],  daysAgo: [80, 160], avgSpend: [30, 90]  };
    case 'one_off':     return { orderCount: [1, 1],  daysAgo: [120, 200], avgSpend: [25, 80] };
  }
}

function rand(min: number, max: number, seed: number): number {
  // Deterministic-ish "random" using a simple LCG so seed runs are
  // reproducible in tests.
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  const r = x - Math.floor(x);
  return min + r * (max - min);
}

function randInt(min: number, max: number, seed: number): number {
  return Math.floor(rand(min, max + 0.999, seed));
}

function pickWeighted<T extends { demand: number }>(items: T[], seed: number): T {
  const total = items.reduce((s, it) => s + it.demand, 0);
  const r = rand(0, total, seed);
  let acc = 0;
  for (const it of items) {
    acc += it.demand;
    if (r <= acc) return it;
  }
  return items[items.length - 1];
}

export interface DemoSeedResult {
  store_id: string;
  store_name: string;
  products: number;
  customers: number;
  orders: number;
  message: string;
}

/**
 * Create a demo store populated with realistic products, customers, and
 * orders. Safe to call multiple times — each call creates a new demo
 * store with a unique ID. Returns the store_id so callers can plug it
 * straight into inventory_status, customers_segment, order_anomalies,
 * etc. without needing real Shopify or WooCommerce credentials.
 */
export async function seedDemoStore(store?: Storage): Promise<DemoSeedResult> {
  const s = store ?? defaultStorage;
  const now = new Date();
  const storeId = uuidv4();

  // 1. Create the store record
  const storeRecord: StoreConfig = {
    id: storeId,
    name: 'Acme Demo Store',
    platform: 'shopify',
    url: 'https://acme-demo.myshopify.com',
    api_key: 'demo_token_not_real',
    api_secret: undefined,
    connected_at: now.toISOString(),
    last_sync_at: now.toISOString(),
    product_count: PRODUCT_TEMPLATES.length,
    order_count: 0,      // filled in below
    customer_count: 0,   // filled in below
  };

  // 2. Create products
  const products: Product[] = PRODUCT_TEMPLATES.map((t, i) => ({
    id: `${storeId}_p_${i + 1}`,
    store_id: storeId,
    external_id: `demo-sku-${i + 1}`,
    title: t.title,
    sku: `ACME-${String(i + 1).padStart(4, '0')}`,
    price: t.price,
    compare_at_price: t.price > 80 ? Math.round(t.price * 1.25 * 100) / 100 : null,
    cost_price: t.cost,
    currency: 'USD',
    inventory_quantity: t.stock,
    category: t.category,
    status: 'active',
    created_at: new Date(now.getTime() - 180 * 86_400_000).toISOString(),
    updated_at: now.toISOString(),
  }));

  // 3. Create customers + orders by archetype
  const customers: Customer[] = [];
  const orders: Order[] = [];
  let customerIdx = 0;
  let orderCounter = 1000;

  for (const { archetype, count } of ARCHETYPE_MIX) {
    const params = archetypeParams(archetype);

    for (let k = 0; k < count; k++) {
      const seedBase = customerIdx * 101 + k * 17;
      const name = pick(CUSTOMER_NAMES, customerIdx);
      const email = name.toLowerCase().replace(/\W+/g, '.') + '@example.test';
      const country = pick(COUNTRIES, customerIdx);
      const city = pick(CITIES[country], customerIdx + 1);

      const orderCount = randInt(params.orderCount[0], params.orderCount[1], seedBase + 1);
      const avgSpend = rand(params.avgSpend[0], params.avgSpend[1], seedBase + 2);
      const firstDaysAgo = randInt(params.daysAgo[0], params.daysAgo[1] + 30, seedBase + 3);
      const lastDaysAgo = randInt(params.daysAgo[0], params.daysAgo[1], seedBase + 4);

      const customer: Customer = {
        id: `${storeId}_c_${customerIdx + 1}`,
        store_id: storeId,
        external_id: `demo-cust-${customerIdx + 1}`,
        email,
        name,
        total_orders: orderCount,
        total_spent: 0, // filled in below
        first_order_at: new Date(now.getTime() - firstDaysAgo * 86_400_000).toISOString(),
        last_order_at: new Date(now.getTime() - lastDaysAgo * 86_400_000).toISOString(),
        avg_order_value: 0, // filled in below
        country,
        city,
        tags: archetype === 'champion' ? ['vip'] : [],
        created_at: new Date(now.getTime() - (firstDaysAgo + 15) * 86_400_000).toISOString(),
      };
      customers.push(customer);

      // Generate this customer's orders
      let customerTotal = 0;
      for (let o = 0; o < orderCount; o++) {
        const product = pickWeighted(PRODUCT_TEMPLATES.map((p, idx) => ({ ...p, idx })), seedBase + o * 3 + 5);
        const quantity = randInt(1, 3, seedBase + o * 3 + 6);
        const unitPrice = product.price;
        const lineTotal = unitPrice * quantity;
        const tax = Math.round(lineTotal * 0.08 * 100) / 100;
        const shipping = lineTotal > 100 ? 0 : 8.95;
        const total = Math.round((lineTotal + tax + shipping) * 100) / 100;
        customerTotal += total;

        // Spread orders from first to last
        let daysAgo: number;
        if (orderCount === 1) {
          daysAgo = lastDaysAgo;
        } else {
          const ratio = o / (orderCount - 1);
          daysAgo = Math.round(firstDaysAgo - (firstDaysAgo - lastDaysAgo) * ratio);
        }

        const orderTs = new Date(now.getTime() - daysAgo * 86_400_000);
        orderCounter++;

        const item: OrderItem = {
          product_id: `${storeId}_p_${product.idx + 1}`,
          title: product.title,
          sku: `ACME-${String(product.idx + 1).padStart(4, '0')}`,
          quantity,
          unit_price: unitPrice,
          total: Math.round(lineTotal * 100) / 100,
        };

        orders.push({
          id: `${storeId}_o_${orderCounter}`,
          store_id: storeId,
          external_id: `demo-order-${orderCounter}`,
          order_number: String(orderCounter),
          customer_id: customer.id,
          customer_email: customer.email,
          status: daysAgo < 3 ? 'processing' : daysAgo < 14 ? 'shipped' : 'delivered',
          subtotal: Math.round(lineTotal * 100) / 100,
          tax_total: tax,
          shipping_total: shipping,
          discount_total: 0,
          total,
          currency: 'USD',
          items: [item],
          shipping_country: country,
          shipping_city: city,
          payment_method: 'card',
          ip_address: null,
          created_at: orderTs.toISOString(),
          updated_at: orderTs.toISOString(),
        });
      }

      customer.total_spent = Math.round(customerTotal * 100) / 100;
      customer.avg_order_value = orderCount > 0 ? Math.round((customerTotal / orderCount) * 100) / 100 : 0;
      customerIdx++;
    }
  }

  // 4. Persist everything
  storeRecord.order_count = orders.length;
  storeRecord.customer_count = customers.length;
  await s.addStore(storeRecord);
  await s.upsertProducts(products);
  await s.upsertOrders(orders);
  await s.upsertCustomers(customers);

  return {
    store_id: storeId,
    store_name: storeRecord.name,
    products: products.length,
    customers: customers.length,
    orders: orders.length,
    message: `Demo store "${storeRecord.name}" seeded with ${products.length} products, ${customers.length} customers, and ${orders.length} orders. Use this store_id with any ShopOps tool to explore the product without real Shopify or WooCommerce credentials.`,
  };
}
