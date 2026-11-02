// ai-queue-assignment-service.vitest.spec.ts — the service with fakes, and decisions acting through the queue
// (BUILD_PLAN Phase 6): accepted / overridden ASSIGN through the queue's own action with the technician + version the
// suggestion saw; a stale guest is refused (409) and nothing is recorded; the same idempotency key replays; the decision
// event goes to the outbox with the row and to realtime (audit bug 8); an empty branch is a plain 400 (bug 14).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { OutboxWriter } from '@aipowersalon/events';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository } from './ai-queue-assignment.repository';
import { KyselyQueueAssignmentRepository } from './ai-queue-assignment.kysely.repository';
import { InMemoryQueueDataAdapter, InMemoryAssignExecution } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentEntitlement } from './ai-queue-assignment-entitlement';
import { RealtimeAssignmentEmitter, QueueServiceDataAdapter, QueueAssignExecutionAdapter, QueueScanAdapter } from './ai-queue-assignment.adapters';
import { QueueService, KyselyQueueRepository } from '@aipowersalon/queue';
import { ctxFrom } from './ai-queue-assignment.controller';
import { QueueAssignmentForbiddenError, QueueAssignmentDisabledError, QueueAssignmentValidationError, QueueAssignmentStaleError, type QueueAssignmentContext } from './ai-queue-assignment.dto';

const PERMS = ['ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.assign', 'ai_queue_assignment.override'];
const ctx = (t: string, b = 'b1', perms = PERMS): QueueAssignmentContext => ({ tenantId: t, branchId: b, userId: 'u1', role: 'OWNER', permissions: perms });

function inputs(over: any = {}) {
  return {
    entry: { queueEntryId: 'q1', branchId: 'b1', version: 1, requiredCategories: ['nails'], serviceDurationMinutes: 30, requestedTechnicianId: null, ...over.entry },
    candidates: over.candidates ?? [
      { technicianId: 't1', name: 'Kim', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 0, isPrevious: false },
      { technicianId: 't2', name: 'Lee', branchId: 'b1', available: true, skills: ['hair'], activeAssignments: 0, isPrevious: false }, // wrong skill
      { technicianId: 't3', name: 'Ana', branchId: 'b1', available: true, skills: ['nails'], activeAssignments: 2, maxConcurrent: 3, isPrevious: false },
    ],
  };
}

