// tip-adjustment.pgtest — D15/D19 gaps (Nov 5 2026): a free-form tip adjustment on a paid ticket is a posted manual
// tip_correction for one technician (the collected tip never changes). Refused: unpaid ticket, a technician who did not work
// it, zero, no reason, another location, and a negative amount that would take her tip on the ticket below zero.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TipAllocationService } from './compensation-tip-allocation.service';

const P = '7c000000-0000-4000-8000-0000000000';
const SV = P + 'a9', CAT = P + 'a8', T = P + '01', B1 = P + 'b1', B2 = P + 'b2', TK = P + 'c1', TK2 = P + 'c2', C = P + 'd1', ANA = P + 'e1', BEA = P + 'e2', U = P + 'f1';
const ctx = (branchId: string | null = B1) => ({ tenantId: T, branchId, userId: U, role: 'MANAGER', permissions: ['tips.adjust'] });
let svc: TipAllocationService; let pg: any;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','X','X','tipadj','TIPADJ','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B1}','${T}','One'), ('${B2}','${T}','Two');
    INSERT INTO users (id, tenant_id, role, email, full_name) VALUES ('${U}','${T}','MANAGER','m@tip.test','Mia');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}','${T}','${B1}','A','B','A B');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${ANA}','${T}','${B1}','Ana','x','Ana','active'), ('${BEA}','${T}','${B1}','Bea','x','Bea','active');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, tip_cents, status, paid_at) VALUES ('${TK}','${T}','${B1}','${C}', 1000, 'paid', now()), ('${TK2}','${T}','${B1}','${C}', 500, 'open', null);
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}','${T}','${B1}','Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SV}','${T}','${B1}','${CAT}','Gel',45,5000,'active');
    INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) VALUES ('${T}','${B1}','${TK}','${ANA}','${SV}','Gel',5000,45,5000), ('${T}','${B1}','${TK2}','${ANA}','${SV}','Gel',5000,45,5000);
    INSERT INTO ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) VALUES ('${T}','${B1}','${TK}','${ANA}', 1000);`);
  svc = new TipAllocationService(kyselyFor(pg));
}, 120_000);

describe('free-form tip adjustment', () => {
  it('a positive then a negative adjustment are posted ledger rows; the collected tip never changes', async () => {
    const a = await svc.adjust(ctx() as any, TK, { technicianId: ANA, amountCents: 500, reason: 'Cash tip counted in drawer' });
    expect(a).toMatchObject({ amountCents: 500, earnedCents: 1500, routedToNextPeriod: false });
    const b = await svc.adjust(ctx() as any, TK, { technicianId: ANA, amountCents: -1500, reason: 'Entered twice' });
    expect(b.earnedCents).toBe(0);
    const rows = await q(`select amount_cents, source, status, reason_code from compensation_adjustments where ticket_id = $1 order by created_at, amount_cents desc`, [TK]);
    expect(rows.map((r) => Number(r.amount_cents)).sort((x, y) => x - y)).toEqual([-1500, 500]);
    expect(rows.every((r) => r.source === 'manual' && r.status === 'posted' && r.reason_code === 'tip_adjustment_manual')).toBe(true);
    expect(Number((await q(`select tip_cents from tickets where id = $1`, [TK]))[0].tip_cents)).toBe(1000);
  });
  it('below zero, wrong technician, unpaid ticket, zero, no reason and another location are refused', async () => {
    await expect(svc.adjust(ctx() as any, TK, { technicianId: ANA, amountCents: -1, reason: 'too much' })).rejects.toMatchObject({ status: 409, code: 'TIP_ADJUSTMENT_INVALID' });
    await expect(svc.adjust(ctx() as any, TK, { technicianId: BEA, amountCents: 100, reason: 'not hers' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.adjust(ctx() as any, TK2, { technicianId: ANA, amountCents: 100, reason: 'unpaid' })).rejects.toMatchObject({ status: 409 });
    await expect(svc.adjust(ctx() as any, TK, { technicianId: ANA, amountCents: 0, reason: 'zero' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.adjust(ctx() as any, TK, { technicianId: ANA, amountCents: 100, reason: ' ' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.adjust(ctx(B2) as any, TK, { technicianId: ANA, amountCents: 100, reason: 'other place' })).rejects.toMatchObject({ status: 404 });
    expect((await q(`select count(*)::int n from compensation_adjustments where ticket_id = $1`, [TK]))[0].n).toBe(2);
  });
});
