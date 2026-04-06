import type { RFMResult } from '../models/store.js';
import { storage } from '../services/storage.js';
import { segmentCustomers, identifyChurnRisk } from '../services/rfm.js';
import { validateUUID, NotFoundError } from '../utils/errors.js';

export interface SegmentSummary {
  store_id: string;
  total_customers: number;
  segments: Record<string, { count: number; total_spent: number; avg_rfm: number }>;
  customers: RFMResult[];
}

export async function getCustomerSegments(storeId: string): Promise<SegmentSummary> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const customers = await storage.getCustomers(storeId);
  const orders = await storage.getOrders(storeId);
  const results = segmentCustomers(customers, orders);

  // Build segment summary
  const segments: Record<string, { count: number; total_spent: number; avg_rfm: number }> = {};
  for (const r of results) {
    if (!segments[r.segment]) {
      segments[r.segment] = { count: 0, total_spent: 0, avg_rfm: 0 };
    }
    segments[r.segment].count++;
    segments[r.segment].total_spent += r.total_spent;
    segments[r.segment].avg_rfm += r.rfm_score;
  }
  for (const seg of Object.values(segments)) {
    seg.avg_rfm = seg.count > 0 ? Math.round((seg.avg_rfm / seg.count) * 100) / 100 : 0;
    seg.total_spent = Math.round(seg.total_spent * 100) / 100;
  }

  return {
    store_id: storeId,
    total_customers: results.length,
    segments,
    customers: results,
  };
}

export async function getChurnRisk(storeId: string): Promise<{ store_id: string; at_risk_count: number; customers: RFMResult[] }> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const customers = await storage.getCustomers(storeId);
  const orders = await storage.getOrders(storeId);
  const atRisk = identifyChurnRisk(customers, orders);

  return {
    store_id: storeId,
    at_risk_count: atRisk.length,
    customers: atRisk,
  };
}
