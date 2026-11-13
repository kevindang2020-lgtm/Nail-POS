// live-schedule-day-notes.pgtest — extras LIVE TECHNICIAN SCHEDULE 12 "Technician Day Notes": the day detail carries the notes
// already written on the technician's day by their owning records (a blocked time's note, an appointment's note), oldest
// first. Appointment notes are customer data: a role without pos.customers.view never receives them (counted as hidden).
// Another technician's, another day's, a cancelled appointment's and another salon's notes never appear. Nothing is written.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyLiveScheduleRepository } from './live-technician-schedule.kysely.repository';
import { LiveTechnicianScheduleService } from './live-technician-schedule.service';

const P = 'dd120000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const T = id('a1'), B = id('b1'), TX = id('a2'), BX = id('b2'), TECH = id('c1'), TECH2 = id('c2'), TECHX = id('c9');
const DAY = '2026-10-05';
const NOW = Date.parse('2026-10-05T15:00:00Z');
const full = { tenantId: T, branchId: B, userId: 'u1', role: 'OWNER', permissions: ['pos.technicians.view', 'pos.customers.view'] } as never;
const noCustomers = { tenantId: T, branchId: B, userId: 'u2', role: 'FRONT_DESK', permissions: ['pos.technicians.view'] } as never;
let pg: any; let svc: LiveTechnicianScheduleService;

beforeAll(async () => {
  pg = await migratedPglite(); const db = kyselyFor(pg); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Notes','Notes','dnotes','DNOT01','active'), ($2,'Other','Other','dnotes-x','DNOX01','active')`, [T, TX]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, BX, TX]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,'Anh','X','Anh X','active'), ($4,$2,$3,'Bao','X','Bao X','active'), ($5,$6,$7,'Other','X','Other X','active')`, [TECH, T, B, TECH2, TECHX, TX, BX]);
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,1,'09:00','18:00',true)`, [T, B, TECH]);
  await q(`insert into technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason, note) values
    ($1,$2,$3,$4,'13:00','13:30','training','Gel-X refresher with the trainer'),
    ($1,$2,$3,$4,'16:00','16:15','unavailable',null),
    ($1,$2,$3,'2026-10-06','10:00','10:30','training','next day — not shown'),
    ($1,$2,$5,$4,'11:00','11:30','training','other technician — not shown')`, [T, B, TECH, DAY, TECH2]);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status, notes) values
    ($1,$2,$3,'Ava Kim',$4,'10:00','10:45','booked','Allergic to acrylic — use gel only'),
    ($1,$2,$3,'Ben Lo',$4,'11:00','11:45','booked',''),
    ($1,$2,$3,'Cara Gone',$4,'12:00','12:30','cancelled','cancelled — not shown')`, [T, B, TECH, DAY]);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status, notes) values ($1,$2,$3,'X',$4,'10:00','10:30','booked','other salon')`, [TX, BX, TECHX, DAY]);
  const repo = new KyselyLiveScheduleRepository(db); repo.now = () => NOW;
  svc = new LiveTechnicianScheduleService(repo);
});

describe('Technician Day Notes (extras LIVE TECHNICIAN SCHEDULE 12)', () => {
  it('a role with customer access sees the blocked-time note and the appointment note of that day, oldest first; nothing else', async () => {
    const d: any = await svc.detail(full, TECH, DAY);
    expect(d.dayNotes).toEqual([
      { kind: 'appointment', sourceId: expect.any(String), startTime: '10:00', endTime: '10:45', text: 'Allergic to acrylic — use gel only', customerName: 'Ava Kim' },
      { kind: 'blocked_time', sourceId: expect.any(String), startTime: '13:00', endTime: '13:30', text: 'Gel-X refresher with the trainer', reason: 'training' },
    ]);
    expect(d.dayNotesHidden).toBe(0);
    expect(JSON.stringify(d.dayNotes)).not.toMatch(/not shown|other salon/);
  });
  it('the privacy guard: without pos.customers.view the appointment note is left out on the server and counted as hidden', async () => {
    const d: any = await svc.detail(noCustomers, TECH, DAY);
    expect(d.dayNotes).toEqual([expect.objectContaining({ kind: 'blocked_time', text: 'Gel-X refresher with the trainer' })]);
    expect(d.dayNotesHidden).toBe(1);
    expect(JSON.stringify(d)).not.toContain('Allergic');
  });
  it('a technician with no notes that day gets an empty list, and reading wrote nothing', async () => {
    const before = (await pg.query(`select (select count(*) from technician_blocked_times)::int b, (select count(*) from pos_tech_appointments)::int a`)).rows[0];
    const d: any = await svc.detail(full, TECH2, '2026-10-07');
    expect(d.dayNotes).toEqual([]); expect(d.dayNotesHidden).toBe(0);
    expect((await pg.query(`select (select count(*) from technician_blocked_times)::int b, (select count(*) from pos_tech_appointments)::int a`)).rows[0]).toEqual(before);
  });
});
