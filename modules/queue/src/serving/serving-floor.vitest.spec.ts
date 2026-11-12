// serving-floor.vitest.spec — Serving mandate (Oct 28 2026) §22–§39, §44–§57, §62, §72, §82–§85, §91–§104.
// Start / Mark Ready / Send are ONE business effect however often or from however many stations they are asked for;
// stage moves follow the canonical flow and invalid jumps are refused; an add-on is priced from the catalog, owned by
// the technician who performs it, written once per logical addition and moves the estimate; partial completion never
// completes the visit; KPIs with no population are null; 200 technicians are a capped panel with counts; AI and Auto
// Balance only recommend; Send Update / Staff Alert use the notification domains; another salon sees nothing. Runs on
// the in-memory adapter (the Kysely compare-and-set / unique-key SQL is verified on PostgreSQL 16 — see the status doc).
import { describe, it, expect } from 'vitest';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, buildFloorProjection, type SVTicket } from './serving.repository';
import {
  servingNextActions, canServingMove, servingTechnicianLoad, buildBalanceSuggestions, buildServingInsights, addOnLineIdFor,
  DEFAULT_SERVING_SETTINGS, SERVING_KPI_DEFINITIONS, computeOnTimeCompletionPercent, type ServingStaffRow,
} from './serving.dto';
import { createHash } from 'node:crypto';

const PERMS = ['pos.serving.view', 'pos.serving.start', 'pos.serving.pause_resume', 'pos.serving.update_notes', 'pos.serving.edit_services', 'pos.serving.assign_technician', 'pos.serving.assign_helper', 'pos.serving.mark_done', 'pos.serving.send_to_service_done', 'pos.serving.report_delay', 'pos.service_done.view', 'pos.communications.send'];
const ctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_mgr', role: 'MANAGER', permissions: PERMS } as any;
const other = { ...ctx, tenantId: 'other_salon', userId: 'u_x' } as any;
const desk = { ...ctx, userId: 'u_desk', role: 'RECEPTIONIST', permissions: ['pos.serving.view', 'pos.serving.start'] } as any;
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.name; } };
const setup = () => { const repo = new InMemoryServingRepository(); return { repo, svc: new ServingService(repo as any) }; };
const revs = async (repo: InMemoryServingRepository, id: string, action: string) => (await repo.listRevisions(ctx, id)).filter((r) => r.action === action).length;
// seed: sv_4001 in service (Mia, + Gel add-on) · sv_4002 paused · sv_4003 not started (Leo) · sv_4004 delayed · sv_4005 in service

describe('Start Service is idempotent and concurrency-safe (§24–§26, §101, §139)', () => {
  it('START ×3 → one start, one revision, one server start time', async () => {
    const { repo, svc } = setup();
    const a = await svc.start(ctx, 'sv_4003'); const b = await svc.start(ctx, 'sv_4003'); const c = await svc.start(ctx, 'sv_4003');
    expect([a.duplicate, b.duplicate, c.duplicate]).toEqual([undefined, true, true]);
    expect(a.status).toBe('in_service'); expect(b.startedAt).toBe(a.startedAt); expect(c.startedAt).toBe(a.startedAt);
    expect(await revs(repo, 'sv_4003', 'service_started')).toBe(1);
    expect(svc.auditLog().filter((x) => x.actionType === 'pos_serving_started')).toHaveLength(1);
  });
  it('two stations at the same instant → one start, the other answers duplicate', async () => {
    const { repo, svc } = setup();
    const [a, b] = await Promise.all([svc.start(ctx, 'sv_4003'), svc.start({ ...ctx, userId: 'u_desk2' }, 'sv_4003')]);
    expect([!!a.duplicate, !!b.duplicate].sort()).toEqual([false, true]);
    expect(await revs(repo, 'sv_4003', 'service_started')).toBe(1);
  });
  it('a completed visit cannot be started again (no invalid terminal restart)', async () => {
    const { svc } = setup();
    await svc.markDone(ctx, 'sv_4001');
    expect(await code(svc.start(ctx, 'sv_4001'))).toBe('SERVICE_START_STATE_INVALID');
  });
  it('another salon cannot start this salon\'s guest (§96, §144)', async () => {
    const { repo, svc } = setup();
    expect(await code(svc.start(other, 'sv_4003'))).toBe('TICKET_NOT_FOUND');
    expect((await repo.ticket(ctx, 'sv_4003'))!.status).toBe('not_started');
  });
});

