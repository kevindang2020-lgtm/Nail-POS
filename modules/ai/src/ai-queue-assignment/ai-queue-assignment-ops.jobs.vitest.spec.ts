// ai-queue-assignment-ops.jobs.vitest.spec — BUILD_PLAN Phase 6: the per-branch background work on the ONE job queue
// (jobs table, registerJobHandler, claimJobs). The dispatcher enqueues one scan per branch with work and one auto-run per
// branch whose auto switch is on and allowed — tenant-partitioned (each job carries its salon), never for a suspended
// salon or one without the AI package; the handlers re-check every switch when they run and stamp last_scan_at /
// last_auto_run_at.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { claimJobs, jobHandlerFor } from '@aipowersalon/database';
import { dispatchQueueOpsJobs, registerQueueOpsJobHandlers, runAutoJob, runScanJob, QUEUE_OPS_JOB, queueOpsJobsEnabled, type QueueOpsJobDeps } from './ai-queue-assignment-ops.jobs';
import { KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { KyselyQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const id = (n: number) => `b5b5b5b5-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1), SUSP = id(2), NOPKG = id(3);
const A1 = id(11), A2 = id(12), A3 = id(13), S1 = id(21), N1 = id(31);
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const calls: { kind: 'scan' | 'auto'; ctx: QueueAssignmentContext }[] = [];
let deps: QueueOpsJobDeps;

beforeAll(async () => {
  pg = await migratedPglite();
  for (const [t, slug, status] of [[A, 'jobs-p6-a', 'active'], [SUSP, 'jobs-p6-s', 'suspended'], [NOPKG, 'jobs-p6-n', 'active']] as const)
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', 'S ${slug}', 'S ${slug}', '${slug}', '${slug.toUpperCase().replace(/-/g, '')}', '${status}')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${A1}', '${A}', 'A1', 'active'), ('${A2}', '${A}', 'A2', 'active'), ('${A3}', '${A}', 'A3', 'active'),
                 ('${S1}', '${SUSP}', 'S1', 'active'), ('${N1}', '${NOPKG}', 'N1', 'active')`);
  await pg.exec(`INSERT INTO tenant_ai_subscriptions (tenant_id, package_code, status) VALUES ('${A}', 'ai_queue_technician_assignment', 'active'), ('${SUSP}', 'ai_queue_technician_assignment', 'active')`);
  // A1: a waiting, unassigned guest; A2: only an unresolved alert (the queue emptied — the alert must still auto-resolve);
  // A3: nothing. The suspended salon and the salon without the package have waiting guests too.
  await pg.exec(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status) VALUES ('${A}', '${A1}', 'G', 'waiting'), ('${SUSP}', '${S1}', 'G', 'waiting'), ('${NOPKG}', '${N1}', 'G', 'waiting')`);
  await pg.exec(`INSERT INTO queue_alerts (tenant_id, branch_id, queue_entry_id, type, severity, reason) VALUES ('${A}', '${A2}', 'gone', 'waiting_too_long', 'warning', 'Waiting 25 min (exceeded)')`);
  await pg.exec(`INSERT INTO queue_assignment_tenant_settings (tenant_id, auto_enabled, assignment_mode) VALUES ('${A}', true, 'AUTOMATIC'), ('${SUSP}', true, 'AUTOMATIC'), ('${NOPKG}', true, 'AUTOMATIC')`);
  db = kyselyFor(pg);
  deps = {
    db, settings: new KyselyQueueAssignmentSettings(db, null), entitlement: new KyselyQueueAssignmentEntitlement(db),
    scan: async (ctx) => { calls.push({ kind: 'scan', ctx }); return { raised: 0 }; },
    autoRun: async (ctx) => { calls.push({ kind: 'auto', ctx }); return { assigned: 0 }; },
  };
  registerQueueOpsJobHandlers(deps);
});
beforeEach(async () => { calls.length = 0; await pg.exec(`DELETE FROM jobs WHERE job_type LIKE 'ai.queue_assignment.%'`); await pg.exec(`DELETE FROM platform_settings WHERE setting_key = 'ai.auto_actions_disabled'`); });

const jobs = async () => (await q(`select job_type, tenant_id, payload from jobs where job_type like 'ai.queue_assignment.%' order by job_type, payload->>'branchId'`)).map((r) => [r.job_type, r.tenant_id, (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload).branchId]);

describe('dispatch', () => {
  it('one scan per branch with work (open queue OR unresolved alert), one auto-run where auto is on and someone waits — only active salons with the package', async () => {
    const r = await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T18:00:10Z'));
    expect(r).toMatchObject({ scan: 2, autoRun: 1 });
    expect(await jobs()).toEqual([[QUEUE_OPS_JOB.autoRun, A, A1], [QUEUE_OPS_JOB.scan, A, A1], [QUEUE_OPS_JOB.scan, A, A2]]);
  });
  it('once per branch per minute (a slow worker never piles them up)', async () => {
    await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T18:00:10Z'));
    expect(await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T18:00:50Z'))).toMatchObject({ scan: 0, autoRun: 0 });
    expect(await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T18:01:05Z'))).toMatchObject({ scan: 2, autoRun: 1 });
  });
  it('no auto-run jobs while the platform switch is on, or the salon kill switch', async () => {
    await pg.exec(`INSERT INTO platform_settings (setting_key, setting_group, value, value_type) VALUES ('ai.auto_actions_disabled', 'kill_switches', 'true'::jsonb, 'boolean')`);
    expect(await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T19:00:00Z'))).toMatchObject({ scan: 2, autoRun: 0 });
    await pg.exec(`DELETE FROM platform_settings WHERE setting_key = 'ai.auto_actions_disabled'`);
    await pg.exec(`UPDATE queue_assignment_tenant_settings SET auto_killed = true WHERE tenant_id = '${A}'`);
    expect(await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T19:01:00Z'))).toMatchObject({ scan: 2, autoRun: 0 });
    await pg.exec(`UPDATE queue_assignment_tenant_settings SET auto_killed = false WHERE tenant_id = '${A}'`);
  });
  it('the switch is on unless AI_QUEUE_OPS_JOBS=off', () => {
    expect(queueOpsJobsEnabled({})).toBe(true);
    expect(queueOpsJobsEnabled({ AI_QUEUE_OPS_JOBS: 'off' })).toBe(false);
  });
});

describe('the jobs run through the queue\'s worker contract (claim → registered handler)', () => {
  it('scan + auto-run per branch under the system context; stamps last_scan_at / last_auto_run_at without a settings version', async () => {
    await dispatchQueueOpsJobs(db, Date.parse('2026-10-07T20:00:00Z'));
    const claimed = await claimJobs(db, 'standard', 'test-worker', { limit: 20 });
    const mine = claimed.filter((j) => j.jobType.startsWith('ai.queue_assignment.'));
    expect(mine.length).toBe(3);
    for (const j of mine) await jobHandlerFor(j.jobType)!(j.payload, { jobId: j.id, tenantId: j.tenantId, attempt: 1, correlationId: null, renewLease: async () => true });
    expect(calls.map((c) => [c.kind, c.ctx.branchId]).sort()).toEqual([['auto', A1], ['scan', A1], ['scan', A2]]);
    expect(calls.every((c) => c.ctx.tenantId === A && c.ctx.userId === '' && c.ctx.role === 'SYSTEM')).toBe(true);
    const st = await q(`select branch_id, version, last_scan_at is not null as scanned, last_auto_run_at is not null as auto from queue_assignment_settings where tenant_id = $1 order by branch_id`, [A]);
    expect(st).toEqual([{ branch_id: A1, version: 0, scanned: true, auto: true }, { branch_id: A2, version: 0, scanned: true, auto: false }]);
    expect((await deps.settings.effective({ tenantId: A, branchId: A1 })).configVersion).toBe('1.0');   // the stamp is not a settings change
  });
  it('the handler re-checks: a salon suspended after enqueue, the platform switch, a missing package → skipped, nothing runs', async () => {
    expect(await runScanJob(deps, SUSP, { branchId: S1 })).toEqual({ skipped: 'salon_not_active' });
    expect(await runScanJob(deps, NOPKG, { branchId: N1 })).toEqual({ skipped: 'not_entitled' });
    await pg.exec(`INSERT INTO platform_settings (setting_key, setting_group, value, value_type) VALUES ('ai.auto_actions_disabled', 'kill_switches', 'true'::jsonb, 'boolean')`);
    expect(await runAutoJob(deps, A, { branchId: A1 })).toEqual({ skipped: 'auto_blocked:platform' });
    await pg.exec(`DELETE FROM platform_settings WHERE setting_key = 'ai.auto_actions_disabled'`);
    await deps.settings.update({ tenantId: A, branchId: A1 }, { autoEnabled: false }, { userId: null });
    expect(await runAutoJob(deps, A, { branchId: A1 })).toEqual({ skipped: 'auto_blocked:disabled' });
    expect(calls).toEqual([]);
    await expect(runScanJob(deps, A, { branchId: 'not-a-uuid' })).rejects.toThrow(/tenant and branch/);
  });
});
