// processor.factory.ts — selects a real PaymentProcessor from env, or none.
//
// CardPointe is considered configured when a base URL (or site) plus merchid/username/password are present. When
// configured, resolvePaymentStatus() reports "connected" and the checkout service routes card auth / refund / void through
// the live client. When absent, behavior is unchanged (sandbox if PAYMENTS_SANDBOX=1, otherwise honest "not configured").

import { instrumentedFetch } from '@aipowersalon/observability';
import { CardPointeClient, CardPointeConfig, FetchLike } from './cardpointe.client';
import type { PaymentProcessor } from './payment-processor.port';

export function cardPointeConfigFromEnv(): CardPointeConfig | null {
  const env = process.env;
  const baseUrl = env.CARDPOINTE_BASE_URL || (env.CARDPOINTE_SITE ? `https://${env.CARDPOINTE_SITE}.cardconnect.com` : '');
  const merchid = env.CARDPOINTE_MERCHID;
  const username = env.CARDPOINTE_USERNAME;
  const password = env.CARDPOINTE_PASSWORD;
  if (!baseUrl || !merchid || !username || !password) return null;
  return { baseUrl, merchid, username, password, currency: env.CARDPOINTE_CURRENCY || 'USD' };
}

export function cardPointeConfigured(): boolean {
  return cardPointeConfigFromEnv() !== null;
}

/**
 * @deprecated wave 3 PAYI §152–§153: a platform-wide env merchant is LEGACY — the authoritative configuration is the
 * tenant's own gateway (`tenant_payment_config`) or branch merchant (`payment_merchant_accounts`) through
 * `PaymentGatewayResolver`. This env path is reached only with `PAYMENTS_ALLOW_ENV_FALLBACK=1` (dev / UAT scripts) and
 * production refuses to boot with it (`production-config.ts`). Remove when the UAT scripts read Super Admin config only.
 */
export function processorFromEnv(): PaymentProcessor | undefined {
  const cfg = cardPointeConfigFromEnv();
  if (!cfg) return undefined;
  const transport: FetchLike = instrumentedFetch('cardpointe', (url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));
  return new CardPointeClient(cfg, transport);
}
