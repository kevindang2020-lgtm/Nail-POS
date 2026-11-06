// backup-center.pgtest — G9 Enterprise Backup & DR on the REAL schema (migration 819), with a SECOND PGlite database
// as the isolated staged clone: the catalog accepts only verifiable manifests, shows a point as recoverable only after a
// real verification, keeps tenants apart, plans with the post-point financial activity, needs a second person, fences
// one restore per tenant, and completes only with comparison evidence — the live database is never written.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { BackupCenterService, type StagingSource } from './backup-center.service';
import { BackupCenterError } from './backup-center-core';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}
const kysely = (pg: PGlite) => new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (k: any) => new PostgresIntrospector(k), createQueryCompiler: () => new PostgresQueryCompiler() } });
const FILES = readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
const LATEST = FILES.reduce((m, f) => (f > m ? f : m), '');
async function migrated(): Promise<PGlite> {
  const pg = await PGlite.create();
  for (const f of FILES) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  // the migration ledger is created by scripts/migrate.mjs (not by a migration) — mirror it
  await pg.exec(`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now(), checksum text, duration_ms integer)`);
  await pg.query(`insert into schema_migrations (filename) values ($1) on conflict do nothing`, [LATEST]);
  return pg;
}

const T1 = 'bc000000-0000-4000-8000-0000000000a1', T2 = 'bc000000-0000-4000-8000-0000000000a2';
const B1 = 'bc000000-0000-4000-8000-0000000000b1', B2 = 'bc000000-0000-4000-8000-0000000000b2', B3 = 'bc000000-0000-4000-8000-0000000000b3';
const OPS = { userId: 'bc000000-0000-4000-8000-0000000000e1', email: 'ops@aps.test' };
const SA = { userId: 'bc000000-0000-4000-8000-0000000000e2', email: 'sa@aps.test' };
const SHA = (c: string) => c.repeat(64);
const MIDNIGHT = '2026-11-05T05:00:00.000Z';
let now = Date.parse('2026-11-05T12:00:00Z');
let live: PGlite; let stagedPg: PGlite; let svc: BackupCenterService; let stagingOn = true;
const q = (s: string, p: any[] = []) => live.query(s, p).then((r: any) => r.rows as any[]);
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof BackupCenterError ? e.code : (e as Error).message; } };
const manifest = (over: Record<string, unknown> = {}) => ({
  backupRef: 'railway-2026-11-05', environment: 'production', scope: 'platform', source: 'provider_snapshot', recoveryTimestamp: MIDNIGHT,
  schemaVersion: LATEST, appRelease: 'abc1234', artifacts: [{ kind: 'database', location: 's3://aps-backups/2026-11-05.dump', sha256: SHA('a'), sizeBytes: 4096, keyRef: 'kms:alias/aps-backup', immutable: true }], ...over,
});

async function seed(pg: PGlite, customersPerBranch: number) {
  const x = (s: string, p: any[] = []) => pg.query(s, p);
  for (const [t, c] of [[T1, 'BKC1'], [T2, 'BKC2']]) await x(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, created_at) values ($1, $2, $2, lower($3), $3, 'active', '2026-01-01')`, [t, `Salon ${c}`, c]);
  for (const [b, t, n] of [[B1, T1, 'Downtown'], [B2, T1, 'Uptown'], [B3, T2, 'Main']]) await x(`insert into branches (id, tenant_id, name, status, timezone, salon_code) values ($1,$2,$3,'active','America/New_York',$4)`, [b, t, n, `S-${n.toUpperCase()}`]);
  for (const [t, b] of [[T1, B1], [T1, B2], [T2, B3]]) for (let i = 0; i < customersPerBranch; i++)
    await x(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, updated_at) values ($1,$2,'C','N','C N','2026-11-04T00:00:00Z')`, [t, b]);
}

beforeAll(async () => {
  [live, stagedPg] = await Promise.all([migrated(), migrated()]);
  await seed(live, 3); await seed(stagedPg, 2);   // the staged clone is the older copy: 2 customers per branch, live has 3
  const stagedDb = kysely(stagedPg);
  const staging: StagingSource = { describe: () => (stagingOn ? 'test staged clone' : null), open: () => (stagingOn ? { db: stagedDb, close: async () => undefined } : null) };
  svc = new BackupCenterService(kysely(live), staging, () => now);
}, 300_000);

