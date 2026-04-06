import type { AnomalyResult } from '../models/store.js';
import { storage } from '../services/storage.js';
import { detectAnomalies } from '../services/anomaly.js';
import { validateUUID, NotFoundError } from '../utils/errors.js';

export interface AnomalySummary {
  store_id: string;
  total_anomalies: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  anomalies: AnomalyResult[];
}

export async function getOrderAnomalies(storeId: string): Promise<AnomalySummary> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const orders = await storage.getOrders(storeId);
  const anomalies = detectAnomalies(orders);

  return {
    store_id: storeId,
    total_anomalies: anomalies.length,
    critical: anomalies.filter((a) => a.risk_level === 'critical').length,
    high: anomalies.filter((a) => a.risk_level === 'high').length,
    medium: anomalies.filter((a) => a.risk_level === 'medium').length,
    low: anomalies.filter((a) => a.risk_level === 'low').length,
    anomalies,
  };
}
