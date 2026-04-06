import type { Product, ForecastResult } from '../models/store.js';
import { storage } from '../services/storage.js';
import { forecastAll, forecastProduct } from '../services/forecasting.js';
import { validateUUID, NotFoundError } from '../utils/errors.js';

export interface InventoryStatusResult {
  store_id: string;
  total_products: number;
  total_units: number;
  out_of_stock: number;
  low_stock: number;
  products: Array<{
    id: string;
    title: string;
    sku: string | null;
    quantity: number;
    status: string;
  }>;
}

export async function getInventoryStatus(storeId: string): Promise<InventoryStatusResult> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const products = await storage.getProducts(storeId);
  const activeProducts = products.filter((p) => p.status === 'active');

  const outOfStock = activeProducts.filter((p) => p.inventory_quantity <= 0);
  const lowStock = activeProducts.filter((p) => p.inventory_quantity > 0 && p.inventory_quantity <= 10);
  const totalUnits = activeProducts.reduce((sum, p) => sum + Math.max(0, p.inventory_quantity), 0);

  return {
    store_id: storeId,
    total_products: activeProducts.length,
    total_units: totalUnits,
    out_of_stock: outOfStock.length,
    low_stock: lowStock.length,
    products: activeProducts
      .sort((a, b) => a.inventory_quantity - b.inventory_quantity)
      .slice(0, 50)
      .map((p) => ({
        id: p.id,
        title: p.title,
        sku: p.sku,
        quantity: p.inventory_quantity,
        status: p.inventory_quantity <= 0 ? 'out_of_stock' : p.inventory_quantity <= 10 ? 'low' : 'ok',
      })),
  };
}

export async function getInventoryForecast(storeId: string, productId?: string): Promise<ForecastResult[]> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const orders = await storage.getOrders(storeId);

  if (productId) {
    const product = await storage.getProductById(productId);
    if (!product) throw new NotFoundError('Product', productId);
    return [forecastProduct(product, orders)];
  }

  const products = await storage.getProducts(storeId);
  return forecastAll(products, orders);
}