describe('canonical service flow — legal moves only (§22, §30–§31, §36)', () => {
  it('Move Stage offers only the legal next states for the status', () => {
    expect(servingNextActions('not_started', DEFAULT_SERVING_SETTINGS)).toEqual(['start']);
    expect(servingNextActions('in_service', DEFAULT_SERVING_SETTINGS)).toEqual(['pause', 'report_delay', 'mark_ready', 'send_to_service_done']);
    expect(servingNextActions('paused', DEFAULT_SERVING_SETTINGS)).toEqual(['resume', 'mark_ready', 'send_to_service_done']);
    expect(servingNextActions('sent_to_service_done', DEFAULT_SERVING_SETTINGS)).toEqual([]);
    expect(servingNextActions('in_service', { allowPauseResume: false })).not.toContain('pause');
  });
  it('not started → Service Done is not a move; a handed-off visit returns only through Reopen', () => {
    expect(canServingMove('not_started', 'completed')).toBe(false);
    expect(canServingMove('not_started', 'sent_to_service_done')).toBe(false);
    expect(canServingMove('in_service', 'completed')).toBe(true);
    expect(canServingMove('sent_to_service_done', 'completed')).toBe(false);
  });
  it('the server refuses Mark Ready / Send for a guest never started', async () => {
    const { repo, svc } = setup();
    expect(await code(svc.markDone(ctx, 'sv_4003'))).toBe('CANNOT_MARK_DONE');
    expect(await code(svc.sendToServiceDone(ctx, 'sv_4003'))).toBe('CANNOT_SEND_TO_SERVICE_DONE');
    expect((await repo.ticket(ctx, 'sv_4003'))!.status).toBe('not_started');
  });
  it('the floor rows carry the actions this USER may take (permissions applied)', async () => {
    const { svc } = setup();
    const rows = (await svc.getState(desk)).tickets.items;
    expect(rows.find((r) => r.ticketId === 'sv_4003')!.allowedActions).toEqual(['start']);
    expect(rows.find((r) => r.ticketId === 'sv_4001')!.allowedActions).toEqual([]);   // no mark_done / pause permission
    const mgr = (await svc.getState(ctx)).tickets.items.find((r) => r.ticketId === 'sv_4001')!;
    expect(mgr.allowedActions).toContain('mark_ready');
  });
});

