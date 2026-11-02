// checkout-giftcard-crosstenant.pgtest.vitest.spec.ts — proves the read-only cross-tenant recognition path (spec §15):
// a member salon can look up a card issued at ANOTHER salon in a shared network program, a non-member cannot, a
// tenant-only card never crosses, and same-salon lookups are unchanged. No money moves here — this is the read side.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';
import { InMemoryGiftCardLookupThrottle } from './gift-card-lookup-throttle';
import { hashCardNumber, lastFour } from '@aipowersalon/gift-cards';

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

const A = 'ac000000-0000-0000-0000-000000000001';  // issuing salon (member)
const B = 'ac000000-0000-0000-0000-000000000002';  // redeeming salon (member)
const C = 'ac000000-0000-0000-0000-000000000003';  // outsider salon (not a member)
const P = 'ac000000-0000-0000-0000-0000000000f0';  // network program
const NET = 'ac000000-0000-0000-0000-0000000000d1'; // a network card issued by A
const SOLO = 'ac000000-0000-0000-0000-0000000000d2';// a tenant-only card issued by A
const NUMNET = '7001700270037004';
const NUMSOLO = '8001800280038004';
const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.gift_card_payment'];
const ctxA: any = { tenantId: A, branchId: 'ac000000-0000-0000-0000-0000000000b1', userId: 'ac000000-0000-0000-0000-0000000000c1', role: 'OWNER', permissions: perms };
const ctxB: any = { ...ctxA, tenantId: B };
const ctxC: any = { ...ctxA, tenantId: C };

let pg: PGlite;
let repo: KyselyCheckoutRepository;
let svc: CheckoutService;
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
  svc = new CheckoutService(repo as any, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, new InMemoryGiftCardLookupThrottle());

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','a','A'),($2,'B','B','b','B'),($3,'C','C','c','C')`, [A, B, C]);
  await q(`insert into gift_card_programs (id, owner_tenant_id, name, scope) values ($1,$2,'Net','network')`, [P, A]);
  await q(`insert into gift_card_program_members (program_id, tenant_id, status) values ($1,$2,'active'),($1,$3,'active')`, [P, A, B]); // A + B are members; C is not
  // A network card issued by A, under program P
  await q(`insert into gift_cards (id, tenant_id, code, program_id, card_number_hash, card_number_last4, initial_balance_cents, balance_cents, status) values ($1,$2,'GC-NET1',$3,$4,$5,6000,6000,'active')`, [NET, A, P, hashCardNumber(NUMNET), lastFour(NUMNET)]);
  // A tenant-only card issued by A (no program)
  await q(`insert into gift_cards (id, tenant_id, code, card_number_hash, card_number_last4, initial_balance_cents, balance_cents, status) values ($1,$2,'GC-SOLO1',$3,$4,5000,5000,'active')`, [SOLO, A, hashCardNumber(NUMSOLO), lastFour(NUMSOLO)]);
});