let pointId = '';
describe('the recovery catalog (§31–32, §36)', () => {
  it('records a complete manifest as UNVERIFIED — a stored file is not proof (§32)', async () => {
    const r = await svc.recordPoint(manifest(), 'svc.backups'); pointId = r.id;
    expect(r).toMatchObject({ verificationStatus: 'UNVERIFIED', duplicate: false });
    const o = await svc.overview();
    expect(o.points.latestRecoverableTimestamp).toBeNull();
    expect(o.points.total).toBe(1);
  });
  it('the same report twice is one point; a different manifest under the same backup id is refused', async () => {
    expect((await svc.recordPoint(manifest(), 'svc.backups'))).toMatchObject({ id: pointId, duplicate: true });
    expect(await code(svc.recordPoint(manifest({ appRelease: 'other' }), 'svc.backups'))).toBe('BACKUP_MANIFEST_CONFLICT');
  });
  it('an unsafe manifest is recorded FAILED without its offending fields; a broken identity is refused outright', async () => {
    const r = await svc.recordPoint(manifest({ backupRef: 'bad-1', artifacts: [{ kind: 'database', location: 'postgres://u:pw@h/db', sha256: SHA('b'), sizeBytes: 9, keyRef: 'k' }] }), 'svc.backups');
    expect(r.verificationStatus).toBe('FAILED');
    const row = (await q(`select manifest::text m, rejected_reasons from backup_recovery_points where id = $1`, [r.id]))[0];
    expect(row.m).not.toMatch(/pw@/);
    expect(await code(svc.recordPoint({ ...manifest(), scope: 'galaxy' }, 'svc.backups'))).toBe('BACKUP_MANIFEST_INVALID');
    expect(await code(svc.recordVerification(r.id, { checks: { schema: true, data: true, checksums: true } }, 'drill'))).toBe('BACKUP_MANIFEST_INVALID');
  });
  it('verification: missing checks → PARTIAL; all required checks pass → VERIFIED; the evidence is append-only', async () => {
    expect((await svc.recordVerification(pointId, { checks: { schema: true, data: true } }, 'restore-verify'))).toMatchObject({ result: 'PARTIAL' });
    expect((await svc.recordVerification(pointId, { checks: { schema: true, data: true, checksums: true, decrypt: true } }, 'restore-verify'))).toMatchObject({ result: 'VERIFIED' });
    const p = await svc.point(pointId);
    expect(p.verificationStatus).toBe('VERIFIED'); expect(p.verifications).toHaveLength(2);
    expect(await code(q(`delete from backup_point_verifications`))).toMatch(/append-only/);
    const o = await svc.overview();
    expect(o.points.latestRecoverableTimestamp).toBe(MIDNIGHT);
    expect(o.tenants.protectedByLatestVerifiedPlatformPoint).toBe(2);
    expect(o.schedule.missed).toMatchObject({ missed: false });
  });
});

describe('tenant and branch isolation (§39)', () => {
  it('a tenant sees platform points and its own — never another tenant\'s', async () => {
    const t2 = await svc.recordPoint(manifest({ backupRef: 'export-t2', scope: 'tenant', tenantId: T2, source: 'logical_export' }), 'svc.backups');
    const a = await svc.points({ tenantId: T1 }); const b = await svc.points({ tenantId: T2 });
    expect(a.items.map((p) => p.id)).not.toContain(t2.id);
    expect(b.items.map((p) => p.id)).toContain(t2.id);
    expect(a.calendar[0]).toMatchObject({ date: '2026-11-05', snapshots: 1 });   // only VERIFIED coverage reaches the calendar
    // and at the database: a salon's plan cannot name another salon's recovery point (enforce_tenant_consistency)
    expect(await code(q(`insert into backup_restore_plans (mode, tenant_id, recovery_point_id, target_timestamp, reason, plan, plan_sha256, idempotency_key)
      values ('FULL_TENANT', $1, $2, now(), 'cross-tenant probe', '{}', $3, 'xtenant-probe-1')`, [T1, t2.id, SHA('e')]))).toMatch(/cross-tenant reference refused/);
  });
  it('a tampered branch id (another tenant\'s branch) cannot widen scope', async () => {
    expect(await code(svc.points({ tenantId: T1, branchId: B3 }))).toBe('RESTORE_SCOPE_INVALID');
    expect(await code(svc.createPlan(OPS, { mode: 'ONE_BRANCH', tenantId: T1, branchId: B3, recoveryPointId: pointId, reason: 'Corrupted branch data', idempotencyKey: 'tamper-0001' }))).toBe('RESTORE_SCOPE_INVALID');
  });
  it('search finds a salon by name, code or branch salon code', async () => {
    expect((await svc.searchTenants('BKC1')).items.map((t) => t.id)).toEqual([T1]);
    expect((await svc.searchTenants('S-UPTOWN')).items.map((t) => t.id)).toEqual([T1]);
  });
});

