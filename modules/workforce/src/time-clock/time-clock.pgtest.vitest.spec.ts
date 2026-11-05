// time-clock.pgtest.vitest.spec.ts — the time clock against the REAL schema (every migration via migratedPglite):
// the salon-local date key, ONE open punch per technician (580 partial unique → idempotent double clock-in, split
// shifts), clock-out of a punch that started yesterday, breaks as part of the clock, the workforce state moving in the
// same call, and manager corrections (transactional, branch-scoped, audited — the audit write is NOT optional).
// Merged from the Oct 2026 Technician Profile package, adapted to our harness and our outbox-aware repository.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import type { Kysely } from 'kysely';
import { TimeClockService, TimeClockValidationError } from './time-clock.service';
import { KyselyTimeClockRepository } from './time-clock.kysely.repository';
import { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import { KyselyWorkforceStateStore } from '../workforce-status/workforce-status.kysely.repository';
import { TechnicianClockManagementService } from '../technician-clock-pin/technician-clock-management.service';
import { KyselyClockManagementRepository } from '../technician-clock-pin/technician-clock-management.kysely.repository';
import { TechnicianClockPinService } from '../technician-clock-pin/technician-clock-pin.service';
import { InMemoryClockPinRepository } from '../technician-clock-pin/technician-clock-pin.repository';

const uuid = (p: string, n: string | number) => `${p}${'0'.repeat(8 - p.length)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TA = uuid('ca', 1), TB = uuid('ca', 2), BA = uuid('cb', 1), BA2 = uuid('cb', 3), BB = uuid('cb', 2);
const UA = uuid('cc', 1), UB = uuid('cc', 2);
const TECH_A = uuid('cd', 1), TECH_A2 = uuid('cd', 2), TECH_B = uuid('cd', 3);
const ctxA = { tenantId: TA, branchId: BA, userId: UA, role: 'OWNER', permissions: [] as string[] };
const ctxB = { tenantId: TB, branchId: BB, userId: UB, role: 'OWNER', permissions: [] as string[] };

let pg: any; let db: Kysely<any>; let svc: TimeClockService; let wf: WorkforceStatusService; let mgmt: TechnicianClockManagementService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const count = async (s: string, p: any[] = []) => Number((await q(s, p))[0].n);

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg) as any;
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','tca','TCA'),($2,'B','B','tcb','TCB')`, [TA, TB]);
  await pg.query(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'A-Main','active','America/New_York'),($3,$2,'A-Second','active','America/New_York'),($4,$5,'B-Main','active','America/New_York')`, [BA, TA, BA2, BB, TB]);
  await pg.query(`insert into users (id, tenant_id, role, email, status) values ($1,$2,'OWNER','a@x.test','active'),($3,$4,'OWNER','b@x.test','active')`, [UA, TA, UB, TB]);
  await pg.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, status) values
    ($1,$4,$5,'Ana','A','Ana A',true,'active'), ($2,$4,$6,'Al','A','Al A',true,'active'), ($3,$7,$8,'Bea','B','Bea B',true,'active')`, [TECH_A, TECH_A2, TECH_B, TA, BA, BA2, TB, BB]);
  wf = new WorkforceStatusService(new KyselyWorkforceStateStore(db), null);
  svc = new TimeClockService(new KyselyTimeClockRepository(db), null, wf);
  mgmt = new TechnicianClockManagementService(new TechnicianClockPinService(new InMemoryClockPinRepository()), new KyselyClockManagementRepository(db), wf);
}, 240_000);
afterEach(() => vi.useRealTimers());

describe('date key is the SALON-LOCAL day', () => {
  it('a 9:30pm clock-in in New Jersey (01:30Z next day) is filed under TODAY, and getState sees it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T01:30:00.000Z'));   // = 2026-10-09 21:30 EDT
    const row = await svc.clockIn(ctxA, TECH_A);
    expect(row.created).toBe(true); expect(row.state).toBe('clocked_in');
    const punch = await q(`select shift_date::text as d from technician_shifts where id = $1`, [row.shiftId]);
    expect(punch[0].d).toBe('2026-10-09');                       // NOT 2026-10-10 (the old UTC bug)
    const state = await svc.getState(ctxA);
    expect(state.technicians.find((t) => t.technicianId === TECH_A)?.state).toBe('clocked_in');
    expect(await wf.getTechnicianState(TA, TECH_A)).toMatchObject({ clock: 'CLOCKED_IN', queue: 'AVAILABLE', openShiftId: row.shiftId });
  });
});