describe('Mark Ready hands off to Service Done exactly once (§35–§38, §104, §141–§142)', () => {
  it('MARK READY ×2 → one transition, one revision; Mark Ready is not checkout', async () => {
    const { repo, svc } = setup();
    await svc.markDone(ctx, 'sv_4001'); const again: any = await svc.markDone(ctx, 'sv_4001');
    expect(again.duplicate).toBe(true);
    expect(await revs(repo, 'sv_4001', 'service_marked_done')).toBe(1);
    expect((await repo.ticket(ctx, 'sv_4001'))!.status).toBe('completed');   // Service Done, not checkout
  });
  it('two stations Mark Ready at once → one transition', async () => {
    const { repo, svc } = setup();
    await Promise.all([svc.markDone(ctx, 'sv_4005'), svc.markDone({ ...ctx, userId: 'u_b' }, 'sv_4005')]);
    expect(await revs(repo, 'sv_4005', 'service_marked_done')).toBe(1);
  });
  it('Send to Service Done ×2 (or from two stations) → one handoff, the same visit, no new line', async () => {
    const { repo, svc } = setup();
    const before = (await repo.ticket(ctx, 'sv_4001'))!.lines.length;
    const [a, b] = await Promise.all([svc.sendToServiceDone(ctx, 'sv_4001'), svc.sendToServiceDone({ ...ctx, userId: 'u_b' }, 'sv_4001')]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(await revs(repo, 'sv_4001', 'service_done_locked')).toBe(1);
    expect((await repo.ticket(ctx, 'sv_4001'))!.lines.length).toBe(before);
    expect(a.serviceDoneTicketId).toBe('sv_4001');   // the same canonical visit moves — no new visit
  });
});

describe('add-on / upsell (§46–§53, §93, §95, §103, §138)', () => {
  it('priced from the catalog, owned by the technician who performs it, estimate + revenue move', async () => {
    const { repo, svc } = setup();
    const est0 = (await repo.ticket(ctx, 'sv_4005'))!.estimatedDurationMinutes;
    const st0 = await svc.getState(ctx);
    const d = await svc.addService(ctx, 'sv_4005', { serviceId: 'svc_art', technicianId: 'tech_mia', clientRequestId: 'rq-1' } as any);
    const line = d.services.find((l) => l.serviceName === 'Nail Art')!;
    expect(line.priceCents).toBe(2000); expect(line.isAddOn).toBe(true); expect(line.technicianName).toBe('Mia');
    expect((await repo.ticket(ctx, 'sv_4005'))!.estimatedDurationMinutes).toBe(est0 + 20);   // §95 the delay rule reads the new estimate
    const st1 = await svc.getState(ctx);
    expect(st1.kpis.addOnRevenueCents).toBe(st0.kpis.addOnRevenueCents + 2000);
    expect(st1.analytics.addOnMix.some((m) => m.label === 'Nail Art')).toBe(true);
    expect(st1.analytics.potentialRevenue.addOnsPendingCents).toBe(st0.analytics.potentialRevenue.addOnsPendingCents + 2000);
  });
  it('the same logical add-on submitted twice / from two terminals → ONE line', async () => {
    const { repo, svc } = setup();
    const n0 = (await repo.ticket(ctx, 'sv_4005'))!.lines.length;
    const [a, b] = await Promise.all([
      svc.addService(ctx, 'sv_4005', { serviceId: 'svc_gel', clientRequestId: 'tap-77' } as any),
      svc.addService({ ...ctx, userId: 'u_b' }, 'sv_4005', { serviceId: 'svc_gel', clientRequestId: 'tap-77' } as any),
    ]);
    expect([!!(a as any).duplicate, !!(b as any).duplicate].sort()).toEqual([false, true]);
    expect((await repo.ticket(ctx, 'sv_4005'))!.lines.length).toBe(n0 + 1);
    expect(await revs(repo, 'sv_4005', 'service_added')).toBe(1);
  });
  it('a client cannot name its own price without a manager override', async () => {
    const { svc } = setup();
    expect(await code(svc.addService(ctx, 'sv_4005', { serviceId: 'svc_gel', priceOverrideCents: 1 } as any))).toBe('ForbiddenError');
  });
  it('an unknown service / another salon\'s ticket is refused', async () => {
    const { svc } = setup();
    expect(await code(svc.addService(ctx, 'sv_4005', { serviceId: 'svc_nope' } as any))).toBe('SERVICE_UNKNOWN');
    expect(await code(svc.addService(other, 'sv_4005', { serviceId: 'svc_gel' } as any))).toBe('TICKET_NOT_FOUND');
  });
  it('the deterministic line id is a valid uuid and differs per request', () => {
    const h = (x: string) => createHash('sha256').update(x).digest('hex');
    const a = addOnLineIdFor('t1', 'r1', h), b = addOnLineIdFor('t1', 'r2', h);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/); expect(a).not.toBe(b);
    expect(addOnLineIdFor('t1', 'r1', h)).toBe(a);
  });
});

describe('multi-technician visit and partial completion (§44–§45, §90–§92, §136)', () => {
  it('Manicure by A + Pedicure by B: A finishing her line frees A, the visit stays in Serving with B', async () => {
    const { repo, svc } = setup();
    await svc.addService(ctx, 'sv_4005', { serviceId: 'svc_pedi', technicianId: 'tech_mia' } as any);   // Ava's guest, Mia does the pedicure
    const t = (await repo.ticket(ctx, 'sv_4005'))!;
    const avaLine = t.lines.find((l) => l.serviceName === 'Signature Manicure')!; const miaLine = t.lines.find((l) => l.serviceName === 'Spa Pedicure')!;
    expect(miaLine.technicianId).toBe('tech_mia');   // ownership is per line
    let load = servingTechnicianLoad([t]); expect(load.tech_mia).toBe(1);
    await svc.editService(ctx, 'sv_4005', miaLine.serviceLineId, { status: 'done' });
    const after = (await repo.ticket(ctx, 'sv_4005'))!;
    expect(after.status).toBe('in_service');   // partial completion did not complete the visit
    load = servingTechnicianLoad([after]); expect(load.tech_mia).toBeUndefined(); expect(load.tech_ava ?? 0).toBe(avaLine.technicianId ? 1 : 1);
    const row = (await svc.getState(ctx)).tickets.items.find((r) => r.ticketId === 'sv_4005')!;
    expect(row.technicianNames).toEqual(expect.arrayContaining(['Ava', 'Mia']));
  });
});

