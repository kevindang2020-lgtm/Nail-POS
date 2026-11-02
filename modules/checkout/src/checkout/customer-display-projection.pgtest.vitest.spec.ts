// customer-display-projection.pgtest.vitest.spec.ts — 23-inch dual-screen spec §30–§39 on the REAL schema (every
// migration, PGlite): the customer display's checkout comes from the same ticket rows the POS reads.
//   • lines (service / add-on / product, quantity, catalog price), first-name technicians, the discount snapshot,
//     tax, tip, payments and points — read through KyselyCheckoutRepository.customerDisplayCheckout
//   • TENANT + BRANCH ISOLATION — another salon's context, or another branch's, gets nothing
//   • THE DISCOUNT-STACK BUG (found by this work, Oct 6 2026): the single-ticket loader never selected
//     tickets.discount_snapshot, so every discount writer rebuilt the stack from an empty list — adding a manual
//     discount silently DELETED a membership credit already on the ticket. Pinned through the real CheckoutService.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'cd000000-0000-0000-0000-000000000001';
const T2 = 'cd000000-0000-0000-0000-000000000002';
const BR = 'cd000000-0000-0000-0000-0000000000b1';
const BR2 = 'cd000000-0000-0000-0000-0000000000b2';
const CUST = 'cd000000-0000-0000-0000-0000000000c1';
const OLIVIA = 'cd000000-0000-0000-0000-0000000000a1';
const LISA = 'cd000000-0000-0000-0000-0000000000a2';
const CAT = 'cd000000-0000-0000-0000-0000000000f1';
const SVC_GEL = 'cd000000-0000-0000-0000-0000000005e1';
const SVC_PEDI = 'cd000000-0000-0000-0000-0000000005e2';
const SVC_FRENCH = 'cd000000-0000-0000-0000-0000000005e3';
const PROD_OIL = 'cd000000-0000-0000-0000-0000000000d1';
const TK = 'cd000000-0000-0000-0000-0000000000e1';
const TK_STACK = 'cd000000-0000-0000-0000-0000000000e2';
const perms = ['pos.checkout.view', 'pos.checkout.apply_discount', 'pos.checkout.add_tip', 'pos.checkout.take_payment'];
const ctx: any = { tenantId: T, branchId: BR, userId: 'cd000000-0000-0000-0000-0000000000c9', role: 'OWNER', permissions: perms };