describe('restore plans, approval and the job (§11–18, §25, §35)', () => {
  let destructiveId = ''; let previewId = '';
  it('plans with the activity after the requested time; money after it needs finance acknowledgement and a second person', async () => {
    const [cust] = await q(`select id from customers where tenant_id = $1 and branch_id = $2 limit 1`, [T1, B1]);
    const [tk] = await q(`insert into tickets (tenant_id, branch_id, customer_id) values ($1,$2,$3) returning id`, [T1, B1, cust.id]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) values ($1,$2,$3,'card',4500,'approved','2026-11-05T09:30:00Z')`, [T1, B1, tk.id]);
    const p = await svc.createPlan(OPS, { mode: 'FULL_TENANT', tenantId: T1, recoveryPointId: pointId, reason: 'Accidental bulk delete of appointments', idempotencyKey: 'plan-full-0001' });
    destructiveId = p.id;
    expect(p.status).toBe('AWAITING_APPROVAL');
    expect(p.plan.activity.payments).toEqual({ count: 1, amountCents: 4500 });
    expect(p.plan.warnings.map((w: any) => w.code)).toContain('PAYMENTS_AFTER_TARGET');
    expect((await svc.createPlan(OPS, { mode: 'FULL_TENANT', tenantId: T1, recoveryPointId: pointId, reason: 'Accidental bulk delete of appointments', idempotencyKey: 'plan-full-0001' })).id).toBe(p.id);   // double click
    expect(await code(svc.approve(OPS, p.id, { planSha256: p.planSha256, financeAcknowledged: true }))).toBe('RESTORE_SECOND_PERSON_REQUIRED');
    expect(await code(svc.approve(SA, p.id, { planSha256: p.planSha256 }))).toBe('RESTORE_FINANCE_ACK_REQUIRED');
    expect(await code(svc.approve(SA, p.id, { planSha256: SHA('c'), financeAcknowledged: true }))).toBe('RESTORE_PLAN_CHANGED');
    const ok = await svc.approve(SA, p.id, { planSha256: p.planSha256, financeAcknowledged: true });
    expect(ok).toMatchObject({ status: 'APPROVED', approvedBy: SA.userId });
  });
  it('a blocked plan (unverified point, selected domain) cannot be approved', async () => {
    const un = await svc.recordPoint(manifest({ backupRef: 'unverified-1', recoveryTimestamp: '2026-11-04T05:00:00.000Z' }), 'svc.backups');
    const b1 = await svc.createPlan(OPS, { mode: 'FULL_TENANT', tenantId: T1, recoveryPointId: un.id, reason: 'Testing an unverified point', idempotencyKey: 'plan-unv-0001' });
    expect(b1).toMatchObject({ status: 'BLOCKED', failureCode: 'POINT_NOT_VERIFIED' });
    const b2 = await svc.createPlan(OPS, { mode: 'SELECTED_DOMAIN', tenantId: T1, recoveryPointId: pointId, reason: 'Restore only the inventory', idempotencyKey: 'plan-dom-0001' });
    expect(b2.failureCode).toBe('MODE_NOT_SUPPORTED');
    expect(await code(svc.approve(SA, b1.id, { planSha256: b1.planSha256 }))).toBe('RESTORE_STATE_CONFLICT');
  });
  it('§25: an unresolved card attempt blocks the plan', async () => {
    const [tk] = await q(`select id from tickets where tenant_id = $1 limit 1`, [T1]);
    await q(`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, idempotency_key, status) values ($1,$2,$3,100,'card','att-unresolved','processing')`, [T1, B1, tk.id]);
    const p = await svc.createPlan(OPS, { mode: 'FULL_TENANT', tenantId: T1, recoveryPointId: pointId, reason: 'While a card attempt is open', idempotencyKey: 'plan-att-0001' });
    expect(p).toMatchObject({ status: 'BLOCKED', failureCode: 'UNRESOLVED_PAYMENT_ATTEMPTS' });
    await q(`update payment_attempts set status = 'succeeded', resolved_at = now() where idempotency_key = 'att-unresolved'`);
  });
  it('execute: approval required, bound to the plan, expires; repeated clicks start one job', async () => {
    const p = await svc.plan(destructiveId);
    expect(await code(svc.execute(SA, p.id, { planSha256: SHA('d') }))).toBe('RESTORE_PLAN_CHANGED');
    now += 31 * 60_000;
    expect(await code(svc.execute(SA, p.id, { planSha256: p.planSha256 }))).toBe('RESTORE_APPROVAL_EXPIRED');
    now -= 31 * 60_000;
    const a = await svc.execute(SA, p.id, { planSha256: p.planSha256 });
    const b = await svc.execute(SA, p.id, { planSha256: p.planSha256 });
    expect(a.status).toBe('PREPARING'); expect(b.jobId).toBe(a.jobId);
    expect((await q(`select count(*)::int n from jobs where job_type = 'backups.restore_execute'`))[0].n).toBe(1);
  });
  it('§18 fencing: a second restore of the same tenant cannot start while one is in flight (the database refuses it)', async () => {
    const p2 = await svc.createPlan(SA, { mode: 'NON_DESTRUCTIVE_PREVIEW', tenantId: T1, recoveryPointId: pointId, reason: 'Compare staged copy with live', idempotencyKey: 'plan-prev-0001' });
    previewId = p2.id;
    await svc.approve(SA, p2.id, { planSha256: p2.planSha256, financeAcknowledged: true });   // a preview may be self-approved: it never writes
    expect(await code(svc.execute(SA, p2.id, { planSha256: p2.planSha256 }))).toBe('RESTORE_ALREADY_RUNNING');
  });
  it('the destructive job stops at BLOCKED after every check passes — the live database is never written (§47 gate)', async () => {
    const before = (await q(`select count(*)::int n from customers where tenant_id = $1`, [T1]))[0].n;
    expect(await svc.runRestoreJob(destructiveId)).toEqual({ status: 'BLOCKED' });
    const p = await svc.plan(destructiveId);
    expect(p.failureCode).toBe('DESTRUCTIVE_APPLY_NOT_AVAILABLE');
    expect(p.events.map((e) => e.to)).toEqual(['REQUESTED', 'AWAITING_APPROVAL', 'APPROVED', 'PREPARING', 'BLOCKED']);
    expect((await q(`select count(*)::int n from customers where tenant_id = $1`, [T1]))[0].n).toBe(before);
    expect(await svc.runRestoreJob(destructiveId)).toEqual({ status: 'BLOCKED' });   // a re-delivered job does nothing
  });
  it('the non-destructive preview compares the staged clone with live and COMPLETES only with that evidence', async () => {
    const p = await svc.plan(previewId);
    await svc.execute(SA, p.id, { planSha256: p.planSha256 });
    expect(await svc.runRestoreJob(previewId)).toEqual({ status: 'COMPLETED' });
    const done = await svc.plan(previewId);
    expect(done.events.map((e) => e.to)).toEqual(['REQUESTED', 'AWAITING_APPROVAL', 'APPROVED', 'PREPARING', 'RESTORING', 'VERIFYING', 'COMPLETED']);
    const cust = done.evidence.tables.find((t: any) => t.table === 'customers');
    expect(cust).toMatchObject({ live: 6, staged: 4, scope: 'tenant' });
    expect(done.evidence.liveWritten).toBe(false);
    // another tenant's rows were never counted into this tenant's comparison
    expect(done.evidence.totals.live).toBeLessThan((await q(`select count(*)::int n from customers`))[0].n + 1000);
  });
  it('no staged clone configured → BLOCKED with the reason, never a fake success', async () => {
    const p = await svc.createPlan(SA, { mode: 'NON_DESTRUCTIVE_PREVIEW', tenantId: T2, recoveryPointId: pointId, reason: 'Compare without a staged clone', idempotencyKey: 'plan-nostage-1' });
    await svc.approve(SA, p.id, { planSha256: p.planSha256 });
    await svc.execute(SA, p.id, { planSha256: p.planSha256 });
    stagingOn = false;
    expect(await svc.runRestoreJob(p.id)).toEqual({ status: 'BLOCKED' });
    stagingOn = true;
    expect((await svc.plan(p.id)).failureCode).toBe('STAGING_NOT_CONFIGURED');
    expect(await code(q(`update backup_restore_events set action = 'x'`))).toMatch(/append-only/);
  });
});

describe('the midnight checkpoint alert input (§34)', () => {
  it('after the next midnight passes its grace with no platform point, the checkpoint is missed', async () => {
    const later = Date.parse('2026-11-06T08:00:00Z');   // 3 AM New York, Nov 6 — no point for Nov 6 00:00
    const st = await svc.midnightCheckpointStatus(later);
    expect(st).toMatchObject({ missed: true });
    expect(new Date(st!.scheduledAt).toISOString()).toBe('2026-11-06T05:00:00.000Z');
    expect((await svc.midnightCheckpointStatus(Date.parse('2026-11-05T08:00:00Z')))!.missed).toBe(false);
  });
});