describe('QueueAssignmentService', () => {
  function make(over: any = {}, assign: InMemoryAssignExecution | undefined = new InMemoryAssignExecution().seed('q1')) {
    const repo = new InMemoryQueueAssignmentRepository();
    const data = new InMemoryQueueDataAdapter({ q1: inputs(over) });
    const emitter = { emit: vi.fn() };
    const svc = new QueueAssignmentService(repo, data, new InMemoryQueueAssignmentEntitlement(() => true), emitter, { assign });
    return { svc, repo, emitter, assign: assign! };
  }

  it('recommends the eligible skilled tech, excludes the wrong-skill one, persists + emits', async () => {
    const { svc, emitter } = make();
    const env = await svc.recommend(ctx('A'), 'q1');
    expect(env.recommended?.technicianId).toBe('t1');
    expect(env.alternates.find((a) => a.technicianId === 't2')).toBeUndefined(); // ineligible excluded
    expect(env.recommendationId).toBeTruthy();
    expect(emitter.emit).toHaveBeenCalledWith(expect.anything(), 'queue.assignment_recommended', expect.objectContaining({ queueEntryId: 'q1' }));
  });

  it('requires the recommend permission', async () => {
    const { svc } = make();
    await expect(svc.recommend(ctx('A', 'b1', ['ai_queue_assignment.view']), 'q1')).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
  });

  it('is disabled when not entitled', async () => {
    const repo = new InMemoryQueueAssignmentRepository();
    const svc = new QueueAssignmentService(repo, new InMemoryQueueDataAdapter({ q1: inputs() }), new InMemoryQueueAssignmentEntitlement(() => false));
    await expect(svc.recommend(ctx('A'), 'q1')).rejects.toBeInstanceOf(QueueAssignmentDisabledError);
  });

  it('no eligible technician → conflicts summary + no recommendation', async () => {
    const { svc } = make({ candidates: [{ technicianId: 't2', name: 'Lee', branchId: 'b1', available: true, skills: ['hair'], activeAssignments: 0, isPrevious: false }] });
    const env = await svc.recommend(ctx('A'), 'q1');
    expect(env.recommended).toBeNull();
    expect(env.requiredAction).toBe('no_eligible_technician');
    expect(env.conflicts[0]).toMatch(/missing required skill/);
  });

  it('bug 14: an empty branch is a plain 400 "choose a location" — never "" into a UUID column', async () => {
    const { svc } = make();
    await expect(svc.recommend(ctx('A', ''), 'q1')).rejects.toThrow(/Choose a location/);
    await expect(svc.recommend(ctx('A', '   '), 'q1')).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    await expect(svc.runAutoAssignment(ctx('A', ''), { system: true })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    const e = (() => { try { ctxFrom({ ctx: { tenantId: 'A', userId: 'u1', role: 'OWNER', branchId: '' } }); return null; } catch (x) { return x as HttpException; } })();
    expect(e).toBeInstanceOf(HttpException);
    expect(e!.getStatus()).toBe(400);
    expect(String(e!.message)).toMatch(/Choose a location/);
  });

  describe('decisions act through the queue', () => {
    it('accepted → assigns the suggested technician with the version + technician the suggestion saw; row applied; event + realtime', async () => {
      const { svc, repo, emitter, assign } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      const res = await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted' });
      expect(res.applied).toBe(true);
      expect(res.decision).toMatchObject({ decision: 'accepted', chosenTechnicianId: 't1', applied: true, previousTechnicianId: null });
      expect(res.queueItem).toMatchObject({ assignedTechnicianId: 't1', version: 2 });
      expect(assign.calls).toHaveLength(1);
      expect(assign.calls[0].opts).toMatchObject({ technicianId: 't1', expectedTechnicianId: null, expectedVersion: 1, source: 'ai_suggestion' });
      expect(assign.calls[0].opts.idempotencyKey).toBeTruthy();
      expect(repo.events).toEqual([expect.objectContaining({ type: 'decided', payload: expect.objectContaining({ decision: 'accepted', technicianId: 't1', applied: true }) })]);
      expect(emitter.emit).toHaveBeenCalledWith(expect.anything(), 'queue.assignment_decided', expect.objectContaining({ decision: 'accepted', applied: true, technicianId: 't1' }));
    });

    it('bug 8: the realtime emitter delivers queue.assignment_decided (it used to drop every decision event)', () => {
      const realtime = { toTenant: vi.fn() } as any;
      new RealtimeAssignmentEmitter(realtime).emit(ctx('A'), 'queue.assignment_decided', { decision: 'accepted' });
      expect(realtime.toTenant).toHaveBeenCalledWith({ tenantId: 'A', branchId: 'b1' }, EVENTS.queueAssignmentDecided, { decision: 'accepted' });
      for (const n of ['queue.assignment_settings_changed', 'queue.auto_assigned', 'queue.auto_assignment_killed']) expect(RealtimeAssignmentEmitter.WIRE[n]).toBeTruthy();
    });

    it('overridden needs the override permission + a technician, and assigns as a manager override', async () => {
      const { svc, assign } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      await expect(svc.decide(ctx('A', 'b1', ['ai_queue_assignment.view', 'ai_queue_assignment.assign']), env.recommendationId, { decision: 'overridden', chosenTechnicianId: 't3' })).rejects.toBeInstanceOf(QueueAssignmentForbiddenError);
      await expect(svc.decide(ctx('A'), env.recommendationId, { decision: 'overridden' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
      const res = await svc.decide(ctx('A'), env.recommendationId, { decision: 'overridden', chosenTechnicianId: 't3', reason: 'regular client' });
      expect(res.applied).toBe(true);
      expect(assign.calls[0].opts).toMatchObject({ technicianId: 't3', managerOverride: true, source: 'ai_suggestion' });
    });

    it('accepted with a different technician is refused (that is an override)', async () => {
      const { svc } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      await expect(svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted', chosenTechnicianId: 't3' })).rejects.toThrow(/overridden/);
    });

    it('rejected needs a reason, records the feedback code, assigns nothing', async () => {
      const { svc, assign, repo } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      await expect(svc.decide(ctx('A'), env.recommendationId, { decision: 'rejected' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
      await expect(svc.decide(ctx('A'), env.recommendationId, { decision: 'rejected', reason: 'x', feedbackCode: 'Bad Code!' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
      const res = await svc.decide(ctx('A'), env.recommendationId, { decision: 'rejected', reason: 'she prefers Ana', feedbackCode: 'customer_preference' });
      expect(res).toMatchObject({ applied: false, decision: { decision: 'rejected', feedbackCode: 'customer_preference', applied: false } });
      expect(assign.calls).toHaveLength(0);
      expect(repo.events[0].payload).toMatchObject({ decision: 'rejected', applied: false });
    });

    it('a staff member cannot post the auto-run\'s own decision type', async () => {
      const { svc } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      await expect(svc.decide(ctx('A'), env.recommendationId, { decision: 'auto_assigned' as any })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    });

    it('a guest changed since the suggestion → 409 stale, nothing recorded, no event', async () => {
      const { svc, assign, repo, emitter } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      assign.touch('q1', 't3');                           // another device assigned Ana meanwhile (version 1 → 2)
      const err = await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted' }).catch((e) => e);
      expect(err).toBeInstanceOf(QueueAssignmentStaleError);
      expect(err.currentTechnicianId).toBe('t3');
      expect(assign.calls).toHaveLength(0);
      expect(await repo.listDecisions(ctx('A'), 'q1')).toHaveLength(0);
      expect(repo.events).toHaveLength(0);
      expect(emitter.emit).not.toHaveBeenCalledWith(expect.anything(), 'queue.assignment_decided', expect.anything());
    });

    it('the same idempotency key replays: one assignment, one row, the first answer', async () => {
      const { svc, assign, repo } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      const a = await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted', idempotencyKey: 'tap-1' });
      const b = await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted', idempotencyKey: 'tap-1' });
      expect(b.replayed).toBe(true);
      expect(b.decision.id).toBe(a.decision.id);
      expect(b.applied).toBe(true);
      expect(assign.calls).toHaveLength(1);
      expect(await repo.listDecisions(ctx('A'), 'q1')).toHaveLength(1);
      expect(repo.events).toHaveLength(1);
    });

    it('a double click without a key replays too (one recommendation, one outcome)', async () => {
      const { svc, assign } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted' });
      const again = await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted' });
      expect(again.replayed).toBe(true);
      expect(assign.calls).toHaveLength(1);
    });

    it('tenant-isolated; listDecisions sees only its own', async () => {
      const { svc } = make();
      const env = await svc.recommend(ctx('A'), 'q1');
      await expect(svc.decide(ctx('B'), env.recommendationId, { decision: 'accepted' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
      await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted' });
      expect((await svc.listDecisions(ctx('A'), 'q1')).length).toBe(1);
      expect((await svc.listDecisions(ctx('B'), 'q1')).length).toBe(0);
    });

    it('the per-customer panel: entry, latest suggestion, decisions, lock', async () => {
      const { svc } = make({ entry: { lock: { technicianId: 't1', reason: 'regular' } } });
      expect((await svc.panel(ctx('A'), 'q1')).recommendation).toBeNull();
      const env = await svc.recommend(ctx('A'), 'q1');
      await svc.decide(ctx('A'), env.recommendationId, { decision: 'accepted' });
      const p = await svc.panel(ctx('A'), 'q1');
      expect(p.entry).toMatchObject({ queueEntryId: 'q1', version: 1 });
      expect(p.recommendation?.recommendationId).toBe(env.recommendationId);
      expect(p.decisions).toHaveLength(1);
      expect(p.lock).toEqual({ technicianId: 't1', reason: 'regular' });
      await expect(svc.panel(ctx('A'), 'nope')).rejects.toBeInstanceOf(QueueAssignmentValidationError);
    });

    it('round 2: the panel lists every candidate at the top level, with eligibility and the plain reasons', async () => {
      const { svc } = make();
      const p: any = await svc.panel(ctx('A'), 'q1');
      expect(p.candidates.map((c: any) => c.technicianId)).toEqual(['t1', 't2', 't3']);
      expect(p.candidates.find((c: any) => c.technicianId === 't1')).toMatchObject({ name: 'Kim', eligible: true, reasons: [], activeAssignments: 0 });
      expect(p.candidates.find((c: any) => c.technicianId === 't2')).toMatchObject({ eligible: false, reasons: ['missing required skill'] });
      expect(p.candidates.find((c: any) => c.technicianId === 't3')).toMatchObject({ eligible: true, maxConcurrent: 3, activeAssignments: 2 });
      expect(typeof p.candidates.find((c: any) => c.technicianId === 't1').matchScore).toBe('number');
    });
  });
});

// ── PGlite: the decision → the REAL QueueService + Kysely repository (round 2) ──────────────────────────────────
// End to end on every migration: the engine reads QueueService.assignmentInputs, the decision assigns through
// QueueService.assignTechnician — its version bump, its status-history row (migration 525) with source 'ai_suggestion',
// its idempotency, its stale-version refusal. The decision row + QUEUE_ASSIGNMENT_DECIDED are in the same SQL database.
describe('decision → assignment through the REAL QueueService (PGlite, every migration)', () => {
  const T = 'aa6b0000-0000-4000-8000-000000000001', T2 = 'aa6b0000-0000-4000-8000-000000000002';
  const B = 'aa6b0000-0000-4000-8000-0000000000b1';
  const CAT = 'aa6b0000-0000-4000-8000-0000000000a1', SVC = 'aa6b0000-0000-4000-8000-0000000000a2';
  const TA = 'aa6b0000-0000-4000-8000-0000000000c1', TB = 'aa6b0000-0000-4000-8000-0000000000c3';
  const USER = 'aa6b0000-0000-4000-8000-0000000000e1';
  const QPERMS = ['pos.queue.view', 'pos.queue.assign_technician', ...PERMS];
  const c = (t = T): QueueAssignmentContext => ({ tenantId: t, branchId: B, userId: USER, role: 'MANAGER', permissions: QPERMS });
  let pg: any; let db: any; let repo: KyselyQueueAssignmentRepository; let queue: QueueService; let svc: QueueAssignmentService;
  const one = async (q: string) => (await pg.query(q)).rows[0];
  // each test starts with free technicians (capacity 1 by default): earlier guests are finished first
  const guest = async (): Promise<string> => (await pg.query(`UPDATE pos_queue_items SET status = 'completed' WHERE tenant_id = '${T}' AND status NOT IN ('completed', 'cancelled')`), await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status, source, priority, requested_services)
    VALUES ('${T}', '${B}', 'Guest', 'waiting', 'walk_in', 'normal', '[{"serviceId":"${SVC}","serviceName":"Gel Manicure","estimatedDurationMinutes":45,"priceCents":4500}]') RETURNING id`)).id;

  beforeAll(async () => {
    pg = await migratedPglite(); db = kyselyFor(pg);
    await pg.exec(`
      INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'P6B Salon', 'P6B Salon', 'p6b-salon', 'P6B01', 'active');
      INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
      INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${USER}', '${T}', 'Manager', 'active', 'MANAGER');
      INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
      INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 45, 4500);
      INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active'), ('${TB}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active');
      INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${TA}', '${SVC}'), ('${T}', '${B}', '${TB}', '${SVC}');
    `);
    queue = new QueueService(new KyselyQueueRepository(db, new OutboxWriter()));
    repo = new KyselyQueueAssignmentRepository(db, new OutboxWriter());
    svc = new QueueAssignmentService(repo, new QueueServiceDataAdapter(queue), new InMemoryQueueAssignmentEntitlement(() => true), undefined,
      { assign: new QueueAssignExecutionAdapter(queue), scan: new QueueScanAdapter(queue) });
  }, 120000);

  it('the engine reads the real inputs; accepted assigns through the queue (version 1 → 2, history source ai_suggestion), row applied, event in the outbox', async () => {
    const id = await guest();
    const env = await svc.recommend(c(), id);
    expect([TA, TB]).toContain(env.recommended?.technicianId);
    expect(env.queueVersion).toBe(1);
    expect((await one(`SELECT config_version, queue_version, source FROM queue_assignment_recommendations WHERE id = '${env.recommendationId}'`)))
      .toMatchObject({ config_version: '0.0', queue_version: 1, source: 'staff' });
    const res = await svc.decide(c(), env.recommendationId, { decision: 'accepted', idempotencyKey: 'k-accept-1' });
    expect(res.applied).toBe(true);
    expect(res.queueItem).toMatchObject({ assignedTechnicianId: env.recommended!.technicianId, version: 2 });
    expect(await one(`SELECT status, assigned_technician_id, version FROM pos_queue_items WHERE id = '${id}'`)).toMatchObject({ status: 'assigned', assigned_technician_id: env.recommended!.technicianId, version: 2 });
    const hist = (await pg.query(`SELECT version, action, source, to_technician, actor_id, idempotency_key FROM pos_queue_status_history WHERE queue_item_id = '${id}' ORDER BY version`)).rows;
    expect(hist.at(-1)).toMatchObject({ version: 2, action: 'assign', source: 'ai_suggestion', to_technician: env.recommended!.technicianId, actor_id: USER, idempotency_key: 'aqd:k-accept-1' });
    expect(await one(`SELECT decision, applied, idempotency_key, chosen_technician FROM queue_assignment_decisions WHERE recommendation_id = '${env.recommendationId}'`))
      .toEqual({ decision: 'accepted', applied: true, idempotency_key: 'k-accept-1', chosen_technician: env.recommended!.technicianId });
    const ev = (await pg.query(`SELECT aggregate_id, payload_json FROM outbox_events WHERE tenant_id = '${T}' AND event_type = 'queue.assignment_decided'`)).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].aggregate_id).toBe(id);
    expect(typeof ev[0].payload_json === 'string' ? JSON.parse(ev[0].payload_json) : ev[0].payload_json).toMatchObject({ decision: 'accepted', applied: true });

    // idempotent replay: the same key → no second assignment, history row, decision row or event
    const again = await svc.decide(c(), env.recommendationId, { decision: 'accepted', idempotencyKey: 'k-accept-1' });
    expect(again).toMatchObject({ replayed: true, applied: true, decision: { id: res.decision.id } });
    expect(again.queueItem).toMatchObject({ version: 2 });
    expect((await one(`SELECT count(*)::int AS n FROM pos_queue_status_history WHERE queue_item_id = '${id}'`)).n).toBe(hist.length);
    expect((await one(`SELECT count(*)::int AS n FROM queue_assignment_decisions WHERE tenant_id = '${T}'`)).n).toBe(1);
    expect((await one(`SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id = '${T}' AND event_type = 'queue.assignment_decided'`)).n).toBe(1);
  });

  it('a lost decision row is safe to retry: the queue replays its own idempotent assignment, the row is then written once', async () => {
    const id = await guest();
    const env = await svc.recommend(c(), id);
    const tech = env.recommended!.technicianId;
    // the assignment happened (as if the process died before the decision row was written)…
    await queue.assignTechnician(c() as any, id, { technicianId: tech, expectedTechnicianId: null, expectedVersion: 1, source: 'ai_suggestion', idempotencyKey: 'aqd:k-retry-1' } as any);
    // …the client retries with the same key: no conflict, no second write, the decision is recorded applied
    const res = await svc.decide(c(), env.recommendationId, { decision: 'accepted', idempotencyKey: 'k-retry-1' });
    expect(res).toMatchObject({ applied: true, queueItem: { assignedTechnicianId: tech, version: 2 } });
    expect((await one(`SELECT count(*)::int AS n FROM pos_queue_status_history WHERE queue_item_id = '${id}' AND source = 'ai_suggestion'`)).n).toBe(1);
  });

  it('a stale version is refused: staff assigned someone else after the suggestion → 409, the staff choice stands, nothing recorded', async () => {
    const id = await guest();
    const env = await svc.recommend(c(), id);
    const other = env.recommended!.technicianId === TA ? TB : TA;
    await queue.assignTechnician(c() as any, id, { technicianId: other, expectedTechnicianId: null });   // the other device
    const err = await svc.decide(c(), env.recommendationId, { decision: 'accepted' }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueAssignmentStaleError);
    expect(err.currentTechnicianId).toBe(other);
    expect(await one(`SELECT assigned_technician_id, version FROM pos_queue_items WHERE id = '${id}'`)).toMatchObject({ assigned_technician_id: other, version: 2 });
    expect((await one(`SELECT count(*)::int AS n FROM queue_assignment_decisions WHERE recommendation_id = '${env.recommendationId}'`)).n).toBe(0);
  });

  it('a stale VERSION alone (same technician, the guest changed) is refused too', async () => {
    const id = await guest();
    const env = await svc.recommend(c(), id);
    await pg.query(`UPDATE pos_queue_items SET priority = 'vip' WHERE id = '${id}'`);   // any transition bumps the version (migration 525)
    expect(await svc.decide(c(), env.recommendationId, { decision: 'accepted' }).catch((e) => e)).toBeInstanceOf(QueueAssignmentStaleError);
    expect(await one(`SELECT assigned_technician_id FROM pos_queue_items WHERE id = '${id}'`)).toMatchObject({ assigned_technician_id: null });
  });

  it('the panel lists the real candidates with eligibility', async () => {
    const id = await guest();
    const p = await svc.panel(c(), id);
    expect(p.entry).toMatchObject({ queueEntryId: id, version: 1 });
    expect(p.candidates.map((x) => x.technicianId).sort()).toEqual([TA, TB].sort());
    expect(p.candidates.every((x) => x.eligible)).toBe(true);
  });

  it('the decision row and its event commit together: a duplicate key at the database writes neither twice', async () => {
    const id = await guest();
    const first = await repo.recordDecision(c(), { recommendationId: '', queueEntryId: id, decision: 'kept_unassigned', chosenTechnicianId: null, reason: null, decidedBy: 'u', idempotencyKey: 'twin-1' },
      { type: 'decided', actorId: null, payload: { queueItemId: id } });
    const twin = await repo.recordDecision(c(), { recommendationId: '', queueEntryId: id, decision: 'kept_unassigned', chosenTechnicianId: null, reason: null, decidedBy: 'u', idempotencyKey: 'twin-1' },
      { type: 'decided', actorId: null, payload: { queueItemId: id } });
    expect(twin.replayed).toBe(true);
    expect(twin.id).toBe(first.id);
    expect((await one(`SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id = '${T}' AND payload_json::text LIKE '%${first.id}%'`)).n).toBe(1);
  });

  it('tenant isolation: another tenant cannot read or decide the recommendation', async () => {
    const id = await guest();
    const env = await svc.recommend(c(), id);
    expect(await repo.getRecommendation(c(T2), env.recommendationId)).toBeNull();
    expect(await repo.getRecommendation(c(), 'not-a-uuid')).toBeNull();
    await expect(svc.decide(c(T2), env.recommendationId, { decision: 'accepted' })).rejects.toBeInstanceOf(QueueAssignmentValidationError);
  });
});