describe('KPI truthfulness (§16, §50, §82–§85)', () => {
  it('no ratings / nothing judged → null, never a decorative score', async () => {
    const { svc } = setup();
    const k = (await svc.getState(ctx)).kpis;
    expect(k.customerSatisfactionAvg).toBeNull(); expect(k.onTimeCompletionPercent).toBeNull();
    expect(computeOnTimeCompletionPercent([])).toBeNull();
    expect(Object.keys(SERVING_KPI_DEFINITIONS)).toEqual(expect.arrayContaining(['servingNow', 'nearingCompletion', 'averageServiceDurationMinutes', 'techniciansInService', 'addOnAttachRatePercent', 'delayedServices', 'addOnRevenueCents', 'customerSatisfactionAvg', 'onTimeCompletionPercent']));
  });
  it('an empty salon: no average time, no conversion, zero counts — and an empty floor', async () => {
    const { svc } = setup();
    const s = await svc.getState(other);
    expect(s.kpis.averageServiceDurationMinutes).toBeNull(); expect(s.kpis.addOnAttachRatePercent).toBeNull();
    expect(s.kpis.servingNow).toBe(0); expect(s.tickets.items).toHaveLength(0); expect(s.insights).toEqual([]);
  });
  it('stage counts cover every matched ticket, not the visible page', async () => {
    const { svc } = setup();
    const s = await svc.getState(ctx, { pageSize: 2 });
    expect(s.tickets.items).toHaveLength(2);
    const c = s.stageCounts!;
    expect(c.readyToStart + c.inService + c.finishing + c.ready + c.paused + c.delayed).toBeGreaterThanOrEqual(5);
    expect(c.readyToStart).toBe(1); expect(c.paused).toBe(1); expect(c.delayed).toBe(1);
  });
});

describe('200-technician tenant (§62, §86–§87)', () => {
  const mk = (i: number, status: SVTicket['status'], tech: string): SVTicket => ({ ticketId: 't' + i, ticketNumber: '#' + i, customerId: 'c' + i, customerName: 'Guest ' + i, isVip: false, lines: [{ serviceLineId: 'l' + i, serviceId: 's', serviceName: 'Mani', priceCents: 4000, status: 'serving', estDurationMin: 45 }], primaryTechId: tech, primaryTechName: tech, startedAtMs: status === 'not_started' ? null : Date.now() - 30 * 60000, pausedAtMs: null, accumulatedPausedMs: 0, estimatedDurationMinutes: 45, status, delayStatus: 'none', notes: '', customerVisibleNotes: '', updatedAt: '' });
  it('100 on duty, 40 serving, 8 ready → an 8-row panel, counts for everyone, stage counts for all', () => {
    const staff: ServingStaffRow[] = Array.from({ length: 100 }, (_, i) => ({ technicianId: 'k' + i, name: 'Tech ' + i, status: i < 40 ? 'Busy' : i < 50 ? 'Finishing Soon' : 'Available' }));
    const tickets = [...Array.from({ length: 40 }, (_, i) => mk(i, 'in_service', 'k' + i)), ...Array.from({ length: 8 }, (_, i) => mk(100 + i, 'completed', 'k' + (60 + i))), mk(200, 'not_started', 'k1')];
    const f = buildFloorProjection(tickets, () => 30, staff, 200);
    expect(f.staff).toHaveLength(8); expect(f.staff.every((s) => s.status === 'Available')).toBe(true);
    expect(f.staffSummary).toMatchObject({ onDuty: 100, available: 50, finishing: 10, busy: 40, shown: 8, roster: 200 });
    expect(f.stageCounts.ready).toBe(8); expect(f.stageCounts.readyToStart).toBe(1);
    expect(f.techniciansInService).toBe(40);
    expect(f.insights.length).toBeLessThanOrEqual(5);
  });
  // Extras Serving 04 (Nov 12 2026): a live service expected to run past the same technician's next booking today
  it('booking conflict: needs 15 min more but the next booking is in 10 → a warn insight naming the worst one; enough time / no estimate / no booking → none', () => {
    const staff: ServingStaffRow[] = [{ technicianId: 'k1', name: 'Tech 1', status: 'Busy' }, { technicianId: 'k2', name: 'Tech 2', status: 'Busy' }, { technicianId: 'k3', name: 'Tech 3', status: 'Busy' }];
    const noEst = { ...mk(3, 'in_service', 'k3'), estimatedDurationMinutes: 0 };
    const tickets = [mk(1, 'in_service', 'k1'), mk(2, 'in_service', 'k2'), noEst];
    // elapsed 30 of 45 → 15 min left; k1's next booking in 10 (conflict, 5 over), k2's in 20 (fits), k3 has no estimate
    const f = buildFloorProjection(tickets, () => 30, staff, 3, { k1: 10, k2: 20, k3: 1 });
    const c = f.insights.filter((i) => i.id === 'booking_conflict');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ severity: 'warn', route: '/booking', vars: { name: 'k1', minutes: 10, remaining: 15, count: 1 } });
    // two conflicts → the biggest overrun is named, the count says two
    const g = buildFloorProjection(tickets, () => 30, staff, 3, { k1: 10, k2: 2 });
    expect(g.insights.find((i) => i.id === 'booking_conflict')?.vars).toMatchObject({ name: 'k2', minutes: 2, remaining: 15, count: 2 });
    expect(buildFloorProjection(tickets, () => 30, staff, 3).insights.some((i) => i.id === 'booking_conflict')).toBe(false);
    expect(buildFloorProjection(tickets, () => 30, staff, 3, { k2: 20 }).insights.some((i) => i.id === 'booking_conflict')).toBe(false);
  });
});

