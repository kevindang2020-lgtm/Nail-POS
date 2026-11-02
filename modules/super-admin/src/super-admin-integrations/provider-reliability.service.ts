// provider-reliability.service.ts — the guard every outbound provider call passes through. Enforces the per-connection
// circuit breaker (closed→open→half_open→closed) and per-provider/tenant/connection fixed-window rate limits, and
// exposes the exponential-backoff-with-jitter schedule used by retries. An open breaker fast-fails without touching
// the provider and drives the connection to 'degraded'; recovery via a half-open probe restores it. Reset is an
// audited Super Admin action.

import { sql } from 'kysely';
import { admit, onFailure, type CircuitSnapshot } from '@aipowersalon/observability';
import { ProviderReliabilityRepo } from './provider-reliability.kysely.repository';

type Actor = { id?: string; role?: string };
export type ReliabilityConfig = { failureThreshold: number; cooldownSeconds: number; limits: { provider: { limit: number; windowSeconds: number }; tenant: { limit: number; windowSeconds: number }; connection: { limit: number; windowSeconds: number } } };
const DEFAULTS: ReliabilityConfig = { failureThreshold: 5, cooldownSeconds: 60, limits: { provider: { limit: 1000, windowSeconds: 60 }, tenant: { limit: 500, windowSeconds: 60 }, connection: { limit: 200, windowSeconds: 60 } } };

export type GuardCtx = { connectionId: string; tenantId?: string | null; providerKey: string; operation: string };
export type GuardResult<T> = { ok: boolean; result?: T; blocked?: 'circuit_open' | 'rate_limited'; scope?: string; errorCategory?: string; error?: string; retryAfterSeconds?: number; breakerState?: string };

// Exponential backoff with full jitter, capped. Pure + deterministic given `rand`.
export function computeBackoffMs(attempt: number, opts: { baseMs?: number; capMs?: number; jitter?: boolean } = {}, rand: () => number = Math.random): number {
  const base = opts.baseMs ?? 1000; const cap = opts.capMs ?? 60000;
  const raw = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
  if (opts.jitter === false) return raw;
  return Math.floor((0.5 + rand() * 0.5) * raw); // full-ish jitter in [0.5*raw, raw]
}

export class ProviderReliabilityService {
  private readonly cfg: ReliabilityConfig;
  constructor(private readonly repo?: ProviderReliabilityRepo, private readonly db?: any, cfg?: Partial<ReliabilityConfig>) {
    this.cfg = { ...DEFAULTS, ...cfg, limits: { ...DEFAULTS.limits, ...(cfg?.limits ?? {}) } } as ReliabilityConfig;
  }

  backoffMs(attempt: number, jitter = true) { return computeBackoffMs(attempt, { jitter }); }

