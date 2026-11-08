// backup-center.service.ts — Enterprise Backup & Disaster Recovery guide (Nov 5 2026, G9): the recovery catalog, the
// Backup Center read model and the restore plan / approval / job workflow. Rules live in backup-center-core.ts.
//
// HONEST LIMITS (docs/backup/BACKUP_AND_DR.md §6). This service never takes or stores a backup itself — the provider's
// job reports what it produced (POST /internal/backups/recovery-points) and a real restore into a scratch database
// proves it (…/verification, posted by scripts/restore-verify.ts). A restore here runs against an ISOLATED STAGED CLONE
// (RESTORE_STAGING_DATABASE_URL) and never writes the live database: NON_DESTRUCTIVE_PREVIEW compares the staged tenant
// rows with the live ones; FULL_TENANT / ONE_BRANCH stop at BLOCKED (DESTRUCTIVE_APPLY_NOT_AVAILABLE) after every check
// passes, until the recovery pilots (§47) have run. Nothing is reported RESTORED without evidence (§14, §33).
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { DATABASE, canMoveToSql, enqueueJob, registerJobHandler, jobHandlerFor } from '@aipowersalon/database';
import {
  BACKUP_RECOVERY_POINT, BACKUP_RESTORE_PLAN, BackupCenterError, APPROVAL_TTL_MS, BACKUP_TZ, RESTORE_MODES,
  validateManifest, canonicalJson, sha256Hex, retentionFor, midnightSchedule, missedMidnightCheckpoint, localDate,
  evaluatePlan, planChecksum, checkApproval, type RestoreMode, type PointView, type PostPointActivity, type PlanPreview,
} from './backup-center-core';

// response-exposure (Nov 5 2026): explicit columns — a column added later is not returned by accident
const RP_COLS = sql.raw('id, environment, scope, tenant_id, branch_id, source, backup_ref, recovery_timestamp, pitr_window_start, pitr_window_end, database_checkpoint, wal_timeline, schema_version, app_release, manifest, manifest_sha256, size_bytes, retention_class, expires_at, immutable_replica_status, verification_status, verification_detail, verified_at, rejected_reasons, created_at, updated_at, updated_by');
const PLAN_COLS = sql.raw('id, mode, tenant_id, branch_id, recovery_point_id, target_timestamp, reason, plan, plan_sha256, status, version, idempotency_key, requested_by, approved_by, approved_at, approval_expires_at, approved_plan_sha256, finance_acknowledged, job_id, started_at, completed_at, failure_code, failure_detail, evidence, created_at, updated_at, updated_by');

export const RESTORE_JOB_TYPE = 'backups.restore_execute';
const log = new Logger('BackupCenter');
const warn = (what: string) => (e: unknown) => { log.warn(`${what}: ${String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200)}`); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNRESOLVED_ATTEMPT = ['processing', 'unknown', 'reconciliation_required', 'needs_review', 'authorization_pending', 'confirmation_pending', 'authorized', 'card_detected', 'awaiting_customer_tap'];
export interface BackupActor { userId: string | null; email: string | null }

/** Where the isolated recovered clone lives. Never the live database (§10: "never run a historical restore against the live cluster"). */
export interface StagingSource { open(): { db: Kysely<any>; close: () => Promise<void> } | null; describe(): string | null }
export const envStagingSource = (env: NodeJS.ProcessEnv = process.env): StagingSource => ({
  describe: () => (env.RESTORE_STAGING_DATABASE_URL ? 'RESTORE_STAGING_DATABASE_URL' : null),
  open: () => {
    const url = env.RESTORE_STAGING_DATABASE_URL;
    if (!url) return null;
    if (url === env.DATABASE_URL || url === env.PG_WORKER_DATABASE_URL) throw new BackupCenterError('RESTORE_STATE_CONFLICT', 'RESTORE_STAGING_DATABASE_URL points at the live database. A restore is staged in an isolated clone only.', 409);
    const pool = new Pool({ connectionString: url, max: 2 });
    const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    return { db, close: () => db.destroy() };
  },
});
export const BACKUP_STAGING = 'BackupStagingSource';
export const BACKUP_CLOCK = 'BackupCenterClock';

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());
function pointView(r: any, now: number): PointView & Record<string, unknown> {
  const expired = r.expires_at && new Date(r.expires_at).getTime() <= now;
  return {
    id: r.id, scope: r.scope, tenantId: r.tenant_id, branchId: r.branch_id, source: r.source, backupRef: r.backup_ref, environment: r.environment,
    recoveryTimestamp: iso(r.recovery_timestamp)!, pitrWindowStart: iso(r.pitr_window_start), pitrWindowEnd: iso(r.pitr_window_end),
    databaseCheckpoint: r.database_checkpoint, walTimeline: r.wal_timeline, schemaVersion: r.schema_version, appRelease: r.app_release,
    manifestSha256: r.manifest_sha256, sizeBytes: Number(r.size_bytes ?? 0), retentionClass: r.retention_class, expiresAt: iso(r.expires_at),
    immutableReplica: r.immutable_replica_status,
    // §32: a point past retention is not recoverable whatever its last verification said
    verificationStatus: expired && r.verification_status !== 'FAILED' ? 'EXPIRED' : r.verification_status,
    verificationDetail: r.verification_detail, verifiedAt: iso(r.verified_at), rejectedReasons: r.rejected_reasons ?? [],
    artifacts: Array.isArray(r.manifest?.artifacts) ? r.manifest.artifacts.map((a: any) => ({ kind: a.kind, location: a.location, sha256: a.sha256, sizeBytes: a.sizeBytes, keyRef: a.keyRef, immutable: a.immutable === true })) : [],
  };
}

