// (Constitution 13: a checkout × gift-card-stock integration test — it stays in the API while gift-card-stock does.)
// checkout-physical-giftcard-sale.pgtest.vitest.spec.ts — proves activation-at-sale (spec §21): selling a physical card
// atomically claims it from stock (available → activated), creates the pending gift card on that pre-printed number, and
// links the two; a card can't be sold twice; and a number that isn't in available stock can't be sold at all.
import { KyselyGiftCardStockRepo, hashCardNumber, lastFour, hashCardPin } from '@aipowersalon/gift-cards';
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from '@aipowersalon/checkout';

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

const T = 'ec000000-0000-0000-0000-000000000001';
const ctx: any = { tenantId: T, branchId: 'ec000000-0000-0000-0000-0000000000b1', userId: 'ec000000-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: [] };
const TICKET = 'ec000000-0000-0000-0000-0000000000a1';
const INSTOCK = '4827193655028411';   // a registered physical card
const NOTSTOCK = '1234123412341234';   // never registered

let pg: PGlite;
let repo: KyselyCheckoutRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

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
  await new KyselyGiftCardStockRepo(db as any).registerCards(ctx, [{ hash: hashCardNumber(INSTOCK), last4: lastFour(INSTOCK) }], 'Box A');
});

describe('physical gift-card sale — activation from stock (§21)', () => {
  it('claims the stock card, creates the pending card on that number, and links them', async () => {
    const res = await repo.createPhysicalGiftCardSale(ctx, { code: 'GC-PHYS1', amountCents: 5000, ticketId: TICKET, reference: 'GC-****-HYS1', cardNumber: INSTOCK });
    expect(res).not.toBeNull();
    // the pending gift card carries the pre-printed number's hash (never the clear number)
    const gc = await q(`select id, status, card_number_hash, card_number, balance_cents, purchased_cents from gift_cards where code=$1`, ['GC-PHYS1']);
    expect(gc.length).toBe(1);
    expect(gc[0].status).toBe('pending_payment');
    expect(gc[0].card_number).toBeNull();
    expect(gc[0].card_number_hash).toBe(hashCardNumber(INSTOCK));
    expect(Number(gc[0].balance_cents)).toBe(0); // worthless until paid
    // the stock card is now activated and linked to that gift card
    const stock = await q(`select status, gift_card_id, activated_at from gift_card_stock where card_number_hash=$1`, [hashCardNumber(INSTOCK)]);
    expect(stock[0].status).toBe('activated');
    expect(stock[0].gift_card_id).toBe(gc[0].id);
    expect(stock[0].activated_at).not.toBeNull();
  });

  it('refuses to sell the same physical card twice', async () => {
    const res = await repo.createPhysicalGiftCardSale(ctx, { code: 'GC-PHYS2', amountCents: 5000, ticketId: TICKET, reference: 'GC-****-HYS2', cardNumber: INSTOCK });
    expect(res).toBeNull();
    // no second gift card was created
    expect((await q(`select id from gift_cards where code=$1`, ['GC-PHYS2'])).length).toBe(0);
  });

  it('refuses to sell a number that was never registered in stock', async () => {
    const res = await repo.createPhysicalGiftCardSale(ctx, { code: 'GC-PHYS3', amountCents: 5000, ticketId: TICKET, reference: 'GC-****-HYS3', cardNumber: NOTSTOCK });
    expect(res).toBeNull();
    expect((await q(`select id from gift_cards where code=$1`, ['GC-PHYS3'])).length).toBe(0);
  });

  it('a physical sale WITH a PIN stores the PIN hash (bound to the code) on the card', async () => {
    const PINNED = '5921084733621180';
    await new KyselyGiftCardStockRepo((repo as any).db).registerCards(ctx, [{ hash: hashCardNumber(PINNED), last4: lastFour(PINNED) }], 'Box B');
    const res = await repo.createPhysicalGiftCardSale(ctx, { code: 'GC-PHYSPIN', amountCents: 5000, ticketId: TICKET, reference: 'GC-****-SPIN', cardNumber: PINNED, pin: '4321' });
    expect(res).not.toBeNull();
    const gc = await q(`select card_pin_hash from gift_cards where code=$1`, ['GC-PHYSPIN']);
    expect(gc[0].card_pin_hash).toBe(hashCardPin('GC-PHYSPIN', '4321'));
  });
});

describe('gift-card PIN redemption gate (§3/§12)', () => {
  it('requires the correct PIN to redeem a PIN-protected card, and never touches a non-PIN card', async () => {
    // A live, PIN-protected card (PIN 1234, bound to its code) and a live card with no PIN.
    await q(`insert into gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status, card_pin_hash) values (gen_random_uuid(),$1,'GC-RED1',5000,5000,'active',$2)`, [T, hashCardPin('GC-RED1', '1234')]);
    await q(`insert into gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status) values (gen_random_uuid(),$1,'GC-RED2',5000,5000,'active')`, [T]);

    // correct PIN redeems
    expect(await repo.decrementGift(ctx, 'GC-RED1', 2000, '1234')).toBe(true);
    expect(Number((await q(`select balance_cents from gift_cards where code=$1`, ['GC-RED1']))[0].balance_cents)).toBe(3000);
    // wrong PIN is refused (fail closed) — balance untouched
    expect(await repo.decrementGift(ctx, 'GC-RED1', 1000, '9999')).toBe(false);
    // missing PIN is refused
    expect(await repo.decrementGift(ctx, 'GC-RED1', 1000, undefined)).toBe(false);
    expect(Number((await q(`select balance_cents from gift_cards where code=$1`, ['GC-RED1']))[0].balance_cents)).toBe(3000);
    // correct PIN again redeems
    expect(await repo.decrementGift(ctx, 'GC-RED1', 1000, '1234')).toBe(true);

    // a card with no PIN redeems with no PIN supplied — unchanged behavior
    expect(await repo.decrementGift(ctx, 'GC-RED2', 1500)).toBe(true);
    expect(Number((await q(`select balance_cents from gift_cards where code=$1`, ['GC-RED2']))[0].balance_cents)).toBe(3500);
  });
});
