import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const LEMONSQUEEZY_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface LicenseConfig {
  productId: number;
  bundleProductId?: number;
  cacheDir: string;
  buyUrl: string;
}

export interface LicenseStatus {
  isPro: boolean;
  licenseKey?: string;
  productId?: number;
  productName?: string;
  customerEmail?: string;
  reason?: string;
  buyUrl: string;
}

interface CachedLicense {
  validated_at: number;
  status: LicenseStatus;
}

export async function validateLicense(config: LicenseConfig): Promise<LicenseStatus> {
  const key = process.env.LEMONSQUEEZY_LICENSE_KEY?.trim();
  if (!key) {
    return {
      isPro: false,
      reason: 'LEMONSQUEEZY_LICENSE_KEY not set — running in Free mode.',
      buyUrl: config.buyUrl,
    };
  }

  const cachePath = join(config.cacheDir, 'license.json');
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    const cached: CachedLicense = JSON.parse(raw);
    if (Date.now() - cached.validated_at < CACHE_TTL_MS && cached.status.licenseKey === key) {
      return cached.status;
    }
  } catch {
    /* cache miss */
  }

  let status: LicenseStatus;
  try {
    const body = new URLSearchParams({ license_key: key });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(LEMONSQUEEZY_VALIDATE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const json = (await res.json()) as {
      valid?: boolean;
      error?: string;
      meta?: {
        product_id?: number;
        product_name?: string;
        customer_email?: string;
      };
    };

    if (!res.ok || !json.valid) {
      status = {
        isPro: false,
        reason: json?.error ?? `LemonSqueezy returned HTTP ${res.status}`,
        buyUrl: config.buyUrl,
      };
    } else {
      const productId = json.meta?.product_id;
      const validProduct =
        productId === config.productId || productId === config.bundleProductId;
      if (!validProduct) {
        status = {
          isPro: false,
          reason: `License key belongs to product ${productId}, expected ${config.productId}${config.bundleProductId ? ` or ${config.bundleProductId}` : ''}.`,
          buyUrl: config.buyUrl,
        };
      } else {
        status = {
          isPro: true,
          licenseKey: key,
          productId,
          productName: json.meta?.product_name,
          customerEmail: json.meta?.customer_email,
          buyUrl: config.buyUrl,
        };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    status = {
      isPro: false,
      reason: `License validation failed: ${msg}`,
      buyUrl: config.buyUrl,
    };
  }

  try {
    await fs.mkdir(config.cacheDir, { recursive: true });
    const payload: CachedLicense = { validated_at: Date.now(), status };
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    /* ignore cache write errors */
  }

  return status;
}

export function proGateMessage(toolName: string, status: LicenseStatus): string {
  return [
    `Pro license required for ${toolName}.`,
    ``,
    status.reason ? `Reason: ${status.reason}` : '',
    ``,
    `Get a Pro license: ${status.buyUrl}`,
    `Then set: export LEMONSQUEEZY_LICENSE_KEY=<your-key>`,
  ].filter(Boolean).join('\n');
}

export async function ensureProOrReject(
  config: LicenseConfig,
  toolName: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> } | null> {
  const status = await validateLicense(config);
  if (status.isPro) return null;
  return {
    content: [{ type: 'text', text: proGateMessage(toolName, status) }],
  };
}