@Injectable()
export class BackupCenterService {
  private readonly staging: StagingSource;
  private readonly clock: () => number;
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<any>,
    @Optional() @Inject(BACKUP_STAGING) staging?: StagingSource | null,
    @Optional() @Inject(BACKUP_CLOCK) clock?: (() => number) | null,
  ) {
    this.staging = staging ?? envStagingSource();
    this.clock = clock ?? Date.now;
    if (!jobHandlerFor(RESTORE_JOB_TYPE)) registerJobHandler(RESTORE_JOB_TYPE, async (payload: any) => this.runRestoreJob(String(payload?.planId ?? '')));
  }

  // ── catalog ingestion (service-to-service) ──────────────────────────────────────────────────────────────────────────
  async recordPoint(raw: unknown, reportedBy: string): Promise<{ id: string; verificationStatus: string; duplicate: boolean; errors?: string[] }> {
    const v = validateManifest(raw);
    const m: any = raw;
    if (!v.ok) {
      // identity intact but the artifacts unsafe/incomplete → recorded as a FAILED point so the failure is visible (§34);
      // the stored manifest keeps the identity only — never the offending fields
      const identityOk = v.errors.every((e) => e.startsWith('artifacts') || e.includes('credential'));
      if (!identityOk) throw new BackupCenterError('BACKUP_MANIFEST_INVALID', 'The backup manifest is incomplete or unsafe.', 422, { errors: v.errors });
      const ident = { backupRef: m.backupRef, environment: m.environment, scope: m.scope, tenantId: m.tenantId ?? null, branchId: m.branchId ?? null, source: m.source,
        recoveryTimestamp: m.recoveryTimestamp, pitrWindowStart: m.pitrWindowStart ?? null, pitrWindowEnd: m.pitrWindowEnd ?? null, schemaVersion: m.schemaVersion, rejected: true };
      const id = await this.insertPoint(ident, ident, 0, 'missing', 'FAILED', v.errors, reportedBy);
      return { ...id, verificationStatus: 'FAILED', errors: v.errors };
    }
    const man = v.manifest;
    const size = man.artifacts.reduce((s, a) => s + a.sizeBytes, 0);
    const immutable = man.artifacts.filter((a) => a.kind === 'database').every((a) => a.immutable === true) ? 'present' : 'missing';
    const r = await this.insertPoint(man, man, size, immutable, 'UNVERIFIED', [], reportedBy);
    return { ...r, verificationStatus: r.duplicate ? (await this.pointRow(r.id)).verification_status : 'UNVERIFIED' };
  }

  private async insertPoint(ident: any, manifest: any, size: number, immutable: string, status: string, rejected: string[], reportedBy: string): Promise<{ id: string; duplicate: boolean }> {
    const sha = sha256Hex(canonicalJson(manifest));
    const ts = Date.parse(ident.recoveryTimestamp);
    const ret = retentionFor(ident.source, ts);
    const ins = await sql<{ id: string }>`
      insert into backup_recovery_points (environment, scope, tenant_id, branch_id, source, backup_ref, recovery_timestamp, pitr_window_start, pitr_window_end,
        database_checkpoint, wal_timeline, schema_version, app_release, manifest, manifest_sha256, size_bytes, retention_class, expires_at,
        immutable_replica_status, verification_status, verification_detail, rejected_reasons)
      values (${ident.environment}, ${ident.scope}, ${ident.tenantId ?? null}, ${ident.branchId ?? null}, ${ident.source}, ${ident.backupRef}, ${new Date(ts).toISOString()},
        ${ident.pitrWindowStart ?? null}, ${ident.pitrWindowEnd ?? null}, ${manifest.databaseCheckpoint ?? null}, ${manifest.walTimeline ?? null}, ${ident.schemaVersion},
        ${manifest.appRelease ?? null}, ${JSON.stringify(manifest)}::jsonb, ${sha}, ${size}, ${ret.cls}, ${ret.expiresAt === null ? null : new Date(ret.expiresAt).toISOString()},
        ${immutable}, ${status}, ${status === 'FAILED' ? `Rejected manifest (reported by ${reportedBy.slice(0, 60)})` : null}, ${JSON.stringify(rejected)}::jsonb)
      on conflict (environment, backup_ref) do nothing returning id`.execute(this.db);
    if (ins.rows[0]) return { id: ins.rows[0].id, duplicate: false };
    const ex = (await sql<any>`select id, manifest_sha256 from backup_recovery_points where environment = ${ident.environment} and backup_ref = ${ident.backupRef}`.execute(this.db)).rows[0];
    if (!ex) throw new BackupCenterError('BACKUP_MANIFEST_CONFLICT', 'The backup could not be recorded. Report it again.', 409);
    if (ex.manifest_sha256 !== sha) throw new BackupCenterError('BACKUP_MANIFEST_CONFLICT', 'A different manifest was already recorded for this backup.', 409);
    return { id: ex.id, duplicate: true };
  }

  private async pointRow(id: string): Promise<any> {
    if (!UUID.test(id)) throw new BackupCenterError('RECOVERY_POINT_NOT_FOUND', 'That recovery point was not found.', 404);
    const r = (await sql<any>`select ${RP_COLS} from backup_recovery_points where id = ${id}`.execute(this.db)).rows[0];
    if (!r) throw new BackupCenterError('RECOVERY_POINT_NOT_FOUND', 'That recovery point was not found.', 404);
    return r;
  }

  /** A real restore test's evidence (§36). VERIFIED needs every required check to have passed — never "the file exists". */
  async recordVerification(pointId: string, body: { checks?: Record<string, unknown>; detail?: string | null; startedAt?: string | null; completedAt?: string | null }, reportedBy: string) {
    const row = await this.pointRow(pointId);
    if (row.rejected_reasons?.length) throw new BackupCenterError('BACKUP_MANIFEST_INVALID', 'A rejected manifest cannot be verified. Report a corrected backup.', 422);
    const checks = body?.checks && typeof body.checks === 'object' ? body.checks : {};
    const required = ['schema', 'data', 'checksums'];
    const optional = ['decrypt', 'objects', 'smoke'];
    const vals = Object.fromEntries([...required, ...optional].filter((k) => k in checks).map((k) => [k, checks[k] === true]));
    const missing = required.filter((k) => !(k in vals));
    const failedRequired = required.filter((k) => vals[k] === false);
    const result = failedRequired.length ? 'FAILED' : missing.length || Object.values(vals).some((x) => x === false) ? 'PARTIAL' : 'VERIFIED';
    const completed = body?.completedAt && !Number.isNaN(Date.parse(body.completedAt)) ? new Date(body.completedAt).toISOString() : new Date(this.clock()).toISOString();
    const detail = [missing.length ? `not run: ${missing.join(', ')}` : '', failedRequired.length ? `failed: ${failedRequired.join(', ')}` : '', String(body?.detail ?? '').slice(0, 1500)].filter(Boolean).join(' — ') || null;
    await this.db.transaction().execute(async (trx) => {
      await sql`insert into backup_point_verifications (recovery_point_id, result, checks, detail, started_at, completed_at, reported_by)
        values (${pointId}, ${result}, ${JSON.stringify(vals)}::jsonb, ${detail}, ${body?.startedAt && !Number.isNaN(Date.parse(body.startedAt)) ? body.startedAt : null}, ${completed}, ${reportedBy.slice(0, 80)})`.execute(trx);
      const u = await sql`update backup_recovery_points set verification_status = ${result}, verification_detail = ${detail}, verified_at = ${completed}, updated_at = now()
        where id = ${pointId} and ${canMoveToSql(BACKUP_RECOVERY_POINT, result)}`.execute(trx);
      if (!Number(u.numAffectedRows ?? 0)) throw new BackupCenterError('RESTORE_STATE_CONFLICT', 'This recovery point can no longer be verified (expired).', 409);
    });
    return { recoveryPointId: pointId, result, checks: vals, detail };
  }

  // ── Backup Center read model ────────────────────────────────────────────────────────────────────────────────────────
  async currentSchemaVersion(db: Kysely<any> = this.db): Promise<string> {
    const r = (await sql<any>`select max(filename) as v from schema_migrations`.execute(db)).rows[0];
    return String(r?.v ?? '');
  }

  async overview() {
    const now = this.clock();
    const pts = (await sql<any>`select ${RP_COLS} from backup_recovery_points where recovery_timestamp > now() - interval '400 days' order by recovery_timestamp desc limit 2000`.execute(this.db)).rows.map((r) => pointView(r, now));
    const platform = pts.filter((p) => p.scope === 'platform');
    const verified = pts.filter((p) => p.verificationStatus === 'VERIFIED');
    const latestVerified = verified.reduce<number | null>((m, p) => { const t = p.source === 'pitr_window' ? Date.parse(p.pitrWindowEnd!) : Date.parse(p.recoveryTimestamp); return m === null || t > m ? t : m; }, null);
    const week = now - 7 * 86_400_000;
    const sched = midnightSchedule(now);
    const missed = platform.length ? missedMidnightCheckpoint(now, platform.map((p) => Date.parse(p.recoveryTimestamp))) : null;
    const pitr = verified.filter((p) => p.source === 'pitr_window').sort((a, b) => Date.parse(b.pitrWindowEnd!) - Date.parse(a.pitrWindowEnd!))[0] ?? null;
    const drill = (await sql<any>`select status, started_at, completed_at, detail from backup_reports where kind = 'restore_drill' order by completed_at desc limit 1`.execute(this.db)).rows[0] ?? null;
    const tenants = (await sql<any>`select count(*)::int n from tenants`.execute(this.db)).rows[0]?.n ?? 0;
    const latestPlatformVerified = platform.find((p) => p.verificationStatus === 'VERIFIED') ?? null;
    const protectedTenants = latestPlatformVerified
      ? (await sql<any>`select count(*)::int n from tenants where created_at <= ${latestPlatformVerified.recoveryTimestamp}`.execute(this.db)).rows[0]?.n ?? 0 : 0;
    const active = (await sql<any>`select count(*)::int n from backup_restore_plans where status in ('PREPARING','RESTORING','RECONCILING','VERIFYING')`.execute(this.db)).rows[0]?.n ?? 0;
    return {
      timezone: BACKUP_TZ, generatedAt: new Date(now).toISOString(), catalogConfigured: pts.length > 0,
      tenants: { total: tenants, protectedByLatestVerifiedPlatformPoint: protectedTenants },
      points: {
        total: pts.length, verified: verified.length,
        last7Days: { recorded: pts.filter((p) => Date.parse(p.recoveryTimestamp) >= week).length,
          failed: pts.filter((p) => Date.parse(p.recoveryTimestamp) >= week && p.verificationStatus === 'FAILED').length,
          unverified: pts.filter((p) => Date.parse(p.recoveryTimestamp) >= week && p.verificationStatus === 'UNVERIFIED').length },
        lastPlatformPoint: platform[0] ? { id: platform[0].id, recoveryTimestamp: platform[0].recoveryTimestamp, verificationStatus: platform[0].verificationStatus } : null,
        latestRecoverableTimestamp: latestVerified === null ? null : new Date(latestVerified).toISOString(),
        verifiedWithoutImmutableCopy: verified.filter((p) => p.immutableReplica !== 'present').length,
        storageBytes: pts.filter((p) => p.verificationStatus !== 'EXPIRED').reduce((s, p) => s + Number(p.sizeBytes || 0), 0),
      },
      pitr: pitr ? { windowStart: pitr.pitrWindowStart, windowEnd: pitr.pitrWindowEnd } : null,
      schedule: { nextMidnightCheckpoint: new Date(sched.next).toISOString(), lastScheduled: new Date(sched.last).toISOString(),
        missed: missed ? { missed: missed.missed, scheduledAt: new Date(missed.scheduledAt).toISOString() } : null },
      evidence: {
        rpoSeconds: latestVerified === null ? null : Math.max(0, Math.round((now - latestVerified) / 1000)),
        lastRestoreDrill: drill ? { status: drill.status, completedAt: iso(drill.completed_at),
          durationSeconds: drill.started_at ? Math.round((new Date(drill.completed_at).getTime() - new Date(drill.started_at).getTime()) / 1000) : null } : null,
      },
      restores: { active },
    };
  }

  async searchTenants(q: string) {
    const term = String(q ?? '').trim().slice(0, 80);
    if (!term) return { items: [] };
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const idMatch = UUID.test(term) ? term : null;
    const rows = (await sql<any>`
      select t.id, t.display_name, t.legal_name, t.tenant_code, t.status,
        coalesce((select json_agg(json_build_object('id', b.id, 'name', b.name, 'salonCode', b.salon_code) order by b.name) from branches b where b.tenant_id = t.id), '[]') as branches
      from tenants t
      where t.id::text = ${idMatch} or t.display_name ilike ${like} or t.legal_name ilike ${like} or t.tenant_code ilike ${like}
         or exists (select 1 from branches b where b.tenant_id = t.id and (b.name ilike ${like} or b.salon_code ilike ${like}))
      order by t.display_name limit 25`.execute(this.db)).rows;
    return { items: rows.map((r) => ({ id: r.id, name: r.display_name ?? r.legal_name, tenantCode: r.tenant_code, status: r.status, branches: r.branches })) };
  }

  private async assertScope(tenantId: string | null, branchId: string | null): Promise<void> {
    if (tenantId !== null && !UUID.test(tenantId)) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Choose a valid salon and branch for this restore.', 422);
    if (branchId !== null && (!tenantId || !UUID.test(branchId))) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Choose a valid salon and branch for this restore.', 422);
    if (tenantId && !(await sql`select 1 from tenants where id = ${tenantId}`.execute(this.db)).rows.length) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'That salon was not found.', 422);
    // §39: a tampered branch id cannot widen scope — it must belong to the selected tenant
    if (branchId && !(await sql`select 1 from branches where id = ${branchId} and tenant_id = ${tenantId}`.execute(this.db)).rows.length) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'That branch does not belong to this salon.', 422);
  }

  /** The points that can serve this scope: platform-wide points plus the tenant's (and branch's) own — never another tenant's. */
  async points(q: { tenantId?: string | null; branchId?: string | null }) {
    const tenantId = q.tenantId || null, branchId = q.branchId || null;
    await this.assertScope(tenantId, branchId);
    const now = this.clock();
    const rows = (await sql<any>`select ${RP_COLS} from backup_recovery_points
      where scope = 'platform' or (${tenantId}::uuid is not null and tenant_id = ${tenantId} and (branch_id is null or ${branchId}::uuid is null or branch_id = ${branchId}))
      order by recovery_timestamp desc limit 500`.execute(this.db)).rows.map((r) => pointView(r, now));
    // §17/§38: the calendar shows only what a VERIFIED point really covers; everything else is disabled
    const days = new Map<string, { date: string; snapshots: number; pitr: boolean }>();
    for (const p of rows.filter((x) => x.verificationStatus === 'VERIFIED')) {
      if (p.source === 'pitr_window') {
        for (let t = Date.parse(p.pitrWindowStart!); t <= Date.parse(p.pitrWindowEnd!) + 1; t += 3_600_000) {
          const d = localDate(Math.min(t, Date.parse(p.pitrWindowEnd!))); const e = days.get(d) ?? { date: d, snapshots: 0, pitr: false }; e.pitr = true; days.set(d, e);
        }
      } else { const d = localDate(Date.parse(p.recoveryTimestamp)); const e = days.get(d) ?? { date: d, snapshots: 0, pitr: false }; e.snapshots++; days.set(d, e); }
    }
    return { timezone: BACKUP_TZ, tenantId, branchId, items: rows, calendar: [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1)) };
  }

  async point(id: string) {
    const r = await this.pointRow(id);
    const ver = (await sql<any>`select result, checks, detail, started_at, completed_at, reported_by from backup_point_verifications where recovery_point_id = ${id} order by completed_at desc limit 20`.execute(this.db)).rows;
    return { ...pointView(r, this.clock()), verifications: ver.map((v) => ({ result: v.result, checks: v.checks, detail: v.detail, startedAt: iso(v.started_at), completedAt: iso(v.completed_at), reportedBy: v.reported_by })) };
  }

  // ── planner ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async activityAfter(tenantId: string, branchId: string | null, at: string): Promise<PostPointActivity> {
    const b = branchId;
    const one = async (q: any) => (await q.execute(this.db)).rows[0] ?? {};
    const pay = await one(sql<any>`select count(*)::int n, coalesce(sum(amount_cents),0)::bigint s from payments where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and created_at > ${at}`);
    const att = await one(sql<any>`select count(*)::int n from payment_attempts where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and status in (${sql.join(UNRESOLVED_ATTEMPT)}) and resolved_at is null`);
    const po = await one(sql<any>`select count(*)::int n, coalesce(sum(amount_cents),0)::bigint s, count(*) filter (where check_issued_at > ${at})::int c from payroll_payouts
      where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and (created_at > ${at} or paid_at > ${at} or check_issued_at > ${at})`);
    const gc = await one(sql<any>`select count(*)::int n from gift_card_transactions where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and created_at > ${at}`);
    const ly = await one(sql<any>`select count(*)::int n from loyalty_ledger where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and created_at > ${at}`);
    const sms = await one(sql<any>`select count(*)::int n from sms_delivery_logs where tenant_id = ${tenantId} and created_at > ${at}`);
    const ob = await one(sql<any>`select count(*)::int n from outbox_events where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and created_at > ${at}`);
    const tk = await one(sql<any>`select count(*)::int n from tickets where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and updated_at > ${at}`);
    const ap = await one(sql<any>`select count(*)::int n from pos_tech_appointments where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and updated_at > ${at}`);
    const cu = await one(sql<any>`select count(*)::int n from customers where tenant_id = ${tenantId} and (${b}::uuid is null or branch_id = ${b}) and updated_at > ${at}`);
    const shared = b ? await one(sql<any>`select count(distinct t.customer_id)::int n from tickets t where t.tenant_id = ${tenantId} and t.branch_id = ${b} and t.customer_id is not null
      and exists (select 1 from tickets o where o.tenant_id = ${tenantId} and o.customer_id = t.customer_id and o.branch_id <> ${b})`) : null;
    const links = await one(sql<any>`select count(*)::int n from customer_global_links where tenant_id = ${tenantId}`);
    return {
      payments: { count: pay.n ?? 0, amountCents: Number(pay.s ?? 0) }, unresolvedPaymentAttempts: att.n ?? 0,
      payrollPayouts: { count: po.n ?? 0, amountCents: Number(po.s ?? 0), checksIssued: po.c ?? 0 },
      giftCardTransactions: gc.n ?? 0, loyaltyEntries: ly.n ?? 0, smsSent: sms.n ?? 0, outboxEvents: ob.n ?? 0,
      ticketsChanged: tk.n ?? 0, appointmentsChanged: ap.n ?? 0, customersChanged: cu.n ?? 0,
      sharedCustomersAcrossBranches: shared ? shared.n ?? 0 : null, centralIdentityLinks: links.n ?? 0,
    };
  }

  private async preview(mode: RestoreMode, tenantId: string | null, branchId: string | null, pointId: string, targetMs: number): Promise<PlanPreview> {
    const row = await this.pointRow(pointId);
    const now = this.clock();
    const point = pointView(row, now);
    const activity = tenantId ? await this.activityAfter(tenantId, branchId, new Date(targetMs).toISOString()) : null;
    return evaluatePlan({ mode, tenantId, branchId, point, targetMs, now, currentSchemaVersion: await this.currentSchemaVersion(), activity });
  }

  async createPlan(actor: BackupActor, b: { mode: string; tenantId?: string | null; branchId?: string | null; recoveryPointId: string; targetTimestamp?: string | null; reason: string; idempotencyKey: string }) {
    if (!(RESTORE_MODES as readonly string[]).includes(b.mode)) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Choose a restore mode.', 422);
    const mode = b.mode as RestoreMode;
    const tenantId = mode === 'FULL_PLATFORM' ? null : b.tenantId || null;
    const branchId = mode === 'ONE_BRANCH' || mode === 'NON_DESTRUCTIVE_PREVIEW' ? b.branchId || null : null;
    if (mode !== 'FULL_PLATFORM' && !tenantId) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Choose the salon to restore.', 422);
    if (mode === 'ONE_BRANCH' && !branchId) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Choose the branch to restore.', 422);
    await this.assertScope(tenantId, branchId);
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 10) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Give a reason of at least 10 characters.', 422);
    const key = String(b.idempotencyKey ?? '');
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(key)) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'A request key is required.', 422);
    const dup = (await sql<any>`select id from backup_restore_plans where idempotency_key = ${key}`.execute(this.db)).rows[0];
    if (dup) return this.plan(dup.id);
    const row = await this.pointRow(b.recoveryPointId);
    const targetMs = b.targetTimestamp ? Date.parse(b.targetTimestamp) : new Date(row.recovery_timestamp).getTime();
    if (Number.isNaN(targetMs)) throw new BackupCenterError('RESTORE_SCOPE_INVALID', 'Choose a valid restore time.', 422);
    const preview = await this.preview(mode, tenantId, branchId, row.id, targetMs);
    const sha = planChecksum(preview);
    const to = preview.blockers.length ? 'BLOCKED' : 'AWAITING_APPROVAL';
    const id = await this.db.transaction().execute(async (trx) => {
      const ins = await sql<{ id: string }>`insert into backup_restore_plans (mode, tenant_id, branch_id, recovery_point_id, target_timestamp, reason, plan, plan_sha256, status, idempotency_key, requested_by, updated_by)
        values (${mode}, ${tenantId}, ${branchId}, ${row.id}, ${preview.targetTimestamp}, ${reason}, ${JSON.stringify(preview)}::jsonb, ${sha}, 'REQUESTED', ${key}, ${actor.userId}, ${actor.userId})
        on conflict (idempotency_key) do nothing returning id`.execute(trx);
      if (!ins.rows[0]) return null;
      const pid = ins.rows[0].id;
      await this.event(trx, pid, null, 'REQUESTED', 'requested', actor, { reason });
      await sql`update backup_restore_plans set status = ${to}, updated_at = now(), updated_by = ${actor.userId}, failure_code = ${preview.blockers[0]?.code ?? null}
        where id = ${pid} and ${canMoveToSql(BACKUP_RESTORE_PLAN, to)}`.execute(trx);
      await this.event(trx, pid, 'REQUESTED', to, 'planned', actor, { planSha256: sha, blockers: preview.blockers.map((x) => x.code), warnings: preview.warnings.map((x) => x.code) });
      return pid;
    });
    if (!id) { const again = (await sql<any>`select id from backup_restore_plans where idempotency_key = ${key}`.execute(this.db)).rows[0]; return this.plan(again.id); }
    return this.plan(id);
  }

  private async event(db: Kysely<any>, planId: string, from: string | null, to: string, action: string, actor: BackupActor | null, detail: Record<string, unknown> = {}) {
    await sql`insert into backup_restore_events (plan_id, from_status, to_status, action, actor_user_id, actor_label, detail, created_at)
      values (${planId}, ${from}, ${to}, ${action}, ${actor?.userId ?? null}, ${actor ? (actor.email ?? 'operator').slice(0, 120) : 'restore worker'}, ${JSON.stringify(detail)}::jsonb, clock_timestamp())`.execute(db);
  }

  private planView(r: any) {
    return {
      id: r.id, mode: r.mode, tenantId: r.tenant_id, branchId: r.branch_id, recoveryPointId: r.recovery_point_id, targetTimestamp: iso(r.target_timestamp),
      reason: r.reason, status: r.status, version: r.version, planSha256: r.plan_sha256, plan: r.plan, requestedBy: r.requested_by,
      approvedBy: r.approved_by, approvedAt: iso(r.approved_at), approvalExpiresAt: iso(r.approval_expires_at), financeAcknowledged: r.finance_acknowledged,
      jobId: r.job_id, startedAt: iso(r.started_at), completedAt: iso(r.completed_at), failureCode: r.failure_code, failureDetail: r.failure_detail,
      evidence: r.evidence ?? {}, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    };
  }
  private async planRow(id: string): Promise<any> {
    if (!UUID.test(id)) throw new BackupCenterError('RESTORE_PLAN_NOT_FOUND', 'That restore plan was not found.', 404);
    const r = (await sql<any>`select ${PLAN_COLS} from backup_restore_plans where id = ${id}`.execute(this.db)).rows[0];
    if (!r) throw new BackupCenterError('RESTORE_PLAN_NOT_FOUND', 'That restore plan was not found.', 404);
    return r;
  }
  async plan(id: string) {
    const r = await this.planRow(id);
    const ev = (await sql<any>`select from_status, to_status, action, actor_user_id, actor_label, detail, created_at from backup_restore_events where plan_id = ${id} order by created_at, id limit 200`.execute(this.db)).rows;
    return { ...this.planView(r), events: ev.map((e) => ({ from: e.from_status, to: e.to_status, action: e.action, actorUserId: e.actor_user_id, actor: e.actor_label, detail: e.detail, at: iso(e.created_at) })) };
  }
  async plans(q: { status?: string; tenantId?: string; page?: number; pageSize?: number }) {
    const size = Math.min(100, Math.max(1, Number(q.pageSize) || 25)); const page = Math.max(1, Number(q.page) || 1);
    const st = q.status && (BACKUP_RESTORE_PLAN.states as readonly string[]).includes(q.status) ? q.status : null;
    const tid = q.tenantId && UUID.test(q.tenantId) ? q.tenantId : null;
    const rows = (await sql<any>`select ${PLAN_COLS} from backup_restore_plans where (${st}::text is null or status = ${st}) and (${tid}::uuid is null or tenant_id = ${tid})
      order by created_at desc limit ${size} offset ${(page - 1) * size}`.execute(this.db)).rows;
    const total = (await sql<any>`select count(*)::int n from backup_restore_plans where (${st}::text is null or status = ${st}) and (${tid}::uuid is null or tenant_id = ${tid})`.execute(this.db)).rows[0]?.n ?? 0;
    return { items: rows.map((r) => this.planView(r)), page, pageSize: size, total };
  }

  // ── approval / execution (§14, §18, §35) ───────────────────────────────────────────────────────────────────────────
  async approve(actor: BackupActor, id: string, b: { planSha256: string; financeAcknowledged?: boolean | null }) {
    const r = await this.planRow(id);
    if (r.status !== 'AWAITING_APPROVAL') throw new BackupCenterError('RESTORE_STATE_CONFLICT', `This plan is ${r.status}; only a plan awaiting approval can be approved.`, 409);
    const issue = checkApproval({ mode: r.mode, requestedBy: r.requested_by, planSha256: r.plan_sha256, financialEvents: Number(r.plan?.financialEventsAfterTarget ?? 0) }, actor.userId, String(b?.planSha256 ?? ''), b?.financeAcknowledged === true);
    if (issue) throw new BackupCenterError(issue.code, issue.message, issue.code === 'RESTORE_SECOND_PERSON_REQUIRED' ? 403 : issue.code === 'RESTORE_PLAN_CHANGED' ? 409 : 422);
    const exp = new Date(this.clock() + APPROVAL_TTL_MS).toISOString();
    await this.db.transaction().execute(async (trx) => {
      const u = await sql`update backup_restore_plans set status = 'APPROVED', approved_by = ${actor.userId}, approved_at = now(), approval_expires_at = ${exp},
          approved_plan_sha256 = plan_sha256, finance_acknowledged = ${b?.financeAcknowledged === true}, version = version + 1, updated_at = now(), updated_by = ${actor.userId}
        where id = ${id} and status = 'AWAITING_APPROVAL' and plan_sha256 = ${b.planSha256} and ${canMoveToSql(BACKUP_RESTORE_PLAN, 'APPROVED')}`.execute(trx);
      if (!Number(u.numAffectedRows ?? 0)) throw new BackupCenterError('RESTORE_STATE_CONFLICT', 'This plan changed while you were approving it.', 409);
      await this.event(trx, id, 'AWAITING_APPROVAL', 'APPROVED', 'approved', actor, { planSha256: b.planSha256, expiresAt: exp, financeAcknowledged: b?.financeAcknowledged === true });
    });
    return this.plan(id);
  }

  async cancel(actor: BackupActor, id: string, reason: string) {
    const r = await this.planRow(id);
    if (!BACKUP_RESTORE_PLAN.can(r.status, 'CANCELLED')) throw new BackupCenterError('RESTORE_STATE_CONFLICT', `This plan is ${r.status} and cannot be cancelled here.`, 409);
    await this.db.transaction().execute(async (trx) => {
      const u = await sql`update backup_restore_plans set status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = ${actor.userId}, completed_at = now()
        where id = ${id} and status = ${r.status} and ${canMoveToSql(BACKUP_RESTORE_PLAN, 'CANCELLED')}`.execute(trx);
      if (!Number(u.numAffectedRows ?? 0)) throw new BackupCenterError('RESTORE_STATE_CONFLICT', 'This plan changed. Refresh and try again.', 409);
      await this.event(trx, id, r.status, 'CANCELLED', 'cancelled', actor, { reason: String(reason ?? '').slice(0, 500) });
    });
    return this.plan(id);
  }

  /** Start the durable restore job. Idempotent: a second click returns the same job; the DB fences a second restore. */
  async execute(actor: BackupActor, id: string, b: { planSha256: string }) {
    const r = await this.planRow(id);
    if (['PREPARING', 'RESTORING', 'RECONCILING', 'VERIFYING', 'COMPLETED'].includes(r.status) && r.job_id) return this.plan(id);   // repeated click
    if (r.status !== 'APPROVED') throw new BackupCenterError('RESTORE_STATE_CONFLICT', `This plan is ${r.status}; it must be approved first.`, 409);
    if (String(b?.planSha256 ?? '') !== r.approved_plan_sha256) throw new BackupCenterError('RESTORE_PLAN_CHANGED', 'The approval was given for a different plan. Review it again.', 409);
    if (!r.approval_expires_at || new Date(r.approval_expires_at).getTime() <= this.clock()) throw new BackupCenterError('RESTORE_APPROVAL_EXPIRED', 'The approval expired. Approve the plan again.', 409);
    try {
      await this.db.transaction().execute(async (trx) => {
        const u = await sql`update backup_restore_plans set status = 'PREPARING', started_at = now(), version = version + 1, updated_at = now(), updated_by = ${actor.userId}
          where id = ${id} and status = 'APPROVED' and ${canMoveToSql(BACKUP_RESTORE_PLAN, 'PREPARING')}`.execute(trx);
        if (!Number(u.numAffectedRows ?? 0)) throw new BackupCenterError('RESTORE_STATE_CONFLICT', 'This plan changed. Refresh and try again.', 409);
        const job = await enqueueJob(trx, { jobClass: 'reconciliation', jobType: RESTORE_JOB_TYPE, tenantId: r.tenant_id ?? null, payload: { planId: id }, idempotencyKey: `restore:${id}`, maxAttempts: 1, createdBy: actor.userId });
        await sql`update backup_restore_plans set job_id = ${job.id} where id = ${id}`.execute(trx);
        await this.event(trx, id, 'APPROVED', 'PREPARING', 'started', actor, { jobId: job.id });
      });
    } catch (e: any) {
      if (e?.code === '23505' || /uq_brpl_one_active/.test(String(e?.message))) throw new BackupCenterError('RESTORE_ALREADY_RUNNING', 'A restore is already running for this salon.', 409);
      throw e;
    }
    return this.plan(id);
  }

  private async move(planId: string, from: string, to: string, action: string, patch: { evidence?: unknown; failureCode?: string | null; failureDetail?: string | null; done?: boolean } = {}, detail: Record<string, unknown> = {}) {
    await this.db.transaction().execute(async (trx) => {
      const u = await sql`update backup_restore_plans set status = ${to}, version = version + 1, updated_at = now(),
          evidence = case when ${patch.evidence === undefined}::boolean then evidence else ${JSON.stringify(patch.evidence ?? {})}::jsonb end,
          failure_code = coalesce(${patch.failureCode ?? null}, failure_code), failure_detail = coalesce(${patch.failureDetail ?? null}, failure_detail),
          completed_at = case when ${patch.done === true}::boolean then now() else completed_at end
        where id = ${planId} and status = ${from} and ${canMoveToSql(BACKUP_RESTORE_PLAN, to)}`.execute(trx);
      if (!Number(u.numAffectedRows ?? 0)) throw new BackupCenterError('RESTORE_STATE_CONFLICT', `Restore ${planId} is no longer ${from}.`, 409);
      await this.event(trx, planId, from, to, action, null, detail);
    });
  }

  /** The worker. Every stage is a recorded transition; nothing is COMPLETED without the verification evidence. */
  async runRestoreJob(planId: string): Promise<{ status: string }> {
    const r = await this.planRow(planId);
    if (r.status !== 'PREPARING') return { status: r.status };   // a re-delivered job after the fact does nothing
    const block = async (code: string, detail: string) => { await this.move(planId, 'PREPARING', 'BLOCKED', 'blocked', { failureCode: code, failureDetail: detail, done: true }, { code }); return { status: 'BLOCKED' }; };
    // re-check the plan against the catalog NOW (§17): the point may have expired or failed a later verification
    const fresh = await this.preview(r.mode, r.tenant_id, r.branch_id, r.recovery_point_id, new Date(r.target_timestamp).getTime());
    if (fresh.blockers.length) return block(fresh.blockers[0].code, fresh.blockers.map((x) => x.message).join(' '));
    const destructive = r.mode !== 'NON_DESTRUCTIVE_PREVIEW';
    if (destructive && planChecksum(fresh) !== r.approved_plan_sha256) return block('RESTORE_PLAN_CHANGED', 'Activity changed after approval (new payments, payouts or records). Plan and approve again.');
    let handle: { db: Kysely<any>; close: () => Promise<void> } | null = null;
    try { handle = this.staging.open(); } catch (e: any) { return block('STAGING_REFUSED', String(e?.message ?? e).slice(0, 300)); }
    if (!handle) return block('STAGING_NOT_CONFIGURED', 'No isolated staged clone is configured (RESTORE_STAGING_DATABASE_URL). Recover the point into a scratch database first (docs/backup/BACKUP_AND_DR.md §4).');
    try {
      const stagedSchema = await this.currentSchemaVersion(handle.db).catch((e) => { warn('staged schema read failed')(e); return ''; });
      if (stagedSchema !== fresh.point.schemaVersion) return block('STAGING_POINT_MISMATCH', `The staged clone is on schema "${stagedSchema || 'unknown'}", not the recovery point's "${fresh.point.schemaVersion}". Recover THIS point into the staging database.`);
      if (destructive) return block('DESTRUCTIVE_APPLY_NOT_AVAILABLE', 'Every check passed, but writing staged rows into the live shared database is not enabled until the recovery pilots (§47) are signed off. Use the non-destructive comparison and the runbook.');
      await this.move(planId, 'PREPARING', 'RESTORING', 'staged_read', {}, { staging: this.staging.describe() });
      const diff = await this.compareTenant(handle.db, r.tenant_id, r.branch_id);
      await this.move(planId, 'RESTORING', 'VERIFYING', 'compared', {}, { tables: diff.tables.length, differing: diff.differing.length });
      // verification: the comparison actually covered the tenant's core tables in BOTH copies (not an empty read)
      const core = ['customers', 'tickets', 'payments'];
      const missing = core.filter((t) => !diff.tables.some((x) => x.table === t));
      if (missing.length) { await this.move(planId, 'VERIFYING', 'FAILED', 'verification_failed', { failureCode: 'STAGING_INCOMPLETE', failureDetail: `Core tables missing from the comparison: ${missing.join(', ')}`, done: true, evidence: diff }); return { status: 'FAILED' }; }
      await this.move(planId, 'VERIFYING', 'COMPLETED', 'completed', { evidence: { ...diff, liveWritten: false, stagedSchema, comparedAt: new Date(this.clock()).toISOString() }, done: true });
      return { status: 'COMPLETED' };
    } catch (e: any) {
      const cur = (await this.planRow(planId)).status;
      if (BACKUP_RESTORE_PLAN.can(cur, 'FAILED')) await this.move(planId, cur, 'FAILED', 'failed', { failureCode: 'RESTORE_WORKER_ERROR', failureDetail: String(e?.message ?? e).split('\n')[0].slice(0, 300), done: true }).catch(warn(`restore ${planId}: recording FAILED`));
      return { status: 'FAILED' };
    } finally { await handle.close().catch(warn('closing the staged clone')); }
  }

  /** Read-only per-table comparison of one tenant (optionally one branch) between the staged clone and live (§11 "compare historical and current state"). */
  async compareTenant(staged: Kysely<any>, tenantId: string, branchId: string | null) {
    const cols = async (db: Kysely<any>) => new Map((await sql<any>`select table_name, bool_or(column_name = 'branch_id') as has_branch from information_schema.columns
      where table_schema = 'public' and column_name in ('tenant_id', 'branch_id') group by table_name having bool_or(column_name = 'tenant_id')`.execute(db)).rows.map((x) => [x.table_name as string, !!x.has_branch]));
    const live = await cols(this.db); const stg = await cols(staged);
    const names = [...live.keys()].filter((t) => stg.has(t)).sort();
    const tables: Array<{ table: string; live: number; staged: number; scope: 'branch' | 'tenant' }> = [];
    for (const t of names) {
      const byBranch = !!branchId && live.get(t) === true && stg.get(t) === true;
      const count = async (db: Kysely<any>) => Number((await sql<any>`select count(*)::bigint n from ${sql.table(t)} where tenant_id::text = ${tenantId} ${byBranch ? sql`and branch_id::text = ${branchId}` : sql``}`.execute(db)).rows[0]?.n ?? 0);
      tables.push({ table: t, live: await count(this.db), staged: await count(staged), scope: byBranch ? 'branch' : 'tenant' });
    }
    const differing = tables.filter((x) => x.live !== x.staged);
    return { tables, differing, onlyLive: [...live.keys()].filter((t) => !stg.has(t)), onlyStaged: [...stg.keys()].filter((t) => !live.has(t)),
      totals: { live: tables.reduce((s, x) => s + x.live, 0), staged: tables.reduce((s, x) => s + x.staged, 0) } };
  }

  /** §34 alert input for the health tick: the missed midnight checkpoint, once the catalog has ever been fed. */
  // the 3-day window is measured from `now` (the clock the caller asked about), not the database's own now() — it read the
  // wrong window whenever the two differ (the §34 test began failing once the real date passed Nov 8)
  async midnightCheckpointStatus(now = this.clock()) {
    const rows = (await sql<any>`select recovery_timestamp from backup_recovery_points where scope = 'platform' and verification_status <> 'FAILED' and recovery_timestamp > ${new Date(now - 3 * 86_400_000)} order by recovery_timestamp desc limit 20`.execute(this.db)).rows;
    const ever = (await sql<any>`select 1 from backup_recovery_points where scope = 'platform' limit 1`.execute(this.db)).rows.length > 0;
    if (!ever) return null;
    return missedMidnightCheckpoint(now, rows.map((x) => new Date(x.recovery_timestamp).getTime()));
  }
}
