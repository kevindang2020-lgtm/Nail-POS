// ai-queue-assignment-superadmin.vitest.spec — BUILD_PLAN Phase 6: platform oversight on the real migrated schema.
// Bug 12: "salons with auto on" was a count of BRANCH rows (and missed salon-wide switches); AI-call statuses read a
// 'provider_error' bucket nothing writes. Plus the salon list, one salon's detail and the audited per-salon kill switch.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyQueueSuperAdminRead, InMemoryQueueSuperAdminRead } from './ai-queue-assignment-superadmin.repository';
import { QueueSuperAdminService, QueueSuperAdminError } from './ai-queue-assignment-superadmin.controller';
import { KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { RecordingOpsEmitter } from './ai-queue-assignment-ops.notifications';

const id = (n: number) => `f9f9f9f9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = id(1), T2 = id(2), T3 = id(3), T4 = id(4);
const T1B = [id(11), id(12), id(13)], T2B = id(21), T3B = id(31), T4B = id(41);
const SA = id(99);
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite();
  for (const [t, slug, status] of [[T1, 'sa-p6-one', 'active'], [T2, 'sa-p6-two', 'active'], [T3, 'sa-p6-three', 'active'], [T4, 'sa-p6-four', 'suspended']] as const)
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', 'Salon ${slug}', 'Salon ${slug}', '${slug}', '${slug.toUpperCase().replace(/-/g, '')}', '${status}')`);
  for (const b of T1B) await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${b}', '${T1}', 'One ${b.slice(-2)}', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${T2B}', '${T2}', 'Two', 'active'), ('${T3B}', '${T3}', 'Three', 'active'), ('${T4B}', '${T4}', 'Four', 'active')`);
  // T1: auto on at TWO of its three locations (two rows) → ONE salon
  await pg.exec(`INSERT INTO queue_assignment_settings (tenant_id, branch_id, auto_enabled) VALUES ('${T1}', '${T1B[0]}', true), ('${T1}', '${T1B[1]}', true), ('${T1}', '${T1B[2]}', false)`);
  // T2: auto on SALON-WIDE (Phase 6 salon row), no branch rows → counted
  await pg.exec(`INSERT INTO queue_assignment_tenant_settings (tenant_id, auto_enabled, assignment_mode) VALUES ('${T2}', true, 'AUTOMATIC')`);
  // T3: on, but the salon kill switch is on → not counted
  await pg.exec(`INSERT INTO queue_assignment_tenant_settings (tenant_id, auto_enabled, assignment_mode, auto_killed, auto_killed_reason) VALUES ('${T3}', true, 'AUTOMATIC', true, 'misassignments')`);
  await pg.exec(`INSERT INTO queue_assignment_decisions (tenant_id, branch_id, queue_entry_id, decision, decided_by) VALUES
    ('${T1}', '${T1B[0]}', 'q1', 'accepted', 'u'), ('${T1}', '${T1B[0]}', 'q2', 'rejected', 'u'), ('${T1}', '${T1B[0]}', 'q3', 'auto_assigned', 'system'), ('${T2}', '${T2B}', 'q4', 'auto_assigned', 'system')`);
  await pg.exec(`INSERT INTO queue_alerts (tenant_id, branch_id, queue_entry_id, type, severity, reason, status, auto_resolved) VALUES
    ('${T1}', '${T1B[0]}', 'q1', 'waiting_too_long', 'critical', 'Waiting 50 min (critical)', 'open', false),
    ('${T1}', '${T1B[0]}', 'q2', 'unassigned', 'info', 'No technician for 12 min', 'resolved', true)`);
  await pg.exec(`INSERT INTO ai_usage_logs (tenant_id, package_code, action, status) VALUES
    ('${T1}', 'ai_queue_technician_assignment', 'queue.explain_recommendation', 'success'), ('${T1}', 'ai_queue_technician_assignment', 'queue.explain_recommendation', 'failed'),
    ('${T2}', 'ai_queue_technician_assignment', 'queue.explain_recommendation', 'blocked_limit'), ('${T2}', 'ai_other', 'x', 'success')`);
  db = kyselyFor(pg);
});

describe('platform overview (bug 12)', () => {
  it('salons with auto on are counted BY SALON on the effective switch (location value, else salon value; killed = off)', async () => {
    const a = await new KyselyQueueSuperAdminRead(db).aggregate();
    expect(a.salons.autoEnabled).toBe(2);         // T1 (once, not twice) + T2 (salon-wide); not T3 (killed)
    expect(a.auto.tenantsEnabled).toBe(2);
    expect(a.salons.autoKilled).toBe(1);
    expect(a.salons.using).toBe(3);
  });
  it('AI calls by the statuses AiPlatform really writes; decisions keep auto apart; alerts open vs auto-resolved', async () => {
    const a = await new KyselyQueueSuperAdminRead(db).aggregate();
    expect(a.aiCalls).toEqual({ success: 1, failed: 1, blocked_limit: 1, blocked_permission: 0, blocked_unpaid: 0, total: 3, other: 0 });
    expect((a as any).explanationUsage).toBeUndefined();
    expect(a.decisions).toMatchObject({ accepted: 1, rejected: 1, auto_assigned: 2, total: 4, acceptanceRate: 0.5 });
    expect(a.alerts).toMatchObject({ total: 2, open: 1, autoResolved: 1, openByType: { waiting_too_long: 1 }, openBySeverity: { critical: 1 } });
  });
});

describe('salons and one salon', () => {
  it('lists salons with their switches and open alerts', async () => {
    const rows = await new KyselyQueueSuperAdminRead(db).salons();
    const one = rows.find((r) => r.tenantId === T1)!;
    expect(one).toMatchObject({ branches: 3, branchesAutoOn: 2, openAlerts: 1, criticalAlerts: 1, decisions30d: 2, autoAssigned30d: 1, autoKilled: false });
    expect(rows.find((r) => r.tenantId === T3)).toMatchObject({ autoKilled: true, autoKilledReason: 'misassignments', branchesAutoOn: 0 });
    expect((await new KyselyQueueSuperAdminRead(db).salons({ search: 'two' })).map((r) => r.tenantId)).toEqual([T2]);
  });
  it('one salon: branches with their effective settings, open alerts (no guest data), the version log', async () => {
    const svc = new QueueSuperAdminService(new KyselyQueueSuperAdminRead(db), new KyselyQueueAssignmentSettings(db, null));
    const d: any = await svc.salonDetail(T1);
    expect(d.tenant).toMatchObject({ tenantId: T1 });
    expect(d.branches.map((b: any) => b.effective.autoEnabled)).toEqual([true, true, false]);
    expect(d.openAlerts).toEqual([expect.objectContaining({ type: 'waiting_too_long', reason: 'Waiting 50 min (critical)' })]);
    await expect(svc.salonDetail(id(77))).rejects.toBeInstanceOf(QueueSuperAdminError);
  });
});

describe('the per-salon auto kill switch', () => {
  it('needs a 12-character reason and an explicit killed flag', async () => {
    const svc = new QueueSuperAdminService(new KyselyQueueSuperAdminRead(db), new KyselyQueueAssignmentSettings(db, new OutboxWriter()), null, db);
    await expect(svc.setAutoKill({ userId: SA }, T2, true, 'too short')).rejects.toThrow(/12 characters/);
    await expect(svc.setAutoKill({ userId: SA }, T2, 'yes', 'a long enough reason here')).rejects.toThrow(/killed/);
  });
  it('kills the salon\'s auto-assign (every branch blocked), audited twice (salon log + platform audit), event + realtime', async () => {
    const emitter = new RecordingOpsEmitter(); const settings = new KyselyQueueAssignmentSettings(db, new OutboxWriter());
    const svc = new QueueSuperAdminService(new KyselyQueueSuperAdminRead(db), settings, emitter, db);
    const r = await svc.setAutoKill({ userId: SA }, T2, true, 'wrong technicians assigned all morning');
    expect(r).toMatchObject({ tenantId: T2, killed: true, reason: 'wrong technicians assigned all morning' });
    expect((await settings.effective({ tenantId: T2, branchId: T2B })).autoBlockedBy).toBe('salon_kill_switch');
    expect((await settings.versions({ tenantId: T2, branchId: null }))[0]).toMatchObject({ change: 'platform_kill', changedBy: SA });
    expect((await q(`select count(*)::int n from audit_logs where tenant_id = $1 and action_type = 'super_admin_ai_queue_auto_killed' and role = 'SUPER_ADMIN' and user_id = $2`, [T2, SA]))[0].n).toBe(1);
    expect((await q(`select count(*)::int n from outbox_events where tenant_id = $1 and event_type = 'queue.auto_assignment_disabled'`, [T2]))[0].n).toBe(1);
    expect(emitter.events).toEqual([expect.objectContaining({ event: 'auto_killed', scope: { tenantId: T2, branchId: null } })]);
    expect((await new KyselyQueueSuperAdminRead(db).aggregate()).salons.autoEnabled).toBe(1);
    await svc.setAutoKill({ userId: SA }, T2, false, 'fixed the rotation settings');
    expect((await settings.effective({ tenantId: T2, branchId: T2B })).autoAllowed).toBe(true);
  });
});

describe('in-memory read port', () => {
  it('empty → zeroes', async () => {
    const a = await new QueueSuperAdminService(new InMemoryQueueSuperAdminRead()).platformOverview();
    expect([a.salons.autoEnabled, a.decisions.total, a.alerts.total, a.aiCalls.total]).toEqual([0, 0, 0, 0]);
  });
});
