// provider-reliability.kysely.repository.ts — persistence for circuit breakers + fixed-window rate limits.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

const nz = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export type BreakerRow = { connection_id: string; state: string; failure_count: number; success_count: number; failure_threshold: number; cooldown_seconds: number; opened_at: string | null; half_opened_at: string | null; open_elapsed?: number; half_open_elapsed?: number | null };

export class ProviderReliabilityRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async getBreaker(connectionId: string, defaults: { threshold: number; cooldown: number }): Promise<BreakerRow> {
    const r: any = await sql<any>`select connection_id::text as connection_id, state, failure_count, success_count, failure_threshold, cooldown_seconds,
      to_char(opened_at,'YYYY-MM-DD"T"HH24:MI:SS') as opened_at, to_char(half_opened_at,'YYYY-MM-DD"T"HH24:MI:SS') as half_opened_at,
      extract(epoch from (now() - opened_at)) as open_elapsed, extract(epoch from (now() - half_opened_at)) as half_open_elapsed
      from integration_circuit_breakers where connection_id = ${connectionId}::uuid`.execute(this.db);
    if (r.rows[0]) return { ...r.rows[0], open_elapsed: nz(r.rows[0].open_elapsed), half_open_elapsed: r.rows[0].half_open_elapsed == null ? null : nz(r.rows[0].half_open_elapsed) } as any;
    await sql`insert into integration_circuit_breakers (connection_id, failure_threshold, cooldown_seconds) values (${connectionId}::uuid, ${defaults.threshold}, ${defaults.cooldown}) on conflict (connection_id) do nothing`.execute(this.db);
    return { connection_id: connectionId, state: 'closed', failure_count: 0, success_count: 0, failure_threshold: defaults.threshold, cooldown_seconds: defaults.cooldown, opened_at: null, half_opened_at: null } as any;
  }

  async openElapsedSeconds(connectionId: string): Promise<number> {
    const r: any = await sql<any>`select coalesce(extract(epoch from (now() - opened_at)),0) as e from integration_circuit_breakers where connection_id = ${connectionId}::uuid`.execute(this.db);
    return nz(r.rows[0]?.e);
  }

  async transition(connectionId: string, state: 'closed' | 'open' | 'half_open'): Promise<void> {
    const openStamp = state === 'open' ? sql`now()` : sql`opened_at`;
    const halfStamp = state === 'half_open' ? sql`now()` : sql`half_opened_at`;
    const resetFail = state === 'closed' ? sql`0` : sql`failure_count`;
    await sql`update integration_circuit_breakers set state = ${state}, opened_at = ${openStamp}, half_opened_at = ${halfStamp}, failure_count = ${resetFail}, last_state_change_at = now(), updated_at = now() where connection_id = ${connectionId}::uuid`.execute(this.db);
  }

  /** Phase 2: take the ONE half-open probe slot. Atomic — of two processes that both see an expired open circuit, one
   *  wins; a half-open probe that never reported back (its process died) is reclaimable after the cooldown. */
  async claimProbe(connectionId: string): Promise<boolean> {
    const r: any = await sql`update integration_circuit_breakers set state = 'half_open', half_opened_at = now(), last_state_change_at = now(), updated_at = now()
      where connection_id = ${connectionId}::uuid
        and ((state = 'open' and opened_at <= now() - make_interval(secs => cooldown_seconds))
          or (state = 'half_open' and half_opened_at <= now() - make_interval(secs => cooldown_seconds)))
      returning connection_id`.execute(this.db);
    return r.rows.length === 1;
  }

  async recordSuccess(connectionId: string): Promise<void> {
    await sql`update integration_circuit_breakers set success_count = success_count + 1, failure_count = 0, updated_at = now() where connection_id = ${connectionId}::uuid`.execute(this.db);
  }

  // Returns the new failure_count and whether the breaker should open (>= threshold).
  async recordFailure(connectionId: string): Promise<{ failureCount: number; threshold: number }> {
    const r: any = await sql<any>`update integration_circuit_breakers set failure_count = failure_count + 1, last_failure_at = now(), updated_at = now() where connection_id = ${connectionId}::uuid returning failure_count, failure_threshold`.execute(this.db);
    return { failureCount: nz(r.rows[0]?.failure_count), threshold: nz(r.rows[0]?.failure_threshold) };
  }

  // Fixed-window peek: returns true if the scope is currently OVER its limit (or pinned by a provider Retry-After).
  async isLimited(scopeType: string, scopeKey: string, cfg: { limit: number; windowSeconds: number }): Promise<{ limited: boolean; retryAfter: number }> {
    const r: any = await sql<any>`select count, limit_per_window, window_seconds,
      extract(epoch from (now() - window_start)) as age, coalesce(extract(epoch from (retry_after_until - now())),0) as ra
      from integration_rate_limits where scope_type = ${scopeType} and scope_key = ${scopeKey}`.execute(this.db);
    const row = r.rows[0];
    if (!row) return { limited: false, retryAfter: 0 };
    if (nz(row.ra) > 0) return { limited: true, retryAfter: Math.ceil(nz(row.ra)) };
    const age = nz(row.age); const win = nz(row.window_seconds) || cfg.windowSeconds;
    if (age >= win) return { limited: false, retryAfter: 0 }; // window elapsed → will reset on increment
    return { limited: nz(row.count) >= (nz(row.limit_per_window) || cfg.limit), retryAfter: Math.ceil(win - age) };
  }

  async increment(scopeType: string, scopeKey: string, cfg: { limit: number; windowSeconds: number }): Promise<void> {
    // reset the window if elapsed, else bump the counter
    await sql`insert into integration_rate_limits (scope_type, scope_key, window_seconds, limit_per_window, window_start, count)
      values (${scopeType}, ${scopeKey}, ${cfg.windowSeconds}, ${cfg.limit}, now(), 1)
      on conflict (scope_type, scope_key) do update set
        window_start = case when extract(epoch from (now() - integration_rate_limits.window_start)) >= integration_rate_limits.window_seconds then now() else integration_rate_limits.window_start end,
        count = case when extract(epoch from (now() - integration_rate_limits.window_start)) >= integration_rate_limits.window_seconds then 1 else integration_rate_limits.count + 1 end,
        limit_per_window = ${cfg.limit}, window_seconds = ${cfg.windowSeconds}, updated_at = now()`.execute(this.db);
  }

  async pinRetryAfter(scopeType: string, scopeKey: string, seconds: number, cfg: { limit: number; windowSeconds: number }): Promise<void> {
    await sql`insert into integration_rate_limits (scope_type, scope_key, window_seconds, limit_per_window, retry_after_until, count)
      values (${scopeType}, ${scopeKey}, ${cfg.windowSeconds}, ${cfg.limit}, now() + (${seconds} || ' seconds')::interval, 0)
      on conflict (scope_type, scope_key) do update set retry_after_until = now() + (${seconds} || ' seconds')::interval, updated_at = now()`.execute(this.db);
  }

  async getState(connectionId: string): Promise<any> {
    const b: any = await sql<any>`select state, failure_count, failure_threshold, cooldown_seconds, to_char(opened_at,'YYYY-MM-DD"T"HH24:MI:SS') as opened_at from integration_circuit_breakers where connection_id = ${connectionId}::uuid`.execute(this.db);
    const rl: any = await sql<any>`select scope_type, scope_key, count, limit_per_window, window_seconds, to_char(retry_after_until,'YYYY-MM-DD"T"HH24:MI:SS') as retry_after_until from integration_rate_limits where scope_key = ${connectionId} or scope_type in ('provider','tenant') order by scope_type`.execute(this.db);
    return { breaker: b.rows[0] ?? { state: 'closed', failure_count: 0 }, rateLimits: rl.rows ?? [] };
  }

  async resetBreaker(connectionId: string): Promise<void> {
    await sql`update integration_circuit_breakers set state = 'closed', failure_count = 0, opened_at = null, half_opened_at = null, last_state_change_at = now(), updated_at = now() where connection_id = ${connectionId}::uuid`.execute(this.db);
  }
}
