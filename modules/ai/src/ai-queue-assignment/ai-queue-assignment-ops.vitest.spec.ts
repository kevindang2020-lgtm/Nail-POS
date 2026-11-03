// ai-queue-assignment-ops.vitest.spec — BUILD_PLAN Phase 6: overview, settings routes, analytics (bug 13), CSV export,
// usage and the owner's branch comparison. In memory for the rules; PGlite for the read model's SQL.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { QueueOpsService, parseRange, startOfLocalDay, QueueOpsConflictError } from './ai-queue-assignment-ops.service';
import { InMemoryQueueOpsRead, KyselyQueueOpsRead, type DecisionRow } from './ai-queue-assignment-ops.repository';
import { InMemoryQueueAlertRepository } from './ai-queue-assignment-alerts.repository';
import { InMemoryQueueAssignmentSettings, KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueOps } from './ai-queue-assignment-ops.ports';
import { RecordingOpsEmitter } from './ai-queue-assignment-ops.notifications';
import { computeDecisionAnalytics, safeCsv, hourIn } from './ai-queue-assignment-analytics';
import { QueueAssignmentForbiddenError, QueueAssignmentValidationError, type QueueAssignmentContext } from './ai-queue-assignment.dto';

// owner.branches.compare: an owner's session carries the salon-wide reach (BUILD_PLAN Phase 9 — the salon scope is that
// permission, not the OWNER role name)
const ALL = ['ai_queue_assignment.view', 'ai_queue_assignment.manage_rules', 'ai_queue_assignment.manage_auto', 'ai_queue_assignment.export', 'owner.dashboard.view', 'owner.branches.compare'];
const ctx = (role = 'OWNER', perms = ALL, b = 'B1'): QueueAssignmentContext => ({ tenantId: 'T', branchId: b, userId: 'u1', role, permissions: perms });
const NOW = Date.parse('2026-10-07T18:00:00Z');
const dec = (o: Partial<DecisionRow>): DecisionRow => ({ id: Math.random().toString(36), branchId: 'B1', queueEntryId: 'q', decision: 'accepted', chosenTechnicianId: 't1', previousTechnicianId: null,
  reason: null, feedbackCode: null, decidedBy: 'u1', applied: true, createdAt: '2026-10-07T15:00:00.000Z', ...o });

function rig(data: ConstructorParameters<typeof InMemoryQueueOpsRead>[0] = {}) {
  const settings = new InMemoryQueueAssignmentSettings();
  const read = new InMemoryQueueOpsRead({ branches: [{ branchId: 'B1', name: 'Main', timezone: 'America/New_York' }, { branchId: 'B2', name: 'Mall', timezone: 'America/New_York' }], ...data });
  const emitter = new RecordingOpsEmitter();
  const queue = new InMemoryQueueOps({ entries: [
    { queueEntryId: 'a', status: 'waiting', waitMinutes: 12, assignedTechnicianId: null, isAppointment: false, updatedAt: new Date(NOW).toISOString() },
    { queueEntryId: 'b', status: 'in_service', waitMinutes: 0, assignedTechnicianId: 't2', isAppointment: false, updatedAt: new Date(NOW).toISOString() },
  ], technicians: [{ technicianId: 't1', status: 'available', name: 'Kim' }, { technicianId: 't2', status: 'busy', activeAssignments: 1 }] });
  const svc = new QueueOpsService(settings, new InMemoryQueueAlertRepository(), queue, read, null, emitter, () => NOW);
  return { svc, settings, read, emitter };
}

