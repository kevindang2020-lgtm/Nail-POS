// reception-copilot-live-state.service.ts — transient live-call + session state (spec §38), over the EXISTING cache port
// (Redis when REDIS_URL is set, in-memory otherwise — same seam as Copilot settings). This is NOT a new subsystem and NOT
// authoritative: the durable record stays in Postgres (reception_copilot_sessions + appointments). It holds short-lived
// operational state — which call is active for a tenant, and lightweight session context — so takeover can verify a call
// is active + owned without a DB round-trip, and so state survives across stateless API nodes.
//
// Key design (§38): namespace carries the TENANT (`copilot:{tenantId}`), so keys are tenant-scoped and cannot collide
// across tenants; the key is `{resourceType}:{id}`. Short TTLs. Fail-open: a cache miss/failure never blocks or corrupts
// a mutation — the caller degrades to the Postgres path.
import { Injectable, Inject } from '@nestjs/common';
import { InMemoryCache, type CachePort } from '../cache/cache-port';
import type { CopilotCtx } from './reception-copilot-context.service';

const CALL_TTL_MS = 2 * 60 * 60 * 1000;    // a live call won't outlast this
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface ActiveCall { tenantId: string; branchId: string | null; providerCallId: string; customerId?: string | null; startedMs: number }

@Injectable()
export class ReceptionCopilotLiveStateService {
  private readonly cache: CachePort;
  constructor(@Inject('COPILOT_CACHE') cache: CachePort | null) { this.cache = cache ?? new InMemoryCache(); }

  private ns(tenantId: string): string { return `copilot:${tenantId}`; }   // tenant is IN the namespace → tenant-scoped

  /** Provider webhook marks a call active for a tenant. Enables takeover ownership + active-status verification. */
  async setActiveCall(ctx: CopilotCtx, input: { providerCallId: string; customerId?: string | null }): Promise<void> {
    const rec: ActiveCall = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, providerCallId: input.providerCallId, customerId: input.customerId ?? null, startedMs: Date.now() };
    try { await this.cache.set(this.ns(ctx.tenantId), `call:${input.providerCallId}`, JSON.stringify(rec), CALL_TTL_MS); } catch { /* fail-open */ }
  }

  /** Read active-call state for THIS tenant only — a call recorded under another tenant is in a different namespace and
   * is unreachable here, so this cannot confirm another tenant's call. */
  async getActiveCall(tenantId: string, providerCallId: string): Promise<ActiveCall | null> {
    try {
      const raw = await this.cache.get(this.ns(tenantId), `call:${providerCallId}`);
      return raw ? JSON.parse(raw) as ActiveCall : null;
    } catch { return null; }
  }

  async clearActiveCall(tenantId: string, providerCallId: string): Promise<void> {
    try { await this.cache.set(this.ns(tenantId), `call:${providerCallId}`, '', 1); } catch { /* fail-open */ }
  }

  /** Lightweight session context cache (POS route, current entity), tenant-scoped, short TTL. Durable session row is in
   * Postgres; this is the fast cross-node read. */
  async setSession(ctx: CopilotCtx, sessionId: string, state: Record<string, unknown>): Promise<void> {
    try { await this.cache.set(this.ns(ctx.tenantId), `session:${sessionId}`, JSON.stringify({ ...state, tenantId: ctx.tenantId, userId: ctx.userId, at: Date.now() }), SESSION_TTL_MS); } catch { /* fail-open */ }
  }
  async getSession(tenantId: string, sessionId: string): Promise<Record<string, unknown> | null> {
    try { const raw = await this.cache.get(this.ns(tenantId), `session:${sessionId}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
}
