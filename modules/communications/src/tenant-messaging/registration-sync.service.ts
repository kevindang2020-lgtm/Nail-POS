// registration-sync.service.ts — PM-03 / PM-04 (Four-Module Completion Guide §7, Oct 30 2026): reconcile a salon's
// carrier registration with the PROVIDER and store a sanitized snapshot per item (tenant_messaging_registration_snapshots,
// migration 725). Readiness, the POS A2P status and both Phone & Messaging pages read those snapshots.
//
//   • which account: the salon's own (tenant default) Twilio credentials; a salon without its own account uses the
//     platform ISV account (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN), where Super Admin registers brands for it. The
//     resources read are ONLY the ids stored for THIS salon (tenant_a2p_registrations / its own sender number);
//   • what: 10DLC brand, A2P campaign (us_app_to_person on the Messaging Service), the Messaging Service, the sender ↔
//     service association — or, for a toll-free sender, its toll-free verification (10DLC does not apply);
//   • failures: each item records an error CLASS, the last successful read time and the retry state (consecutive
//     failures, next retry with backoff) — shown as "Unknown — not verified", never the old green;
//   • manual "Refresh Status" (settings.edit, rate-limited per salon by the DATABASE clock) and a durable, idempotent,
//     env-gated scheduled refresh (MESSAGING_REGISTRATION_SYNC_ENABLED, OFF by default) on the ONE job queue;
//   • nothing is submitted, resubmitted, edited or paid for.
// Every statement on a tenant table carries `tenant_id = ${tenantId}`; the tenant comes from the session or the job row.
import { Injectable, Inject, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { withCode } from '@aipowersalon/api-contracts';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { readBrand, readCampaign, readMessagingService, readServiceNumbers, readNumberSid, readTollfreeVerification, type RegHttp, type RegAuth, type ReadResult } from './twilio-registration-client';
import { normalizeBrand, normalizeCampaign, normalizeTollfree, numberTypeOf, retryAfterMs, REGISTRATION_REFRESH_MIN_INTERVAL_MS, REGISTRATION_SCHEDULED_EVERY_MS, type ItemKind, type RegItemState, type RegSnapshot } from './registration-model';

export const REGISTRATION_REFRESH_JOB = 'messaging.registration.refresh';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9:_-]{8,120}$/;

export class RegistrationSyncError extends Error {}
const logGap = (what: string) => (e: unknown): void => {
  const code = (e as { code?: unknown } | null)?.code;
  process.stderr.write(JSON.stringify({ level: 'warn', msg: what, code: typeof code === 'string' ? code : null }) + '\n');
};

/** On only when MESSAGING_REGISTRATION_SYNC_ENABLED is explicitly on (dev / test / CI never call the provider by themselves). */
export function registrationSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.MESSAGING_REGISTRATION_SYNC_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export interface SyncRunView { id: string; trigger: string; outcome: string; errorClass: string | null; itemsChecked: number; accountSource: string | null; startedAt: string; finishedAt: string | null }
export type AccountSource = 'tenant_default' | 'platform_isv';

const d = (v: unknown): Date | null => (v ? new Date(String(v instanceof Date ? v.toISOString() : v)) : null);
/** the run columns runView reads (no whole-row read) */
const RUN_COLS = sql`r.id, r.trigger_kind, r.outcome, r.error_class, r.items_checked, r.account_source, r.started_at, r.finished_at`;
const runView = (r: any): SyncRunView => ({ id: String(r.id), trigger: String(r.trigger_kind), outcome: String(r.outcome), errorClass: r.error_class ?? null, itemsChecked: Number(r.items_checked ?? 0),
  accountSource: r.account_source ?? null, startedAt: d(r.started_at)!.toISOString(), finishedAt: r.finished_at ? d(r.finished_at)!.toISOString() : null });

