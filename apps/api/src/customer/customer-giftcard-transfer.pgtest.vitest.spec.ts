// customer-giftcard-transfer.pgtest.vitest.spec.ts — pins send-to-friend TRANSFER against the real schema (spec §10/§11).
// When a recipient claims a gifted card: (1) ownership moves to the claimer, (2) any outstanding presentation tokens
// (barcodes) held by the previous owner are revoked so they stop working immediately, and (3) the claim is single-use —
// a replay of the same claim token does nothing. This uses PGlite with the real migrations, exercising the raw SQL.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCustomerRepository } from './customer.kysely.repository';
import { mintClaimToken, hashClaimToken } from '@aipowersalon/gift-cards';

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

const T = 'dc000000-0000-0000-0000-000000000001';
const BR = 'dc000000-0000-0000-0000-0000000000b1';
const SENDER = 'dc000000-0000-0000-0000-0000000000c1';
const CLAIMER = 'dc000000-0000-0000-0000-0000000000c2';
const CARD = 'dc000000-0000-0000-0000-0000000000d1';
const PTOK = 'dc000000-0000-0000-0000-0000000000f1';
const CARD2 = 'dc000000-0000-0000-0000-0000000000d2';
const PTOK2 = 'dc000000-0000-0000-0000-0000000000f2';
const senderCtx: any = { tenantId: T, branchId: BR, userId: 'us', role: 'CUSTOMER', permissions: [] };
const claimerCtx: any = { tenantId: T, branchId: BR, userId: 'uc', role: 'CUSTOMER', permissions: [] };

let pg: PGlite;
let repo: KyselyCustomerRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const minted = mintClaimToken();

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCustomerRepository(db as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D','slug','CODE')`, [T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sam','Sender','Sam Sender')`, [SENDER, T, BR]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Casey','Claimer','Casey Claimer')`, [CLAIMER, T, BR]);
  // A live card owned by the sender, with a $50 balance.
  await q(`insert into gift_cards (id, tenant_id, branch_id, code, initial_balance_cents, balance_cents, status, customer_id) values ($1,$2,$3,'GCTRANSFER01',5000,5000,'active',$4)`, [CARD, T, BR, SENDER]);
  // An outstanding, un-revoked presentation token (barcode) for that card, still within its short expiry window.
  await q(`insert into gift_card_presentation_tokens (id, tenant_id, gift_card_id, token_hash, nonce, expires_at) values ($1,$2,$3,'ptokhash1','nonce1', now() + interval '90 seconds')`, [PTOK, T, CARD]);
  // A second live card (with its own barcode) for the report-lost / freeze tests.
  await q(`insert into gift_cards (id, tenant_id, branch_id, code, initial_balance_cents, balance_cents, status, customer_id) values ($1,$2,$3,'GCLOST01',3000,3000,'active',$4)`, [CARD2, T, BR, SENDER]);
  await q(`insert into gift_card_presentation_tokens (id, tenant_id, gift_card_id, token_hash, nonce, expires_at) values ($1,$2,$3,'ptokhash2','nonce2', now() + interval '90 seconds')`, [PTOK2, T, CARD2]);
});

describe('gift-card send-to-friend — transfer, barcode revocation, single-use (§10/§11)', () => {
  it('creates a claim and transfers ownership to the claimer, revoking outstanding barcodes', async () => {
    await repo.createGiftCardClaim(senderCtx, { cardId: CARD, senderCustomerId: SENDER, tokenHash: minted.tokenHash, recipientPhone: '+15551230000', message: 'Enjoy!', expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });

    const claim = await repo.findGiftCardClaimByHash(claimerCtx, hashClaimToken(minted.token));
    expect(claim).not.toBeNull();
    expect(claim!.giftCardId).toBe(CARD);

    const res = await repo.claimGiftCardTransfer(claimerCtx, claim!.id, CARD, CLAIMER);
    expect(res.ok).toBe(true);
    expect(res.balanceCents).toBe(5000);
    expect(res.senderName).toBe('Sam Sender');
    expect(res.message).toBe('Enjoy!');

    // Ownership moved to the claimer.
    const card = await q(`select customer_id, recipient_id from gift_cards where id=$1`, [CARD]);
    expect(card[0].customer_id).toBe(CLAIMER);
    expect(card[0].recipient_id).toBe(CLAIMER);

    // §11: the previously-issued barcode is now revoked.
    const tok = await q(`select revoked_at from gift_card_presentation_tokens where id=$1`, [PTOK]);
    expect(tok[0].revoked_at).not.toBeNull();

    // The claim token itself is marked claimed by the claimer.
    const ct = await q(`select claimed_at, claimed_by_customer_id from gift_card_claim_tokens where token_hash=$1`, [minted.tokenHash]);
    expect(ct[0].claimed_at).not.toBeNull();
    expect(ct[0].claimed_by_customer_id).toBe(CLAIMER);
  });

  it('is single-use: replaying the same claim token does not transfer again', async () => {
    const claim = await repo.findGiftCardClaimByHash(claimerCtx, hashClaimToken(minted.token));
    const again = await repo.claimGiftCardTransfer(claimerCtx, claim!.id, CARD, SENDER);
    expect(again.ok).toBe(false);
    // Ownership is unchanged (still the first claimer, not reverted to the sender).
    const card = await q(`select customer_id from gift_cards where id=$1`, [CARD]);
    expect(card[0].customer_id).toBe(CLAIMER);
  });
});

describe('gift-card report lost/stolen — freeze + barcode revocation + ledger (§22)', () => {
  it('freezes an owned card, revokes its barcodes, and writes a 0-amount freeze ledger event', async () => {
    const res = await repo.reportGiftCardLost(senderCtx, SENDER, CARD2);
    expect(res.ok).toBe(true);
    const card = await q(`select status, balance_cents from gift_cards where id=$1`, [CARD2]);
    expect(card[0].status).toBe('frozen');
    expect(Number(card[0].balance_cents)).toBe(3000); // balance is protected, not spent
    const tok = await q(`select revoked_at from gift_card_presentation_tokens where id=$1`, [PTOK2]);
    expect(tok[0].revoked_at).not.toBeNull();
    const led = await q(`select amount_cents, balance_after_cents from gift_card_transactions where gift_card_id=$1 and type='freeze'`, [CARD2]);
    expect(led.length).toBe(1);
    expect(Number(led[0].amount_cents)).toBe(0);
    expect(Number(led[0].balance_after_cents)).toBe(3000);
  });

  it('rejects a repeat report (already frozen) and a card the customer does not own', async () => {
    const again = await repo.reportGiftCardLost(senderCtx, SENDER, CARD2);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('not_freezable');
    const notOwned = await repo.reportGiftCardLost(senderCtx, CLAIMER, CARD2);
    expect(notOwned.ok).toBe(false);
    expect(notOwned.reason).toBe('not_found');
  });
});