  async run<T>(ctx: GuardCtx, fn: () => Promise<T>): Promise<GuardResult<T>> {
    if (!this.repo) { try { return { ok: true, result: await fn() }; } catch (e: any) { return { ok: false, errorCategory: 'Provider Error', error: String(e?.message ?? e) }; } }
    const br = await this.repo.getBreaker(ctx.connectionId, { threshold: this.cfg.failureThreshold, cooldown: this.cfg.cooldownSeconds });
    // Circuit breaker gate — THE breaker's decision (circuit-breaker.ts, BUILD_PLAN Phase 2) over this durable row.
    if (br.state !== 'closed') {
      const nowMs = Date.now();
      const openElapsed = br.state === 'open' ? (br.open_elapsed ?? await this.repo.openElapsedSeconds(ctx.connectionId)) : 0;
      const policy = { failureThreshold: Number(br.failure_threshold) || this.cfg.failureThreshold, openMs: (Number(br.cooldown_seconds) || this.cfg.cooldownSeconds) * 1000 };
      const snap: CircuitSnapshot = {
        state: br.state === 'half_open' ? 'half_open' : 'open', consecutiveFailures: Number(br.failure_count) || 0,
        openedAt: nowMs - openElapsed * 1000,
        // a half-open probe is in flight until it reports — or until a cooldown passes (its process died mid-call)
        probeInFlight: br.state === 'half_open' && (br.half_open_elapsed == null || br.half_open_elapsed * 1000 < policy.openMs),
      };
      const a = admit(snap, nowMs, policy);
      const claimed = a.allowed && (this.repo.claimProbe ? await this.repo.claimProbe(ctx.connectionId) : (await this.repo.transition(ctx.connectionId, 'half_open'), true));
      if (!claimed) return { ok: false, blocked: 'circuit_open', errorCategory: 'Circuit Breaker Open', retryAfterSeconds: Math.max(1, Math.ceil(a.retryAfterMs / 1000)), breakerState: br.state };
    }
    // rate-limit gate — peek all applicable scopes, then increment only if all pass
    const scopes: { type: string; key: string; cfg: { limit: number; windowSeconds: number }; category: string }[] = [
      { type: 'provider', key: ctx.providerKey, cfg: this.cfg.limits.provider, category: 'Provider Rate Limit' },
      ...(ctx.tenantId ? [{ type: 'tenant', key: ctx.tenantId, cfg: this.cfg.limits.tenant, category: 'Tenant Limit Reached' }] : []),
      { type: 'connection', key: ctx.connectionId, cfg: this.cfg.limits.connection, category: 'Provider Rate Limit' },
    ];
    for (const s of scopes) { const chk = await this.repo.isLimited(s.type, s.key, s.cfg); if (chk.limited) return { ok: false, blocked: 'rate_limited', scope: s.type, errorCategory: s.category, retryAfterSeconds: chk.retryAfter }; }
    for (const s of scopes) await this.repo.increment(s.type, s.key, s.cfg);

    try {
      const result = await fn();
      const cur = await this.repo.getBreaker(ctx.connectionId, { threshold: this.cfg.failureThreshold, cooldown: this.cfg.cooldownSeconds });
      if (cur.state === 'half_open') { await this.repo.transition(ctx.connectionId, 'closed'); await this.setConnection(ctx.connectionId, 'active'); }
      else await this.repo.recordSuccess(ctx.connectionId);
      return { ok: true, result };
    } catch (e: any) {
      const retryAfter = Number(e?.retryAfterSeconds) || 0;
      if (retryAfter > 0) await this.repo.pinRetryAfter('provider', ctx.providerKey, retryAfter, this.cfg.limits.provider);
      const cur = await this.repo.getBreaker(ctx.connectionId, { threshold: this.cfg.failureThreshold, cooldown: this.cfg.cooldownSeconds });
      if (cur.state === 'half_open') { await this.repo.transition(ctx.connectionId, 'open'); await this.setConnection(ctx.connectionId, 'degraded'); return { ok: false, blocked: 'circuit_open', errorCategory: 'Circuit Breaker Open', error: String(e?.message ?? e), breakerState: 'open' }; }
      const f = await this.repo.recordFailure(ctx.connectionId);
      if (onFailure({ state: 'closed', consecutiveFailures: f.failureCount - 1, openedAt: null, probeInFlight: false }, Date.now(), { failureThreshold: f.threshold, openMs: this.cfg.cooldownSeconds * 1000 }).state === 'open') { await this.repo.transition(ctx.connectionId, 'open'); await this.setConnection(ctx.connectionId, 'degraded'); return { ok: false, errorCategory: 'Circuit Breaker Open', error: String(e?.message ?? e), breakerState: 'open', retryAfterSeconds: retryAfter || undefined }; }
      return { ok: false, errorCategory: retryAfter ? 'Provider Rate Limit' : 'Provider Error', error: String(e?.message ?? e), retryAfterSeconds: retryAfter || undefined };
    }
  }

  private async setConnection(connectionId: string, status: 'active' | 'degraded') {
    if (!this.db) return;
    await sql`update integration_connections set connection_status = ${status}, updated_at = now() where id = ${connectionId}::uuid and connection_status not in ('disabled','compromised','retired')`.execute(this.db).catch(() => undefined);
  }

  async getReliability(_actor: Actor, connectionId?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!connectionId) return { ok: false as const, error: 'connection_required', status: 400 };
    return { ok: true as const, status: 200, ...(await this.repo.getState(String(connectionId))) };
  }

  async resetCircuit(actor: Actor, connectionId?: string, reason?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!connectionId) return { ok: false as const, error: 'connection_required', status: 400 };
    if (!String(reason ?? '').trim()) return { ok: false as const, error: 'reason_required', status: 400 };
    await this.repo.resetBreaker(String(connectionId));
    await this.setConnection(String(connectionId), 'active');
    if (this.db) await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${actor.id ?? null}::uuid, 'SUPER_ADMIN', 'super_admin_integration_circuit_reset', 'integration_connection', ${String(connectionId)}, ${JSON.stringify({ reason })}::jsonb)`.execute(this.db).catch(() => undefined);
    return { ok: true as const, status: 200, breakerState: 'closed' };
  }
}
