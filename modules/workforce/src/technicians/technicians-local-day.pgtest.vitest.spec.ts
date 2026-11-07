// technicians-local-day.pgtest — the POS Technicians screen's "today" is the BRANCH's day (Oct 6 2026). The clock is fixed
// at 9:30 pm Monday Oct 5 in New York (01:30 UTC Tuesday); each figure gets a row from 10 am today and one from 11 pm
// last night (Monday in UTC) and must count exactly the first.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';
import { TechCashHandoffRepository } from '../tech-cash-handoff/tech-cash-handoff.repository';

const T = 'cececece-0000-4000-8000-000000000001';
const B = 'cececece-0000-4000-8000-000000000002';
const C = 'cececece-0000-4000-8000-000000000003';
const TECH = 'cececece-0000-4000-8000-000000000004';
const TK1 = 'cececece-0000-4000-8000-000000000010';
const TK2 = 'cececece-0000-4000-8000-000000000011';
const NOW = Date.parse('2026-10-06T01:30:00Z');
const TEN_AM = '2026-10-05T14:00:00Z', ELEVEN_PM_SUN = '2026-10-05T03:00:00Z', NINE_PM = '2026-10-06T01:00:00Z';
const ctx: any = { tenantId: T, branchId: B, userId: 'cececece-0000-4000-8000-0000000000c1', role: 'OWNER', permissions: ['*'] };
let repo: KyselyTechniciansRepository; let pg: any;

beforeAll(async () => {
  pg = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Tech Day LLC','Tech Day','tech-day','TDAY01','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Day','Guest','Day Guest')`, [C, T, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Mia','Chen','Mia Chen','active')`, [TECH, T, B]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, service_done_at) values ($1,$3,$4,$5,'service_done',$6), ($2,$3,$4,$5,'service_done',$7)`, [TK1, TK2, T, B, C, TEN_AM, ELEVEN_PM_SUN]);
  const line = `insert into ticket_service_lines (tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, created_at) values ($1,$2,$3,$4,'00000000-0000-0000-0000-000000000000','Gel Manicure',$5,45,$5,'completed',$6)`;
  await q(line, [T, B, TK1, TECH, 4500, TEN_AM]);
  await q(line, [T, B, TK1, TECH, 1000, NINE_PM]);           // 9 pm tonight — Tuesday in UTC, still today here
  await q(line, [T, B, TK2, TECH, 9900, ELEVEN_PM_SUN]);
  // cash Mia collected: 10 am and 9 pm tonight (Tuesday in UTC), and 11 pm last night (Monday in UTC)
  const cash = `insert into cash_payment_confirmations (tenant_id, branch_id, ticket_id, customer_id, technician_id, amount_cents, confirmed_at, status) values ($1,$2,$3,$4,$5,$6,$7,'confirmed')`;
  await q(cash, [T, B, TK1, C, TECH, 2000, TEN_AM]);
  await q(cash, [T, B, TK1, C, TECH, 1500, NINE_PM]);
  await q(cash, [T, B, TK2, C, TECH, 4000, ELEVEN_PM_SUN]);
  repo = new KyselyTechniciansRepository(kyselyFor(pg) as never); (repo as any).now = () => NOW;
});

describe('Technicians count the branch\'s day', () => {
  it('today\'s sales: 10 am + 9 pm tonight = $55 — not last night\'s $99, and not missing tonight\'s $10', async () => {
    const r: any = await repo.query(ctx, {} as never);
    expect(r.kpisFull.todaySalesCents).toBe(5500);
  });
  it('services completed today: the two lines on the 10 am ticket', async () => {
    const r: any = await repo.query(ctx, {} as never);
    expect(r.kpisFull.totalServicesCompletedToday).toBe(2);
  });
  // Re-pinned (Technician Profile merge, Oct 12 2026): the roster no longer writes punches — every clock change goes
  // through the ONE time clock (open punch + breaks + workforce state), whose branch-local date key is pinned in
  // time-clock.pgtest ("the salon-local date key"). A roster setShift is refused and writes nothing.
  it('a roster shift write is refused (the time clock owns punches) and nothing is filed', async () => {
    await expect(repo.setShift(ctx, TECH, { shiftStatus: 'on_shift' } as never)).rejects.toThrow(/time clock/);
    const rows = (await pg.query(`select 1 from technician_shifts where technician_id = $1`, [TECH])).rows;
    expect(rows).toEqual([]);
    expect((await repo.getShift(ctx, TECH))?.shiftStatus ?? 'clocked_out').toBe('clocked_out');
  });
});

describe('a technician\'s cash hand-off is the branch\'s business day', () => {
  it('defaults to Monday at 9:30 pm, and Monday\'s cash is 10 am $20 + 9 pm $15 — last night\'s $40 is Sunday\'s', async () => {
    const h = new TechCashHandoffRepository(kyselyFor(pg) as never); h.now = () => NOW;
    expect(await h.today(ctx)).toBe('2026-10-05');
    const mon = await h.expectedCashForTech(ctx, TECH, '2026-10-05');
    expect([mon.expectedCents, mon.paymentCount]).toEqual([3500, 2]);
    expect((await h.expectedCashForTech(ctx, TECH, '2026-10-04')).expectedCents).toBe(4000);
    expect((await h.listForDay(ctx, '2026-10-05')).map((x: any) => x.expectedCents)).toEqual([3500]);
  });
});

describe('F5 §32 (Nov 6 2026): a technician schedule edit is version-checked', () => {
  it('two editors read version N; the first save wins, the second gets VERSION_CONFLICT and nothing is overwritten', async () => {
    const day = (start: string) => ({ isWorking: true, startTime: start, endTime: '18:00' } as any);
    const v0 = (await repo.getSchedule(ctx, TECH))!.version ?? 0;
    await repo.setSchedule(ctx, TECH, { weekly: { monday: day('09:00') }, unavailableDates: [], expectedVersion: v0 });
    const after = (await repo.getSchedule(ctx, TECH))!;
    expect(after.weekly.monday?.startTime.slice(0, 5)).toBe('09:00');
    await expect(repo.setSchedule(ctx, TECH, { weekly: { monday: day('11:00') }, unavailableDates: [], expectedVersion: v0 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await repo.getSchedule(ctx, TECH))!.weekly.monday?.startTime.slice(0, 5)).toBe('09:00');
    await repo.setSchedule(ctx, TECH, { weekly: { monday: day('11:00') }, unavailableDates: [], expectedVersion: after.version });
    expect((await repo.getSchedule(ctx, TECH))!.weekly.monday?.startTime.slice(0, 5)).toBe('11:00');
  });
});
