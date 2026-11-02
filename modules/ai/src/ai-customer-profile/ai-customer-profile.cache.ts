// ai-customer-profile.cache.ts — tenant-scoped summary cache over the existing namespace-versioned CachePort (§38).
// Isolation guarantees:
//   • The namespace embeds the tenantId, so one tenant's entries are physically unreachable from another and a single
//     invalidate(namespace) drops ALL of that tenant's summaries at once (version bump) — never a cross-tenant SCAN.
//   • The data key embeds customerId + a permission fingerprint, so an owner-level summary can never be served to a
//     lower-permission user (§38 "Do not serve an owner-level customer summary to a user with lower permissions").
//   • Short TTL bounds staleness; explicit invalidateTenant() is called on customer/appointment/membership changes.
import { type CachePort, InMemoryCache } from '../cache/cache-port';
import type { AiCustomerProfileContext } from './ai-customer-profile.dto';

const APP = 'aipowersalon:ai-customer-profile:v1';
const DEFAULT_TTL_MS = 60_000; // 60s — correctness bound until event-driven invalidation (Stage 3 merge/delete)

/** Stable, order-independent fingerprint of the permissions that gate what a summary may contain. */
function permissionHash(permissions: string[]): string {
  const relevant = (permissions || [])
    .filter(p => p.startsWith('customers') || p.startsWith('pos.ai_customer_profile') || p.startsWith('pos.customers'))
    .sort();
  let h = 0;
  const s = relevant.join('|');
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

export class ProfileCache {
  private readonly cache: CachePort;
  constructor(cache?: CachePort | null, private readonly ttlMs = DEFAULT_TTL_MS) { this.cache = cache ?? new InMemoryCache(); }

  /** Namespace is per-tenant so invalidate() clears exactly one tenant's summaries. */
  private ns(tenantId: string): string { return `${APP}:tenant:${tenantId}`; }
  private key(ctx: AiCustomerProfileContext, customerId: string, kind: string): string {
    return `customer:${customerId}:${kind}:branch:${ctx.branchId || '-'}:perm:${permissionHash(ctx.permissions)}`;
  }

  async get<T>(ctx: AiCustomerProfileContext, customerId: string, kind: string): Promise<T | null> {
    if (!ctx?.tenantId) return null;
    const raw = await this.cache.get(this.ns(ctx.tenantId), this.key(ctx, customerId, kind));
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }
  async set<T>(ctx: AiCustomerProfileContext, customerId: string, kind: string, value: T): Promise<void> {
    if (!ctx?.tenantId) return;
    await this.cache.set(this.ns(ctx.tenantId), this.key(ctx, customerId, kind), JSON.stringify(value), this.ttlMs);
  }

  /** memoize helper: return cached value or compute+store it. */
  async wrap<T>(ctx: AiCustomerProfileContext, customerId: string, kind: string, compute: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(ctx, customerId, kind);
    if (hit !== null) return hit;
    const fresh = await compute();
    await this.set(ctx, customerId, kind, fresh);
    return fresh;
  }

  /** Invalidate ALL summaries for one tenant (customer/appointment/membership/loyalty/consent change, merge, delete). */
  async invalidateTenant(tenantId: string): Promise<void> {
    if (!tenantId) return;
    await this.cache.invalidate(this.ns(tenantId));
  }
}