describe('analytics — auto-assignments are not staff acceptances (bug 13)', () => {
  it('rates are over staff decisions; auto_assigned is its own count', () => {
    const a = computeDecisionAnalytics([dec({}), dec({ decision: 'rejected', reason: 'busy' }), dec({ decision: 'auto_assigned' }), dec({ decision: 'auto_assigned' }), dec({ decision: 'auto_assigned' })]);
    expect([a.total, a.staffTotal, a.autoAssigned, a.accepted, a.acceptanceRate, a.rejectionRate]).toEqual([5, 2, 3, 1, 0.5, 0.5]);
  });
  it('only auto-assignments → no acceptance rate at all (never a fabricated 0 % or 100 %)', () => {
    expect(computeDecisionAnalytics([dec({ decision: 'auto_assigned' })]).acceptanceRate).toBeNull();
  });
  it('hours are the location\'s own (15:00 UTC = 11:00 in New York)', () => {
    expect(hourIn('2026-10-07T15:00:00Z', 'America/New_York')).toBe(11);
    expect(hourIn('2026-10-07T15:00:00Z', 'Not/AZone')).toBe(15);
    const a = computeDecisionAnalytics([dec({})], 'America/New_York');
    expect(a.byHour).toEqual([{ hour: 11, total: 1, accepted: 1, autoAssigned: 0 }]);
  });
  it('the service puts waits, technicians and hours together', async () => {
    const { svc } = rig({ decisions: [dec({}), dec({ decision: 'auto_assigned', chosenTechnicianId: 't2' })], names: { t1: 'Kim', t2: 'Lee' },
      waits: [{ queueItemId: 'x', branchId: 'B1', technicianId: 't1', checkedInAt: '2026-10-07T14:40:00Z', startedAt: '2026-10-07T15:00:00Z' }, { queueItemId: 'y', branchId: 'B2', technicianId: 't1', checkedInAt: '2026-10-07T14:00:00Z', startedAt: '2026-10-07T15:00:00Z' }] });
    const a = await svc.analytics(ctx(), { from: '2026-10-01', to: '2026-10-07' });
    expect(a.decisions).toMatchObject({ accepted: 1, autoAssigned: 1, acceptanceRate: 1 });
    expect(a.waits).toMatchObject({ served: 1, avgMinutes: 20 });                       // B2's wait is not this location's
    expect(a.byTechnician.find((t) => t.technicianId === 't1')).toMatchObject({ name: 'Kim', served: 1, chosenByStaff: 1 });
    expect(a.byTechnician.find((t) => t.technicianId === 't2')).toMatchObject({ autoAssigned: 1, chosenByStaff: 0 });
    expect(a.byHour.find((h) => h.hour === 10)).toMatchObject({ served: 1, avgWaitMinutes: 20 });
  });
  it('ranges are checked in plain words', () => {
    expect(() => parseRange('yesterday')).toThrow(/2026-10-01/);
    expect(() => parseRange('2026-10-07', '2026-10-01')).toThrow(/before/);
    expect(() => parseRange('2026-01-01', '2026-10-01')).toThrow(/at most/);
    expect(parseRange('2026-10-01', '2026-10-01')).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' });
    // Nov 3 audit: bare days are SALON days (New York, EDT −4h) and the end day is included whole
    expect(parseRange('2026-10-01', '2026-10-01', Date.now(), 'America/New_York')).toEqual({ from: '2026-10-01T04:00:00.000Z', to: '2026-10-02T04:00:00.000Z' });
  });
});

