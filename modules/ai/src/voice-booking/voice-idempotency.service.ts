// voice-idempotency.service.ts — idempotency for gateway mutations (§20/§21) + the server-derived handoff destination.
// Semantics: begin() inserts a 'pending' row — the unique index is the concurrency gate, so two simultaneous identical
// calls can't both proceed. commit() stores the response for verbatim replay. A retry with the same payload replays;
// a different payload under the same key is a conflict; a failed request release()s so a clean retry works.
import { API_IDEMPOTENCY, canMoveToSql, branchTimeZone } from '@aipowersalon/database';
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { VoiceContext } from './voice-booking.service';

export type IdemBegin =
  | { kind: 'proceed' }
  | { kind: 'replay'; response: any }
  | { kind: 'conflict' }
  | { kind: 'inflight' };

export interface VoiceIdempotencyRepo {
  begin(ctx: VoiceContext, operation: string, key: string, requestHash: string): Promise<IdemBegin>;
  commit(ctx: VoiceContext, operation: string, key: string, response: any): Promise<void>;
  release(ctx: VoiceContext, operation: string, key: string): Promise<void>;
}

@Injectable()
export class VoiceIdempotencyService {
  constructor(@Inject('VoiceIdempotencyRepo') private readonly repo: VoiceIdempotencyRepo) {}
  begin(ctx: VoiceContext, op: string, key: string, hash: string) { return this.repo.begin(ctx, op, key, hash); }
  commit(ctx: VoiceContext, op: string, key: string, response: any) { return this.repo.commit(ctx, op, key, response); }
  release(ctx: VoiceContext, op: string, key: string) { return this.repo.release(ctx, op, key); }
}

export class InMemoryVoiceIdempotencyRepo implements VoiceIdempotencyRepo {
  private rows = new Map<string, { hash: string; status: 'pending' | 'committed'; response?: any }>();
  private k(ctx: VoiceContext, op: string, key: string) { return `${ctx.tenantId}|${op}|${key}`; }
  async begin(ctx: VoiceContext, op: string, key: string, hash: string): Promise<IdemBegin> {
    const k = this.k(ctx, op, key);
    const cur = this.rows.get(k);
    if (!cur) { this.rows.set(k, { hash, status: 'pending' }); return { kind: 'proceed' }; }
    if (cur.status === 'committed') return cur.hash === hash ? { kind: 'replay', response: cur.response } : { kind: 'conflict' };
    return cur.hash === hash ? { kind: 'inflight' } : { kind: 'conflict' };
  }
  async commit(ctx: VoiceContext, op: string, key: string, response: any) { const r = this.rows.get(this.k(ctx, op, key)); if (r) { r.status = 'committed'; r.response = response; } }
  async release(ctx: VoiceContext, op: string, key: string) { const k = this.k(ctx, op, key); const r = this.rows.get(k); if (r?.status === 'pending') this.rows.delete(k); }
}

