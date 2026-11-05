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
