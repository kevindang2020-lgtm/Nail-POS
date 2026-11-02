// auto-config-queries.pgtest — the auto-assignment config and the auto-run against the real migrated schema
// (BUILD_PLAN Phase 6). The private KyselyAutoConfig / KyselyRotationSettings are gone: the routes read and write the
// ONE settings source (KyselyQueueAssignmentSettings). The intents this file guarded stay:
//   • a missing row must mean auto-assignment OFF (fail-closed), not "enabled with default thresholds";
//   • a saved config must actually come back, per branch;
//   • rotation-policy is a JSON object (audit bug 7);
// and the Phase 6 ones: the PLATFORM switch in platform_settings stops the run (bug 6), and an auto-assignment lands as
// an 'auto_assigned' decision + QUEUE_AUTO_ASSIGNED in the outbox (bug 13) without touching a guest staff already took.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { OutboxWriter } from '@aipowersalon/events';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { KyselyQueueAssignmentRepository } from './ai-queue-assignment.kysely.repository';
import { KyselyQueueAssignmentSettings } from './ai-queue-assignment-settings';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { QueueService, KyselyQueueRepository } from '@aipowersalon/queue';
import { QueueServiceDataAdapter, QueueScanAdapter, QueueAssignExecutionAdapter } from './ai-queue-assignment.adapters';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const T = 'd5d5d5d5-0000-4000-8000-000000000001';
const B = 'd5d5d5d5-0000-4000-8000-000000000002';
const B2 = 'd5d5d5d5-0000-4000-8000-000000000009';
const TECH = 'd5d5d5d5-0000-4000-8000-0000000000c1', TECH2 = 'd5d5d5d5-0000-4000-8000-0000000000c2';
const CAT = 'd5d5d5d5-0000-4000-8000-0000000000a1', SVC = 'd5d5d5d5-0000-4000-8000-0000000000a2';
const Q1 = 'd5d5d5d5-0000-4000-8000-0000000000f1', Q2 = 'd5d5d5d5-0000-4000-8000-0000000000f2';
const PERMS = ['pos.queue.view', 'pos.queue.assign_technician', 'ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.manage_auto', 'ai_queue_assignment.manage_rules'];
const ctx = (b = B): QueueAssignmentContext => ({ tenantId: T, branchId: b, userId: 'd5d5d5d5-0000-4000-8000-0000000000e1', role: 'OWNER', permissions: PERMS });
let pg: any; let db: any; let settings: KyselyQueueAssignmentSettings; let svc: QueueAssignmentService;

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Assign Salon LLC', 'Assign Salon', 'assign-salon', 'ASGN1', 'active') ON CONFLICT DO NOTHING;`);
  for (const [id, n] of [[B, 'Main'], [B2, 'Second']]) await pg.exec(`INSERT INTO branches (id, tenant_id, name, status) VALUES ('${id}', '${T}', '${n}', 'active') ON CONFLICT DO NOTHING;`).catch(() => undefined);
  await pg.exec(`
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${ctx().userId}', '${T}', 'Owner', 'active', 'OWNER') ON CONFLICT DO NOTHING;
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 45, 4500);
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH}', '${T}', '${B}', 'Kim', 'X', 'Kim X', 'active'), ('${TECH2}', '${T}', '${B}', 'Ana', 'X', 'Ana X', 'active');
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${TECH}', '${SVC}'), ('${T}', '${B}', '${TECH2}', '${SVC}');
  `);
  settings = new KyselyQueueAssignmentSettings(db, new OutboxWriter());
  // Round 2: the REAL queue — inputs, scan and the assignment all go through QueueService + its Kysely repository.
  const queue = new QueueService(new KyselyQueueRepository(db, new OutboxWriter()));
  svc = new QueueAssignmentService(new KyselyQueueAssignmentRepository(db, new OutboxWriter()), new QueueServiceDataAdapter(queue),
    new InMemoryQueueAssignmentEntitlement(() => true), undefined, { settings, scan: new QueueScanAdapter(queue), assign: new QueueAssignExecutionAdapter(queue) });
});

describe('absent config fails CLOSED', () => {
  it('no row means auto-assignment is OFF — never "on with defaults" — and the thresholds are still sane', async () => {
    const c = await svc.getAutoConfig(ctx());
    expect(c).toMatchObject({ enabled: false, autoAllowed: false, autoBlockedBy: 'disabled' });
    expect(c.confidenceFloor).toBeGreaterThan(0);
    expect(c.maxPerRun).toBeGreaterThan(0);
  });
});