describe('one OPEN punch per technician', () => {
  it('a double clock-in is ONE transition: the second call returns the same open punch, exactly one row', async () => {
    const again = await svc.clockIn(ctxA, TECH_A);
    expect(again.created).toBe(false);
    expect(await count(`select count(*)::int as n from technician_shifts where technician_id = $1 and end_time is null`, [TECH_A])).toBe(1);
  });
  it('three clock-ins in flight still yield exactly one open row and no 500', async () => {
    const ctxA2 = { ...ctxA, branchId: BA2 };   // Al works at the second branch — the clock is branch-scoped
    const results = await Promise.allSettled([svc.clockIn(ctxA2, TECH_A2), svc.clockIn(ctxA2, TECH_A2), svc.clockIn(ctxA2, TECH_A2)]);
    expect(results.map((r: any) => (r.status === 'fulfilled' ? 'ok' : String(r.reason?.message || r.reason)))).toEqual(['ok', 'ok', 'ok']);
    expect(results.filter((r: any) => r.value.created).length).toBe(1);
    expect(await count(`select count(*)::int as n from technician_shifts where technician_id = $1`, [TECH_A2])).toBe(1);
  });
  it('Fair Turn: a technician\'s FIRST clock-in joins the turn rotation exactly once (the workforce row is seeded from the open punch, so the clock move itself is a no-op — the turn queue still follows)', async () => {
    // Ana (first test) and Al (three racing clock-ins) never had a workforce row before their first punch
    // one JOIN per business day she clocked in on (the first test ran on a fixed earlier salon day)
    expect(await q(`select business_date::text as d, count(*)::int as n from technician_turn_events where technician_id = $1 and event_type = 'JOIN' group by 1 having count(*) <> 1`, [TECH_A])).toEqual([]);
    expect(await count(`select count(*)::int as n from technician_turn_events where technician_id = $1 and event_type = 'JOIN' and business_date = '2026-10-09'`, [TECH_A])).toBe(1);
    expect(await count(`select count(*)::int as n from technician_turn_events where technician_id = $1 and event_type = 'JOIN'`, [TECH_A2])).toBe(1);
    expect(await q(`select status, in_rotation from technician_turn_state where technician_id = $1`, [TECH_A2])).toEqual([{ status: 'READY', in_rotation: true }]);
  });
  it('clock-out finds the OPEN punch even when it started on an earlier salon day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T14:00:00.000Z'));   // next day 10:00 EDT
    const out = await svc.clockOut(ctxA, TECH_A);
    expect(out.state).toBe('clocked_out');
    expect(await count(`select count(*)::int as n from technician_shifts where technician_id = $1 and end_time is null`, [TECH_A])).toBe(0);
    expect(await wf.getTechnicianState(TA, TECH_A)).toMatchObject({ clock: 'CLOCKED_OUT', queue: 'OFF_SHIFT', openShiftId: null });
    await expect(svc.clockOut(ctxA, TECH_A)).rejects.toBeInstanceOf(TimeClockValidationError);   // nothing open now
  });
  it('a split shift the same day is two rows (the old day-unique 381 would have thrown)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T15:00:00.000Z'));
    const second = await svc.clockIn(ctxA, TECH_A);
    expect(second.created).toBe(true);
    const rows = await q(`select shift_date::text as d, end_time from technician_shifts where technician_id = $1 order by start_time`, [TECH_A]);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.end_time == null)).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-10T16:00:00.000Z'));
    await svc.clockOut(ctxA, TECH_A);
    vi.setSystemTime(new Date('2026-10-10T17:00:00.000Z'));
    const third = await svc.clockIn(ctxA, TECH_A);                 // in → out → in again on 2026-10-10
    expect(third.created).toBe(true);
    expect(await count(`select count(*)::int as n from technician_shifts where technician_id = $1 and shift_date = '2026-10-10'`, [TECH_A])).toBe(2);
  });
});