describe('AI is advisory, Auto Balance only recommends (§54–§57)', () => {
  it('a guest waiting on a busy technician → a suggestion to a FREE technician; nothing is reassigned', async () => {
    const { repo, svc } = setup();
    const r = await svc.balanceSuggestions(ctx);
    expect(r.appliesAutomatically).toBe(false);
    expect((await repo.ticket(ctx, 'sv_4003'))!.primaryTechId).toBe('tech_leo');   // untouched
    const pure = buildBalanceSuggestions([{ ticketId: 'a', ticketNumber: '#1', customerName: 'G', status: 'not_started', primaryTechId: 'busy', lines: [] }, { ticketId: 'b', ticketNumber: '#2', customerName: 'H', status: 'in_service', primaryTechId: 'busy', lines: [{ status: 'serving' }] }], [{ technicianId: 'free', name: 'Free', status: 'Available' }, { technicianId: 'busy', name: 'Busy', status: 'Busy' }]);
    expect(pure).toEqual([expect.objectContaining({ ticketId: 'a', toTechnicianId: 'free', reason: 'technician_busy' })]);
  });
  it('insights name the situation and an action a person confirms', () => {
    const ins = buildServingInsights({ active: [{ customerName: 'A', isVip: false, elapsed: 70, est: 45 }], waitingToStart: 2, busyTechWaiting: 2, readyForServiceDone: 1, freeTechnicians: 1 });
    expect(ins.map((i) => i.id)).toEqual(['overtime', 'balance', 'ready']);
    expect(ins.every((i) => !('apply' in i))).toBe(true);
  });
});

describe('Send Update and Staff Alert use the notification domains (§58, §72)', () => {
  it('app channel writes the guest\'s feed; SMS is honestly not configured; service state is untouched', async () => {
    const { repo, svc } = setup();
    const before = (await repo.ticket(ctx, 'sv_4004'))!.status;
    expect(await svc.notifyCustomer(ctx, 'sv_4004', { channel: 'app', kind: 'running_late' })).toEqual({ channel: 'app', configured: true, delivered: true });
    expect(repo.customerNotifications).toEqual([expect.objectContaining({ tenantId: 'luxe001', customerId: 'c_sv_4004', type: 'service_update', reference: 'sv_4004' })]);
    expect(await svc.notifyCustomer(ctx, 'sv_4004', { channel: 'sms' })).toMatchObject({ configured: false, delivered: false });
    expect((await repo.ticket(ctx, 'sv_4004'))!.status).toBe(before);
    expect(await code(svc.notifyCustomer(desk, 'sv_4004', {}))).toBe('ForbiddenError');
  });
  it('a staff alert reaches one technician of THIS salon; a foreign ticket reference is refused', async () => {
    const { repo, svc } = setup();
    await svc.staffAlert(ctx, { technicianId: 'tech_ava', ticketId: 'sv_4005', message: 'Guest asks for a top coat' });
    expect(repo.techNotifications).toEqual([expect.objectContaining({ technicianId: 'tech_ava', type: 'staff_alert', reference: 'sv_4005' })]);
    expect(await code(svc.staffAlert(other, { technicianId: 'tech_ava', message: 'x' }))).toBe('TECHNICIAN_NOT_FOUND');
    expect(await code(svc.staffAlert(ctx, { technicianId: 'tech_ava', message: '' }))).toBe('MESSAGE_REQUIRED');
  });
});
