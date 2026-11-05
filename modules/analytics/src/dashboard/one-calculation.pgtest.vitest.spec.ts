// one-calculation.pgtest — ONE-PAY F11 (Oct 13 2026), real schema (PGlite): the POS dashboard's "top technicians" tips are
// each technician's share from the compensation snapshot (the one tip split) — not the ticket's whole tip credited to
// its primary technician.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CompensationService, KyselyCompensationPorts } from '@aipowersalon/workforce';
import { KyselyDashboardRepo } from './dashboard.kysely.repository';

const P = 'c0ef0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), B = id('b1'), CAT = id('ca1'), CUST = id('c0'), TECH = id('c1'), TECH2 = id('c2'), SVC = id('d1'), TICKET = id('e1');
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'One Pay D LLC','One Pay D','one-pay-d','ONEPD1','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, T, B]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$3,$4,'Mia','Chen','Mia Chen','active',true), ($2,$3,$4,'Ava','Li','Ava Li','active',true)`, [TECH, TECH2, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel',45,5000)`, [SVC, T, B, CAT]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents, tip_cents, paid_at, chosen_payment_method, primary_technician_id) values ($1,$2,$3,$4,'paid','D1',10000,11000,1000, now(), 'card', $5)`, [TICKET, T, B, CUST, TECH]);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$3,$4,$5,$6,$7,'Gel',5000,45,5000,'percent',50), ($2,$3,$4,$5,$6,$8,'Gel',5000,45,5000,'percent',50)`, [id('11'), id('12'), T, B, TICKET, SVC, TECH, TECH2]);
  const r = await new CompensationService(new KyselyCompensationPorts(db), { warn: () => undefined, error: () => undefined }).snapshotPaidTicket({ tenantId: T, branchId: B }, TICKET);
  expect(r.ok).toBe(true);
}, 180_000);

describe('POS dashboard top technicians tips = the snapshot tip split (ONE-PAY F11)', () => {
  it('Mia and Ava each show their $5.00 share — not $10.00 for the primary and $0.00 for the other', async () => {
    const st: any = await new KyselyDashboardRepo(db).getAggregate({ tenantId: T, branchId: B }, {});
    const tipsOf = (tid: string) => st.topTechnicians.find((t: any) => t.technicianId === tid)?.tipsCents;
    expect(tipsOf(TECH)).toBe(500);
    expect(tipsOf(TECH2)).toBe(500);
  });
});
