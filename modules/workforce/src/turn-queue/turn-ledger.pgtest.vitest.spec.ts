// turn-ledger.pgtest.vitest.spec.ts — the ONE turn-queue writer against the REAL schema (every migration through 602).
// Mandate tests §196–§208 at the database level: traditional rotation, half turns, requested guests, breaks, clock-out,
// skips with preserved position, corrections, declines, adjustments, reorder, idempotency, branch / tenant isolation,
// the append-only history and an exact replay of the day. A FIXED clock is used for every call (never today's date).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import type { Kysely } from 'kysely';
import {
  turnClockIn, turnClockOut, turnBreakStart, turnBreakEnd, turnAssign, turnServiceStart, turnServiceComplete, turnUnassign, turnDecline, turnAdjust,
  turnReorder, turnHold, turnRelease, turnCustomerDeclined, declinedTechniciansFor, readTurnDay, readTurnEvents, turnCloseDay, turnOfferTimeout, unclosedPastDays,
} from './turn-ledger';
import { rotationOrder } from './turn-core';

const uuid = (p: string, n: string | number) => `${p}${'0'.repeat(8 - p.length)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TA = uuid('aa', 1), TB = uuid('aa', 2), BA = uuid('ab', 1), BA2 = uuid('ab', 2), BB = uuid('ab', 3);
const LISA = uuid('ac', 1), MARY = uuid('ac', 2), ANNA = uuid('ac', 3), KIM = uuid('ac', 4), BEX = uuid('ac', 9);
const GEL = uuid('ad', 1), QUICK = uuid('ad', 2), ACRYL = uuid('ad', 3), CAT_GEL = uuid('ae', 1), CAT_ACR = uuid('ae', 2);
const DAY = '2026-03-02';
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00.000Z`);   // branch time zone is UTC below
let pg: any; let db: Kysely<any>; let qn = 0;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const mgr = { userId: uuid('af', 1), type: 'user' as const };

