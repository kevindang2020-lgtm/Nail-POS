// ai-queue-assignment-adapters.vitest.spec.ts — BUILD_PLAN Phase 6: the production adapters against QueueService's
// contract shape (a structural fake — the queue domain is Agent A's), and the global QUEUE_RECOMMENDER binding in Nest.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { QueueAssignExecutionAdapter, QueueScanAdapter, QueueServiceDataAdapter, TechAppointmentsAdapter, queueCtx } from './ai-queue-assignment.adapters';
import { QueueRecommenderModule } from './ai-queue-assignment-recommender';
import { QUEUE_RECOMMENDER_TOKEN } from './ai-queue-assignment.tokens';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

const ctx: QueueAssignmentContext = { tenantId: 'A', branchId: 'b1', userId: 'u1', role: 'FRONT_DESK', permissions: ['ai_queue_assignment.view'] };

class QueueAssignmentConflict extends Error { readonly code = 'VERSION_CONFLICT'; constructor(public currentTechnicianId: string | null) { super('changed'); this.name = 'QueueAssignmentConflict'; } }

describe('QueueAssignExecutionAdapter → QueueService.assignTechnician', () => {
  it('passes the expectation, version, source, idempotency key and override through', async () => {
    const q: any = { assignTechnician: vi.fn(async () => ({ queueItemId: 'q1', assignedTechnicianId: 't1', version: 5 })) };
    const r = await new QueueAssignExecutionAdapter(q).assign(ctx, 'q1', { technicianId: 't1', expectedTechnicianId: null, expectedVersion: 4, source: 'ai_suggestion', idempotencyKey: 'k1', managerOverride: true, reason: 'x' });
    expect(r).toEqual({ ok: true, item: { queueItemId: 'q1', assignedTechnicianId: 't1', version: 5 } });
    expect(q.assignTechnician).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', branchId: 'b1', userId: 'u1' }), 'q1',
      { technicianId: 't1', expectedTechnicianId: null, expectedVersion: 4, managerOverride: true, source: 'ai_suggestion', idempotencyKey: 'k1', reason: 'x' });
  });
  it('always sends expectedTechnicianId (null = "nobody yet") — omitting it let the queue overwrite (bug 5)', async () => {
    const q: any = { assignTechnician: vi.fn(async () => ({})) };
    await new QueueAssignExecutionAdapter(q).assign(ctx, 'q1', { technicianId: 't1', expectedTechnicianId: null, source: 'auto_assign' });
    expect(q.assignTechnician.mock.calls[0][2]).toHaveProperty('expectedTechnicianId', null);
  });
  it('the queue\'s conflict comes back as a conflict (never a generic failure)', async () => {
    const q: any = { assignTechnician: vi.fn(async () => { throw new QueueAssignmentConflict('t7'); }) };
    expect(await new QueueAssignExecutionAdapter(q).assign(ctx, 'q1', { technicianId: 't1', expectedTechnicianId: null, source: 'auto_assign' }))
      .toMatchObject({ ok: false, conflict: true, currentTechnicianId: 't7' });
    const v: any = { assignTechnician: vi.fn(async () => { throw new Error('Technician is not available — manager override required'); }) };
    expect(await new QueueAssignExecutionAdapter(v).assign(ctx, 'q1', { technicianId: 't1', expectedTechnicianId: null, source: 'staff' }))
      .toEqual({ ok: false, error: 'Technician is not available — manager override required' });
  });
  it('a system run asks the queue as the system (no user permission check at the queue)', async () => {
    const q: any = { assignTechnician: vi.fn(async () => ({})), detail: vi.fn(async () => ({ status: 'waiting', assignedTechnicianId: null, version: 3 })) };
    const sys = { ...ctx, userId: '00000000-0000-0000-0000-000000000000', role: 'SYSTEM', permissions: [] };
    await new QueueAssignExecutionAdapter(q).assign(sys, 'q1', { technicianId: 't1', expectedTechnicianId: null, source: 'auto_assign', system: true });
    // BUILD_PLAN Phase 9: the named worker principal with exactly its declared grant (what pos.queue.view /
    // pos.queue.assign_technician resolve to)
    expect(q.assignTechnician.mock.calls[0][0]).toMatchObject({ system: true, role: 'SYSTEM', actor: 'worker:ai-queue-auto-assign', worker: 'ai-queue-auto-assign', permissions: ['queue.view', 'queue.manage'] });
    expect(queueCtx(ctx)).not.toHaveProperty('system');
    expect(await new QueueAssignExecutionAdapter(q).current(ctx, 'q1')).toMatchObject({ status: 'waiting', assignedTechnicianId: null, version: 3 });
  });
});

