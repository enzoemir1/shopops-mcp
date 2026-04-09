import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { StoreConfig, Product, Order, Customer } from '../models/store.js';

// ── Simple async lock ─────────────────────────────────────────────
class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(resolve);
        if (idx !== -1) this.queue.splice(idx, 1);
        resolve(); // release after timeout to prevent deadlock
      }, 10_000);
      this.queue.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.locked = false;
  }
}

/** Guard against path traversal — only allow simple alphanumeric names */
function safeName(name: string): string {
  const clean = basename(name).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) throw new Error(`Invalid storage name: ${name}`);
  return clean;
}

// ── Storage ───────────────────────────────────────────────────────
class Storage {
  private dataDir: string;
  private lock = new AsyncLock();

  constructor() {
    this.dataDir = join(process.cwd(), 'data');
  }

  private filePath(name: string): string {
    return join(this.dataDir, `${safeName(name)}.json`);
  }

  private async readJSON<T>(name: string): Promise<T[]> {
    try {
      const raw = await readFile(this.filePath(name), 'utf-8');
      return JSON.parse(raw) as T[];
    } catch {
      return [];
    }
  }

  private async writeJSON<T>(name: string, data: T[]): Promise<void> {
    await this.lock.acquire();
    try {
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(this.filePath(name), JSON.stringify(data, null, 2), 'utf-8');
    } finally {
      this.lock.release();
    }
  }

  // ── Stores ────────────────────────────────────────────────────
  async getStores(): Promise<StoreConfig[]> {
    return this.readJSON<StoreConfig>('stores');
  }

  async getStoreById(id: string): Promise<StoreConfig | undefined> {
    const stores = await this.getStores();
    return stores.find((s) => s.id === id);
  }

  async getStoreByUrl(url: string): Promise<StoreConfig | undefined> {
    const stores = await this.getStores();
    return stores.find((s) => s.url === url);
  }

  async addStore(store: StoreConfig): Promise<StoreConfig> {
    const stores = await this.getStores();
    stores.push(store);
    await this.writeJSON('stores', stores);
    return store;
  }

  async updateStore(id: string, patch: Partial<StoreConfig>): Promise<StoreConfig | undefined> {
    const stores = await this.getStores();
    const idx = stores.findIndex((s) => s.id === id);
    if (idx === -1) return undefined;
    stores[idx] = { ...stores[idx], ...patch };
    await this.writeJSON('stores', stores);
    return stores[idx];
  }

  // ── Products ──────────────────────────────────────────────────
  async getProducts(storeId: string): Promise<Product[]> {
    const all = await this.readJSON<Product>('products');
    return all.filter((p) => p.store_id === storeId);
  }

  async getProductById(id: string): Promise<Product | undefined> {
    const all = await this.readJSON<Product>('products');
    return all.find((p) => p.id === id);
  }

  async upsertProducts(products: Product[]): Promise<number> {
    const all = await this.readJSON<Product>('products');
    let upserted = 0;
    for (const product of products) {
      const idx = all.findIndex((p) => p.id === product.id);
      if (idx !== -1) {
        all[idx] = product;
      } else {
        all.push(product);
      }
      upserted++;
    }
    await this.writeJSON('products', all);
    return upserted;
  }

  // ── Orders ────────────────────────────────────────────────────
  async getOrders(storeId: string): Promise<Order[]> {
    const all = await this.readJSON<Order>('orders');
    return all.filter((o) => o.store_id === storeId);
  }

  async getRecentOrders(storeId: string, limit: number): Promise<Order[]> {
    const orders = await this.getOrders(storeId);
    return orders
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  async getOrdersByDateRange(storeId: string, from: string, to: string): Promise<Order[]> {
    const orders = await this.getOrders(storeId);
    const fromTs = new Date(from).getTime();
    const toTs = new Date(to).getTime();
    return orders.filter((o) => {
      const ts = new Date(o.created_at).getTime();
      return ts >= fromTs && ts <= toTs;
    });
  }

  async upsertOrders(orders: Order[]): Promise<number> {
    const all = await this.readJSON<Order>('orders');
    let upserted = 0;
    for (const order of orders) {
      const idx = all.findIndex((o) => o.id === order.id);
      if (idx !== -1) {
        all[idx] = order;
      } else {
        all.push(order);
      }
      upserted++;
    }
    await this.writeJSON('orders', all);
    return upserted;
  }

  // ── Customers ─────────────────────────────────────────────────
  async getCustomers(storeId: string): Promise<Customer[]> {
    const all = await this.readJSON<Customer>('customers');
    return all.filter((c) => c.store_id === storeId);
  }

  async getTopCustomers(storeId: string, limit: number): Promise<Customer[]> {
    const customers = await this.getCustomers(storeId);
    return customers
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, limit);
  }

  async upsertCustomers(customers: Customer[]): Promise<number> {
    const all = await this.readJSON<Customer>('customers');
    let upserted = 0;
    for (const customer of customers) {
      const idx = all.findIndex((c) => c.id === customer.id);
      if (idx !== -1) {
        all[idx] = customer;
      } else {
        all.push(customer);
      }
      upserted++;
    }
    await this.writeJSON('customers', all);
    return upserted;
  }
}

/** Default global storage instance using process.cwd()/data directory. */
export const storage = new Storage();