describe('a saved config round-trips, per branch', () => {
  it('enabling persists; turning it back OFF persists too (a stuck-on switch is the dangerous direction)', async () => {
    await svc.setAutoConfig(ctx(), { enabled: true, confidenceFloor: 0.9, maxPerRun: 3 });
    expect(await svc.getAutoConfig(ctx())).toMatchObject({ enabled: true, confidenceFloor: 0.9, maxPerRun: 3, autoAllowed: true });
    await svc.setAutoConfig(ctx(), { enabled: false });
    expect((await svc.getAutoConfig(ctx())).enabled).toBe(false);
  });
  // Two rows that disagree is what makes the branch predicate observable.
  it('each branch reads its OWN config', async () => {
    await svc.setAutoConfig(ctx(B), { enabled: false, maxPerRun: 2 });
    await svc.setAutoConfig(ctx(B2), { enabled: true, maxPerRun: 9, exclusions: { vip: true } });
    expect(await svc.getAutoConfig(ctx(B))).toMatchObject({ enabled: false, maxPerRun: 2 });
    expect(await svc.getAutoConfig(ctx(B2))).toMatchObject({ enabled: true, maxPerRun: 9, exclusions: { vip: true } });
  });
  it('rotation-policy is a JSON object and keeps the fixed order (bug 7)', async () => {
    // RE-PINNED Oct 13 2026 (FLOW T1): fixed_order IS the manual_order fairness mode (the fixed order kept)
    expect(await svc.setRotationPolicy(ctx(), { policy: 'fixed_order', fixedOrder: [TECH] })).toEqual({ policy: 'manual_order', fixedOrder: [TECH] });
    expect(await svc.getRotationPolicy(ctx())).toEqual({ policy: 'manual_order', fixedOrder: [TECH] });
    expect(await svc.getRotationPolicy(ctx(B2))).toEqual({ policy: 'traditional_weighted_rotation', fixedOrder: [] });   // Fair Turn: the new default (600)
  });
});

describe('the auto-run in real SQL', () => {
  it('the platform switch (platform_settings ai.auto_actions_disabled) stops it (bug 6)', async () => {
    await svc.setAutoConfig(ctx(), { enabled: true, confidenceFloor: 0.5, maxPerRun: 5, delaySeconds: 0 });
    const svcs = JSON.stringify([{ serviceId: SVC, serviceName: 'Gel Manicure', estimatedDurationMinutes: 45, priceCents: 4500 }]);
    await sql`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, status, source, priority, requested_services) values
      (${Q1}, ${T}, ${B}, 'Guest 1', 'waiting', 'walk_in', 'normal', ${svcs}::jsonb), (${Q2}, ${T}, ${B}, 'Guest 2', 'waiting', 'walk_in', 'normal', ${svcs}::jsonb)`.execute(db);
    await pg.exec(`INSERT INTO platform_settings (setting_key, setting_group, value, value_type) VALUES ('ai.auto_actions_disabled', 'kill_switches', 'true'::jsonb, 'boolean')
                   ON CONFLICT (setting_key) DO UPDATE SET value = 'true'::jsonb`);
    expect(await svc.runAutoAssignment(ctx())).toMatchObject({ allowed: false, blockedBy: 'platform', assigned: 0 });
    expect((await sql<any>`select count(*)::int as n from pos_queue_items where tenant_id = ${T} and assigned_technician_id is not null`.execute(db)).rows[0].n).toBe(0);
    await pg.exec(`UPDATE platform_settings SET value = 'false'::jsonb WHERE setting_key = 'ai.auto_actions_disabled'`);
  });
  it('assigns as auto_assigned with QUEUE_AUTO_ASSIGNED in the outbox; a guest staff took first is left alone (bug 5, 13)', async () => {
    await sql`update pos_queue_items set assigned_technician_id = ${TECH}, status = 'assigned' where id = ${Q2}`.execute(db);   // staff
    const before = (await sql<any>`select version from pos_queue_items where id = ${Q2}`.execute(db)).rows[0].version;
    const r = await svc.runAutoAssignment(ctx());
    expect(r).toMatchObject({ assigned: 1, considered: 1 });                       // only the waiting guest
    const rows = (await sql<any>`select id, assigned_technician_id as t, version, status from pos_queue_items where tenant_id = ${T} order by customer_name`.execute(db)).rows;
    expect(rows.find((x: any) => x.id === Q1)).toMatchObject({ t: TECH2, status: 'assigned' });   // Kim is at capacity with Guest 2
    expect(rows.find((x: any) => x.id === Q2)).toMatchObject({ t: TECH, version: before });         // untouched
    expect((await sql<any>`select source from pos_queue_status_history where queue_item_id = ${Q1} and to_technician = ${TECH2}`.execute(db)).rows).toEqual([{ source: 'auto_assign' }]);
    const d = (await sql<any>`select queue_entry_id, decision, applied, decided_by from queue_assignment_decisions where tenant_id = ${T}`.execute(db)).rows;
    expect(d).toEqual([{ queue_entry_id: Q1, decision: 'auto_assigned', applied: true, decided_by: ctx().userId }]);
    expect((await sql<any>`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = 'queue.auto_assigned'`.execute(db)).rows[0].n).toBe(1);
    const src = (await sql<any>`select source from queue_assignment_recommendations where tenant_id = ${T} and queue_entry_id = ${Q1}`.execute(db)).rows;
    expect(src.map((x: any) => x.source)).toContain('auto_run');
  });
});
