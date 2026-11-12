// serving-guest-details.pgtest — w4 sweep SW-08 (Oct 13 2026): the Serving ticket's "Guest Service Details" never showed
// the guest's loyalty points OR their preferred technician. detail() selected customers.points_balance — a column that
// lives on customer_loyalty_profiles, not customers — so PostgreSQL refused the whole statement, .catch(() => undefined)
// hid it, and both fields were always blank (found in the PostgreSQL error log during the live route sweep).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyServingRepository } from './serving.kysely.repository';

const P = 'c5e60000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), BA = id('b1'), CUST = id('c0'), MIA = id('e001'), SVC = id('d001'), CAT = id('c100'), TK = id('f001');
const ctx = { tenantId: TA, branchId: BA, userId: id('ee1'), role: 'OWNER', permissions: ['pos.serving.view'] } as any;
let repo: KyselyServingRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Guest LLC','Guest','serve-guest','SRVG01','active')`, [TA]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [BA, TA]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Mia','C','Mia C','active',true)`, [MIA, TA, BA]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, preferred_technician_id) values ($1,$2,$3,'Ann','Guest','Ann Guest',$4)`, [CUST, TA, BA, MIA]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance) values ($1,$2,$3,120)`, [TA, BA, CUST]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, TA, BA]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Manicure',45,4500)`, [SVC, TA, BA, CAT]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, ticket_number, subtotal_cents, total_cents) values ($1,$2,$3,$4,$5,'serving','T1',4500,4500)`, [TK, TA, BA, CUST, MIA]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status) values ($1,$2,$3,$4,$5,'Manicure',4500,45,4500,'serving')`, [TA, BA, TK, SVC, MIA]);
  await q(`insert into technician_skills (tenant_id, technician_id, skill_group, created_at) values ($1,$2,'manicure',now()), ($1,$2,'gel',now())`, [TA, MIA]);
  // §59–§60: only a technician with a status row (clocked in / serving / break) is on the staff panel — Mia is serving
  await q(`insert into technician_statuses (tenant_id, branch_id, technician_id, status) values ($1,$2,$3,'serving')`, [TA, BA, MIA]);
  repo = new KyselyServingRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Serving → Guest Service Details', () => {
  it('shows the guest\'s loyalty points (from the loyalty profile) and their preferred technician', async () => {
    const d = await repo.detail(ctx, TK);
    expect(d?.customer.loyaltyPoints).toBe(120);
    expect(d?.customer.preferredTechName).toBe('Mia C');
  });

  // w4 sweep SW-11: the "Available / Finishing technicians" panel selected technicians.specialties (no such column) — the
  // statement failed, .catch(() => []) emptied the list, and the panel was ALWAYS empty on Serving and Service Done
  it('the staff panel lists the salon\'s technicians, with their specialty from their skills', async () => {
    const st: any = await repo.query(ctx, {} as any);
    const mia = st.staff.find((x: any) => x.technicianId === MIA);
    expect(mia).toBeTruthy();
    expect(mia.specialty).toMatch(/manicure|gel/);
  });
});

// Extras Serving 04 (Nov 12 2026): the booking-conflict insight reads each technician's next booking TODAY, on the branch clock
describe('Serving → next booking per technician (booking conflict input)', () => {
  it('minutes until the next booked / confirmed appointment later today; past, cancelled, arrived and other days are not counted', async () => {
    const pg: any = (repo as any).db;
    const plus5 = (t: string) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + 5; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
    const ins = (date: string, time: string, status: string) => pg.insertInto('pos_tech_appointments').values({ tenant_id: TA, branch_id: BA, technician_id: MIA, customer_name: 'G', source: 'manual', services: JSON.stringify([]), appt_date: date, start_time: time, end_time: plus5(time), duration_minutes: 5, status, deposit_status: 'not_required' } as never).execute();
    await ins('2026-11-12', '09:30', 'booked');      // already started (10:00 now) — not next
    await ins('2026-11-12', '10:05', 'cancelled');   // cancelled
    await ins('2026-11-12', '10:10', 'arrived');     // already here — not a booking still to come
    await ins('2026-11-12', '10:20', 'confirmed');   // ← the next one: 20 min
    await ins('2026-11-12', '11:00', 'booked');
    await ins('2026-11-13', '09:00', 'booked');      // tomorrow
    repo.now = () => Date.parse('2026-11-12T15:00:00Z');   // 10:00 in New York
    expect(await repo.nextBookingMinutes(ctx)).toEqual({ [MIA]: 20 });
    repo.now = () => Date.parse('2026-11-12T16:30:00Z');   // 11:30 — nothing left today
    expect(await repo.nextBookingMinutes(ctx)).toEqual({});
    expect(await repo.nextBookingMinutes({ ...ctx, tenantId: id('a9') })).toEqual({});   // another salon sees none
    repo.now = Date.now;
  });
});
