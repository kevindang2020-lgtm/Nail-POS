// queue-floor.vitest.spec — Customer Queue mandate (Oct 28 2026) §14–§15, §20–§29, §32, §36, §42, §53, §55, §71, §76.
// The board, the priority panel, the technician panel and the insights are ONE server projection over canonical state;
// priority follows the existing rankQueue policy (deterministic); technicians come from their real signals (off shift /
// blocked never offered), capped with a whole-roster summary at 200 technicians; insights are advisory only; KPIs with
// nothing to measure are null; projected revenue uses the approved override; Start Service / Send to Tech Queue are one
// effect however often they are asked (a restart, a second device, the concurrent loser); a raised priority needs a
// reason; a refusal answers its registry code and status; another salon sees nothing. In-memory adapter — the Postgres
// compare-and-set and the durable key columns are verified on PostgreSQL 16 (see the status doc).
import { describe, it, expect } from 'vitest';
import { InMemoryQueueRepository, type QueueContext } from './queue.repository';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { buildQueueFloor, staffStatusOf, projectedServiceCents, QUEUE_KPI_DEFINITIONS, QUEUE_FLOW_STAGES, QUEUE_STAFF_SHOWN, QUEUE_PRIORITY_SHOWN, type FloorItem, type FloorTech } from './queue-floor';

const PERMS = ['pos.queue.view', 'pos.queue.create', 'pos.queue.edit', 'pos.queue.call_next', 'pos.queue.assign_technician', 'pos.queue.update_priority', 'pos.queue.move_to_tech_queue', 'pos.queue.move_to_serving', 'pos.queue.cancel', 'pos.queue.remove', 'pos.serving.view', 'pos.technicians.view'];
const ctx: QueueContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_mgr', role: 'MANAGER', permissions: PERMS };
const other: QueueContext = { ...ctx, tenantId: 'other_salon', userId: 'u_x' };
const NOW = Date.UTC(2026, 9, 28, 16, 0);
const ago = (m: number) => NOW - m * 60000;
const item = (id: string, status: string, priority: FloorItem['priority'], waited: number, over: Partial<FloorItem> = {}): FloorItem => ({ queueItemId: id, status, priority, isVip: priority === 'vip', source: 'walk_in', customerName: 'Guest ' + id, assignedTechId: null, checkedInAtMs: ago(waited), services: [], ...over });
const tech = (i: number, status: FloorTech['signals']['status'], availableInMinutes: number | null = null, rotationIndex: number | null = i): FloorTech => ({ technicianId: 't' + i, name: 'Tech ' + String(i).padStart(3, '0'), skills: ['Manicure'], activeAssignments: 0, rotationIndex, signals: { status, availableInMinutes, onBreak: status === 'on_break' } });
const floor = (items: FloorItem[], techs: FloorTech[] = [], over: { vip?: boolean; avg?: number } = {}) => buildQueueFloor({ items, techs, vipPriorityEnabled: over.vip ?? true, avgServiceMinutes: over.avg ?? 45, peakHour: null, nowMs: NOW });
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.name; } };
const setup = () => { const repo = new InMemoryQueueRepository(); return { repo, svc: new QueueService(repo) }; };

describe('Guest Flow Board is canonical state (§20)', () => {
  it('one column per active queue status, counts every entry, top 3 by arrival — no time-derived stages', () => {
    const f = floor([item('a', 'waiting', 'normal', 1), item('b', 'waiting', 'normal', 30), item('c', 'waiting', 'high', 50), item('d', 'waiting', 'normal', 5), item('e', 'called', 'normal', 9), item('f', 'assigned', 'normal', 3), item('g', 'ready_for_tech', 'normal', 2), item('h', 'moved_to_tech_queue', 'normal', 2)]);
    expect(Object.keys(f.flowCounts)).toEqual([...QUEUE_FLOW_STAGES]);
    expect(f.flowCounts).toEqual({ waiting: 4, called: 1, assigned: 1, ready_for_tech: 1, moved_to_tech_queue: 1 });
    expect(f.flowTop.waiting).toEqual(['c', 'b', 'd']);   // earliest arrival first; a 1-minute guest is "waiting", not "arrived"
  });
  it('a status the board does not show (in_service, finished) is not counted in a column', () => {
    const f = floor([item('a', 'in_service', 'normal', 5), item('b', 'cancelled', 'normal', 5)]);
    expect(Object.values(f.flowCounts).reduce((a, n) => a + n, 0)).toBe(0);
  });
});

