// ai-queue-assignment-alerts.vitest.spec — BUILD_PLAN Phase 6: the alert lifecycle end to end. In memory for the service
// rules; PGlite (the real migrated schema) for the transaction: raise / auto-resolve with outbox events, resolved hidden by
// default (bug 9), the repair that REALLY goes through the queue and is audited, the owner alert + manager push once.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { QueueAlertService } from './ai-queue-assignment-alerts.service';
import { InMemoryQueueAlertRepository, KyselyQueueAlertRepository } from './ai-queue-assignment-alerts.repository';
import { InMemoryQueueAssignmentSettings, KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueOps, toOpsEntry, type OpsQueueEntry, type OpsTechnician } from './ai-queue-assignment-ops.ports';
import { RecordingOpsEmitter, RecordingAlertNotifier, KyselyQueueAlertNotifier, notificationText, needsNotification } from './ai-queue-assignment-ops.notifications';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { QueueAssignmentForbiddenError, QueueAssignmentValidationError, type QueueAssignmentContext } from './ai-queue-assignment.dto';

const PERMS = ['ai_queue_assignment.view', 'ai_queue_assignment.resolve_alerts', 'ai_queue_assignment.assign', 'ai_queue_assignment.manage_rules'];
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const entry = (o: Partial<OpsQueueEntry> & { queueEntryId: string }): OpsQueueEntry => ({ status: 'waiting', waitMinutes: 0, assignedTechnicianId: null, isAppointment: false, updatedAt: ago(1), version: 3, ...o });
const tech = (id: string, status = 'available'): OpsTechnician => ({ technicianId: id, status });

function rig(entries: OpsQueueEntry[], technicians: OpsTechnician[] = [tech('t1'), tech('t2')]) {
  const repo = new InMemoryQueueAlertRepository();
  const settings = new InMemoryQueueAssignmentSettings();
  const queue = new InMemoryQueueOps({ entries, technicians });
  const emitter = new RecordingOpsEmitter(); const notifier = new RecordingAlertNotifier();
  const svc = new QueueAlertService(repo, settings, queue, new InMemoryQueueAssignmentEntitlement(() => true), emitter, notifier);
  return { repo, settings, queue, emitter, notifier, svc };
}
const ctx = (perms = PERMS, t = 'T', b = 'B'): QueueAssignmentContext => ({ tenantId: t, branchId: b, userId: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'MANAGER', permissions: perms });