// BUILD_PLAN Phase 10 (migration 541): the voice gateway's own table was merged into the ONE idempotency store,
// api_idempotency — scope 'voice:<tenant>:<operation>', so the expiry sweep and tenant deletion cover these rows too.
// Same semantics as before: the (scope, idem_key) primary key is the concurrency gate.
const voiceScope = (ctx: VoiceContext, op: string) => `voice:${ctx.tenantId}:${op}`;
export class KyselyVoiceIdempotencyRepo implements VoiceIdempotencyRepo {
  constructor(private readonly db: Kysely<any>) {}
  async begin(ctx: VoiceContext, op: string, key: string, hash: string): Promise<IdemBegin> {
    const scope = voiceScope(ctx, op);
    const inserted = (await sql`
      INSERT INTO api_idempotency (scope, idem_key, tenant_id, method, route, request_hash, state, expires_at)
      VALUES (${scope}, ${key}, ${ctx.tenantId}, 'INTERNAL', ${'voice_gateway.' + op}, ${hash}, 'inflight', now() + interval '7 days')
      ON CONFLICT (scope, idem_key) DO NOTHING
      RETURNING idem_key`.execute(this.db)).rows[0];
    if (inserted) return { kind: 'proceed' };
    const row: any = (await sql`SELECT request_hash, state, response_body FROM api_idempotency
      WHERE scope = ${scope} AND idem_key = ${key} AND tenant_id = ${ctx.tenantId} LIMIT 1`.execute(this.db)).rows[0];
    if (!row) return { kind: 'proceed' }; // raced with a release; treat as fresh
    if (row.state === 'done') return row.request_hash === hash ? { kind: 'replay', response: row.response_body } : { kind: 'conflict' };
    return row.request_hash === hash ? { kind: 'inflight' } : { kind: 'conflict' };
  }
  async commit(ctx: VoiceContext, op: string, key: string, response: any) {
    await sql`UPDATE api_idempotency SET state = 'done', response_body = ${JSON.stringify(response ?? null)}::jsonb, completed_at = now()
      WHERE scope = ${voiceScope(ctx, op)} AND idem_key = ${key} AND ${canMoveToSql(API_IDEMPOTENCY, 'done')} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
  }
  async release(ctx: VoiceContext, op: string, key: string) {
    await sql`DELETE FROM api_idempotency
      WHERE scope = ${voiceScope(ctx, op)} AND idem_key = ${key} AND tenant_id = ${ctx.tenantId} AND state = 'inflight'`.execute(this.db);
  }
}

/**
 * VoiceBranchInfoService — narrow, read-only branch facts the gateway needs: the human-transfer phone (§16/§31,
 * ALWAYS server-derived from the branch record, never accepted from Retell) and the branch's store hours + timezone.
 * Deliberately NOT PosSettingsService: that service gates reads behind tenant-staff roles + `settings.view`, which
 * would force granting the AI principal a settings scope the spec's least-privilege rule (§3.3) forbids. This reads
 * ONLY the store_hours row from tenant_settings, merged over the same DEFAULT_SETTINGS the settings module uses —
 * one source of truth for defaults, no duplicated business rules.
 */
import { DEFAULT_SETTINGS, type DayHour } from '@aipowersalon/tenants';

export interface BranchHours { timezone: string | null; storeHours: Record<string, DayHour> }

@Injectable()
export class VoiceBranchInfoService {
  constructor(@Inject('VOICE_HANDOFF_DB') private readonly db: Kysely<any> | null) {}

  async transferDestination(ctx: VoiceContext): Promise<string | null> {
    if (!this.db) return null; // honest: no DB handle → no configured destination
    try {
      // Prefer the salon-editable phone (POS Settings → Business & Branch, stored in tenant_settings 'business_branch');
      // fall back to the branches table column. Either way the number is server-derived, never taken from Retell.
      const rows: any[] = (await sql`SELECT branch_id, settings_json FROM tenant_settings
        WHERE tenant_id = ${ctx.tenantId} AND category = 'business_branch' AND (branch_id = ${ctx.branchId} OR branch_id IS NULL)`.execute(this.db)).rows;
      const pick = rows.find((r) => r.branch_id === ctx.branchId) ?? rows.find((r) => r.branch_id == null);
      if (pick) {
        const j = typeof pick.settings_json === 'string' ? JSON.parse(pick.settings_json) : (pick.settings_json ?? {});
        const settingsPhone = String(j?.phone ?? '').trim();
        if (settingsPhone) return settingsPhone;
      }
      const row: any = (await sql`SELECT phone FROM branches WHERE tenant_id = ${ctx.tenantId} AND id = ${ctx.branchId} LIMIT 1`.execute(this.db)).rows[0];
      const phone = String(row?.phone ?? '').trim();
      return phone || null;
    } catch { return null; }
  }

  /** Store hours for the branch: the Settings screen's 'store-hours-auto-logout' row (branch row > tenant-wide row) over
   *  DEFAULT_SETTINGS; the zone is the BRANCH's own (branchTimeZone — the one "salon day" source). This read the category
   *  'store_hours', which nothing writes: every salon got the default hours and New York's clock, so the voice platform
   *  was told absolute times off by the zone difference (wave 4 PILOT, Oct 13 2026). */
  async storeHours(ctx: VoiceContext): Promise<BranchHours> {
    const dflt = DEFAULT_SETTINGS.storeHoursAutoLogout;
    const base: BranchHours = { timezone: dflt.timezone ?? null, storeHours: { ...dflt.storeHours } };
    if (!this.db) return base;
    const zone = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null).catch(() => base.timezone);
    try {
      const rows: any[] = (await sql`SELECT branch_id, settings_json FROM tenant_settings
        WHERE tenant_id = ${ctx.tenantId} AND category IN ('store-hours-auto-logout', 'store_hours') AND (branch_id = ${ctx.branchId} OR branch_id IS NULL)`.execute(this.db)).rows;
      const pick = rows.find((r) => r.branch_id === ctx.branchId) ?? rows.find((r) => r.branch_id == null);
      if (!pick) return { ...base, timezone: zone };
      const j = typeof pick.settings_json === 'string' ? JSON.parse(pick.settings_json) : (pick.settings_json ?? {});
      return { timezone: zone, storeHours: { ...base.storeHours, ...(j.storeHours ?? {}) } };
    } catch { return { ...base, timezone: zone }; }
  }
}