async function guest(opts: { services?: { serviceId: string; estimatedDurationMinutes: number }[]; requested?: string | null; appointmentId?: string | null; source?: string } = {}): Promise<string> {
  const id = uuid('b0', ++qn);
  await pg.query(`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, source, requested_services, priority, status, requested_technician_id, appointment_id)
    values ($1,$2,$3,'Guest ' || $4,$5,$6::jsonb,'normal','waiting',$7,$8)`, [id, TA, BA, qn, opts.source ?? 'walk_in', JSON.stringify(opts.services ?? [{ serviceId: GEL, estimatedDurationMinutes: 45 }]), opts.requested ?? null, opts.appointmentId ?? null]);
  return id;
}
async function order(nowMs: number) { const d = await readTurnDay(db, TA, BA, nowMs); return rotationOrder(d.ctx.mode, d.ctx.policy, d.rows, nowMs).map((r) => r.technicianId); }
async function state(tech: string, nowMs: number) { return (await readTurnDay(db, TA, BA, nowMs)).rows.find((r) => r.technicianId === tech)!; }

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg) as any;
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','tqa','TQA'),($2,'B','B','tqb','TQB')`, [TA, TB]);
  await pg.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'A-Main','active','UTC'),($3,$2,'A-Two','active','UTC'),($4,$5,'B-Main','active','UTC')`, [BA, TA, BA2, BB, TB]);
  await pg.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, status) values
    ($1,$5,$6,'Lisa','N','Lisa N',true,'active'),($2,$5,$6,'Mary','M','Mary M',true,'active'),($3,$5,$6,'Anna','A','Anna A',true,'active'),($4,$5,$6,'Kim','K','Kim K',true,'active'),
    ($7,$8,$9,'Bex','X','Bex X',true,'active')`, [LISA, MARY, ANNA, KIM, TA, BA, BEX, TB, BB]);
  await pg.query(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$3,$4,'Gel'),($2,$3,$4,'Acrylic')`, [CAT_GEL, CAT_ACR, TA, BA]);
  await pg.query(`insert into services (id, tenant_id, branch_id, name, category_id, duration_minutes, price_cents) values ($1,$4,$7,'Gel Manicure',$5,45,4000),($2,$4,$7,'Polish Change',$5,15,1500),($3,$4,$7,'Acrylic Fill',$6,60,5500)`, [GEL, QUICK, ACRYL, TA, CAT_GEL, CAT_ACR, BA]);
  await pg.query(`insert into turn_unit_rules (tenant_id, scope, service_id, turn_units) values ($1,'service',$2,50)`, [TA, QUICK]);
}, 240_000);

describe('§27–28 clock-in joins the rotation in order (back of the queue)', () => {
  it('Lisa, Mary, Anna clock in → positions 1, 2, 3 and three JOIN events', async () => {
    await turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: LISA }, { nowMs: at('09:00') });
    await turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: MARY }, { nowMs: at('09:01') });
    await turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: ANNA }, { nowMs: at('09:02') });
    await turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: ANNA }, { nowMs: at('09:03') });   // idempotent re-sync
    expect(await order(at('09:05'))).toEqual([LISA, MARY, ANNA]);
    const joins = await readTurnEvents(db, TA, { branchId: BA, eventTypes: ['JOIN'] });
    expect(joins.map((e) => e.technicianId)).toEqual([LISA, MARY, ANNA]);
  });
});

describe('§196 traditional rotation + §87 Service Done credits the turn', () => {
  it('Lisa takes a full-turn walk-in → Mary, Anna, Lisa; the credit lands at Service Done', async () => {
    const g = await guest();
    const r = await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: LISA, queueItemId: g, source: 'ai_suggestion', recommendedTechnicianId: LISA, eligiblePool: [LISA, MARY, ANNA], actor: mgr }, { nowMs: at('09:30') });
    expect(r).toMatchObject({ units: 100, kind: 'walk_in_shared', manual: false });
    expect(await order(at('09:31'))).toEqual([MARY, ANNA, LISA]);
    expect(await state(LISA, at('09:31'))).toMatchObject({ status: 'ASSIGNED', provisionalUnits: 100, accumulatedUnits: 0 });
    await turnServiceStart(db, { tenantId: TA, branchId: BA, technicianIds: [LISA], queueItemId: g }, { nowMs: at('09:35') });
    expect((await state(LISA, at('09:36'))).status).toBe('SERVING');
    await turnServiceComplete(db, { tenantId: TA, branchId: BA, technicianIds: [LISA], queueItemIds: [g], startedAt: new Date(at('09:35')).toISOString() }, { nowMs: at('10:20') });
    expect(await state(LISA, at('10:21'))).toMatchObject({ status: 'READY', provisionalUnits: 0, accumulatedUnits: 100, serviceMinutes: 45 });
    const credit = await readTurnEvents(db, TA, { branchId: BA, eventTypes: ['TURN_CREDIT'] });
    expect(credit).toHaveLength(1); expect(credit[0]).toMatchObject({ technicianId: LISA, turnUnitsDelta: 100, assignmentRef: r.assignEventId });
    // a duplicate Service Done credits nothing twice
    await turnServiceComplete(db, { tenantId: TA, branchId: BA, technicianIds: [LISA], queueItemIds: [g] }, { nowMs: at('10:22') });
    expect(await readTurnEvents(db, TA, { branchId: BA, eventTypes: ['TURN_CREDIT'] })).toHaveLength(1);
  });
});

describe('§197 / §67 skill-ineligible skip keeps the position', () => {
  it('Mary (next) cannot do Acrylic → Anna assigned; Mary SKIP recorded and still first for the next service she can do', async () => {
    const g = await guest({ services: [{ serviceId: ACRYL, estimatedDurationMinutes: 60 }] });
    await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, source: 'auto_assign', recommendedTechnicianId: ANNA, skips: [{ technicianId: MARY, reason: 'SKILL_INELIGIBLE' }] }, { nowMs: at('10:30') });
    expect((await order(at('10:31')))[0]).toBe(MARY);
    const skip = (await readTurnEvents(db, TA, { branchId: BA, eventTypes: ['SKIP'] }))[0];
    expect(skip).toMatchObject({ technicianId: MARY, reasonCode: 'SKILL_INELIGIBLE', positionBefore: skip.positionAfter });
    expect((await state(MARY, at('10:31'))).eligibleSkipCount).toBe(1);
  });
});

describe('§201 half turns', () => {
  it('a 0.5-turn Polish Change keeps Mary first; a second one moves her to the back', async () => {
    const g1 = await guest({ services: [{ serviceId: QUICK, estimatedDurationMinutes: 15 }] });
    const r1 = await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: MARY, queueItemId: g1, source: 'ai_suggestion', recommendedTechnicianId: MARY }, { nowMs: at('10:40') });
    expect(r1.units).toBe(50);
    expect((await readTurnEvents(db, TA, { branchId: BA, queueItemId: g1, eventTypes: ['ASSIGN'] }))[0].turnRuleId).toBeTruthy();   // §45 snapshot of the rule
    await turnServiceComplete(db, { tenantId: TA, branchId: BA, technicianIds: [MARY], queueItemIds: [g1] }, { nowMs: at('10:55') });
    expect((await order(at('10:56')))[0]).toBe(MARY);
    expect((await state(MARY, at('10:56'))).pendingUnits).toBe(50);
    const g2 = await guest({ services: [{ serviceId: QUICK, estimatedDurationMinutes: 15 }] });
    await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: MARY, queueItemId: g2, source: 'ai_suggestion', recommendedTechnicianId: MARY }, { nowMs: at('11:00') });
    const o = await order(at('11:01'));
    expect(o[o.length - 1]).toBe(MARY);
    await turnServiceComplete(db, { tenantId: TA, branchId: BA, technicianIds: [MARY], queueItemIds: [g2] }, { nowMs: at('11:15') });
    expect((await state(MARY, at('11:16'))).accumulatedUnits).toBe(100);
  });
});

describe('§200 requested technician + §202 manual override', () => {
  it('a guest who asks for Lisa does not consume her walk-in turn (default policy)', async () => {
    const before = (await state(LISA, at('11:20'))).rotationPosition;
    const g = await guest({ requested: LISA });
    const r = await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: LISA, queueItemId: g, source: 'staff', recommendedTechnicianId: LISA }, { nowMs: at('11:20') });
    expect(r).toMatchObject({ units: 0, kind: 'walk_in_requested' });
    expect((await state(LISA, at('11:21'))).rotationPosition).toBe(before);
    await turnServiceComplete(db, { tenantId: TA, branchId: BA, technicianIds: [LISA], queueItemIds: [g] }, { nowMs: at('11:50') });
  });
  it('staff choosing someone other than the engine’s pick is a MANUAL_ASSIGN with the reason and both orders', async () => {
    const g = await guest();
    const top = (await order(at('12:00')))[0];
    const other = [LISA, MARY, ANNA].find((t) => t !== top)!;
    const r = await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: other, queueItemId: g, source: 'staff', recommendedTechnicianId: top, overrideReasonCode: 'TRAINING', reasonText: 'pairing', actor: mgr }, { nowMs: at('12:00') });
    expect(r.manual).toBe(true);
    const ev = (await readTurnEvents(db, TA, { branchId: BA, eventTypes: ['MANUAL_ASSIGN'] }))[0];
    expect(ev).toMatchObject({ technicianId: other, recommendedTechnicianId: top, reasonCode: 'TRAINING', reasonText: 'pairing', actorId: mgr.userId });
    expect(Array.isArray(ev.metadata.orderBefore) && Array.isArray(ev.metadata.orderAfter)).toBe(true);
    // §134 an unassignment is a CORRECTION — the old row stays and the turn + position come back
    const pos = ev.positionBefore;
    await turnUnassign(db, { tenantId: TA, branchId: BA, queueItemId: g, reason: 'wrong guest', actor: mgr }, { nowMs: at('12:05') });
    expect(await state(other, at('12:06'))).toMatchObject({ status: 'READY', provisionalUnits: 0, rotationPosition: pos });
    expect(await readTurnEvents(db, TA, { branchId: BA, eventTypes: ['MANUAL_ASSIGN'] })).toHaveLength(1);
  });
  it('§84 the same idempotency key writes once', async () => {
    const g = await guest();
    const a1 = await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, source: 'auto_assign', idempotencyKey: 'k-1' }, { nowMs: at('12:10') });
    const a2 = await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, source: 'auto_assign', idempotencyKey: 'k-1' }, { nowMs: at('12:11') });
    expect(a2.assignEventId).toBe(a1.assignEventId);
    expect(await readTurnEvents(db, TA, { queueItemId: g, eventTypes: ['ASSIGN'] })).toHaveLength(1);
    await turnUnassign(db, { tenantId: TA, branchId: BA, queueItemId: g, reason: 'test cleanup' }, { nowMs: at('12:12') });
  });
});

describe('§62–66 declines', () => {
  it('a guest declining Lisa is logged and costs her nothing; the engine sees the decline for that guest only', async () => {
    const g = await guest();
    await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: LISA, queueItemId: g, source: 'ai_suggestion', recommendedTechnicianId: LISA }, { nowMs: at('12:20') });
    const before = (await readTurnEvents(db, TA, { queueItemId: g, eventTypes: ['ASSIGN'] }))[0].positionBefore;
    await turnCustomerDeclined(db, { tenantId: TA, branchId: BA, technicianId: LISA, queueItemId: g, reasonText: 'prefers someone else', actor: mgr }, { nowMs: at('12:21') });
    expect(await state(LISA, at('12:22'))).toMatchObject({ status: 'READY', provisionalUnits: 0, rotationPosition: before });
    expect(await declinedTechniciansFor(db, TA, g)).toEqual([LISA]);
  });
  it('a safety decline is never penalised; a personal one follows the salon rule (charge half)', async () => {
    await pg.query(`insert into queue_assignment_tenant_settings (tenant_id, turn_policy) values ($1, '{"technicianDeclinePolicy":"CHARGE_HALF_TURN"}'::jsonb)
      on conflict (tenant_id) do update set turn_policy = excluded.turn_policy`, [TA]);
    const g = await guest();
    await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, source: 'ai_suggestion' }, { nowMs: at('12:30') });
    const acc = (await state(ANNA, at('12:30'))).accumulatedUnits;
    const s = await turnDecline(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, reasonCode: 'EQUIPMENT_UNAVAILABLE' }, { nowMs: at('12:31') });
    expect(s.penalized).toBe(false); expect((await state(ANNA, at('12:31'))).accumulatedUnits).toBe(acc);
    await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, source: 'ai_suggestion' }, { nowMs: at('12:32') });
    const p = await turnDecline(db, { tenantId: TA, branchId: BA, technicianId: ANNA, queueItemId: g, reasonCode: 'PERSONAL_PREFERENCE' }, { nowMs: at('12:33') });
    expect(p.penalized).toBe(true); expect((await state(ANNA, at('12:33'))).accumulatedUnits).toBe(acc + 50);
    await pg.query(`update queue_assignment_tenant_settings set turn_policy = '{}'::jsonb where tenant_id = $1`, [TA]);
  });
  it('§152–153 an offer timeout returns the turn and keeps the position by default', async () => {
    const g = await guest();
    await turnAssign(db, { tenantId: TA, branchId: BA, technicianId: MARY, queueItemId: g, source: 'ai_suggestion' }, { nowMs: at('12:40') });
    await turnOfferTimeout(db, { tenantId: TA, branchId: BA, technicianId: MARY, queueItemId: g }, { nowMs: at('12:41') });
    expect(await state(MARY, at('12:41'))).toMatchObject({ status: 'READY', provisionalUnits: 0 });
  });
});

describe('§198 breaks, §31 hold, §205 clock-out', () => {
  it('a short break keeps the place; a manager hold is not a payroll break; release returns', async () => {
    const pos = (await state(LISA, at('13:00'))).rotationPosition;
    await turnBreakStart(db, { tenantId: TA, branchId: BA, technicianId: LISA }, { nowMs: at('13:00') });
    expect((await state(LISA, at('13:05'))).status).toBe('BREAK');
    expect(await order(at('13:05'))).toContain(LISA);   // still in the rotation, just not READY
    await turnBreakEnd(db, { tenantId: TA, branchId: BA, technicianId: LISA }, { nowMs: at('13:15') });
    expect(await state(LISA, at('13:16'))).toMatchObject({ status: 'READY', rotationPosition: pos });
    await turnHold(db, { tenantId: TA, branchId: BA, technicianId: LISA, reason: 'helping at the desk', actor: mgr }, { nowMs: at('13:20') });
    expect((await state(LISA, at('13:21'))).status).toBe('HOLD');
    await turnRelease(db, { tenantId: TA, branchId: BA, technicianId: LISA, actor: mgr }, { nowMs: at('13:25') });
    expect(await state(LISA, at('13:26'))).toMatchObject({ status: 'READY', rotationPosition: pos });
  });
  it('a long break moves her to the back (afterPreserveWindow MOVE_BACK)', async () => {
    await turnBreakStart(db, { tenantId: TA, branchId: BA, technicianId: LISA }, { nowMs: at('13:30') });
    await turnBreakEnd(db, { tenantId: TA, branchId: BA, technicianId: LISA }, { nowMs: at('14:30') });
    const o = await order(at('14:31')); expect(o[o.length - 1]).toBe(LISA);
  });
  it('clock-out removes her from eligibility immediately and deletes nothing', async () => {
    const before = (await readTurnEvents(db, TA, { technicianId: ANNA })).length;
    await turnClockOut(db, { tenantId: TA, branchId: BA, technicianId: ANNA }, { nowMs: at('14:40') });
    expect(await order(at('14:41'))).not.toContain(ANNA);
    expect(await state(ANNA, at('14:41'))).toMatchObject({ status: 'CLOCKED_OUT', inRotation: false });
    expect((await readTurnEvents(db, TA, { technicianId: ANNA })).length).toBe(before + 1);
  });
});

describe('§71–73 reorder and turn credit adjustment', () => {
  it('set next puts Kim (late arrival, joined at the back) first; the REORDER keeps both orders', async () => {
    await turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: KIM }, { nowMs: at('14:45') });
    const o = await order(at('14:46')); expect(o[o.length - 1]).toBe(KIM);   // §128 late arrival joins back
    const r = await turnReorder(db, { tenantId: TA, branchId: BA, technicianId: KIM, placement: { setNext: true }, reason: 'covering for Anna', actor: mgr }, { nowMs: at('14:47') });
    expect(r.order[0]).toBe(KIM);
    const ev = (await readTurnEvents(db, TA, { eventTypes: ['REORDER'] }))[0];
    expect(ev.metadata.orderBefore).toEqual(o); expect(ev.reasonText).toBe('covering for Anna');
  });
  it('adjust +0.5 with a reason; refused when zero', async () => {
    const acc = (await state(MARY, at('14:50'))).accumulatedUnits;
    await turnAdjust(db, { tenantId: TA, branchId: BA, technicianId: MARY, deltaUnits: 50, reason: 'missed credit', actor: mgr }, { nowMs: at('14:50') });
    expect((await state(MARY, at('14:51'))).accumulatedUnits).toBe(acc + 50);
    await expect(turnAdjust(db, { tenantId: TA, branchId: BA, technicianId: MARY, deltaUnits: 0, reason: 'x', actor: mgr }, { nowMs: at('14:52') })).rejects.toThrow(/not zero/);
  });
});

describe('§145–148 isolation, §181 integrity, §134 append-only', () => {
  it('a technician in the rotation at branch A cannot be assigned at branch A-Two the same day', async () => {
    const g = uuid('b0', 900);
    await pg.query(`insert into pos_queue_items (id, tenant_id, branch_id, customer_name, source, requested_services, priority, status) values ($1,$2,$3,'X','walk_in','[]'::jsonb,'normal','waiting')`, [g, TA, BA2]);
    await expect(turnAssign(db, { tenantId: TA, branchId: BA2, technicianId: MARY, queueItemId: g, source: 'staff' }, { nowMs: at('15:00') })).rejects.toThrow(/another location/);
  });
  it('another tenant sees none of it; a cross-tenant technician id is refused by the database', async () => {
    expect(await readTurnEvents(db, TB, {})).toEqual([]);
    await expect(turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: BEX }, { nowMs: at('15:01') })).rejects.toThrow(/cross-tenant/);
  });
  it('history cannot be rewritten or deleted', async () => {
    await expect(pg.query(`update technician_turn_events set turn_units = 999 where tenant_id = $1`, [TA])).rejects.toThrow(/append-only/);
    await expect(pg.query(`delete from technician_turn_events where tenant_id = $1`, [TA])).rejects.toThrow(/append-only/);
  });
});

describe('§208 the day replays exactly from history', () => {
  it('sequence numbers are gap-free and the credited units equal the state', async () => {
    const evs = await readTurnEvents(db, TA, { branchId: BA, from: DAY, to: DAY });
    expect(evs.map((e) => e.sequenceNumber)).toEqual(evs.map((_, i) => i + 1));
    const day = await readTurnDay(db, TA, BA, at('15:10'));
    for (const r of day.rows) {
      const credited = evs.filter((e) => e.technicianId === r.technicianId && (e.eventType === 'TURN_CREDIT' || e.eventType === 'ADJUST' || e.eventType === 'DECLINE')).reduce((s, e) => s + e.turnUnitsDelta, 0);
      expect(r.accumulatedUnits).toBe(credited);
      const lastStatus = [...evs].reverse().find((e) => e.technicianId === r.technicianId && e.statusAfter)?.statusAfter;
      expect(lastStatus).toBe(r.status);
    }
  });
  it('§125–126 the day-close sweep finds the unclosed past day (one row per branch-day, not per technician)', async () => {
    // wave 4 (UI sweep): the query's groupBy/execute sat inside a trailing comment, so the scheduler awaited a query
    // BUILDER and every tick failed ("don't await SelectQueryBuilder instances directly") — no day ever closed
    const days = await unclosedPastDays(db, Date.parse('2026-03-03T08:00:00.000Z'));
    expect(days.filter((d) => d.tenantId === TA && d.branchId === BA)).toEqual([{ tenantId: TA, branchId: BA, businessDate: DAY }]);
    expect(await unclosedPastDays(db, Date.parse('2026-03-02T23:00:00.000Z'))).toEqual([]);   // still that day at the branch
  });
  it('§125 closing the day keeps every row and writes DAY_CLOSE', async () => {
    const res = await turnCloseDay(db, { tenantId: TA, branchId: BA, businessDate: DAY }, { nowMs: Date.parse('2026-03-03T08:00:00.000Z') });
    expect(res.closed).toBe(4);
    expect((await q(`select count(*)::int n from technician_turn_state where tenant_id = $1 and business_date = $2 and closed_at is not null`, [TA, DAY]))[0].n).toBe(4);
    // the next day starts fresh (no deletion): Mary clocks in on the 3rd → a new row at position 1
    await turnClockIn(db, { tenantId: TA, branchId: BA, technicianId: MARY }, { nowMs: Date.parse('2026-03-03T09:00:00.000Z') });
    const d3 = await readTurnDay(db, TA, BA, Date.parse('2026-03-03T09:05:00.000Z'));
    expect(d3.businessDate).toBe('2026-03-03'); expect(d3.rows.map((r) => r.accumulatedUnits)).toEqual([0]);
  });
});