/** the latest snapshot per item + the last run, for one salon (readiness, POS A2P status) */
export async function loadRegistrationSnapshots(db: Kysely<any>, tenantId: string): Promise<{ items: Partial<Record<ItemKind, RegSnapshot>>; lastRun: SyncRunView | null }> {
  const r: any = await sql`SELECT DISTINCT ON (s.item_kind) s.item_kind, s.normalized_state, s.verified, s.source, s.provider_id, s.raw_status, s.error_class, s.checked_at,
      s.last_success_at, s.retry_count, s.next_retry_at, s.details
    FROM tenant_messaging_registration_snapshots s WHERE s.tenant_id = ${tenantId} ORDER BY s.item_kind, s.checked_at DESC, s.id DESC`.execute(db);
  const items: Partial<Record<ItemKind, RegSnapshot>> = {};
  for (const x of r.rows ?? []) {
    items[x.item_kind as ItemKind] = { kind: x.item_kind, state: x.normalized_state, verified: !!x.verified, source: x.source, providerId: x.provider_id ?? null, providerStatus: x.raw_status ?? null,
      errorClass: x.error_class ?? null, checkedAt: d(x.checked_at)!, lastSuccessAt: d(x.last_success_at), retryCount: Number(x.retry_count ?? 0), nextRetryAt: d(x.next_retry_at),
      details: (typeof x.details === 'string' ? JSON.parse(x.details) : x.details) ?? {} };
  }
  const run: any = await sql`SELECT ${RUN_COLS} FROM tenant_messaging_registration_sync_runs r WHERE r.tenant_id = ${tenantId} ORDER BY r.started_at DESC LIMIT 1`.execute(db);
  return { items, lastRun: run.rows?.[0] ? runView(run.rows[0]) : null };
}

interface ItemResult { kind: ItemKind; state: RegItemState; verified: boolean; source: RegSnapshot['source']; providerId: string | null; rawStatus: string | null; errorClass: string | null; details: Record<string, unknown> }