describe('breaks are part of the clock', () => {
  it('break start writes a technician_breaks row and the technician leaves AVAILABLE immediately; break end restores; clock-out closes an open break', async () => {
    const onBreak = await svc.breakStart(ctxA, TECH_A, { kind: 'lunch' });
    expect(onBreak.state).toBe('on_break');
    expect(await count(`select count(*)::int as n from technician_breaks where technician_id = $1 and ended_at is null`, [TECH_A])).toBe(1);
    expect(await wf.isAssignable(TA, TECH_A)).toBe(false);
    expect((await wf.getTechnicianState(TA, TECH_A))!.queue).toBe('BREAK');
    expect(await q(`select distinct status from technician_statuses where technician_id = $1`, [TECH_A])).toEqual([{ status: 'on_break' }]);
    await svc.breakStart(ctxA, TECH_A).catch(() => undefined);   // second start: one OPEN break only
    expect(await count(`select count(*)::int as n from technician_breaks where technician_id = $1 and ended_at is null`, [TECH_A])).toBe(1);
    const back = await svc.breakEnd(ctxA, TECH_A);
    expect(back.state).toBe('clocked_in');
    expect(await wf.isAssignable(TA, TECH_A)).toBe(true);
    await svc.breakStart(ctxA, TECH_A);
    await svc.clockOut(ctxA, TECH_A);
    expect(await count(`select count(*)::int as n from technician_breaks where technician_id = $1 and ended_at is null`, [TECH_A])).toBe(0);
  });
});

describe('manager corrections', () => {
  it('are transactional, branch-scoped and audited', async () => {
    const open = await svc.clockIn(ctxB, TECH_B);
    const mctxB = { tenantId: TB, branchId: BB, userId: UB, role: 'OWNER' };
    const endIso = new Date(Date.now() + 3_600_000).toISOString();
    const res = await mgmt.adjustTimecard(mctxB, open.shiftId, { endTime: endIso, reason: 'Missed clock-out' });
    expect(res.adjustments).toBe(1);
    expect(await count(`select count(*)::int as n from technician_timecard_adjustments where shift_id = $1`, [open.shiftId])).toBe(1);
    expect(await count(`select count(*)::int as n from audit_events where action = 'technician_timecard_adjusted' and resource_id = $1 and reason = 'Missed clock-out'`, [open.shiftId])).toBe(1);   // through modules/audit (audit_events)
    expect((await q(`select end_time, status from technician_shifts where id = $1`, [open.shiftId]))[0].status).toBe('completed');
    expect((await wf.getTechnicianState(TB, TECH_B))!.clock).toBe('CLOCKED_OUT');   // closing an open punch by correction IS a clock-out
  });
  it('a manager at another branch (or tenant) cannot see or correct the punch', async () => {
    const shift = (await q(`select id from technician_shifts where technician_id = $1`, [TECH_B]))[0].id;
    await expect(mgmt.adjustTimecard({ tenantId: TA, branchId: BA, userId: UA, role: 'OWNER' }, shift, { startTime: new Date().toISOString(), reason: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(mgmt.adjustTimecard({ tenantId: TB, branchId: BA2, userId: UB, role: 'OWNER' }, shift, { startTime: new Date().toISOString(), reason: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('when the audit row cannot be written, NOTHING is corrected (the trail and the punch roll back)', async () => {
    const shift = (await q(`select id, start_time from technician_shifts where technician_id = $1`, [TECH_B]))[0];
    const before = await count(`select count(*)::int as n from technician_timecard_adjustments where shift_id = $1`, [shift.id]);
    // Make ONLY the audit insert fail (the trail + punch writes are valid): a trigger that rejects this action type.
    await pg.exec(`create or replace function _reject_tc_audit() returns trigger as $$ begin if new.action = 'technician_timecard_adjusted' then raise exception 'audit sink down'; end if; return new; end $$ language plpgsql;
                   create trigger _reject_tc_audit_t before insert on audit_events for each row execute function _reject_tc_audit();`);
    try {
      const mctxB = { tenantId: TB, branchId: BB, userId: UB, role: 'OWNER' };
      await expect(mgmt.adjustTimecard(mctxB, shift.id, { startTime: new Date(Date.now() - 7_200_000).toISOString(), reason: 'late' })).rejects.toThrow(/audit sink down/);
      expect(await count(`select count(*)::int as n from technician_timecard_adjustments where shift_id = $1`, [shift.id])).toBe(before);   // trail rolled back
      expect(new Date((await q(`select start_time from technician_shifts where id = $1`, [shift.id]))[0].start_time).toISOString()).toBe(new Date(shift.start_time).toISOString());   // punch untouched
    } finally {
      await pg.exec(`drop trigger if exists _reject_tc_audit_t on audit_events; drop function if exists _reject_tc_audit();`);
    }
  });
});