describe('QueueAlertService (in memory)', () => {
  it('stuck detection works off the queue\'s REAL updated_at (bug 3): a 40-minute-old assignment is stuck', async () => {
    const { svc, repo } = rig([entry({ queueEntryId: 'q1', status: 'assigned', assignedTechnicianId: 't1', updatedAt: ago(40), waitMinutes: 5 })]);
    await svc.scanAlerts(ctx());
    expect((await repo.list({ tenantId: 'T', branchId: 'B' })).map((a) => a.type)).toContain('stuck_record');
  });

  it('the scan uses the location\'s EFFECTIVE thresholds from the one settings source', async () => {
    const r = rig([entry({ queueEntryId: 'q1', waitMinutes: 14, assignedTechnicianId: 't1' })]);
    await r.svc.scanAlerts(ctx());
    expect((await r.repo.list({ tenantId: 'T', branchId: 'B' })).some((a) => a.type === 'waiting_too_long')).toBe(false);
    await r.settings.update({ tenantId: 'T', branchId: null }, { waitApproachingMin: 5, waitExceededMin: 10, waitSevereMin: 12, waitCriticalMin: 13 }, { userId: null });
    await r.svc.scanAlerts(ctx());
    expect((await r.repo.list({ tenantId: 'T', branchId: 'B' })).find((a) => a.type === 'waiting_too_long')?.severity).toBe('critical');
  });

  it('auto-resolves when the guest is served; resolved alerts are hidden unless asked for (bug 9)', async () => {
    const r = rig([entry({ queueEntryId: 'q1', waitMinutes: 25, assignedTechnicianId: 't1' })]);
    const s1 = await r.svc.scanAlerts(ctx());
    expect(s1.raised).toBeGreaterThan(0);
    r.queue.snap.entries[0].status = 'in_service'; r.queue.snap.entries[0].startedAt = ago(0);
    const s2 = await r.svc.scanAlerts(ctx());
    expect(s2.autoResolved).toBe(s1.raised);
    expect(await r.svc.listAlerts(ctx())).toEqual([]);
    const all = await r.svc.listAlerts(ctx(), { status: 'all' });
    expect(all.every((a) => a.status === 'resolved' && a.autoResolved && a.resolution === 'condition_cleared')).toBe(true);
    expect(r.emitter.events.filter((e) => e.event === 'alert_resolved').every((e) => e.payload.autoResolved === true)).toBe(true);
  });

  it('a second scan of the same condition updates, never duplicates or re-notifies', async () => {
    const r = rig([entry({ queueEntryId: 'q1', waitMinutes: 35, assignedTechnicianId: 't1' })]);
    await r.svc.scanAlerts(ctx());
    const n = r.notifier.sent.length;
    expect(n).toBe(1);   // the severe wait (high); warning-level findings never notify
    const s2 = await r.svc.scanAlerts(ctx());
    expect(s2.raised).toBe(0);
    expect(r.notifier.sent.length).toBe(n);
    r.queue.snap.entries[0].waitMinutes = 50;   // escalates to critical → notified again, once
    await r.svc.scanAlerts(ctx()); await r.svc.scanAlerts(ctx());
    expect(r.notifier.sent.map((a) => a.severity)).toEqual(['high', 'critical']);
  });

  it('acknowledge and resolve need resolve_alerts, keep the note, and a staff-resolved alert is not raised again at the same level', async () => {
    const r = rig([entry({ queueEntryId: 'q1', waitMinutes: 25, assignedTechnicianId: 't1' })]);
    await r.svc.scanAlerts(ctx());
    const [a] = (await r.svc.listAlerts(ctx())).filter((x) => x.type === 'waiting_too_long');
    await expect(r.svc.acknowledgeAlert(ctx(['ai_queue_assignment.view']), a.id)).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    expect((await r.svc.acknowledgeAlert(ctx(), a.id, 'on it')).status).toBe('acknowledged');
    const done = await r.svc.resolveAlert(ctx(), a.id, 'guest is happy to wait');
    expect([done.status, done.resolution, done.reviewNote, done.autoResolved]).toEqual(['resolved', 'resolved_by_staff', 'guest is happy to wait', false]);
    await r.svc.scanAlerts(ctx());
    expect((await r.svc.listAlerts(ctx())).some((x) => x.type === 'waiting_too_long')).toBe(false);
    r.queue.snap.entries[0].waitMinutes = 40;   // got worse → raised again
    await r.svc.scanAlerts(ctx());
    expect((await r.svc.listAlerts(ctx())).some((x) => x.type === 'waiting_too_long')).toBe(true);
  });

  it('repair REALLY changes the queue through the queue port, with the guest\'s current technician + version, and closes the alert', async () => {
    const r = rig([entry({ queueEntryId: 'q1', status: 'assigned', assignedTechnicianId: 't1', updatedAt: ago(45), version: 7 })]);
    await r.svc.scanAlerts(ctx());
    const stuck = (await r.svc.listAlerts(ctx())).find((a) => a.type === 'stuck_record')!;
    const out = await r.svc.repair(ctx(), stuck.id, { action: 'unassign', reason: 'tech went home' });
    expect(r.queue.calls).toEqual([{ id: 'q1', action: 'unassign', opts: expect.objectContaining({ expectedTechnicianId: 't1', expectedVersion: 7, reason: 'tech went home' }) }]);
    expect(r.queue.snap.entries[0]).toMatchObject({ status: 'waiting', assignedTechnicianId: null });
    expect(out.alert).toMatchObject({ status: 'resolved', resolution: 'repaired:unassign' });
    expect(r.repo.repairs[0]).toMatchObject({ action: 'unassign', queueEntryId: 'q1', reason: 'tech went home' });
    expect(r.emitter.events.some((e) => e.event === 'record_repaired')).toBe(true);
  });

  it('repair is gated: the action must fit the alert, cancel needs override + a reason, reassign needs a technician', async () => {
    const r = rig([entry({ queueEntryId: 'q1', status: 'called', assignedTechnicianId: 't1', updatedAt: ago(45) }), entry({ queueEntryId: 'q2', waitMinutes: 25 })]);
    await r.svc.scanAlerts(ctx());
    const alerts = await r.svc.listAlerts(ctx());
    const stuck = alerts.find((a) => a.type === 'stuck_record')!; const waiting = alerts.find((a) => a.type === 'waiting_too_long' && a.queueEntryId === 'q2')!;
    await expect(r.svc.repair(ctx(), waiting.id, { action: 'cancel', reason: 'left' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    await expect(r.svc.repair(ctx(), stuck.id, { action: 'cancel', reason: 'left' })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
    await expect(r.svc.repair(ctx([...PERMS, 'ai_queue_assignment.override']), stuck.id, { action: 'cancel' })).rejects.toThrow(/why/);
    await expect(r.svc.repair(ctx(), waiting.id, { action: 'reassign' })).rejects.toThrow(/technician/);
    expect(r.queue.calls).toEqual([]);
    await r.svc.repair(ctx(), waiting.id, { action: 'reassign', technicianId: 't2' });
    expect(r.queue.calls[0]).toMatchObject({ id: 'q2', action: 'reassign', opts: { technicianId: 't2', expectedTechnicianId: null } });
  });

  it('a queue refusal (stale version, lock) surfaces and the alert stays open', async () => {
    const r = rig([entry({ queueEntryId: 'q1', status: 'assigned', assignedTechnicianId: 't1', updatedAt: ago(45) })]);
    await r.svc.scanAlerts(ctx());
    const stuck = (await r.svc.listAlerts(ctx())).find((a) => a.type === 'stuck_record')!;
    const conflict = Object.assign(new Error('The queue changed — reload.'), { name: 'QueueAssignmentConflict' });
    (r.queue as any).fail = conflict;
    await expect(r.svc.repair(ctx(), stuck.id, { action: 'unassign' })).rejects.toThrow(/reload/);
    expect((await r.svc.listAlerts(ctx())).find((a) => a.id === stuck.id)?.status).toBe('open');
  });

  it('the thresholds route is a view over the settings (versioned)', async () => {
    const r = rig([]);
    const saved = await r.svc.setThresholds(ctx(), { approachingMin: 5, exceededMin: 15, severeMin: 25, criticalMin: 40 });
    expect(saved).toMatchObject({ criticalMin: 40, configVersion: '0.1' });
    await expect(r.svc.setThresholds(ctx(), { exceededMin: 50 })).rejects.toThrow(/rise/);
  });

  it('the scan snapshot maps the queue\'s scanEntries rows (contract shape and the older thin shape)', () => {
    expect(toOpsEntry({ queueEntryId: 'a', status: 'assigned', waitMinutes: 4, assignedTechnicianId: 't', isAppointment: false, updatedAt: '2026-10-07T10:00:00.000Z', version: 2, lock: { technicianId: null, reason: 'hold' } }))
      .toMatchObject({ queueEntryId: 'a', version: 2, lock: { technicianId: null } });
    expect(toOpsEntry({ queueItemId: 'b', status: 'waiting', waitMinutes: 1, updatedAt: null })).toMatchObject({ queueEntryId: 'b', updatedAt: null, assignedTechnicianId: null });
  });
});

describe('notification text never carries guest data', () => {
  it('title = type + location, body = the detection reason (minutes / counts only)', () => {
    const t = notificationText({ type: 'waiting_too_long', severity: 'critical', reason: 'Waiting 50 min (critical)' }, 'Main St');
    expect(t).toEqual({ title: 'Critical: Long wait — Main St', body: 'Waiting 50 min (critical)' });
    expect(needsNotification({ severity: 'warning', notifiedSeverity: null, status: 'open' })).toBe(false);
    expect(needsNotification({ severity: 'high', notifiedSeverity: 'high', status: 'open' })).toBe(false);
    expect(needsNotification({ severity: 'critical', notifiedSeverity: 'high', status: 'acknowledged' })).toBe(true);
  });
});

describe('PostgreSQL (real migrated schema)', () => {
  const T = 'c7c7c7c7-0000-4000-8000-000000000001', T2 = 'c7c7c7c7-0000-4000-8000-000000000009', B = 'c7c7c7c7-0000-4000-8000-000000000002';
  const MGR = 'c7c7c7c7-0000-4000-8000-0000000000a1', TECHU = 'c7c7c7c7-0000-4000-8000-0000000000a2', OTHERB = 'c7c7c7c7-0000-4000-8000-000000000003';
  let pg: any; let db: any;
  const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
  beforeAll(async () => {
    pg = await migratedPglite();
    for (const [id, slug] of [[T, 'alert-p6-a'], [T2, 'alert-p6-b']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${id}', 'S ${slug}', 'S ${slug}', '${slug}', '${slug.toUpperCase().replace(/-/g, '')}', 'active')`);
    await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main St', 'active'), ('${OTHERB}', '${T}', 'Other', 'active')`);
    await pg.exec(`INSERT INTO users (id, tenant_id, branch_id, role, status, full_name) VALUES ('${MGR}', '${T}', '${B}', 'MANAGER', 'active', 'M'), ('${TECHU}', '${T}', '${B}', 'TECHNICIAN', 'active', 'X'),
                   ('c7c7c7c7-0000-4000-8000-0000000000a3', '${T}', '${OTHERB}', 'MANAGER', 'active', 'Other manager')`);
    db = kyselyFor(pg);
  });
  const pctx = (t = T): QueueAssignmentContext => ({ tenantId: t, branchId: B, userId: MGR, role: 'MANAGER', permissions: [...PERMS, 'ai_queue_assignment.override'] });

  it('raise → auto-resolve in one transaction each, with queue.alert_raised / queue.alert_resolved in the outbox; tenant-isolated', async () => {
    const queue = new InMemoryQueueOps({ entries: [entry({ queueEntryId: 'd0d0d0d0-0000-4000-8000-000000000001', waitMinutes: 33, assignedTechnicianId: null })], technicians: [tech('t1')] });
    const repo = new KyselyQueueAlertRepository(db, new OutboxWriter());
    const svc = new QueueAlertService(repo, new KyselyQueueAssignmentSettings(db, new OutboxWriter()), queue, null, null, null);
    const s1 = await svc.scanAlerts(pctx());
    expect(s1.raised).toBeGreaterThanOrEqual(2);   // waiting_too_long + unassigned
    const raisedEv = await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.alert_raised'`, [T]);
    expect(raisedEv[0].n).toBe(s1.raised);
    expect((await svc.listAlerts(pctx(T2))).length).toBe(0);
    queue.snap.entries = [];
    const s2 = await svc.scanAlerts(pctx());
    expect(s2.autoResolved).toBe(s1.raised);
    const rows = await q(`select status, auto_resolved, resolution from queue_alerts where tenant_id = $1`, [T]);
    expect(rows.every((r) => r.status === 'resolved' && r.auto_resolved && r.resolution === 'condition_cleared')).toBe(true);
    const resolvedEv = await q(`select payload_json from outbox_events where tenant_id = $1 and event_type = 'queue.alert_resolved'`, [T]);
    expect(resolvedEv.length).toBe(s1.raised);
    expect(JSON.stringify(resolvedEv)).not.toMatch(/customer|phone/i);
    expect((await svc.listAlerts(pctx())).length).toBe(0);                       // bug 9
    expect((await svc.listAlerts(pctx(), { status: 'all' })).length).toBe(s1.raised);
  });

  it('a repair is written to queue_repair_actions AND audit_logs; the alert closes as repaired', async () => {
    const id = 'd0d0d0d0-0000-4000-8000-000000000002';
    const queue = new InMemoryQueueOps({ entries: [entry({ queueEntryId: id, status: 'assigned', assignedTechnicianId: 't1', updatedAt: ago(50) })], technicians: [tech('t1', 'busy'), tech('t2')] });
    const svc = new QueueAlertService(new KyselyQueueAlertRepository(db, new OutboxWriter()), new KyselyQueueAssignmentSettings(db, null), queue, null, null, null);
    await svc.scanAlerts(pctx());
    const stuck = (await svc.listAlerts(pctx())).find((a) => a.type === 'stuck_record' && a.queueEntryId === id)!;
    await svc.repair(pctx(), stuck.id, { action: 'start_service', reason: 'she is in the chair' });
    expect(queue.calls.map((c) => c.action)).toEqual(['start_service']);
    expect(await q(`select action, reason, performed_by from queue_repair_actions where tenant_id = $1 and alert_id = $2`, [T, stuck.id])).toEqual([{ action: 'start_service', reason: 'she is in the chair', performed_by: MGR }]);
    expect((await q(`select count(*)::int n from audit_logs where tenant_id = $1 and action_type = 'ai_queue_alert_repaired' and user_id = $2`, [T, MGR]))[0].n).toBe(1);
    expect((await q(`select status, resolution from queue_alerts where id = $1`, [stuck.id]))[0]).toEqual({ status: 'resolved', resolution: 'repaired:start_service' });
  });

  it('a high alert → one owner alert + a push to THIS branch\'s managers only (not technicians, not other branches); no guest data', async () => {
    const pushes: { userId: string; title: string; body?: string }[] = [];
    const push = { dispatchToUser: async (_t: string | null, userId: string, m: any) => { pushes.push({ userId, ...m }); return { tokens: 1, sent: 1, failed: 0, provider: 'mock' }; } };
    const id = 'd0d0d0d0-0000-4000-8000-000000000003';
    const queue = new InMemoryQueueOps({ entries: [entry({ queueEntryId: id, waitMinutes: 47, assignedTechnicianId: 't1' })], technicians: [tech('t1', 'busy'), tech('t2')] });
    const repo = new KyselyQueueAlertRepository(db, null);
    const svc = new QueueAlertService(repo, new KyselyQueueAssignmentSettings(db, null), queue, null, null, new KyselyQueueAlertNotifier(db, push as any));
    const r = await svc.scanAlerts(pctx());
    expect(r.notified).toBe(1);   // the critical wait; one guest is not "congestion"
    expect(pushes.map((p) => p.userId)).toEqual([MGR]);
    expect(pushes[0].title).toContain('Main St');
    const owner = await q(`select category, severity, title, body from owner_alerts where tenant_id = $1 and category = 'queue_alert'`, [T]);
    expect(owner).toEqual([{ category: 'queue_alert', severity: 'critical', title: 'Critical: Long wait — Main St', body: 'Waiting 47 min (critical)' }]);
    await svc.scanAlerts(pctx());   // same alert next minute → nothing new
    expect(pushes.length).toBe(1);
    expect((await q(`select count(*)::int n from owner_alerts where tenant_id = $1 and category = 'queue_alert'`, [T]))[0].n).toBe(1);
  });
});
