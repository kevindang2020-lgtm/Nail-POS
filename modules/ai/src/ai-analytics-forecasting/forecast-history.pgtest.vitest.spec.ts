// forecast-history.pgtest — AI Analytics & Forecasting guide (Nov 1 2026) on the REAL schema: the appointment history comes from
// the booking calendar, one point per salon day from the first booked day to yesterday, quiet days counted as 0, cancelled
// appointments excluded, today left out (not over), another branch / salon never counted. The readiness the screen shows is the
// number the forecast is refused on.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BookingCalendarAppointmentSource, zeroFill } from './forecast-history.kysely.source';
import { AppointmentForecastService } from './appointment-forecast.service';

const T = 'c7730000-0000-4000-8000-000000000001', B = 'c7730000-0000-4000-8000-000000000002', B2 = 'c7730000-0000-4000-8000-000000000003', X = 'c7730000-0000-4000-8000-000000000004';
const ctx = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: ['reports.view', 'pos.ai_analytics.view'] } as any;
let db: any; let src: BookingCalendarAppointmentSource;
const NOW = new Date('2026-11-02T17:00:00Z');   // Nov 2, noon in New York
const q = async (s: any) => (await s.execute(db)).rows as any[];
// an appointment needs its technician (NOT NULL); one technician per appointment so the no-overlap rule never bites
let techN = 0;
const appt = async (t: string, b: string, day: string, status = 'booked') => {
  const tech = `c7731000-0000-4000-8000-${String(++techN).padStart(12, '0')}`;
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${tech}, ${t}, ${b}, 'Tech', ${String(techN)}, ${'Tech ' + techN})`);
  return q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) values (${t}, ${b}, ${tech}, 'Guest', ${day}::date, '10:00', '10:45', ${status})`);
};

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  src = new BookingCalendarAppointmentSource(db, () => NOW);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'fc-773', 'FC773', 'active'), (${X}, 'X', 'Other', 'fc-773x', 'FC773X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'North', 'America/New_York')`);
  await q(sql`set session_replication_role = replica`);
  for (const d of ['2026-10-20', '2026-10-20', '2026-10-22', '2026-10-25', '2026-10-31', '2026-11-01']) await appt(T, B, d);
  await appt(T, B, '2026-10-23', 'cancelled');       // cancelled: not counted
  await appt(T, B, '2026-11-02');                     // today: not over, not counted
  await appt(T, B2, '2026-10-21'); await appt(X, B, '2026-10-21');   // another branch / salon
  await q(sql`set session_replication_role = origin`);
});

describe('Forecast history from the booking calendar', () => {
  it('FH-01 one point per day from the first booked day to yesterday; quiet and closed days are 0; cancelled, today, other branch / salon excluded', async () => {
    const s = await src.getDailyAppointments(ctx, 180);
    expect(s[0]).toEqual({ date: '2026-10-20', value: 2 });
    expect(s[s.length - 1]).toEqual({ date: '2026-11-01', value: 1 });
    expect(s.length).toBe(13);                                       // Oct 20 … Nov 1
    expect(s.find((p) => p.date === '2026-10-21')?.value).toBe(0);  // other branch / salon not counted
    expect(s.find((p) => p.date === '2026-10-23')?.value).toBe(0);  // cancelled not counted
    expect(s.reduce((a, p) => a + p.value, 0)).toBe(6);
  });
  it('FH-02 the readiness is the number the forecast is refused on (13 of 14 → not ready, 1 day short)', async () => {
    const svc = new AppointmentForecastService(src);
    expect(await svc.readiness(ctx)).toMatchObject({ historyDays: 13, minimum: 14, ready: false, daysShort: 1, firstDay: '2026-10-20', lastDay: '2026-11-01' });
    await expect(svc.getAppointmentForecast(ctx, 7)).rejects.toThrow();
  });
  it('FH-03 zeroFill keeps the range and fills the gaps', () => {
    expect(zeroFill([{ date: '2026-01-01', value: 3 }, { date: '2026-01-03', value: 1 }], '2026-01-01', '2026-01-04').map((p) => p.value)).toEqual([3, 0, 1, 0]);
  });
});
