// customer-follow-up-status.pgtest — extras Customer 05 "Smart customer follow-up status", against the REAL schema: the
// customer detail carries advisory indicators from each system of record — upcoming bookings (booked / confirmed from the
// salon's today), open / overdue AI follow-ups (only for a viewer of that queue; otherwise unknown, never zero) and whether
// the contact details are complete and verified. Reading changes nothing and sends nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { CustomersService } from './customers.service';

const P = 'c5e72000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), C = id('c1'), C0 = id('c2'), MIA = id('e001');
const viewer = { tenantId: T, branchId: B, userId: id('ee1'), role: 'FRONT_DESK', permissions: ['pos.customers.view'] } as any;
const owner = { ...viewer, role: 'OWNER', permissions: ['pos.customers.view', 'ai.use'] };
let pg: any; let svc: CustomersService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Fu LLC','Fu','cust-fu','CFU001','active'), ($2,'Other LLC','Other','cust-fu2','CFU002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Else','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [MIA, T, B]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, phone_verified_at) values
    ($1,$2,$3,'Ann','Guest','Ann Guest','+12155550101','(215) 555-0101',null,null),
    ($4,$2,$3,'Bo','Done','Bo Done','+12155550102','(215) 555-0102','bo@example.com',now())`, [C, T, B, C0]);
  const svcJson = JSON.stringify([{ serviceName: 'Gel', durationMinutes: 45, priceCents: 4500 }]);
  const today = `(now() at time zone 'America/New_York')::date`;
  // upcoming: in 3 days (booked) and in 10 days (confirmed); NOT counted: yesterday's booked, a cancelled one in 2 days
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source) values
    ($1,$2,$3,$4,'Ann',$5,${today} + 10,'09:30','10:15',45,'confirmed','phone'),
    ($1,$2,$3,$4,'Ann',$5,${today} + 3,'14:00','14:45',45,'booked','online'),
    ($1,$2,$3,$4,'Ann',$5,${today} - 1,'11:00','11:45',45,'booked','online'),
    ($1,$2,$3,$4,'Ann',$5,${today} + 2,'11:00','11:45',45,'cancelled','online')`, [T, B, MIA, C, svcJson]);
  await q(`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, status, customer_id, due_at) values
    ($1,$2,'CALLBACK','open',$3, now() - interval '2 hours'),
    ($1,$2,'CALLBACK','assigned',$3, now() + interval '1 day'),
    ($1,$2,'CALLBACK','resolved',$3, now() - interval '5 days')`, [T, B, C]);
  svc = new CustomersService(new KyselyCustomersRepository(kyselyFor(pg) as never));
}, 180_000);

describe('Customer detail — advisory follow-up status (read-only)', () => {
  it('counts only live upcoming bookings from the salon\'s today and names the next one', async () => {
    const d = await svc.detail(owner, C);
    const day = (await q(`select ((now() at time zone 'America/New_York')::date + 3)::text as d`)).rows[0].d;
    expect(d.followUpStatus!.upcoming).toEqual({ count: 2, nextDate: day, nextTime: '14:00' });
    expect(d.followUpStatus!.salonDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('open follow-ups and the overdue one are counted for a viewer of the follow-up queue; resolved ones never', async () => {
    const f = (await svc.detail(owner, C)).followUpStatus!.followUps!;
    expect({ active: f.active, overdue: f.overdue }).toEqual({ active: 2, overdue: 1 });
    expect(new Date(f.nextDueAt!).getTime()).toBeLessThan(Date.now());
  });
  it('without the follow-up permission the count is unknown (null), not zero', async () => {
    expect((await svc.detail(viewer, C)).followUpStatus!.followUps).toBeNull();
  });
  it('contact completeness: missing email + unverified phone vs a complete verified profile', async () => {
    expect((await svc.detail(owner, C)).followUpStatus!.contact).toEqual({ hasPhone: true, phoneVerified: false, hasEmail: false });
    const done = (await svc.detail(owner, C0)).followUpStatus!;
    expect(done.contact).toEqual({ hasPhone: true, phoneVerified: true, hasEmail: true });
    expect(done.upcoming.count).toBe(0); expect(done.followUps).toEqual({ active: 0, overdue: 0, nextDueAt: null });
  });
  it('reads only: nothing about the bookings or follow-ups changes, and another salon cannot open the customer', async () => {
    const before = (await q(`select (select count(*) from pos_tech_appointments)::int a, (select string_agg(status, ',' order by status) from ai_receptionist_follow_ups) f, (select count(*) from notifications)::int n`)).rows[0];
    await svc.detail(owner, C);
    expect((await q(`select (select count(*) from pos_tech_appointments)::int a, (select string_agg(status, ',' order by status) from ai_receptionist_follow_ups) f, (select count(*) from notifications)::int n`)).rows[0]).toEqual(before);
    await expect(svc.detail({ ...owner, tenantId: T2, branchId: B2 }, C)).rejects.toThrow();
  });
  it('the customer detail says whether the phone was confirmed (phone_verified_at was never read before, so every customer said "not verified")', async () => {
    expect((await svc.detail(owner, C0)).isPhoneVerified).toBe(true);
    expect((await svc.detail(owner, C)).isPhoneVerified).toBe(false);
  });;
});
