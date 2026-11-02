// ai-queue-assignment-ops.queue-integration.vitest.spec — BUILD_PLAN Phase 6, round 2: an alert repair through the REAL
// queue domain (agent A's QueueService over KyselyQueueRepository, the migrated schema incl. 524/525 triggers). The
// stuck assignment is detected from the row's REAL updated_at, then "unassign" clears it through
// QueueService.unassignTechnician — version bumped, a pos_queue_status_history row with source 'repair', the queue's
// own audit row, the repair log + audit_logs — and a stale board (wrong version) gets the queue's 409, not a write.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { QueueService, KyselyQueueRepository } from '@aipowersalon/queue';
import { QueueAlertService } from './ai-queue-assignment-alerts.service';
import { KyselyQueueAlertRepository } from './ai-queue-assignment-alerts.repository';
import { KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { QueueServiceOpsAdapter, queueOpsSystemContext } from './ai-queue-assignment-ops.ports';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const id = (n: number) => `a1a1a1a1-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), TECH = id(3), MGR = id(4), Q1 = id(10), Q2 = id(11);
let pg: any; let svc: QueueAlertService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const mgr: QueueAssignmentContext = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER',
  permissions: ['pos.queue.view', 'pos.queue.assign_technician', 'ai_queue_assignment.view', 'ai_queue_assignment.resolve_alerts', 'ai_queue_assignment.assign'] };

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Repair Salon', 'Repair Salon', 'repair-p6-c', 'REPAIRP6C', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active')`);
  await pg.exec(`INSERT INTO users (id, tenant_id, branch_id, role, status, full_name) VALUES ('${MGR}', '${T}', '${B}', 'MANAGER', 'active', 'Manager')`);
  await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${TECH}', '${T}', '${B}', 'Kim', 'L', 'Kim L', 'active', true)`);
  // assigned 45 minutes ago and never started (updated_at is the row's own, as the 525 trigger keeps it)
  await pg.exec(`INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, status, assigned_technician_id, checked_in_at, updated_at)
                 VALUES ('${Q1}', '${T}', '${B}', 'Private Guest', 'assigned', '${TECH}', now() - interval '50 minutes', now() - interval '45 minutes'),
                        ('${Q2}', '${T}', '${B}', 'Second Guest', 'assigned', '${TECH}', now() - interval '50 minutes', now() - interval '45 minutes')`);
  const db = kyselyFor(pg) as never;
  const queue = new QueueService(new KyselyQueueRepository(db, new OutboxWriter()));
  svc = new QueueAlertService(new KyselyQueueAlertRepository(db, new OutboxWriter()), new KyselyQueueAssignmentSettings(db, null), new QueueServiceOpsAdapter(queue), null, null, null);
});

describe('repair through the real QueueService', () => {
  it('the background scan (system context) reads the real queue and finds the stuck assignments', async () => {
    const r = await svc.runScan(queueOpsSystemContext(T, B));
    expect(r.raised).toBeGreaterThanOrEqual(2);
    const stuck = (await svc.listAlerts(mgr)).filter((a) => a.type === 'stuck_record').map((a) => a.queueEntryId).sort();
    expect(stuck).toEqual([Q1, Q2]);
  });

  it('unassign clears the technician: version bumped, history source "repair", queue audit + repair log + audit_logs', async () => {
    const before = (await q(`select version from pos_queue_items where id = $1`, [Q1]))[0].version;
    const alert = (await svc.listAlerts(mgr)).find((a) => a.type === 'stuck_record' && a.queueEntryId === Q1)!;
    await svc.repair(mgr, alert.id, { action: 'unassign', reason: 'Kim went home sick' });
    const item = (await q(`select status, assigned_technician_id, version from pos_queue_items where id = $1`, [Q1]))[0];
    expect(item).toEqual({ status: 'waiting', assigned_technician_id: null, version: before + 1 });
    const h = await q(`select action, source, actor_id, reason, from_technician, to_technician, version from pos_queue_status_history where queue_item_id = $1 order by created_at desc, version desc limit 1`, [Q1]);
    expect(h).toEqual([{ action: 'unassign', source: 'repair', actor_id: MGR, reason: 'Kim went home sick', from_technician: TECH, to_technician: null, version: before + 1 }]);
    expect(await q(`select action_type, user_id from pos_queue_audit where tenant_id = $1 and entity_id = $2 and action_type = 'pos_queue_technician_unassigned'`, [T, Q1])).toEqual([{ action_type: 'pos_queue_technician_unassigned', user_id: MGR }]);
    expect(await q(`select action, reason, performed_by from queue_repair_actions where alert_id = $1`, [alert.id])).toEqual([{ action: 'unassign', reason: 'Kim went home sick', performed_by: MGR }]);
    expect((await q(`select count(*)::int n from audit_logs where tenant_id = $1 and action_type = 'ai_queue_alert_repaired'`, [T]))[0].n).toBe(1);
    expect((await q(`select status, resolution from queue_alerts where id = $1`, [alert.id]))[0]).toEqual({ status: 'resolved', resolution: 'repaired:unassign' });
  });

  it('a stale board (the guest changed after the alert) gets the queue\'s conflict and nothing is written', async () => {
    const alert = (await svc.listAlerts(mgr)).find((a) => a.type === 'stuck_record' && a.queueEntryId === Q2)!;
    const v = (await q(`select version from pos_queue_items where id = $1`, [Q2]))[0].version;
    await expect(svc.repair(mgr, alert.id, { action: 'unassign', reason: 'stale', expectedVersion: v - 1 })).rejects.toMatchObject({ name: expect.stringMatching(/Conflict/) });
    expect((await q(`select assigned_technician_id, version from pos_queue_items where id = $1`, [Q2]))[0]).toEqual({ assigned_technician_id: TECH, version: v });
    expect((await q(`select status from queue_alerts where id = $1`, [alert.id]))[0].status).toBe('open');
    expect(await q(`select 1 from queue_repair_actions where alert_id = $1`, [alert.id])).toEqual([]);
  });

  it('the staff member\'s own queue permissions apply: without pos.queue.assign_technician the repair is refused', async () => {
    const alert = (await svc.listAlerts(mgr)).find((a) => a.type === 'stuck_record' && a.queueEntryId === Q2)!;
    const weak = { ...mgr, permissions: mgr.permissions.filter((p) => p !== 'pos.queue.assign_technician') };
    await expect(svc.repair(weak, alert.id, { action: 'unassign', reason: 'no rights' })).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect((await q(`select assigned_technician_id from pos_queue_items where id = $1`, [Q2]))[0].assigned_technician_id).toBe(TECH);
  });
});