describe('scan / inputs / appointments adapters', () => {
  it('scan passes every contract field through (C detects on them)', async () => {
    const row = { queueEntryId: 'q1', version: 2, waitMinutes: 7, status: 'in_service', assignedTechnicianId: 't1', requestedTechnicianId: 't1', isAppointment: true, appointmentStartAt: 'x', lateMinutes: 3,
      isVip: false, groupId: null, serviceIds: ['s1'], startedAt: 'y', expectedDurationMinutes: 45, updatedAt: 'z', lock: null };
    const q: any = { scanEntries: vi.fn(async () => [row]) };
    expect(await new QueueScanAdapter(q).getScanEntries(ctx)).toEqual([row]);
  });
  it('inputs: not found at the queue → null (a 400 "not found", never a 500)', async () => {
    const q: any = { assignmentInputs: vi.fn(async () => { throw new Error('Queue item not found'); }) };
    expect(await new QueueServiceDataAdapter(q).getInputs(ctx, 'nope')).toBeNull();
  });
  it('appointments: the queue domain resolves the branch day and each start (startAt) — the adapter reads it, never parses HH:MM (bug 2)', async () => {
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    const appts: any = { appointments: vi.fn(async () => [
      { appointmentId: 'a1', technicianId: 't1', status: 'confirmed', startTime: '23:59', startAt: soon },
      { appointmentId: 'a2', technicianId: 't2', status: 'confirmed', date: '2026-10-07', startTime: '14:30' },   // no startAt → no signal, never a guess
    ]) };
    const up = await new TechAppointmentsAdapter(appts).getUpcoming(ctx);
    expect(appts.appointments.mock.calls[0][1]).toEqual({});   // the default board day is the BRANCH's (A's repository)
    expect(up.t1).toMatchObject({ appointmentId: 'a1', nextAppointmentInMinutes: 20 });
    expect(up.t2).toBeUndefined();
  });
});

describe('QUEUE_RECOMMENDER is bound globally (Nest)', () => {
  it('a provider in ANOTHER module (the queue) receives the engine recommender, resolved lazily', async () => {
    const svc = { suggest: vi.fn(async () => ({ q1: { technicianId: 't1', name: 'Kim', confidence: 0.8, requiredAction: 'assignable', reasons: [] } })), balance: vi.fn(async () => ({ proposals: [], unassignable: [] })) };
    class Board { constructor(public rec: any) {} }
    @Module({ providers: [{ provide: Board, useFactory: (rec: any) => new Board(rec), inject: [{ token: QUEUE_RECOMMENDER_TOKEN, optional: true }] }], exports: [Board] })
    class FakeQueueModule {}
    @Module({ imports: [QueueRecommenderModule, FakeQueueModule], providers: [{ provide: QueueAssignmentService, useValue: svc }] })
    class Root {}
    const app = await NestFactory.createApplicationContext(Root, { logger: false });
    try {
      const board = app.get(Board);
      expect(board.rec).toBeTruthy();
      expect(await board.rec.suggest(ctx, ['q1'])).toEqual({ q1: expect.objectContaining({ technicianId: 't1' }) });
      expect(svc.suggest).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', branchId: 'b1' }), ['q1']);
      expect(await board.rec.balance(ctx)).toEqual({ proposals: [], unassignable: [] });
    } finally { await app.close(); }
  });
});
