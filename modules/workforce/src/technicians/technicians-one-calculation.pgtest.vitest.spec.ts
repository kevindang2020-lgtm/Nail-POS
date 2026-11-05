// technicians-one-calculation.pgtest — ONE-PAY F2 (Oct 13 2026) on the REAL schema (PGlite, all migrations): the POS
// Technicians screen's commission / tips / "payroll snapshot" figures are the compensation AUTHORITY's (the immutable
// snapshot + posted ledger adjustments over the branch day) — never today's sales × the technician's CURRENT rate, and
// tips are never a hard-coded 0.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCompensationPorts } from '../compensation/compensation.kysely.ports';
import { CompensationService } from '../compensation/compensation.service';
import { CompensationSnapshotRepository } from '../compensation/compensation-snapshot.repository';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';

const P = 'c0ed0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const CAT = id('ca1'), T = id('a1'), B = id('b1'), CUST = id('c0'), TECH = id('c1'), SVC = id('d1'), TICKET = id('e1'), LINE = id('f1');
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = { tenantId: T, branchId: B, userId: id('99'), role: 'OWNER', permissions: [] as string[] };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'One Pay LLC','One Pay','one-pay','ONEP01','active',45)`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, T, B]);
  // her CURRENT rate is 70 % — the old screen multiplied today's sales by it
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, default_commission_split_percent) values ($1,$2,$3,'Mia','Chen','Mia Chen','active',true,70)`, [TECH, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel',45,10000)`, [SVC, T, B, CAT]);
  // paid today: $100.00 line stamped at 50 % → $50.00 commission; a $10.00 card tip
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents, tip_cents, paid_at, chosen_payment_method, primary_technician_id) values ($1,$2,$3,$4,'paid','OP1',10000,11000,1000, now(), 'card', $5)`, [TICKET, T, B, CUST, TECH]);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,'Gel',10000,45,10000,'percent',50)`, [LINE, T, B, TICKET, SVC, TECH]);
  const r = await new CompensationService(new KyselyCompensationPorts(db), { warn: () => undefined, error: () => undefined }).snapshotPaidTicket({ tenantId: T, branchId: B }, TICKET);
  expect(r.ok).toBe(true);
  // a posted −$5.00 correction today (e.g. a partial refund reversal)
  await new CompensationSnapshotRepository(db).persistAdjustments(T, B, [{ technicianId: TECH, ticketId: TICKET, serviceLineId: LINE, periodId: null, category: 'commission_correction', amountCents: -500, reason: 'proof', status: 'posted', source: 'manual', targetsFuturePeriod: false, requestedBy: null, approvedBy: null }]);
}, 180_000);

describe('POS Technicians money = the compensation authority (ONE-PAY F2)', () => {
  it('row + KPI + insight commission is the snapshot ($50.00) net of the posted −$5.00 — not $100.00 × 70 %', async () => {
    const repo = new KyselyTechniciansRepository(db);
    const st: any = await repo.query(ctx as any, {} as any);
    const row = st.rows.items.find((r: any) => r.technicianId === TECH);
    expect(row.estimatedCommissionCents).toBe(4500);
    expect(row.todayTipsCents).toBe(1000);
    expect(st.kpisFull.estimatedCommissionCents).toBe(4500);
    expect(st.kpisFull.todayTipsCents).toBe(1000);
    expect(st.insights.payrollSnapshotCents).toBe(4500);
  });
  it('the technician payroll summary reads the same numbers', async () => {
    const s: any = await new KyselyTechniciansRepository(db).payrollSummary(ctx as any, TECH);
    expect(s).toMatchObject({ commissionCents: 4500, tipsCents: 1000, estimatedTodayCents: 4500 });
  });
});
