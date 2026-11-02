import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutInProgressError } from './checkout.dto';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}


// checkout-concurrent-payment.pgtest.vitest.spec.ts — Oct 4 2026: two simultaneous gift-card taps on a card that could
// cover the bill twice debited it twice and recorded two full payments; a double-tapped split recorded every segment
// twice (both reproduced live against the API + Postgres 16, then fixed). The fix: the card debit and the payment rows
// commit in ONE transaction, under the visit lock and a check that what has been paid is what the payment was priced
// on. These tests pin the half a single-connection database CAN show — a stale check rolls back the debit and writes
// no payment; the live race script in the commit message shows the concurrent half.
const T = 'cc000000-0000-0000-0000-000000000001';
const B = 'cc000000-0000-0000-0000-0000000000b1';
const ctx: any = { tenantId: T, branchId: B, userId: 'cc000000-0000-0000-0000-0000000000f1', role: 'OWNER', permissions: [] };
let pg: PGlite; let repo: KyselyCheckoutRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const balance = async (code: string) => Number((await q(`select balance_cents from gift_cards where code=$1`, [code]))[0].balance_cents);
const payments = async (ticket: string) => (await q(`select method, amount_cents from payments where ticket_id=$1 order by amount_cents`, [ticket])).map((r: any) => `${r.method}:${r.amount_cents}`);
let n = 0;
async function newTicket(): Promise<string> {
  const c = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,'Race','Probe','Race Probe',$3) returning id`, [T, B, '+1555000' + String(1000 + ++n)]))[0].id;
  return (await q(`insert into tickets (tenant_id, branch_id, customer_id, status) values ($1,$2,$3,'open') returning id`, [T, B, c]))[0].id;
}
const rec = (ticketId: string, method: any, amountCents: number): any => ({ paymentId: '', ticketId, method, amountCents, tipCents: 0, status: 'approved', createdAt: new Date().toISOString() });

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCheckoutRepository(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D','race','RACE')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
});

describe('gift-card payment: debit + payment row are one transaction under the paid-amount check', () => {
  it('with the paid amount it was priced on: debits the card once and records the payment', async () => {
    const t = await newTicket(); await repo.issueGiftCard(ctx, { code: 'GC-CC-OK', amountCents: 20000 } as any);
    const p = await repo.redeemGiftAndRecordIfUnchanged(ctx, 'GC-CC-OK', 5388, undefined, rec(t, 'gift_card', 5388), 0);
    expect(p).not.toBeNull();
    expect(await balance('GC-CC-OK')).toBe(14612);
    expect(await payments(t)).toEqual(['gift_card:5388']);
  });

  it('the second tap (priced before the first landed) is refused — and its debit is ROLLED BACK', async () => {
    const t = await newTicket(); await repo.issueGiftCard(ctx, { code: 'GC-CC-RACE', amountCents: 20000 } as any);
    await repo.redeemGiftAndRecordIfUnchanged(ctx, 'GC-CC-RACE', 5388, undefined, rec(t, 'gift_card', 5388), 0);
    // the duplicate still believes nothing was paid (expectedPaid 0) — exactly the live race
    await expect(repo.redeemGiftAndRecordIfUnchanged(ctx, 'GC-CC-RACE', 5388, undefined, rec(t, 'gift_card', 5388), 0)).rejects.toBeInstanceOf(CheckoutInProgressError);
    expect(await balance('GC-CC-RACE')).toBe(14612);                  // debited ONCE, not 9224
    expect(await payments(t)).toEqual(['gift_card:5388']);             // one payment, not two
    expect((await q(`select count(*)::int as n from gift_card_transactions where type='redeem' and gift_card_id=(select id from gift_cards where code='GC-CC-RACE')`))[0].n).toBe(1);
  });

  it('a card that cannot be redeemed writes nothing (null, no payment row)', async () => {
    const t = await newTicket(); await repo.issueGiftCard(ctx, { code: 'GC-CC-LOW', amountCents: 1000 } as any);
    expect(await repo.redeemGiftAndRecordIfUnchanged(ctx, 'GC-CC-LOW', 5388, undefined, rec(t, 'gift_card', 5388), 0)).toBeNull();
    expect(await balance('GC-CC-LOW')).toBe(1000);
    expect(await payments(t)).toEqual([]);
  });
});

describe('split payment: the duplicate settlement is refused before any segment is written', () => {
  const segs = (code: string) => [{ method: 'gift_card' as any, amountCents: 2000, giftCardCode: code }, { method: 'cash' as any, amountCents: 3388 }];
  it('first settlement records every segment; a duplicate priced on the same paid amount is refused, nothing doubled', async () => {
    const t = await newTicket(); await repo.issueGiftCard(ctx, { code: 'GC-CC-SPLIT', amountCents: 20000 } as any);
    await repo.recordSplitAtomic(ctx, t, segs('GC-CC-SPLIT'), { expectedPaidCents: 0 });
    await expect(repo.recordSplitAtomic(ctx, t, segs('GC-CC-SPLIT'), { expectedPaidCents: 0 })).rejects.toBeInstanceOf(CheckoutInProgressError);
    expect(await payments(t)).toEqual(['gift_card:2000', 'cash:3388']);
    expect(await balance('GC-CC-SPLIT')).toBe(18000);                  // one 2000 debit, not two
  });
  it('without expectedPaidCents the old behaviour is kept (callers that do not price on a paid amount)', async () => {
    const t = await newTicket(); await repo.issueGiftCard(ctx, { code: 'GC-CC-LEGACY', amountCents: 20000 } as any);
    await repo.recordSplitAtomic(ctx, t, segs('GC-CC-LEGACY'), {});
    expect(await payments(t)).toEqual(['gift_card:2000', 'cash:3388']);
  });
});