@Injectable()
export class TenantRegistrationSyncService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}
  /** the provider HTTP client (tests swap it for a fake; never a DI dependency) */
  http: RegHttp = (...a) => fetch(...a);
  /** the manual refresh window (tests shorten it) */
  minIntervalMs = REGISTRATION_REFRESH_MIN_INTERVAL_MS;

  private need(): AppDatabase { if (!this.db) throw withCode(new RegistrationSyncError('Registration status needs the database.'), 'SERVICE_UNAVAILABLE'); return this.db; }

  /** the account this salon's registration is read from — its own credentials first, else the platform ISV account */
  private async accountFor(tenantId: string): Promise<{ auth: RegAuth; source: AccountSource; fromNumber: string | null; messagingServiceSid: string | null } | { none: 'not_configured' | 'secret_unreadable' }> {
    const db = this.need();
    const c: any = await sql`SELECT c.account_sid, c.auth_token_enc, c.from_number, c.messaging_service_sid, c.status, c.offboarded_at FROM tenant_messaging_credentials c
      WHERE c.tenant_id = ${tenantId} AND c.provider = 'twilio' AND c.branch_id IS NULL LIMIT 1`.execute(db);
    const row = c.rows?.[0];
    if (row && row.status === 'configured' && !row.offboarded_at && row.account_sid && row.auth_token_enc) {
      let pass: string;
      try { pass = this.secrets.decrypt(row.auth_token_enc); } catch (e) { logGap('registration sync: stored token could not be decrypted')(e); return { none: 'secret_unreadable' }; }
      return { auth: { accountSid: row.account_sid, user: row.account_sid, pass }, source: 'tenant_default', fromNumber: row.from_number ?? null, messagingServiceSid: row.messaging_service_sid ?? null };
    }
    const sid = process.env.TWILIO_ACCOUNT_SID || '', tok = process.env.TWILIO_AUTH_TOKEN || '';
    if (sid && tok) {
      const n: any = await sql`SELECT n.phone_number FROM tenant_messaging_numbers n WHERE n.tenant_id = ${tenantId} AND n.channel = 'sms' AND n.status = 'active' ORDER BY n.created_at LIMIT 1`.execute(db);
      return { auth: { accountSid: sid, user: sid, pass: tok }, source: 'platform_isv', fromNumber: n.rows?.[0]?.phone_number ?? null, messagingServiceSid: null };
    }
    return { none: 'not_configured' };
  }

  /**
   * Refresh this salon's registration status from the provider. Idempotent per `idempotencyKey` (a replay returns the
   * first run). Manual refreshes are rate-limited per salon. Returns the run; the snapshots are read separately.
   */
  async refresh(tenantId: string, opts: { trigger: 'manual' | 'scheduled'; idempotencyKey: string; actorUserId?: string | null }): Promise<{ run: SyncRunView; replayed: boolean }> {
    const db = this.need();
    if (!UUID.test(tenantId)) throw withCode(new RegistrationSyncError('Unknown salon.'), 'VALIDATION_FAILED');
    if (!KEY.test(opts.idempotencyKey)) throw withCode(new RegistrationSyncError('Invalid request key.'), 'VALIDATION_FAILED');
    const prior: any = await sql`SELECT ${RUN_COLS} FROM tenant_messaging_registration_sync_runs r WHERE r.tenant_id = ${tenantId} AND r.idempotency_key = ${opts.idempotencyKey} LIMIT 1`.execute(db);
    if (prior.rows?.[0]) return { run: runView(prior.rows[0]), replayed: true };
    if (opts.trigger === 'manual') {
      const recent: any = await sql`SELECT EXTRACT(EPOCH FROM (now() - r.started_at)) * 1000 AS age_ms FROM tenant_messaging_registration_sync_runs r
        WHERE r.tenant_id = ${tenantId} AND r.trigger_kind = 'manual' ORDER BY r.started_at DESC LIMIT 1`.execute(db);
      const age = recent.rows?.[0]?.age_ms;
      const wait = age == null ? 0 : this.minIntervalMs - Number(age);
      if (wait > 0) throw withCode(new RegistrationSyncError('Registration status was just refreshed for this salon. Try again shortly.'), 'REGISTRATION_REFRESH_RATE_LIMITED', { retryAfterSeconds: Math.ceil(wait / 1000) });
    }
    const actor = opts.actorUserId && UUID.test(opts.actorUserId) ? opts.actorUserId : null;
    const ins: any = await sql`INSERT INTO tenant_messaging_registration_sync_runs (tenant_id, trigger_kind, idempotency_key, requested_by_user_id)
      VALUES (${tenantId}, ${opts.trigger}, ${opts.idempotencyKey}, ${actor}) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`.execute(db);
    if (!ins.rows?.[0]) {   // a concurrent request with the same key won: return ITS run
      const again: any = await sql`SELECT ${RUN_COLS} FROM tenant_messaging_registration_sync_runs r WHERE r.tenant_id = ${tenantId} AND r.idempotency_key = ${opts.idempotencyKey} LIMIT 1`.execute(db);
      return { run: runView(again.rows[0]), replayed: true };
    }
    const runId = String(ins.rows[0].id);
    let outcome: 'ok' | 'partial' | 'provider_unreachable' | 'not_configured' | 'error' = 'ok'; let errorClass: string | null = null; let items: ItemResult[] = []; let accountSource: string | null = null;
    try {
      const reg: any = await sql`SELECT a.brand_sid, a.brand_status, a.campaign_sid, a.campaign_status, a.messaging_service_sid, a.number_sid FROM tenant_a2p_registrations a WHERE a.tenant_id = ${tenantId} LIMIT 1`.execute(db);
      const rec = reg.rows?.[0] ?? null;
      const acct = await this.accountFor(tenantId);
      if ('none' in acct) {
        outcome = 'not_configured'; errorClass = acct.none;
      } else {
        accountSource = acct.source;
        items = await this.readItems(acct.auth, acct.fromNumber, rec, rec?.messaging_service_sid ?? acct.messagingServiceSid ?? null);
        const failed = items.filter((i) => i.errorClass);
        if (failed.length && failed.length === items.length) { outcome = 'provider_unreachable'; errorClass = failed[0].errorClass; }
        else if (failed.length) { outcome = 'partial'; errorClass = failed[0].errorClass; }
        const changed = await this.writeSnapshots(db, tenantId, runId, accountSource, items);
        if (changed.length) {
          await this.audit.record({ tenantId, userId: actor }, { module: 'messaging', action: 'registration.status_changed', resourceType: 'tenant_messaging_registration_snapshots', resourceId: runId,
            summary: 'Carrier registration status changed (provider read)', metadata: { trigger: opts.trigger, changes: changed } }).catch(logGap('registration sync: audit write failed'));
        }
      }
    } catch (e) {
      outcome = 'error'; errorClass = 'internal';
      logGap('registration sync: run failed')(e);
    }
    const done: any = await sql`UPDATE tenant_messaging_registration_sync_runs SET outcome = ${outcome}, error_class = ${errorClass}, items_checked = ${items.length}, account_source = ${accountSource}, finished_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${runId}::uuid RETURNING id, trigger_kind, outcome, error_class, items_checked, account_source, started_at, finished_at`.execute(db);
    if (opts.trigger === 'manual') {
      await this.audit.record({ tenantId, userId: actor }, { module: 'messaging', action: 'registration.status_refreshed', resourceType: 'tenant_messaging_registration_sync_runs', resourceId: runId,
        summary: `Carrier registration status refreshed: ${outcome}`, metadata: { outcome, errorClass, itemsChecked: items.length, accountSource } }).catch(logGap('registration sync: audit write failed'));
    }
    return { run: runView(done.rows[0]), replayed: false };
  }

  /** read every item that applies to this sender; each item succeeds or fails on its own */
  private async readItems(auth: RegAuth, fromNumber: string | null, rec: any | null, msid: string | null): Promise<ItemResult[]> {
    const fail = (kind: ItemKind, r: ReadResult<unknown> & { ok: false }, providerId: string | null): ItemResult => ({ kind, state: 'unknown', verified: false, source: 'provider', providerId, rawStatus: null, errorClass: r.errorClass, details: { httpStatus: r.httpStatus } });
    const out: ItemResult[] = [];
    const nt = numberTypeOf(fromNumber);
    if (nt.type === 'toll_free' && fromNumber) {
      // PM-04: toll-free verification, tracked on its own (10DLC does not apply)
      const pn = await readNumberSid(this.http, auth, fromNumber);
      if (!pn.ok) { out.push(fail('tollfree_verification', pn, null)); return out; }
      if (!pn.value.sid) { out.push({ kind: 'tollfree_verification', state: 'unknown', verified: false, source: 'provider', providerId: null, rawStatus: null, errorClass: 'not_found', details: { reason: 'NUMBER_NOT_ON_ACCOUNT' } }); return out; }
      const v = await readTollfreeVerification(this.http, auth, pn.value.sid);
      if (!v.ok) { out.push(fail('tollfree_verification', v, null)); return out; }
      const st = normalizeTollfree(v.value.status, v.value.found);
      out.push({ kind: 'tollfree_verification', state: st, verified: true, source: 'provider', providerId: v.value.sid, rawStatus: v.value.status,
        errorClass: null, details: { numberSidLast4: pn.value.sid.slice(-4), submittedAt: v.value.submittedAt, updatedAt: v.value.updatedAt, rejectionCode: v.value.rejectionCode, rejectionReason: v.value.rejectionReason, editAllowed: v.value.editAllowed, numberTypeSource: nt.source } });
      return out;
    }
    // 10DLC: brand → campaign → Messaging Service → number association
    const brandSid: string | null = rec?.brand_sid && /^BN[0-9a-fA-F]{32}$/.test(String(rec.brand_sid)) ? String(rec.brand_sid) : null;
    if (brandSid) {
      const b = await readBrand(this.http, auth, brandSid);
      out.push(b.ok ? { kind: 'brand', state: normalizeBrand(b.value.status), verified: true, source: 'provider', providerId: b.value.sid ?? brandSid, rawStatus: b.value.status, errorClass: null, details: { submittedAt: b.value.createdAt, failureReason: b.value.failureReason } } : fail('brand', b, brandSid));
    } else out.push({ kind: 'brand', state: 'not_started', verified: false, source: 'registration_record', providerId: null, rawStatus: null, errorClass: null, details: {} });
    const ms = msid && /^MG[0-9a-fA-F]{32}$/.test(String(msid)) ? String(msid) : null;
    if (!ms) {
      out.push({ kind: 'campaign', state: 'not_started', verified: false, source: 'registration_record', providerId: null, rawStatus: null, errorClass: null, details: {} });
      out.push({ kind: 'messaging_service', state: 'not_started', verified: false, source: 'registration_record', providerId: null, rawStatus: null, errorClass: null, details: {} });
      return out;
    }
    const campaignSid = rec?.campaign_sid ? String(rec.campaign_sid) : null;
    const c = await readCampaign(this.http, auth, ms, campaignSid);
    out.push(!c.ok ? fail('campaign', c, campaignSid) : !c.value.found ? { kind: 'campaign', state: 'not_started', verified: true, source: 'provider', providerId: null, rawStatus: null, errorClass: null, details: {} }
      : { kind: 'campaign', state: normalizeCampaign(c.value.status), verified: true, source: 'provider', providerId: c.value.sid, rawStatus: c.value.status, errorClass: null, details: { submittedAt: c.value.createdAt } });
    const s = await readMessagingService(this.http, auth, ms);
    out.push(!s.ok ? fail('messaging_service', s, ms) : { kind: 'messaging_service', state: s.value.a2pRegistered === true ? 'approved' : s.value.a2pRegistered === false ? 'pending' : 'unknown', verified: true, source: 'provider', providerId: s.value.sid ?? ms, rawStatus: s.value.a2pRegistered == null ? null : s.value.a2pRegistered ? 'US_APP_TO_PERSON_REGISTERED' : 'NOT_REGISTERED', errorClass: null, details: {} });
    if (fromNumber) {
      const n = await readServiceNumbers(this.http, auth, ms);
      out.push(!n.ok ? fail('number_association', n, ms) : { kind: 'number_association', state: n.value.numbers.includes(fromNumber) ? 'approved' : 'pending', verified: true, source: 'provider', providerId: ms, rawStatus: n.value.numbers.includes(fromNumber) ? 'NUMBER_IN_SERVICE' : 'NUMBER_NOT_IN_SERVICE', errorClass: null, details: { senderLast4: fromNumber.slice(-4), serviceNumbers: n.value.numbers.length } });
    }
    return out;
  }

  /** append one snapshot per item (carrying the last success + retry state forward); returns the state changes */
  private async writeSnapshots(db: AppDatabase, tenantId: string, runId: string, accountSource: string, items: ItemResult[]): Promise<{ item: ItemKind; from: string | null; to: string }[]> {
    const { items: prev } = await loadRegistrationSnapshots(db as unknown as Kysely<any>, tenantId);
    const changes: { item: ItemKind; from: string | null; to: string }[] = [];
    for (const it of items) {
      const p = prev[it.kind];
      const ok = !it.errorClass;
      const retries = ok ? 0 : (p?.errorClass ? p.retryCount : 0) + 1;
      const nextRetry = ok ? null : new Date(Date.now() + retryAfterMs(retries));
      await sql`INSERT INTO tenant_messaging_registration_snapshots (tenant_id, run_id, item_kind, provider_id, raw_status, normalized_state, verified, source, account_source, error_class, details, last_success_at, retry_count, next_retry_at)
        VALUES (${tenantId}, ${runId}::uuid, ${it.kind}, ${it.providerId}, ${it.rawStatus}, ${it.state}, ${it.verified}, ${it.source}, ${accountSource}, ${it.errorClass}, ${JSON.stringify(it.details)}::jsonb,
          ${ok ? sql`now()` : sql`${p?.lastSuccessAt ?? null}::timestamptz`}, ${retries}, ${nextRetry})`.execute(db);
      if (ok && (p?.state ?? null) !== it.state) changes.push({ item: it.kind, from: p?.state ?? null, to: it.state });
    }
    return changes;
  }
}