describe('CSV export', () => {
  it('neutralises formulas (= + - @ and a leading tab) and quotes commas', () => {
    const csv = safeCsv(['a', 'b', 'c', 'd'], [['=HYPERLINK("x")', '\t=1+1', 'plain, with comma', '@SUM(A1)']]);
    expect(csv.split('\n')[1]).toBe(`"'=HYPERLINK(""x"")",'\t=1+1,"plain, with comma",'@SUM(A1)`);
  });
  it('needs ai_queue_assignment.export and returns { format, filename, csv }', async () => {
    const { svc } = rig({ decisions: [dec({ reason: '=cmd|calc', decision: 'rejected', chosenTechnicianId: null })], names: { t1: 'Kim' } });
    await expect(svc.exportCsv(ctx('MANAGER', ['ai_queue_assignment.view']), { type: 'decisions' })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    const out = await svc.exportCsv(ctx(), { type: 'decisions', from: '2026-10-01', to: '2026-10-07' });
    expect(out).toMatchObject({ format: 'csv', filename: 'ai-queue-decisions-2026-10-01-to-2026-10-08.csv', rows: 1 });
    expect(out.csv).toContain("'=cmd|calc");
    await expect(svc.exportCsv(ctx(), { type: 'customers' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
  });
});

describe('settings routes', () => {
  it('GET shows salon, own values (null = inherits), effective and versions', async () => {
    const { svc, settings } = rig();
    await settings.update({ tenantId: 'T', branchId: null }, { waitSevereMin: 33, waitCriticalMin: 44 }, { userId: 'u1' });
    await settings.update({ tenantId: 'T', branchId: 'B1' }, { stuckMinutes: 22 }, { userId: 'u1' });
    const s = await svc.getSettings(ctx());
    expect(s.branch).toMatchObject({ stuckMinutes: 22, waitSevereMin: null, version: 1 });
    expect(s.effective).toMatchObject({ waitSevereMin: 33, stuckMinutes: 22 });
    expect(s.versions.length).toBe(2);
    expect(s.canEditSalon).toBe(true);
  });
  it('a manager changes the location; the salon scope is the owner\'s; auto values need manage_auto', async () => {
    const { svc, emitter } = rig();
    const mgr = ctx('MANAGER', ['ai_queue_assignment.view', 'ai_queue_assignment.manage_rules']);
    await expect(svc.putSettings(mgr, { scope: 'salon', patch: { stuckMinutes: 20 } })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    await expect(svc.putSettings(mgr, { scope: 'branch', patch: { autoEnabled: true } })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    const r = await svc.putSettings(mgr, { scope: 'branch', patch: { stuckMinutes: 20 }, reason: 'short services here' });
    expect(r).toMatchObject({ scope: 'branch', effective: { stuckMinutes: 20 } });
    expect(emitter.events.at(-1)).toMatchObject({ event: 'settings_changed', scope: { branchId: 'B1' } });
    const o = await svc.putSettings(ctx(), { scope: 'salon', patch: { autoEnabled: true } });
    expect(o.effective.autoEnabled).toBe(true);
    await expect(svc.putSettings(ctx(), { scope: 'branch', patch: { nope: 1 } as any })).rejects.toThrow(/Unknown setting/);
  });
  it('a stale version is a conflict (→ 409) carrying the current version; clear makes a value inherit again', async () => {
    const { svc } = rig();
    await svc.putSettings(ctx(), { scope: 'branch', patch: { stuckMinutes: 20 }, expectedVersion: 0 });
    const err = await svc.putSettings(ctx(), { scope: 'branch', patch: { stuckMinutes: 25 }, expectedVersion: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueOpsConflictError);
    expect(err.currentVersion).toBe(1);
    const r = await svc.putSettings(ctx(), { scope: 'branch', clear: ['stuckMinutes'] });
    expect(r.effective.stuckMinutes).toBe(30);
  });
});

describe('overview + owner summary + usage', () => {
  it('the overview is the live floor in one call', async () => {
    const { svc } = rig({ decisions: [dec({ createdAt: new Date(NOW - 3600_000).toISOString() }), dec({ decision: 'auto_assigned', createdAt: new Date(NOW - 60_000).toISOString() }),
      dec({ createdAt: new Date(NOW - 2 * 86_400_000).toISOString() })] });
    const o = await svc.overview(ctx());
    expect(o).toMatchObject({ waiting: 1, unassigned: 1, inService: 1, longestWaitMinutes: 12, openAlerts: 0, autoEnabled: false, autoAllowed: false, autoBlockedBy: 'disabled',
      decisionsToday: { accepted: 1, autoAssigned: 1 } });
    expect(o.technicians).toEqual([{ technicianId: 't1', name: 'Kim', status: 'available', activeAssignments: 0, availableInMinutes: null }, { technicianId: 't2', name: null, status: 'busy', activeAssignments: 1, availableInMinutes: null }]);
  });
  it('"today" starts at the location\'s midnight', () => {
    expect(new Date(startOfLocalDay(Date.parse('2026-10-07T03:00:00Z'), 'America/New_York')).toISOString()).toBe('2026-10-06T04:00:00.000Z');
    expect(new Date(startOfLocalDay(Date.parse('2026-10-07T18:00:00Z'), null)).toISOString()).toBe('2026-10-07T00:00:00.000Z');
  });
  it('the owner compares locations (owner.dashboard.view)', async () => {
    const { svc } = rig({ decisions: [dec({}), dec({ decision: 'rejected', reason: 'x' }), dec({ branchId: 'B2', decision: 'auto_assigned' })],
      waits: [{ queueItemId: 'x', branchId: 'B1', technicianId: 't1', checkedInAt: '2026-10-07T14:40:00Z', startedAt: '2026-10-07T15:00:00Z' }, { queueItemId: 'y', branchId: 'B2', technicianId: 't1', checkedInAt: '2026-10-07T14:00:00Z', startedAt: '2026-10-07T15:00:00Z' }],
      alerts: [{ id: 'a', branchId: 'B2', type: 'unassigned', severity: 'info', status: 'open', queueEntryId: 'q', technicianId: null, reason: 'r', autoResolved: false, resolution: null, createdAt: '2026-10-07T15:00:00.000Z', resolvedAt: null }] });
    await expect(svc.ownerSummary({ tenantId: 'T', userId: 'u', role: 'MANAGER', permissions: [] })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    const s = await svc.ownerSummary({ tenantId: 'T', userId: 'u', role: 'OWNER', permissions: ['owner.dashboard.view'] }, 7);
    expect(s.branches).toEqual([
      expect.objectContaining({ branchId: 'B1', name: 'Main', avgWaitMinutes: 20, acceptanceRate: 0.5, autoAssigned: 0, openAlerts: 0 }),
      expect.objectContaining({ branchId: 'B2', name: 'Mall', avgWaitMinutes: 60, acceptanceRate: null, autoAssigned: 1, openAlerts: 1 }),
    ]);
    expect(s.totals).toMatchObject({ served: 2, avgWaitMinutes: 40, autoAssigned: 1, openAlerts: 1 });
  });
});

describe('KyselyQueueOpsRead (real migrated schema)', () => {
  const T = 'e8e8e8e8-0000-4000-8000-000000000001', T2 = 'e8e8e8e8-0000-4000-8000-000000000009', B = 'e8e8e8e8-0000-4000-8000-000000000002', TECH = 'e8e8e8e8-0000-4000-8000-0000000000c1';
  let read: KyselyQueueOpsRead; let pg: any;
  beforeAll(async () => {
    pg = await migratedPglite();
    for (const [id, slug] of [[T, 'ops-p6-a'], [T2, 'ops-p6-b']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${id}', 'S ${slug}', 'S ${slug}', '${slug}', '${slug.toUpperCase().replace(/-/g, '')}', 'active')`);
    await pg.exec(`INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York')`);
    await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, commission_type, commission_value, default_commission_split_percent, is_active)
                   VALUES ('${TECH}', '${T}', '${B}', 'Kim', 'L', 'Kim L', 'available', 'percentage', 0, 60, true)`).catch(async () => {
      await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${TECH}', '${T}', '${B}', 'Kim', 'L', 'Kim L')`);
    });
    await pg.exec(`INSERT INTO queue_assignment_decisions (tenant_id, branch_id, queue_entry_id, decision, chosen_technician, decided_by, created_at) VALUES
      ('${T}', '${B}', 'q1', 'accepted', '${TECH}', 'u', '2026-10-05T15:00:00Z'), ('${T}', '${B}', 'q2', 'auto_assigned', '${TECH}', 'system', '2026-10-05T16:00:00Z'),
      ('${T2}', '${B}', 'q3', 'accepted', null, 'u', '2026-10-05T15:00:00Z')`);
    await pg.exec(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status, checked_in_at, started_at) VALUES
      ('${T}', '${B}', 'Private Name', 'in_service', '2026-10-05T14:30:00Z', '2026-10-05T15:00:00Z')`);
    await pg.exec(`INSERT INTO ai_usage_logs (tenant_id, package_code, action, status, cost_micro_usd, created_at) VALUES
      ('${T}', 'ai_queue_technician_assignment', 'queue.explain_recommendation', 'success', 120, '2026-10-05T15:00:00Z'),
      ('${T}', 'ai_queue_technician_assignment', 'queue.explain_recommendation', 'blocked_limit', 0, '2026-10-05T15:00:00Z'),
      ('${T}', 'ai_other', 'x', 'success', 5, '2026-10-05T15:00:00Z')`);
    read = new KyselyQueueOpsRead(kyselyFor(pg) as never);
  });
  const R = { from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z' };

  it('decisions, waits, names, usage — tenant-scoped, no guest names selected', async () => {
    const d = await read.decisions(T, B, R.from, R.to);
    expect(d.map((x) => x.decision)).toEqual(['accepted', 'auto_assigned']);
    expect(computeDecisionAnalytics(d)).toMatchObject({ acceptanceRate: 1, autoAssigned: 1 });
    const w = await read.servedWaits(T, B, R.from, R.to);
    expect(w).toEqual([expect.objectContaining({ technicianId: null, checkedInAt: '2026-10-05T14:30:00.000Z', startedAt: '2026-10-05T15:00:00.000Z' })]);
    expect(JSON.stringify(w)).not.toContain('Private Name');
    expect((await read.technicianNames(T))[TECH]).toBe('Kim L');
    expect(await read.branches(T)).toEqual([{ branchId: B, name: 'Main', timezone: 'America/New_York' }]);
    const u = await read.usage(T, R.from, R.to);
    expect(u).toMatchObject({ calls: 2, costMicroUsd: 120, byStatus: { success: 1, blocked_limit: 1 }, byAction: { 'queue.explain_recommendation': 2 } });
    const h = await read.history(T, B, R.from, '2100-01-01T00:00:00Z');   // whatever the queue wrote to pos_queue_status_history (agent A)
    expect(h.every((x) => x.branchId === B && typeof x.version === 'number')).toBe(true);
    expect(JSON.stringify(h)).not.toContain('Private Name');
  });

  it('the service end to end on the real read model + settings (export through PGlite)', async () => {
    const db = kyselyFor(pg) as never;
    const svc = new QueueOpsService(new KyselyQueueAssignmentSettings(db, null), new InMemoryQueueAlertRepository(), new InMemoryQueueOps(), new KyselyQueueOpsRead(db), null, null, () => Date.parse('2026-10-07T12:00:00Z'));
    const c: QueueAssignmentContext = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: ALL };
    const out = await svc.exportCsv(c, { type: 'decisions', from: '2026-10-01', to: '2026-10-07' });
    expect(out.rows).toBe(2);
    expect(out.csv.split('\n')[0]).toBe('created_at,queue_item_id,decision,chosen_technician_id,chosen_technician,previous_technician_id,applied,feedback_code,reason,decided_by');
    expect(out.csv).toContain('Kim L');
    const a = await svc.analytics(c, { from: '2026-10-01', to: '2026-10-07' });
    expect(a.timeZone).toBe('America/New_York');
    expect(a.waits.byHour).toEqual([{ hour: 10, served: 1, avgMinutes: 30 }]);   // 14:30 UTC check-in = 10:30 in New York
  });
});