let pg: PGlite;
let repo: KyselyCheckoutRepository;
let svc: CheckoutService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCheckoutRepository(db as any);
  svc = new CheckoutService(repo as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Luxury Nails LLC','Luxury Nails','cdA','CDA'),($2,'Other','Other','cdB','CDB')`, [T, T2]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display, email) values ($1,$2,$3,'Sophia','Lane','Sophia Lane','(856) 555-0101','sophia@example.com')`, [CUST, T, BR]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$3,$4,'Olivia','Tran','Olivia Tran'),($2,$3,$4,'Lisa','Ngo','Lisa Ngo')`, [OLIVIA, LISA, T, BR]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, BR]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$4,$5,$6,'Gel Manicure',45,4500),($2,$4,$5,$6,'Spa Pedicure',50,6000),($3,$4,$5,$6,'French Tip',10,1000)`, [SVC_GEL, SVC_PEDI, SVC_FRENCH, T, BR, CAT]);
  // tax 7.75 % (the default) — the spec's §33 example ticket
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, tip_cents, discount_cents, discount_snapshot, chosen_payment_method)
           values ($1,$2,$3,$4,'service_done','12',2172,1500,$5::jsonb,'cash')`, [TK, T, BR, CUST, JSON.stringify({ applied: [
    { id: 'membership-benefit-x', category: 'membership', appliedCents: 1000, description: 'VIP Membership' },
    { id: 'loyalty-y', category: 'loyalty', appliedCents: 500, description: 'Loyalty Reward' }] })]);
  let added = 0;   // each line is added a minute after the previous one
  const line = (ticket: string, svcId: string | null, prodId: string | null, name: string, tech: string | null, price: number, qty: number, total: number, kind: string) =>
    q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, product_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, quantity, line_total_cents, line_kind, commission_type_snapshot, commission_value_snapshot, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,30,$9,$10,$11,'percent',55, now() + make_interval(mins => $12))`, [T, BR, ticket, svcId, prodId, tech, name, price, qty, total, kind, added++]);
  await line(TK, SVC_GEL, null, 'Gel Manicure', OLIVIA, 4500, 1, 4500, 'service');
  await line(TK, SVC_PEDI, null, 'Spa Pedicure', LISA, 6000, 1, 6000, 'service');
  await line(TK, SVC_FRENCH, null, 'French Tip', OLIVIA, 1000, 1, 1000, 'add_on');
  await line(TK, null, PROD_OIL, 'Cuticle Oil', null, 1200, 1, 1200, 'retail');
  // the discount-stack ticket: one $100 line, a $20 membership credit already applied through the stacking engine
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, discount_cents, discount_snapshot) values ($1,$2,$3,$4,'service_done','13',2000,$5::jsonb)`,
    [TK_STACK, T, BR, CUST, JSON.stringify({ applied: [{ id: 'membership-r1', category: 'membership', appliedCents: 2000, description: 'Membership: Spa Pedicure' }] })]);
  await line(TK_STACK, SVC_PEDI, null, 'Spa Pedicure', LISA, 10000, 1, 10000, 'service');
});

describe('the customer-safe checkout on the real schema', () => {
  it('the §33 example ticket projects to the cent: four lines, two benefits, tax $8.68, tip $21.72, TOTAL DUE $142.40', async () => {
    const c = (await repo.customerDisplayCheckout(ctx, TK))!;
    expect(c.ticketNumber).toBe('#12');
    // in the order they were added to the ticket (the loader orders lines by created_at)
    expect(c.lines).toEqual([
      { kind: 'service', name: 'Gel Manicure', technicianName: 'Olivia', quantity: 1, amountCents: 4500 },
      { kind: 'service', name: 'Spa Pedicure', technicianName: 'Lisa', quantity: 1, amountCents: 6000 },
      { kind: 'add_on', name: 'French Tip', technicianName: 'Olivia', quantity: 1, amountCents: 1000 },
      { kind: 'product', name: 'Cuticle Oil', quantity: 1, amountCents: 1200 },
    ]);
    expect(c.adjustments).toEqual([{ kind: 'membership', label: 'VIP Membership', amountCents: 1000 }, { kind: 'loyalty', label: 'Loyalty Reward', amountCents: 500 }]);
    expect([c.itemsSubtotalCents, c.discountCents, c.taxCents, c.tipCents, c.customerFeeCents, c.totalCents]).toEqual([12700, 1500, 868, 2172, 0, 14240]);
    expect(c.paymentStatus).toBe('unpaid');
    // the POS reads the same ticket: its total is the display's total
    expect((await repo.totalsFor(ctx, TK))!.totalDueCents).toBe(c.totalCents);
  });

  it('§39: commission, contact details and ids never reach the projection', async () => {
    const json = JSON.stringify(await repo.customerDisplayCheckout(ctx, TK));
    expect(json).not.toMatch(/commission|555-0101|sophia@|Tran|Ngo|cd000000/i);
  });

  it('after a partial gift-card payment and the cash balance, the display shows both payments, PAID, and the points earned', async () => {
    const gift = (await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,'gift_card',4000,'approved') returning id`, [T, BR, TK]))[0].id;
    let c = (await repo.customerDisplayCheckout(ctx, TK))!;
    expect(c.paymentStatus).toBe('partially_paid');
    expect(c.balanceDueCents).toBe(10240);
    const cash = (await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,'cash',10240,'approved') returning id`, [T, BR, TK]))[0].id;
    await q(`update tickets set status='paid', paid_at=now() where id=$1`, [TK]);
    await q(`insert into loyalty_point_earnings (tenant_id, branch_id, customer_id, payment_id, ticket_id, amount_cents, points) values ($1,$2,$3,$4,$5,4000,40),($1,$2,$3,$6,$5,10240,102)`, [T, BR, CUST, gift, TK, cash]);
    c = (await repo.customerDisplayCheckout(ctx, TK))!;
    expect(c.paymentStatus).toBe('paid');
    expect(c.payments).toEqual([{ method: 'gift_card', label: 'Gift card', amountCents: 4000 }, { method: 'cash', label: 'Cash', amountCents: 10240 }]);
    expect([c.paidCents, c.totalCents, c.balanceDueCents]).toEqual([14240, 14240, 0]);
    expect(c.loyaltyPointsEarned).toBe(142);
  });

  it('TENANT + BRANCH ISOLATION: another salon gets nothing; another branch of the same salon gets nothing', async () => {
    expect(await repo.customerDisplayCheckout({ ...ctx, tenantId: T2 }, TK)).toBeNull();
    expect(await repo.customerDisplayCheckout({ ...ctx, branchId: BR2 }, TK)).toBeNull();
  });
});

describe('THE DISCOUNT-STACK BUG: adding a discount kept the ones already on the ticket', () => {
  it('a manual discount on top of a membership credit keeps BOTH (it used to delete the membership credit)', async () => {
    const before = (await repo.ticket(ctx, TK_STACK))!;
    expect((before as any).discountSnapshot?.applied?.map((a: any) => a.category)).toEqual(['membership']);   // the loader reads it now
    await svc.applyDiscount(ctx, TK_STACK, { discountCents: 500 } as any);
    const row = (await q(`select discount_cents, discount_snapshot from tickets where id=$1`, [TK_STACK]))[0];
    const applied = (typeof row.discount_snapshot === 'string' ? JSON.parse(row.discount_snapshot) : row.discount_snapshot).applied;
    expect(applied.map((a: any) => `${a.category}:${a.appliedCents}`).sort()).toEqual(['manual:500', 'membership:2000']);
    expect(Number(row.discount_cents)).toBe(2500);
    const c = (await repo.customerDisplayCheckout(ctx, TK_STACK))!;
    expect(c.adjustments).toEqual([{ kind: 'membership', label: 'Membership: Spa Pedicure', amountCents: 2000 }, { kind: 'discount', label: 'Discount', amountCents: 500 }]);
  });
  it('replacing the manual discount replaces only the manual one', async () => {
    await svc.applyDiscount(ctx, TK_STACK, { discountCents: 800 } as any);
    const row = (await q(`select discount_cents, discount_snapshot from tickets where id=$1`, [TK_STACK]))[0];
    const applied = (typeof row.discount_snapshot === 'string' ? JSON.parse(row.discount_snapshot) : row.discount_snapshot).applied;
    expect(applied.map((a: any) => `${a.category}:${a.appliedCents}`).sort()).toEqual(['manual:800', 'membership:2000']);
    expect(Number(row.discount_cents)).toBe(2800);
  });
});