// ── the scheduled refresh (durable job queue; OFF unless MESSAGING_REGISTRATION_SYNC_ENABLED) ──────────────────────────

/**
 * CROSS-TENANT BY DESIGN (a platform sweep that enqueues one job PER salon, each carrying its own tenant id): salons
 * with a registration record or a toll-free sender whose last read is older than the cadence, or whose failed read's
 * retry time has come. The idempotency key is the salon + the due minute, so a dispatcher that runs twice enqueues once.
 * Staggered: each salon's job runs a stable 0–10 min after dispatch.
 */
export async function dispatchRegistrationRefresh(db: Kysely<any>, nowMs = Date.now(), limit = 500): Promise<{ enqueued: number; duplicates: number }> {
  const due: any = await sql`
    WITH candidates AS (
      SELECT a.tenant_id FROM tenant_a2p_registrations a JOIN tenants t ON t.id = a.tenant_id AND t.status = 'active'
      UNION
      SELECT c.tenant_id FROM tenant_messaging_credentials c JOIN tenants t ON t.id = c.tenant_id AND t.status = 'active'
       WHERE c.provider = 'twilio' AND c.branch_id IS NULL AND c.status = 'configured' AND c.from_number ~ '^[+]1(800|833|844|855|866|877|888)[0-9]{7}$'),
    last AS (
      SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.checked_at, s.error_class, s.next_retry_at
        FROM tenant_messaging_registration_snapshots s JOIN candidates k ON k.tenant_id = s.tenant_id ORDER BY s.tenant_id, s.checked_at DESC)
    SELECT k.tenant_id::text AS tenant_id, l.checked_at, l.error_class, l.next_retry_at FROM candidates k LEFT JOIN last l ON l.tenant_id = k.tenant_id
     ORDER BY l.checked_at NULLS FIRST LIMIT ${limit}`.execute(db);
  let enqueued = 0, duplicates = 0;
  for (const r of due.rows ?? []) {
    const dueAt = !r.checked_at ? nowMs : r.error_class && r.next_retry_at ? new Date(r.next_retry_at).getTime() : new Date(r.checked_at).getTime() + REGISTRATION_SCHEDULED_EVERY_MS;
    if (dueAt > nowMs) continue;
    const stagger = (parseInt(String(r.tenant_id).replace(/-/g, '').slice(-6), 16) % 600) * 1000;
    const dueKey = `${r.tenant_id}:${Math.floor(dueAt / 60_000)}`;
    const j = await enqueueJob(db, { jobClass: 'standard', jobType: REGISTRATION_REFRESH_JOB, tenantId: String(r.tenant_id), payload: { due: dueKey }, priority: 3, maxAttempts: 3, idempotencyKey: dueKey, runAfter: new Date(nowMs + stagger) });
    if (j.duplicate) duplicates++; else enqueued++;
  }
  return { enqueued, duplicates };
}