describe('Waiting Guests by Priority uses the existing rankQueue policy (§22)', () => {
  const pop = [item('n1', 'waiting', 'normal', 40), item('v1', 'waiting', 'vip', 5), item('u1', 'called', 'urgent', 2), item('h1', 'assigned', 'high', 10), item('n2', 'waiting', 'normal', 60), item('r1', 'ready_for_tech', 'urgent', 90)];
  it('urgent > vip > high > normal, then the longest wait; ready_for_tech is not "waiting"', () => {
    expect(floor(pop).priorityOrder).toEqual(['u1', 'v1', 'h1', 'n2', 'n1']);
    expect(floor(pop).priorityCounts).toEqual({ urgent: 1, vip: 1, high: 1, normal: 2 });
  });
  it('vipPriorityEnabled off → the longest wait only', () => { expect(floor(pop, [], { vip: false }).priorityOrder).toEqual(['n2', 'n1', 'h1', 'v1', 'u1']); });
  it('deterministic on ties (same priority, same minute → check-in, then id) and capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => item('g' + String(29 - i).padStart(2, '0'), 'waiting', 'normal', 20));
    const a = floor(many).priorityOrder, b = floor(many.slice().reverse()).priorityOrder;
    expect(a).toEqual(b); expect(a).toHaveLength(QUEUE_PRIORITY_SHOWN); expect(a[0]).toBe('g00');
  });
});

describe('Available Technicians come from real signals, capped at scale (§25–§29)', () => {
  it('off shift / blocked are never offered; Available first in Fair Turn rotation order; Finishing Soon ≤ 15 min', () => {
    const f = floor([], [tech(1, 'in_service', 30), tech(2, 'available', null, 5), tech(3, 'off_shift'), tech(4, 'available', null, 1), tech(5, 'in_service', 8), tech(6, 'blocked'), tech(7, 'on_break')]);
    expect(f.staff.map((s) => [s.technicianId, s.status])).toEqual([['t4', 'Available'], ['t2', 'Available'], ['t5', 'Finishing Soon'], ['t1', 'Busy'], ['t7', 'Break']]);
    expect(f.staffSummary).toMatchObject({ onDuty: 5, available: 2, finishing: 1, busy: 1, onBreak: 1, roster: 7 });
    expect(staffStatusOf({ status: 'in_service', availableInMinutes: null, onBreak: false })).toBe('Busy');
  });
  it('200 technicians → the top rows + a summary of the whole on-duty roster', () => {
    const roster = Array.from({ length: 200 }, (_, i) => tech(i, i < 100 ? (['available', 'in_service', 'in_service', 'on_break'] as const)[i % 4] : 'off_shift', i % 4 === 1 ? 35 : i % 4 === 2 ? 9 : null));
    const t0 = performance.now(); const f = floor([], roster); const ms = performance.now() - t0;
    expect(f.staff).toHaveLength(QUEUE_STAFF_SHOWN); expect(f.staffSummary).toMatchObject({ onDuty: 100, available: 25, finishing: 25, busy: 25, onBreak: 25, roster: 200 });
    expect(ms).toBeLessThan(50);
  });
});

describe('Insights are advisory, at most five (§21)', () => {
  it('long wait / VIP / unassigned with free technicians / no-show risk — routes only open a guest or a preview', () => {
    const items = [item('a', 'waiting', 'normal', 90), item('v', 'waiting', 'vip', 30), item('p', 'waiting', 'normal', 70, { source: 'appointment' }), item('b', 'called', 'normal', 5)];
    const f = buildQueueFloor({ items, techs: [tech(1, 'available')], vipPriorityEnabled: true, avgServiceMinutes: 45, peakHour: 11, nowMs: NOW });
    expect(f.insights.map((i) => i.id)).toEqual(['longWait', 'vip', 'unassigned', 'noShow', 'peak']);
    expect(f.insights.every((i) => !i.route || /^(guest|assign):|^balance$/.test(i.route))).toBe(true);
    expect(f.insights.find((i) => i.id === 'upsell')).toBeUndefined();
    expect(f.waitLevel).toMatchObject({ a: 'delayed', v: 'normal', b: 'normal' });
  });
  it('nothing to say → no insights', () => { expect(floor([item('a', 'waiting', 'normal', 3)]).insights).toEqual([]); });
});

describe('KPIs are server-authoritative and defined (§14–§15, §42)', () => {
  it('an empty salon answers null for Avg Wait / Return Rate, never a decorative 0', async () => {
    const { svc } = setup(); const s = await svc.getState(other);
    expect(s.kpis.waitingGuests).toBe(0); expect(s.kpis.averageWaitMinutes).toBeNull(); expect(s.kpis.returnRatePercent).toBeNull();
    expect(s.staff).toEqual([]); expect(s.waitingByPriority).toEqual([]); expect(s.flow?.counts.waiting).toBe(0);
  });
  it('every KPI on the screen has a written definition', () => {
    for (const k of ['waitingGuests', 'walkInsWaiting', 'vipWaiting', 'readyForAssignment', 'averageWaitMinutes', 'estQueueRevenueCents', 'readyForService', 'noShowRisk', 'returnRatePercent']) expect(QUEUE_KPI_DEFINITIONS[k]?.length).toBeGreaterThan(20);
  });
  it('projected revenue uses the approved override, else the catalog price', () => {
    expect(projectedServiceCents({ priceCents: 5500, priceOverrideCents: 4000 })).toBe(4000);
    expect(projectedServiceCents({ priceCents: 5500 })).toBe(5500); expect(projectedServiceCents({})).toBe(0);
  });
  it('the live state carries the projection: flow counts, priority rows, staff from signals, waitLevel on rows', async () => {
    const { svc } = setup(); const s = await svc.getState(ctx);
    expect(s.kpis.averageWaitMinutes).toBeGreaterThan(0);
    expect(s.flow?.counts).toMatchObject({ waiting: 2, called: 1, assigned: 1, ready_for_tech: 1 });
    expect(s.waitingByPriority?.map((r) => r.queueItemId)).toEqual(['q_5001', 'q_5004', 'q_5003', 'q_5002']);   // vip, high, then the longest-waiting normal
    expect(s.staff.map((x) => x.name)).toEqual(['Ava', 'Mia']);   // the server's rotation order; Leo is off today — not offered
    expect(s.queue.items.every((r) => r.waitLevel === 'normal' || r.waitLevel === 'delayed')).toBe(true);
  });
});