describe('cross-tenant gift-card recognition (§15, read-only)', () => {
  it('a member salon recognizes a network card issued at another salon', async () => {
    const r = await repo.resolveCrossTenantGiftCard(ctxB, NUMNET);
    expect(r.found).toBe(true);
    expect(r.crossTenant).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.balanceCents).toBe(6000);
    expect(r.issuingTenantId).toBe(A);
  });

  it('a non-member salon may NOT redeem the network card', async () => {
    const r = await repo.resolveCrossTenantGiftCard(ctxC, NUMNET);
    expect(r.found).toBe(true);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('not_member');
  });

  it('the issuing salon resolving its own card is not a cross-tenant redemption', async () => {
    const r = await repo.resolveCrossTenantGiftCard(ctxA, NUMNET);
    expect(r.crossTenant).toBe(false);
    expect(r.eligible).toBe(true);
  });

  it('a tenant-only card (no shared program) never crosses to another salon', async () => {
    const r = await repo.resolveCrossTenantGiftCard(ctxB, NUMSOLO);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('no_program');
  });

  it('lookup at a member salon surfaces the network card as redeemable via the network', async () => {
    const r = await svc.giftCardLookup(ctxB, NUMNET);
    expect(r.found).toBe(true);
    expect(r.viaNetwork).toBe(true);
    expect(r.balanceCents).toBe(6000);
    expect(r.redeemableHere).toBe(true);
  });

  it('lookup at a non-member salon does not reveal the card (safe miss)', async () => {
    const r = await svc.giftCardLookup(ctxC, NUMNET);
    expect(r.found).toBe(false);
  });

  it('same-salon lookup of a local card is unchanged (redeemable here)', async () => {
    const r = await svc.giftCardLookup(ctxA, NUMSOLO);
    expect(r.found).toBe(true);
    expect(r.viaNetwork).toBeFalsy();
    expect(r.redeemableHere).toBe(true);
  });

  it('cross-tenant redemption decrements the issuing card, books the ledger at the ISSUER, and records a clearing entry', async () => {
    const ok = await repo.decrementGift(ctxB, 'GC-NET1', 2500);
    expect(ok).toBe(true);
    const card = await q(`select balance_cents from gift_cards where id=$1`, [NET]);
    expect(Number(card[0].balance_cents)).toBe(3500); // 6000 - 2500
    // The redeem ledger row is booked at the ISSUING tenant (A) whose liability is reduced — not the redeeming salon (B).
    const led = await q(`select id, tenant_id, amount_cents from gift_card_transactions where gift_card_id=$1 and type='redeem'`, [NET]);
    expect(led.length).toBe(1);
    expect(led[0].tenant_id).toBe(A);
    expect(Number(led[0].amount_cents)).toBe(2500);
    // One clearing obligation: issuer A owes redeemer B the redeemed amount, keyed to the redeem ledger row.
    const clr = await q(`select issuing_tenant_id, redeeming_tenant_id, amount_cents, status, redemption_transaction_id, program_id from gift_card_clearing_entries where gift_card_id=$1`, [NET]);
    expect(clr.length).toBe(1);
    expect(clr[0].issuing_tenant_id).toBe(A);
    expect(clr[0].redeeming_tenant_id).toBe(B);
    expect(Number(clr[0].amount_cents)).toBe(2500);
    expect(clr[0].status).toBe('pending');
    expect(clr[0].redemption_transaction_id).toBe(led[0].id);
    expect(clr[0].program_id).toBe(P);
  });

  it('a non-member salon cannot redeem the network card', async () => {
    const ok = await repo.decrementGift(ctxC, 'GC-NET1', 100);
    expect(ok).toBe(false);
    const card = await q(`select balance_cents from gift_cards where id=$1`, [NET]);
    expect(Number(card[0].balance_cents)).toBe(3500); // untouched
  });

  it('over-redeem is refused by the guard, leaving the card untouched', async () => {
    const ok = await repo.decrementGift(ctxB, 'GC-NET1', 999999);
    expect(ok).toBe(false);
    const card = await q(`select balance_cents from gift_cards where id=$1`, [NET]);
    expect(Number(card[0].balance_cents)).toBe(3500);
  });

  it('same-tenant redemption creates NO clearing entry', async () => {
    const ok = await repo.decrementGift(ctxA, 'GC-SOLO1', 1000);
    expect(ok).toBe(true);
    const card = await q(`select balance_cents from gift_cards where id=$1`, [SOLO]);
    expect(Number(card[0].balance_cents)).toBe(4000);
    const clr = await q(`select count(*)::int as c from gift_card_clearing_entries where gift_card_id=$1`, [SOLO]);
    expect(clr[0].c).toBe(0);
    const led = await q(`select tenant_id from gift_card_transactions where gift_card_id=$1 and type='redeem'`, [SOLO]);
    expect(led[0].tenant_id).toBe(A);
  });

  // Oct 6 2026 (migration 515): a network card paying at another member salon — the payment (the redeeming salon's) keeps
  // the card's last four, and the ledger row (the issuing salon's) names that payment and the ticket.
  it('a network card paying at a member salon: B\'s payment keeps its last four; A\'s ledger row names the payment', async () => {
    const NET2 = 'ac000000-0000-0000-0000-0000000000d3', NUM2 = '7001700270039876';
    await q(`insert into gift_cards (id, tenant_id, code, program_id, card_number_hash, card_number_last4, initial_balance_cents, balance_cents, status) values ($1,$2,'GC-NET2',$3,$4,$5,20000,20000,'active')`, [NET2, A, P, hashCardNumber(NUM2), lastFour(NUM2)]);
    await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'B Main','active') on conflict do nothing`, [ctxB.branchId, B]);
    const cust = (await q(`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,'Nia','Net','Nia Net') returning id`, [B, ctxB.branchId]))[0].id;
    const tk = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents) values ($1,$2,$3,'ready_checkout',4000,0,0,4000,0) returning id`, [B, ctxB.branchId, cust]))[0].id;
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,'00000000-0000-0000-0000-000000000000','Pedicure',4000,45,4000)`, [B, ctxB.branchId, tk]);
    await svc.payGiftCard(ctxB, tk, { giftCardCode: 'GC-NET2' });
    const pay = (await q(`select id, tenant_id, gift_card_last4 from payments where ticket_id = $1`, [tk]))[0];
    expect(pay).toMatchObject({ tenant_id: B, gift_card_last4: '9876' });
    const led = await q(`select tenant_id, ticket_id, payment_id from gift_card_transactions where gift_card_id = $1 and type = 'redeem'`, [NET2]);
    expect(led).toEqual([{ tenant_id: A, ticket_id: tk, payment_id: pay.id }]);
  });
});