/** the job: one salon's refresh. A provider outage is RECORDED (snapshot retry state) and re-dispatched at its retry
 *  time; an internal error throws so the queue retries it with backoff and, after max attempts, it is dead (visible). */
export async function runRegistrationRefreshJob(svc: Pick<TenantRegistrationSyncService, 'refresh'>, tenantId: string | null, payload: Record<string, unknown>, attempt = 1): Promise<{ outcome: string; replayed: boolean }> {
  if (!tenantId || !UUID.test(tenantId)) throw withCode(new PermanentJobError('a registration refresh needs its tenant'), 'VALIDATION_FAILED');
  const due = String(payload.due ?? '');
  if (!due.startsWith(`${tenantId}:`)) throw withCode(new PermanentJobError('a registration refresh job belongs to its own tenant'), 'VALIDATION_FAILED');
  const { run, replayed } = await svc.refresh(tenantId, { trigger: 'scheduled', idempotencyKey: `job:${due}:${attempt}` });
  if (run.outcome === 'error') throw new Error('registration refresh failed (internal)');
  return { outcome: run.outcome, replayed };
}

@Injectable()
export class MessagingRegistrationSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MessagingRegistrationSyncScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly everyMs = 60 * 60 * 1000;
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly svc: TenantRegistrationSyncService) {}

  onModuleInit(): void {
    if (!this.db) return;
    const db = this.db as unknown as Kysely<any>;
    // the handler is registered wherever the module loads (a worker process may run it); the dispatcher is env-gated
    if (!jobHandlerFor(REGISTRATION_REFRESH_JOB)) registerJobHandler(REGISTRATION_REFRESH_JOB, (payload, ctx) => runRegistrationRefreshJob(this.svc, ctx.tenantId, payload, ctx.attempt));
    if (!runsBackgroundJob('standard') || !registrationSyncEnabled()) return;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'messaging.registration_dispatch', jobClass: 'standard', everyMs: this.everyMs }, async () => {
        const r = await dispatchRegistrationRefresh(db);
        if (r.enqueued) this.logger.log(`registration refresh: ${r.enqueued} salon(s) enqueued`);
      }).catch((e) => this.logger.warn(`registration refresh dispatch failed: ${e?.message ?? e}`));
    }, this.everyMs);
    (this.timer as { unref?: () => void }).unref?.();
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
