// ai-checkout-upsell.kysely.ts — DB-backed ports. The idempotency store uses the api_idempotency primary key (scope,
// idem_key) as the concurrency boundary (§46/§47) — BUILD_PLAN Phase 10 merged the upsell's own table into the ONE store
// (migration 541; scope 'ai_upsell:<tenant>:<branch>:<checkout>:<op>:<target>'): begin() tries to INSERT an 'inflight' row; a collision means another
// attempt already holds the key, so we read it back and report done/conflict/pending. complete() flips it to 'done' with
// the result; fail() deletes a still-pending row so a retry can proceed. Tenant/branch are server-derived from ctx.
import { API_IDEMPOTENCY } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { UPSELL_RECOMMENDATION } from '../checkout/checkout-lifecycles';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiCheckoutUpsellContext } from './ai-checkout-upsell.dto';
import type { IdempotencyStore, BeginResult } from './ai-checkout-upsell.idempotency';
import { rowsToLayers, cleanTunablesPatch, type SettingsRow } from './ai-checkout-upsell-settings';
import type { UpsellSettingsPort, TechnicianSchedulePort } from './ai-checkout-upsell.service';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';
import { businessDate, zonedParts } from '@aipowersalon/date-time';
import { branchTimeZone } from '@aipowersalon/database';

// The idempotency key string encodes tenant|branch|checkout|operation|target|clientKey — split to scope the row.
function parseKey(key: string) {
  const [tenant_id, branch_id, checkout_id, operation, target_id, idem_key] = key.split('|');
  return { tenant_id, branch_id, checkout_id, operation, target_id, idem_key: idem_key ?? 'none' };
}

const upsellScope = (k: ReturnType<typeof parseKey>) => `ai_upsell:${k.tenant_id}:${k.branch_id}:${k.checkout_id}:${k.operation}:${k.target_id}`;

