// live-schedule-gap-quality.pgtest — round 10 (LIVE TECHNICIAN SCHEDULE 03) "Gap Quality Indicator": each open gap of the day
// detail says its minutes, the salon's SAVED booking buffer, the minutes left for a service and which of this location's active
// services fit (count + the longest). Archived / inactive / another salon's services never count. Reading writes nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyLiveScheduleRepository } from './live-technician-schedule.kysely.repository';
import { LiveTechnicianScheduleService } from './live-technician-schedule.service';

const P = 'dd030000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), TX = id('a2'), BX = id('b2'), TECH = id('c1');
const DAY = '2026-10-05';
const ctx = { tenantId: T, branchId: B, userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view'] } as never;
let pg: any; let svc: LiveTechnicianScheduleService;

beforeAll(async () => {
  pg = await migratedPglite(); const db = kyselyFor(pg); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Gap','Gap','gapq','GAPQ01','active'), ($2,'Other','Other','gapq-x','GAPX01','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, BX, TX]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Anh','X','Anh X','active')`, [TECH, T, B]);
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,1,'09:00','18:00',true)`, [T, B, TECH]);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) values ($1,$2,$3,'Ava',$4,'10:00','17:00','booked')`, [T, B, TECH, DAY]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails'), ($4,$5,$6,'Nails')`, [id('d1'), T, B, id('d2'), TX, BX]);
  await q(`insert into services (tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, archived_at) values
    ($1,$2,$3,'Gel manicure',45,4000,'active',null), ($1,$2,$3,'Pedicure',60,5000,'active',null), ($1,$2,$3,'Express polish',15,1500,'active',null),
    ($1,$2,$3,'Old service',20,1000,'active',now()), ($1,$2,$3,'Paused',10,1000,'inactive',null), ($4,$5,$6,'Other salon',5,1000,'active',null)`, [T, B, id('d1'), TX, BX, id('d2')]);
  const repo = new KyselyLiveScheduleRepository(db); repo.now = () => Date.parse('2026-10-05T12:00:00Z');
  svc = new LiveTechnicianScheduleService(repo);
});

describe('Gap Quality Indicator', () => {
  it('each gap: minutes, the engine default buffer when none is saved, usable minutes, active services that fit and the longest', async () => {
    const d: any = await svc.detail(ctx, TECH, DAY);
    const morning = d.gapQuality.find((g: any) => g.startTime === '09:00');
    expect(morning).toMatchObject({ endTime: '10:00', minutes: 60, bufferMinutes: 5, usableMinutes: 55, servicesFit: 2, servicesTotal: 3, longestFit: { name: 'Gel manicure', minutes: 45 } });
    const evening = d.gapQuality.find((g: any) => g.startTime === '17:00');
    expect(evening).toMatchObject({ minutes: 60, servicesFit: 2 });
    expect(d.gapQuality.length).toBe(d.openSlots.length);
  });
  it('the salon\'s saved buffer (a location row wins) changes what fits; nothing is written', async () => {
    await pg.query(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'booking-appointments', '{"bufferMinutes":0}'::jsonb), ($1, $2, 'booking-appointments', '{"bufferMinutes":20}'::jsonb)`, [T, B]);
    const before = (await pg.query(`select count(*)::int n from pos_tech_appointments`)).rows[0];
    const d: any = await svc.detail(ctx, TECH, DAY);
    expect(d.gapQuality.find((g: any) => g.startTime === '09:00')).toMatchObject({ bufferMinutes: 20, usableMinutes: 40, servicesFit: 1, longestFit: { name: 'Express polish', minutes: 15 } });
    expect((await pg.query(`select count(*)::int n from pos_tech_appointments`)).rows[0]).toEqual(before);
  });
  it('round 10 (07): the detail says how many minutes until the next appointment on today\'s clock (null for another day)', async () => {
    const repo = new KyselyLiveScheduleRepository(kyselyFor(pg)); repo.now = () => Date.parse('2026-10-05T13:45:00Z');   // 09:45 at the location
    const d: any = await new LiveTechnicianScheduleService(repo).detail(ctx, TECH, DAY);
    expect(d.nextAppointment).toMatchObject({ startTime: '10:00' });
    expect(d.nextInMinutes).toBe(15);
    const other: any = await new LiveTechnicianScheduleService(repo).detail(ctx, TECH, '2026-10-12');
    expect(other.nextInMinutes ?? null).toBeNull();
  });
});

