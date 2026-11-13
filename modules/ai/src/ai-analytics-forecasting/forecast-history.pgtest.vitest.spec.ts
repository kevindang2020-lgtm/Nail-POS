// forecast-history.pgtest — AI Analytics & Forecasting guide (Nov 1 2026) on the REAL schema: the appointment history comes from
// the booking calendar, one point per salon day from the first booked day to yesterday, quiet days counted as 0, cancelled
// appointments excluded, today left out (not over), another branch / salon never counted. The readiness the screen shows is the
// number the forecast is refused on.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BookingCalendarAppointmentSource, zeroFill, ScheduleCapacitySource, overrideMinutes, overlapMinutes } from './forecast-history.kysely.source';
import { AppointmentForecastService, capacityGap } from './appointment-forecast.service';

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

// Extras (AI Analytics Forecasting 03): forecast workload vs scheduled technician hours — read-only
describe('Forecast-to-capacity gap', () => {
  const TA = 'c7732000-0000-4000-8000-000000000001', TB = 'c7732000-0000-4000-8000-000000000002', TOFF = 'c7732000-0000-4000-8000-000000000003', TX = 'c7732000-0000-4000-8000-000000000004';
  beforeAll(async () => {
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values
      (${TA}, ${T}, ${B}, 'Ana', 'A', 'Ana A', true), (${TB}, ${T}, ${B}, 'Bao', 'B', 'Bao B', true), (${TOFF}, ${T}, ${B}, 'Old', 'O', 'Old O', false), (${TX}, ${T}, ${B2}, 'Nor', 'N', 'Nor N', true)`);
    // Tuesday (dow 2): Ana 9-17 with a 1h lunch (420 min), Bao 10-14 (240); the inactive tech and the other branch never count
    await q(sql`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time) values
      (${T}, ${B}, ${TA}, 2, '09:00', '17:00', '12:00', '13:00'), (${T}, ${B}, ${TB}, 2, '10:00', '14:00', null, null),
      (${T}, ${B}, ${TOFF}, 2, '09:00', '17:00', null, null), (${T}, ${B2}, ${TX}, 2, '09:00', '17:00', null, null)`);
    // Tue Nov 10: Bao takes the day off (override beats the template); Tue Nov 17: Ana works a custom 12-18 with a 30 min break
    await q(sql`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type) values (${T}, ${B}, ${TB}, '2026-11-10', 'America/New_York', 'DAY_OFF')`);
    await q(sql`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type, start_local_time, end_local_time, breaks_json)
      values (${T}, ${B}, ${TA}, '2026-11-17', 'America/New_York', 'CUSTOM_SHIFT', '12:00', '18:00', ${JSON.stringify([{ type: 'unpaid', startLocalTime: '15:00', endLocalTime: '15:30' }])}::jsonb)`);
  });
  it('CAP-01 scheduled minutes: weekly template minus lunch, date overrides win, inactive / other-branch techs excluded; duration from booked history', async () => {
    const cap = await new ScheduleCapacitySource(db, () => NOW).getCapacity(ctx, ['2026-11-03', '2026-11-04', '2026-11-10', '2026-11-17']);
    const z = { timeOffMinutes: 0, blockedMinutes: 0, uncoveredServices: [] };
    expect(cap.days).toEqual([
      { date: '2026-11-03', scheduledMinutes: 660, technicians: 2, ...z },
      { date: '2026-11-04', scheduledMinutes: 0, technicians: 0, ...z },
      { date: '2026-11-10', scheduledMinutes: 420, technicians: 1, ...z },
      { date: '2026-11-17', scheduledMinutes: 570, technicians: 2, ...z },
    ]);
    // the seeded appointments are 10:00–10:45; the duration column is the stored one (default 0 → excluded), so no sample yet
    expect(cap.avgAppointmentMinutes).toBeNull();
    await q(sql`update pos_tech_appointments set duration_minutes = 45 where tenant_id = ${T} and branch_id = ${B} and status <> 'cancelled'`);
    const cap2 = await new ScheduleCapacitySource(db, () => NOW).getCapacity(ctx, ['2026-11-03']);
    expect(cap2.avgAppointmentMinutes).toBe(45);
    expect(cap2.durationSample).toBe(6);   // today and the cancelled one are not history
  });
  it('CAP-02 the gap: short / tight / ok / no_schedule, and unknown when there is no duration history', () => {
    const cap = { days: [{ date: 'a', scheduledMinutes: 600, technicians: 2 }, { date: 'b', scheduledMinutes: 600, technicians: 2 }, { date: 'c', scheduledMinutes: 600, technicians: 2 }, { date: 'd', scheduledMinutes: 0, technicians: 0 }], avgAppointmentMinutes: 60, durationSample: 30, durationWindowDays: 56 };
    const g = capacityGap([{ date: 'a', point: 12, lower: 9, upper: 15 }, { date: 'b', point: 8, lower: 6, upper: 11 }, { date: 'c', point: 5, lower: 3, upper: 7 }, { date: 'd', point: 2, lower: 0, upper: 4 }], cap);
    expect(g.days.map((d) => [d.state, d.expectedMinutes, d.gapMinutes])).toEqual([['short', 720, -120], ['tight', 480, 120], ['ok', 300, 300], ['no_schedule', 120, -120]]);
    const u = capacityGap([{ date: 'a', point: 12, lower: 9, upper: 15 }], { ...cap, avgAppointmentMinutes: null });
    expect(u.days[0]).toMatchObject({ state: 'unknown', expectedMinutes: null, gapMinutes: null, scheduledMinutes: 600 });
  });
  it('extras AI Analytics Forecasting 20: approved time off and blocked time come off only the working windows; the most-booked services are checked against who works that day', async () => {
    const SV = 'c7732000-0000-4000-8000-0000000000a1';
    // Tue Nov 24: Ana 9-17 (lunch 12-13) has approved time off 08:00-10:00 local (only 60 min of it is inside her shift) and a
    // pending one 14:00-15:00 (ignored); Bao 10-14 is blocked 13:00-15:00 (60 min inside his shift); a rejected day off is ignored
    await q(sql`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status) values
      (${T}, ${B}, ${TA}, ('2026-11-24 08:00'::timestamp at time zone 'America/New_York'), ('2026-11-24 10:00'::timestamp at time zone 'America/New_York'), 'approved'),
      (${T}, ${B}, ${TA}, ('2026-11-24 14:00'::timestamp at time zone 'America/New_York'), ('2026-11-24 15:00'::timestamp at time zone 'America/New_York'), 'pending'),
      (${T}, ${B}, ${TB}, ('2026-11-24 00:00'::timestamp at time zone 'America/New_York'), ('2026-11-25 00:00'::timestamp at time zone 'America/New_York'), 'rejected')`);
    await q(sql`insert into technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason) values (${T}, ${B}, ${TB}, '2026-11-24', '13:00', '15:00', 'training')`);
    const cap = await new ScheduleCapacitySource(db, () => NOW).getCapacity(ctx, ['2026-11-24']);
    expect(cap.days[0]).toMatchObject({ scheduledMinutes: 660 - 60 - 60, technicians: 2, timeOffMinutes: 60, blockedMinutes: 60 });
    // a whole approved day off removes that technician from the day
    await q(sql`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status) values (${T}, null, ${TB}, ('2026-12-01 00:00'::timestamp at time zone 'America/New_York'), ('2026-12-02 00:00'::timestamp at time zone 'America/New_York'), 'approved')`);
    expect((await new ScheduleCapacitySource(db, () => NOW).getCapacity(ctx, ['2026-12-01'])).days[0]).toMatchObject({ scheduledMinutes: 420, technicians: 1, timeOffMinutes: 240 });
    // skills: a booked service only Bao is approved for is uncovered on Dec 1 (Bao off) and covered on Nov 24
    const CAT = 'c7732000-0000-4000-8000-0000000000a2';
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name, status) values (${CAT}, ${T}, ${B}, 'Nails', 'active') on conflict do nothing`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SV}, ${T}, ${B}, ${CAT}, 'Gel X', 60, 5000, 'active') on conflict do nothing`);
    await q(sql`update pos_tech_appointments set services = ${JSON.stringify([{ serviceId: SV }])}::jsonb where tenant_id = ${T} and branch_id = ${B}`);
    await q(sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values (${T}, ${B}, ${TB}, ${SV}, true)`);
    const two = await new ScheduleCapacitySource(db, () => NOW).getCapacity(ctx, ['2026-11-24', '2026-12-01']);
    expect(two.topServices).toEqual(['Gel X']);
    expect(two.days.map((d) => d.uncoveredServices)).toEqual([[], ['Gel X']]);
    const g = capacityGap([{ date: '2026-12-01', point: 3, lower: 2, upper: 4 }], two);
    expect(g.days[0]).toMatchObject({ uncoveredServices: ['Gel X'], timeOffMinutes: 240 }); expect(g.topServices).toEqual(['Gel X']);
    expect(overlapMinutes([[540, 720], [780, 1020]], 480, 600)).toBe(60);
  });
  it('CAP-03 overnight overrides count their full length; a day off is 0', () => {
    expect(overrideMinutes({ override_type: 'CUSTOM_SHIFT', start_local_time: '22:00', end_local_time: '02:00', ends_next_day: true, breaks_json: [] })).toBe(240);
    expect(overrideMinutes({ override_type: 'DAY_OFF', start_local_time: null, end_local_time: null, ends_next_day: false, breaks_json: [] })).toBe(0);
  });
  it('CAP-04 the forecast response carries the gap only when a capacity reader is wired; nothing is written', async () => {
    const series = Array.from({ length: 28 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, value: 6 }));
    const reader = { getCapacity: async (_c: unknown, dates: string[]) => ({ days: dates.map((d) => ({ date: d, scheduledMinutes: 300, technicians: 1 })), avgAppointmentMinutes: 60, durationSample: 10, durationWindowDays: 56 }) };
    const withCap = await new AppointmentForecastService({ getDailyAppointments: async () => series }, reader).getAppointmentForecast(ctx, 3);
    expect(withCap.capacity?.days).toHaveLength(3);
    expect(withCap.capacity?.days[0]).toMatchObject({ date: '2026-10-29', scheduledMinutes: 300, expectedMinutes: 360, state: 'short' });
    const without = await new AppointmentForecastService({ getDailyAppointments: async () => series }).getAppointmentForecast(ctx, 3);
    expect(without.capacity).toBeUndefined();
  });
});