export class KyselyIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Kysely<DB>, private readonly pollMs = 25, private readonly pollMax = 160) {}

  async begin(key: string, hash: string): Promise<BeginResult> {
    const k = parseKey(key);
    const ins = await sql`
      INSERT INTO api_idempotency (scope, idem_key, tenant_id, method, route, request_hash, state, expires_at)
      VALUES (${upsellScope(k)}, ${k.idem_key}, ${k.tenant_id}, 'INTERNAL', ${'ai_checkout_upsell.' + k.operation}, ${hash}, 'inflight', now() + interval '7 days')
      ON CONFLICT (scope, idem_key) DO NOTHING RETURNING idem_key`.execute(this.db).catch(() => ({ rows: [] }));
    if (ins.rows.length) return { status: 'new' };
    // collision — another attempt already reserved this key; read it back to decide.
    const row: any = await this.rowFor(k);
    if (!row) return { status: 'new' };
    if (row.request_hash !== hash) return { status: 'conflict' };
    if (row.state === 'done') return { status: 'done', result: row.response_body ?? null };
    // inflight: a concurrent attempt is running — WAIT for its result rather than double-execute (§47).
    for (let i = 0; i < this.pollMax; i++) {
      await new Promise(r => setTimeout(r, this.pollMs));
      const r2: any = await this.rowFor(k);
      if (!r2) return { status: 'new' };                          // winner failed + released → we may proceed
      if (r2.request_hash !== hash) return { status: 'conflict' };
      if (r2.state === 'done') return { status: 'done', result: r2.response_body ?? null };
    }
    return { status: 'new' };                                     // timed out → assume crashed winner; take over
  }
  async complete(key: string, result: unknown): Promise<void> {
    const k = parseKey(key);
    await sql`UPDATE api_idempotency SET state = 'done', response_body = ${JSON.stringify(result ?? null)}::jsonb, completed_at = now()
      WHERE scope = ${upsellScope(k)} AND idem_key = ${k.idem_key} AND ${canMoveToSql(API_IDEMPOTENCY, 'done')} AND tenant_id = ${k.tenant_id}`.execute(this.db).catch(() => {});
  }
  async fail(key: string): Promise<void> {
    const k = parseKey(key);
    await sql`DELETE FROM api_idempotency WHERE scope = ${upsellScope(k)} AND idem_key = ${k.idem_key} AND tenant_id = ${k.tenant_id} AND state = 'inflight'`
      .execute(this.db).catch(() => {});
  }

  private async rowFor(k: ReturnType<typeof parseKey>) {
    return (await sql`SELECT request_hash, state, response_body FROM api_idempotency
      WHERE scope = ${upsellScope(k)} AND idem_key = ${k.idem_key} AND tenant_id = ${k.tenant_id}`.execute(this.db)).rows[0];
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export class KyselyUpsellSettings implements UpsellSettingsPort {
  constructor(private readonly db: Kysely<DB>) {}
  async layers(ctx: AiCheckoutUpsellContext) {
    const rows = await this.db.selectFrom('ai_checkout_upsell_settings')
      .select(['level', 'branch_id', 'device_id', 'user_id', 'enabled', 'tunables'])
      .where('tenant_id', '=', ctx.tenantId)
      // w4 sweep SW-15: a layer is only asked for when the caller HAS that id — comparing a uuid column with '' (no device on
      // a POS web session) failed the whole statement and every layer, the salon's own off-switch included, was ignored
      .where((eb: any) => eb.or([
        eb('level', '=', 'tenant'),
        ...(isUuid(ctx.branchId) ? [eb.and([eb('level', '=', 'branch'), eb('branch_id', '=', ctx.branchId)])] : []),
        ...(isUuid(ctx.deviceId) ? [eb.and([eb('level', '=', 'device'), eb('device_id', '=', ctx.deviceId)])] : []),
        ...(isUuid(ctx.userId) ? [eb.and([eb('level', '=', 'user'), eb('user_id', '=', ctx.userId)])] : []),
      ]))
      // Checkout Upsell Settings guide (Nov 2026): no `.catch(() => [])` — an unreadable settings table used to resolve to the
      // platform defaults, i.e. ENABLED with every category on, even for a salon that had switched the assistant off.
      .limit(50).execute();
    const mapped: SettingsRow[] = rows.map(r => ({ level: r.level, branch_id: r.branch_id ?? null, device_id: r.device_id ?? null, user_id: r.user_id ?? null, enabled: r.enabled ?? null, tunables: r.tunables ?? null }));
    return rowsToLayers(mapped, ctx);
  }

  /** the stored row for one layer of this scope (what the salon saved, not the resolved value) */
  async stored(ctx: AiCheckoutUpsellContext, level: 'tenant' | 'branch' | 'device' | 'user') {
    const k = this.key(ctx, level);
    const r = await this.match(this.db.selectFrom('ai_checkout_upsell_settings').select(['enabled', 'tunables', 'version', 'updated_at', 'updated_by_user_id']), ctx.tenantId, level, k).executeTakeFirst() as { enabled: boolean | null; tunables: unknown; version: number; updated_at: string | null; updated_by_user_id: string | null } | undefined;
    return r ? { enabled: r.enabled ?? null, tunables: (r.tunables ?? null) as Record<string, unknown> | null, version: Number(r.version ?? 1), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null, updatedByUserId: r.updated_by_user_id ?? null }
      : { enabled: null, tunables: null, version: 0, updatedAt: null, updatedByUserId: null };
  }
  private key(ctx: AiCheckoutUpsellContext, level: string) {
    return { branch_id: level === 'branch' ? (ctx.branchId || null) : null, device_id: level === 'device' ? (ctx.deviceId || null) : null, user_id: level === 'user' ? (ctx.userId || null) : null };
  }
  private match(q: any, tenantId: string, level: string, k: { branch_id: string | null; device_id: string | null; user_id: string | null }) {
    q = q.where('tenant_id', '=', tenantId).where('level', '=', level);
    q = k.branch_id ? q.where('branch_id', '=', k.branch_id) : q.where('branch_id', 'is', null);
    q = k.device_id ? q.where('device_id', '=', k.device_id) : q.where('device_id', 'is', null);
    return k.user_id ? q.where('user_id', '=', k.user_id) : q.where('user_id', 'is', null);
  }

  /** Checkout Upsell Settings guide (Nov 2026): one transaction that MERGES the patch into the stored layer (a category
   *  toggle used to send back the whole RESOLVED set — platform defaults and the branch / user layers got baked into the
   *  salon's row — and "Disable"/"Enable" wrote `tunables: null`, wiping every category and limit), refuses a stale
   *  `expectedVersion` (two managers saving at once), and appends a before/after row to the settings history. */
  async setLayer(ctx: AiCheckoutUpsellContext, level: 'tenant' | 'branch' | 'device' | 'user', patch: { enabled?: boolean; tunables?: any }, expectedVersion?: number | null): Promise<{ version: number }> {
    const k = this.key(ctx, level);
    const tunablesPatch = cleanTunablesPatch(patch.tunables);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('upsell-settings:' || ${ctx.tenantId} || ':' || ${level} || ':' || ${k.branch_id ?? ''} || ${k.device_id ?? ''} || ${k.user_id ?? ''}))`.execute(trx);
      const cur = await this.match(trx.selectFrom('ai_checkout_upsell_settings').select(['id', 'enabled', 'tunables', 'version']), ctx.tenantId, level, k).executeTakeFirst() as { id: string; enabled: boolean | null; tunables: unknown; version: number } | undefined;
      const curVersion = cur ? Number(cur.version ?? 1) : 0;
      if (expectedVersion != null && expectedVersion !== curVersion) throw new Error('UPSELL_SETTINGS_VERSION_CONFLICT');
      const beforeT = (cur?.tunables ?? {}) as Record<string, unknown>;
      const afterT = { ...beforeT, ...tunablesPatch } as Record<string, unknown>;
      const beforeE = cur ? (cur.enabled ?? null) : null;
      const afterE = patch.enabled === undefined ? beforeE : patch.enabled;
      const changed = [...(afterE !== beforeE ? ['enabled'] : []), ...Object.keys(tunablesPatch).filter((x) => beforeT[x] !== afterT[x])];
      if (!changed.length) return { version: curVersion };   // nothing changed — no new version, no history row
      const version = curVersion + 1;
      const actor = isUuid(ctx.userId) ? ctx.userId : null;
      if (cur) {
        await trx.updateTable('ai_checkout_upsell_settings').set({ enabled: afterE, tunables: JSON.stringify(afterT), version, updated_by_user_id: actor, updated_at: sql<string>`now()` })
          .where('tenant_id', '=', ctx.tenantId).where('id', '=', cur.id).execute();
      } else {
        await trx.insertInto('ai_checkout_upsell_settings')
          .values({ tenant_id: ctx.tenantId, level, ...k, enabled: afterE, tunables: JSON.stringify(afterT), version, updated_by_user_id: actor }).execute();
      }
      await trx.insertInto('ai_checkout_upsell_settings_history').values({
        tenant_id: ctx.tenantId, level, ...k, version, actor_user_id: actor, actor_role: ctx.role ?? null,
        before_enabled: beforeE, after_enabled: afterE, before_tunables: JSON.stringify(beforeT), after_tunables: JSON.stringify(afterT), changed_keys: changed,
      }).execute();
      return { version };
    });
  }
}

// DB-backed dismissals + feedback (§52/§53). Tenant/branch/checkout/user scoped. Dismissals are unique per
// (tenant, checkout, target) so a repeated dismiss is a no-op (ON CONFLICT DO NOTHING); dismissed() returns the target
// ids to suppress for this checkout. Feedback is append-only and never rewrites rules.
import type { DismissalPort } from './ai-checkout-upsell.service';

export class KyselyDismissals implements DismissalPort {
  constructor(private readonly db: Kysely<DB>) {}
  async dismissed(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<string[]> {
    const rows = await this.db.selectFrom('ai_checkout_upsell_dismissals').select(['target_id'])
      .where('tenant_id', '=', ctx.tenantId).where('checkout_id', '=', checkoutId).limit(200).execute().catch(() => [] as any[]);
    return rows.map(r => String(r.target_id));
  }
  async record(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string, reason: string): Promise<void> {
    await this.db.insertInto('ai_checkout_upsell_dismissals')
      .values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, checkout_id: checkoutId, target_id: targetId, reason, user_id: ctx.userId })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'checkout_id', 'target_id']).doNothing())
      .execute().catch(() => {});
  }
  async recordFeedback(ctx: AiCheckoutUpsellContext, checkoutId: string, recommendationId: string, rating: string, reason: string): Promise<void> {
    await this.db.insertInto('ai_checkout_upsell_feedback')
      .values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, checkout_id: checkoutId, recommendation_id: recommendationId, rating, reason, user_id: ctx.userId })
      .execute().catch(() => {});
  }
}

// DB-backed recommendation records (§44) — populates the analytics table the Super Admin oversight reads. Generation
// writes are deduped per (tenant, checkout, target, context_fingerprint) so re-generation of the same cart shape does not
// inflate counts; outcomes flip the row to APPLIED / DISMISSED (only from an open status).
import type { RecommendationRecord } from './ai-checkout-upsell.records';
import type { RecommendationRecordPort } from './ai-checkout-upsell.service';

export class KyselyRecords implements RecommendationRecordPort {
  constructor(private readonly db: Kysely<DB>) {}
  async persistGenerated(_ctx: AiCheckoutUpsellContext, records: RecommendationRecord[]): Promise<void> {
    if (!records.length) return;
    await this.db.insertInto('ai_checkout_upsell_recommendations')
      .values(records.map(r => ({
        tenant_id: r.tenantId, branch_id: r.branchId, checkout_id: r.checkoutId, customer_id: r.customerId,
        type: r.type, target_id: r.targetId, title: r.title, price_cents: r.priceCents, status: r.status,
        context_fingerprint: r.contextFingerprint, version: r.version, expires_at: r.expiresAt,
      })))
      .onConflict((oc: any) => oc.columns(['tenant_id', 'checkout_id', 'target_id', 'context_fingerprint']).doNothing())
      .execute().catch(() => {});
  }
  async markApplied(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string, resultRef: string): Promise<void> {
    await this.db.updateTable('ai_checkout_upsell_recommendations')
      .set({ status: 'APPLIED', accepted_by_user_id: ctx.userId, result_ref: resultRef })
      .where('tenant_id', '=', ctx.tenantId).where('checkout_id', '=', checkoutId).where('target_id', '=', targetId)
      .where('status', 'in', ['GENERATED', 'DISPLAYED']).where(canMoveToSql(UPSELL_RECOMMENDATION, 'APPLIED') as any).execute().catch(() => {});
  }
  async markDismissed(ctx: AiCheckoutUpsellContext, checkoutId: string, targetId: string): Promise<void> {
    await this.db.updateTable('ai_checkout_upsell_recommendations')
      .set({ status: 'DISMISSED' })
      .where('tenant_id', '=', ctx.tenantId).where('checkout_id', '=', checkoutId).where('target_id', '=', targetId)
      .where('status', 'in', ['GENERATED', 'DISPLAYED']).where(canMoveToSql(UPSELL_RECOMMENDATION, 'DISMISSED') as any).execute().catch(() => {});
  }
}

/** Functional Decision 27: the technician's next appointment today, on the BRANCH's clock (branches.timezone →
 *  America/New_York, the shared lookup). Only appointments that still hold the chair count, and only ones starting AFTER
 *  now — the appointment being checked out started earlier. A fixed zone can be passed for tests. */
export class KyselyTechnicianSchedule implements TechnicianSchedulePort {
  constructor(private readonly db: Kysely<DB>, private readonly timeZone?: string, private readonly now: () => Date = () => new Date()) {}
  async nextAppointment(ctx: AiCheckoutUpsellContext, technicianId: string): Promise<{ startsInMinutes: number; startTime: string } | null> {
    const zone = this.timeZone ?? await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
    const n = this.now(); const p = zonedParts(n, zone);
    const nowMin = p.hour * 60 + p.minute;
    const hhmm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    const r: any = await this.db.selectFrom('pos_tech_appointments').select(['start_time'])
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', ctx.branchId).where('technician_id', '=', technicianId)
      .where('appt_date', '=', businessDate(zone, n)).where('status', 'in', [...CHAIR_HOLDING_STATUSES]).where('start_time', '>', hhmm)
      .orderBy('start_time', 'asc').limit(1).executeTakeFirst().catch(() => null);
    if (!r?.start_time) return null;
    const [h, m] = String(r.start_time).split(':').map(Number);
    return { startsInMinutes: h * 60 + m - nowMin, startTime: String(r.start_time).slice(0, 5) };
  }
}
