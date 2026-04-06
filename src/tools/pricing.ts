import type { PricingAnalysis } from '../models/store.js';
import { storage } from '../services/storage.js';
import { validateUUID, NotFoundError } from '../utils/errors.js';

const MS_PER_DAY = 86_400_000;

export async function analyzePricing(storeId: string, productId?: string): Promise<PricingAnalysis[]> {
  validateUUID(storeId, 'store');
  const store = await storage.getStoreById(storeId);
  if (!store) throw new NotFoundError('Store', storeId);

  const products = await storage.getProducts(storeId);
  const orders = await storage.getOrders(storeId);

  const targetProducts = productId
    ? products.filter((p) => p.id === productId)
    : products.filter((p) => p.status === 'active');

  if (productId && targetProducts.length === 0) throw new NotFoundError('Product', productId);

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * MS_PER_DAY;
  const recentOrders = orders.filter((o) =>
    new Date(o.created_at).getTime() >= thirtyDaysAgo &&
    o.status !== 'cancelled' && o.status !== 'refunded'
  );

  return targetProducts.map((product) => {
    // Count units sold and revenue in last 30 days
    let unitsSold = 0;
    let revenue = 0;
    for (const order of recentOrders) {
      for (const item of order.items) {
        if (item.product_id === product.id) {
          unitsSold += item.quantity;
          revenue += item.total;
        }
      }
    }

    const avgUnitsPerDay = unitsSold / 30;
    const revenuePerDay = revenue / 30;

    // Margin calculation
    const marginPercent = product.cost_price !== null && product.cost_price > 0
      ? Math.round(((product.price - product.cost_price) / product.price) * 10000) / 100
      : null;

    // Discount from compare_at_price
    const discountPercent = product.compare_at_price !== null && product.compare_at_price > product.price
      ? Math.round(((product.compare_at_price - product.price) / product.compare_at_price) * 10000) / 100
      : null;

    // Price elasticity hint and suggestion
    let elasticityHint: string;
    let suggestedPrice: number | null = null;
    let suggestionReason: string;

    if (unitsSold === 0) {
      elasticityHint = 'No sales data — consider lowering price to attract buyers or improving visibility';
      suggestedPrice = product.price > 0 ? Math.round(product.price * 0.85 * 100) / 100 : null;
      suggestionReason = 'No sales in 30 days. A 15% price reduction may increase conversion.';
    } else if (avgUnitsPerDay > 5 && marginPercent !== null && marginPercent < 20) {
      elasticityHint = 'High volume but low margin — demand is strong, consider gradual price increase';
      suggestedPrice = Math.round(product.price * 1.10 * 100) / 100;
      suggestionReason = 'Strong demand with low margin. A 10% increase likely sustainable.';
    } else if (avgUnitsPerDay > 3 && (marginPercent === null || marginPercent >= 40)) {
      elasticityHint = 'Good volume and healthy margin — pricing appears optimal';
      suggestionReason = 'Current pricing is well-balanced. No change recommended.';
    } else if (avgUnitsPerDay < 0.5 && (marginPercent === null || marginPercent > 50)) {
      elasticityHint = 'Low volume with high margin — price may be too high for demand';
      suggestedPrice = Math.round(product.price * 0.90 * 100) / 100;
      suggestionReason = 'Low sales volume despite high margin. Consider a 10% price reduction.';
    } else {
      elasticityHint = 'Moderate performance — test small price changes and measure impact';
      suggestionReason = 'No strong signal. A/B test with 5% variation to find optimal price point.';
    }

    return {
      product_id: product.id,
      product_title: product.title,
      current_price: product.price,
      cost_price: product.cost_price,
      margin_percent: marginPercent,
      compare_at_price: product.compare_at_price,
      discount_percent: discountPercent,
      avg_units_per_day: Math.round(avgUnitsPerDay * 100) / 100,
      revenue_per_day: Math.round(revenuePerDay * 100) / 100,
      price_elasticity_hint: elasticityHint,
      suggested_price: suggestedPrice,
      suggestion_reason: suggestionReason,
    };
  }).sort((a, b) => b.revenue_per_day - a.revenue_per_day);
}
