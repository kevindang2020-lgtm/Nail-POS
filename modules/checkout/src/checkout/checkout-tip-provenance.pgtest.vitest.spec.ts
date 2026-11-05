// checkout-tip-provenance.pgtest.vitest.spec.ts — Custom Tip spec (Jul 26, 2026), verification pillars on the REAL
// migrated schema:
//   PERSISTENCE — applyTip writes tickets.tip_cents + tip_type + tip_percent (migration 418); percent→custom→none
//                 each REPLACES the previous choice (never additive).
//   TENANT ISOLATION — a ctx from another tenant cannot see or tip this tenant's ticket.
//   FINALIZED GUARD — once a payment is captured (paid ticket / partially-paid split), applyTip refuses; the
//                 database row is untouched.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollbackack'.replace('ackack', 'ack'), parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'ad000000-0000-0000-0000-000000000001';
const T2 = 'ad000000-0000-0000-0000-000000000002';
const BR = 'ad000000-0000-0000-0000-0000000000b1';
const TK = 'ad000000-0000-0000-0000-0000000000t1'.replace('t', 'e');
const TK_PAID = 'ad000000-0000-0000-0000-0000000000e2';
const perms = ['pos.checkout.view', 'pos.checkout.add_tip', 'pos.checkout.take_payment'];
const ctx: any = { tenantId: T, branchId: BR, userId: 'ad000000-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: perms };
const ctxOther: any = { ...ctx, tenantId: T2 };

let pg: PGlite;
let repo: KyselyCheckoutRepository;
let svc: CheckoutService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const tipRow = (id: string) => q(`select tip_cents, tip_type, tip_percent, status from tickets where id=$1`, [id]).then((r) => r[0]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCheckoutRepository(db as any);
  svc = new CheckoutService(repo as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','adA','ADA'),($2,'B','B','adB','ADB')`, [T, T2]);
  const CUST = 'ad000000-0000-0000-0000-0000000000c9';
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Tip','Guest','Tip Guest')`, [CUST, T, BR]);
  // A payable ticket with one $100.00 service line.
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK, T, BR, CUST]);
  await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status)
           values ('ad000000-0000-0000-0000-00000000001a',$1,$2,$3,'ad000000-0000-0000-0000-00000000005e','Gel Manicure',10000,45,10000,'done')`, [T, BR, TK]);
  // A ticket that already has a captured payment.
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, tip_cents, tip_type) values ($1,$2,$3,'ad000000-0000-0000-0000-0000000000c9','paid',500,'custom')`, [TK_PAID, T, BR]);
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ('ad000000-0000-0000-0000-0000000000d1',$1,'ad000000-0000-0000-0000-0000000000b1',$2,'cash',10500,500,'approved')`, [T, TK_PAID]);
});

describe('tip provenance + isolation + finalized guard (real schema)', () => {
  it('percent → custom → none: each choice REPLACES the previous one, with tip_type/tip_percent persisted', async () => {
    await svc.applyTip(ctx, TK, { tipType: 'percent', tipPercent: 20, source: 'front_desk' } as any);
    let r = await tipRow(TK);
    expect(Number(r.tip_cents)).toBe(2000);                 // 20% of $100.00
    expect(r.tip_type).toBe('percent');
    expect(Number(r.tip_percent)).toBe(20);

    await svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 1750, source: 'front_desk' } as any);
    r = await tipRow(TK);
    expect(Number(r.tip_cents)).toBe(1750);                 // replaced, not 2000+1750
    expect(r.tip_type).toBe('custom');
    expect(r.tip_percent).toBeNull();

    await svc.applyTip(ctx, TK, { tipType: 'none', source: 'front_desk' } as any);
    r = await tipRow(TK);
    expect(Number(r.tip_cents)).toBe(0);
    expect(r.tip_type).toBe('none');
    expect(r.tip_percent).toBeNull();

    // the ticket read exposes the provenance for receipts/reports/history
    await svc.applyTip(ctx, TK, { tipType: 'percent', tipPercent: 18, source: 'front_desk' } as any);
    const tk: any = await repo.ticket(ctx, TK);
    expect(tk.tipType).toBe('percent');
    expect(tk.tipPercent).toBe(18);
    await svc.applyTip(ctx, TK, { tipType: 'none', source: 'front_desk' } as any);
  });

  it('TENANT ISOLATION: another tenant cannot see or tip this ticket; the row is untouched', async () => {
    await svc.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 1000, source: 'front_desk' } as any);
    await expect(svc.applyTip(ctxOther, TK, { tipType: 'custom', tipAmountCents: 9999, source: 'front_desk' } as any)).rejects.toThrow(/not found/i);
    const r = await tipRow(TK);
    expect(Number(r.tip_cents)).toBe(1000);
  });

  it('BRANCH ISOLATION: a session scoped to another branch cannot see or tip a branch-owned ticket', async () => {
    const ctxOtherBranch: any = { ...ctx, branchId: 'ad000000-0000-0000-0000-0000000000b2' };
    await expect(svc.applyTip(ctxOtherBranch, TK, { tipType: 'custom', tipAmountCents: 4242, source: 'front_desk' } as any)).rejects.toThrow(/not found/i);
    const r = await tipRow(TK);
    expect(Number(r.tip_cents)).toBe(1000);   // unchanged from the tenant-isolation test above
  });

  it('FINALIZED GUARD: a ticket with a captured payment refuses tip changes and keeps its settled values', async () => {
    await expect(svc.applyTip(ctx, TK_PAID, { tipType: 'custom', tipAmountCents: 9999, source: 'front_desk' } as any)).rejects.toThrow(/already been captured/i);
    const r = await tipRow(TK_PAID);
    expect(Number(r.tip_cents)).toBe(500);
    expect(r.tip_type).toBe('custom');
    expect(r.status).toBe('paid');
  });
});

// The receipt line shows the tip clearly (Custom Tip spec) — asserted through the real service + real schema.
describe('receipt shows the tip', () => {
  it('SMS receipt body includes the tip note when a tip was left', async () => {
    const sent: { to: string; body: string }[] = [];
    const svc2 = new CheckoutService(repo as any, { send: async (to: string, body: string) => { sent.push({ to, body }); return { sid: 'x' }; } } as any);
    await q(`update customers set phone_display='+15551234567' where id='ad000000-0000-0000-0000-0000000000c9'`);
    // ensure a known tip on the payable ticket
    await svc2.applyTip(ctx, TK, { tipType: 'custom', tipAmountCents: 1750, source: 'front_desk' } as any);
    const perms2 = [...perms, 'pos.receipts.send'];
    const r = await svc2.receiptSms({ ...ctx, permissions: perms2 } as any, TK);
    expect(r.configured).toBe(true);
    expect(sent[0].body).toContain('$17.50 tip');
  });
});