describe('Start Service / Send to Tech Queue are one effect (§53, §55, §32)', () => {
  it('Start twice → the second is duplicate with the same ticket', async () => {
    const { svc } = setup();
    const a = await svc.moveToServing(ctx, 'q_5005'); const b = await svc.moveToServing(ctx, 'q_5005');
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(true); expect(b.idempotencyKey).toBe(a.idempotencyKey);
  });
  it('a repeat after the key was lost (restart / another replica) is duplicate, not "Cannot start service"', async () => {
    const { repo, svc } = setup(); await svc.moveToServing(ctx, 'q_5005');
    (repo as any)._item(ctx, 'q_5005').servingKey = undefined;
    expect((await svc.moveToServing(ctx, 'q_5005')).duplicate).toBe(true);
  });
  it('two stations at once → exactly one start', async () => {
    const { svc } = setup();
    const r = await Promise.all([svc.moveToServing(ctx, 'q_5005'), svc.moveToServing({ ...ctx, userId: 'u_desk2' }, 'q_5005')]);
    expect(r.filter((x) => !x.duplicate)).toHaveLength(1);
  });
  it('Send to Tech Queue twice / after a lost key → duplicate', async () => {
    const { repo, svc } = setup();
    expect((await svc.moveToTechQueue(ctx, 'q_5003')).duplicate).toBe(false);
    (repo as any)._item(ctx, 'q_5003').techQueueKey = undefined;
    expect((await svc.moveToTechQueue(ctx, 'q_5003')).duplicate).toBe(true);
  });
  it('Start without a technician is refused with its registry code', async () => {
    const { svc } = setup(); expect(await code(svc.moveToServing(ctx, 'q_5002'))).toBe('CANNOT_START_SERVICE');
  });
});

describe('Priority overrides need a reason (§23)', () => {
  it('raising above Normal without a reason is refused; with one it is applied and audited; back to Normal needs none', async () => {
    const { repo, svc } = setup();
    expect(await code(svc.updatePriority(ctx, 'q_5002', { priority: 'vip' }))).toBe('PRIORITY_REASON_REQUIRED');
    expect((await svc.updatePriority(ctx, 'q_5002', { priority: 'vip', reason: 'Bride on a schedule' })).priority).toBe('vip');
    expect(repo.historyRows.some((h) => h.queueItemId === 'q_5002' && h.reason === 'Bride on a schedule')).toBe(true);
    expect((await svc.updatePriority(ctx, 'q_5002', { priority: 'normal' })).priority).toBe('normal');
  });
});

describe('The HTTP refusal carries the registry code and status (§52, §55)', () => {
  it('CANNOT_START_SERVICE answers 409 with its code (it was a bare 400)', async () => {
    const { svc } = setup(); const c = new QueueController(svc);
    const e: any = await c.startService({ ctx } as any, 'q_5002').catch((x) => x);
    expect(e.getStatus()).toBe(409); expect(e.getResponse().code).toBe('CANNOT_START_SERVICE');
  });
  it('a guest of another salon is not found (404 QUEUE_ITEM_NOT_FOUND)', async () => {
    const { svc } = setup(); const c = new QueueController(svc);
    const e: any = await c.startService({ ctx: other } as any, 'q_5005').catch((x) => x);
    expect(e.getStatus()).toBe(404); expect(e.getResponse().code).toBe('QUEUE_ITEM_NOT_FOUND');
  });
});

describe('Send Wait Alert goes through the notification domain (§56)', () => {
  it('a guest with the Customer App gets one push; the result says delivered', async () => {
    const sent: any[] = []; const repo = new InMemoryQueueRepository();
    const svc = new QueueService(repo, undefined, { dispatchToUser: async (t, u, m) => { sent.push({ t, u, m }); } });
    const r = await svc.notifyCustomer(ctx, 'q_5002', { channel: 'app' });
    expect(r).toMatchObject({ channel: 'app', configured: true, delivered: true });
    expect(sent).toHaveLength(1); expect(sent[0].t).toBe('luxe001'); expect(sent[0].m.data.kind).toBe('queue_wait_update');
  });
  it('no push binding → not reported as alerted; SMS stays honest (not configured)', async () => {
    const { svc } = setup();
    expect(await svc.notifyCustomer(ctx, 'q_5002', { channel: 'app' })).toMatchObject({ delivered: false });
    expect(await svc.notifyCustomer(ctx, 'q_5002', { channel: 'sms' })).toMatchObject({ configured: false });
  });
});
