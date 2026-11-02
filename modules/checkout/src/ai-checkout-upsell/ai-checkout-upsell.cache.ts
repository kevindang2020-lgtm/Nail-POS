// ai-checkout-upsell.cache.ts — tenant + checkout + permission-scoped cache over the namespace-versioned CachePort (§76).
// Isolation: the namespace embeds tenantId (one tenant's entries are physically unreachable from another; a single
// invalidate drops that tenant's entries via version bump — never a cross-tenant scan). The data key embeds
// checkoutId + branch + a permission fingerprint, so a higher-permission user's recommendation set is never served to a
// lower-permission user. Short TTL; explicit invalidate on cart/inventory/price/customer/membership/loyalty/promo change.
import { type CachePort, InMemoryCache } from '@aipowersalon/ai';
import type { AiCheckoutUpsellContext } from './ai-checkout-upsell.dto';

const APP = 'aipowersalon:ai-checkout-upsell:v1';
const DEFAULT_TTL_MS = 20_000; // short — recommendations must reflect live cart/inventory/price (§45/§76)

function permissionHash(permissions: string[]): string {
  const relevant = (permissions || []).filter(p => p.startsWith('pos.ai_checkout_upsell') || p.startsWith('pos.checkout') || p.startsWith('pos.memberships') || p.startsWith('pos.loyalty')).sort();
  let h = 0; const s = relevant.join('|');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export class UpsellCache {
  private readonly cache: CachePort;
  constructor(cache?: CachePort | null, private readonly ttlMs = DEFAULT_TTL_MS) { this.cache = cache ?? new InMemoryCache(); }

  private ns(tenantId: string): string { return `${APP}:tenant:${tenantId}`; }
  private key(ctx: AiCheckoutUpsellContext, checkoutId: string, kind: string, contextHash: string): string {
    return `checkout:${checkoutId}:${kind}:branch:${ctx.branchId || '-'}:perm:${permissionHash(ctx.permissions)}:cx:${contextHash}`;
  }

  async get<T>(ctx: AiCheckoutUpsellContext, checkoutId: string, kind: string, contextHash: string): Promise<T | null> {
    if (!ctx?.tenantId) return null;
    const raw = await this.cache.get(this.ns(ctx.tenantId), this.key(ctx, checkoutId, kind, contextHash));
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  async set<T>(ctx: AiCheckoutUpsellContext, checkoutId: string, kind: string, contextHash: string, value: T): Promise<void> {
    if (!ctx?.tenantId) return;
    await this.cache.set(this.ns(ctx.tenantId), this.key(ctx, checkoutId, kind, contextHash), JSON.stringify(value), this.ttlMs);
  }

  /** Invalidate ALL of one tenant's cached recommendations (cart/inventory/price/customer/membership/loyalty/promo change). */
  async invalidateTenant(tenantId: string): Promise<void> { if (tenantId) await this.cache.invalidate(this.ns(tenantId)); }
}

/** Stable context fingerprint: the recommendation set is only valid for this exact cart shape. Changing the service
 *  lines, add-ons, or subtotal changes the hash, so a stale recommendation can never be served against a changed cart. */
export function contextFingerprint(input: { serviceIds: string[]; addOnIds: string[]; subtotalCents: number; customerId: string | null }): string {
  const s = [ [...input.serviceIds].sort().join(','), [...input.addOnIds].sort().join(','), String(input.subtotalCents), input.customerId || '-' ].join('#');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
