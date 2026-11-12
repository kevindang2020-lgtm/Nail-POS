// live-schedule-presence.pgtest — Shift-vs-Clock-In (extras, Live Technician Schedule #04): each board column carries the
// time clock's state (technician_workforce_state 579, or an open punch when there is no workforce row) BESIDE the shift,
// and says whether the shift is a SCHEDULED one or only an open punch drawn as a shift. Unknown stays null — never guessed.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyLiveScheduleRepository } from './live-technician-schedule.kysely.repository';

const T = 'aaaabbbb-0000-4000-8000-000000000001';
const B = 'aaaabbbb-0000-4000-8000-000000000002';
const SCHED_OUT = 'aaaabbbb-0000-4000-8000-000000000011';    // scheduled Monday, clocked out
const PUNCH_ONLY = 'aaaabbbb-0000-4000-8000-000000000012';   // no schedule, an open punch, no workforce row
const SCHED_BREAK = 'aaaabbbb-0000-4000-8000-000000000013';  // scheduled, on break
const SCHED_NONE = 'aaaabbbb-0000-4000-8000-000000000014';   // scheduled, no clock record at all
const NOW = Date.parse('2026-10-05T15:00:00Z');              // 11:00 am Mon Oct 5, New York
const ctx = { tenantId: T, branchId: B, userId: 'u1', role: 'OWNER', permissions: ['*'] } as never;
let db: any; let pg: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Presence LLC','Presence','presence','PRES01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  for (const [id, n] of [[SCHED_OUT, 'Anh Out'], [PUNCH_ONLY, 'Bao Punch'], [SCHED_BREAK, 'Chi Break'], [SCHED_NONE, 'Dung None']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,'X',$4,'active')`, [id, T, B, n]);
  for (const id of [SCHED_OUT, SCHED_BREAK, SCHED_NONE])
    await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,1,'09:00','17:00',true)`, [T, B, id]);
  await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, clock_status, queue_status) values ($1,$2,$3,'CLOCKED_OUT','OFF_SHIFT'), ($1,$2,$4,'ON_BREAK','BREAK')`, [T, B, SCHED_OUT, SCHED_BREAK]);
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,'2026-10-05','2026-10-05T14:00:00Z',null,'active')`, [T, B, PUNCH_ONLY]);
});

const board = async () => { const r = new KyselyLiveScheduleRepository(db); r.now = () => NOW; const st: any = await r.state(ctx, {} as never); return new Map<string, any>(st.technicians.map((c: any) => [c.technicianId, c])); };

describe('Live schedule — shift vs clock-in', () => {
  it('a scheduled technician who has not clocked in: scheduled shift, clocked_out', async () => {
    const c = (await board()).get(SCHED_OUT);
    expect(c.shift).toMatchObject({ startTime: '09:00', endTime: '17:00' });
    expect(c.shiftScheduled).toBe(true); expect(c.clock).toBe('clocked_out');
  });
  it('an open punch with no schedule shows on the board, but the shift is NOT a scheduled one; the punch is the clock', async () => {
    const c = (await board()).get(PUNCH_ONLY);
    expect(c.shift).toBeTruthy(); expect(c.shiftScheduled).toBe(false); expect(c.clock).toBe('clocked_in');
  });
  it('on break comes from the clock; no clock record stays unknown (null), never "clocked out"', async () => {
    const m = await board();
    expect(m.get(SCHED_BREAK).clock).toBe('on_break'); expect(m.get(SCHED_BREAK).shiftScheduled).toBe(true);
    expect(m.get(SCHED_NONE).clock).toBeNull(); expect(m.get(SCHED_NONE).shiftScheduled).toBe(true);
  });
});
