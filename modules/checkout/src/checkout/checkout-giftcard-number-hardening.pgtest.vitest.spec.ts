// checkout-giftcard-number-hardening.pgtest.vitest.spec.ts — pins card-number hardening against the real schema
// (spec §3/§12/§32). After migration 404 the 16-digit number is never stored in the clear: issuance persists only a
// sha256 hash (for scan / manual-entry lookup) and the last 4 (for masked display), and the plaintext column is null.
// This also verifies the migration's SQL backfill hash (Postgres digest) equals the app-side hashCardNumber, so a
// number typed at the POS resolves to the same card whether the hash was written by the app or by the backfill.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { hashCardNumber, lastFour } from '@aipowersalon/gift-cards';

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

const T = 'ec000000-0000-0000-0000-000000000001';
const ctx: any = { tenantId: T, branchId: 'ec000000-0000-0000-0000-0000000000b1', userId: 'ec000000-0000-0000-0000-0000000000f1', role: 'OWNER', permissions: [] };
const NUM = '4827193655028411';   // last4 8411
const NUM2 = '1234567890123456';  // last4 3456

let pg: PGlite;
let repo: KyselyCheckoutRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); // register digest() for migration 404's backfill
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyCheckoutRepository(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'L','D','slug','CODE')`, [T]);
});

describe('gift-card number hardening — hashed at rest, looked up by hash (§3/§12/§32)', () => {
  it('the migration hash (Postgres digest) matches the app hash', async () => {
    const r = await q(`select encode(digest($1,'sha256'),'hex') as h`, [NUM]);
    expect(r[0].h).toBe(hashCardNumber(NUM));
  });

  it('issuing a card stores only the hash + last4, never the plaintext number', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-HARDEN1', amountCents: 5000, cardNumber: NUM } as any);
    const row = await q(`select card_number, card_number_hash, card_number_last4 from gift_cards where code=$1`, ['GC-HARDEN1']);
    expect(row[0].card_number).toBeNull();
    expect(row[0].card_number_hash).toBe(hashCardNumber(NUM));
    expect(row[0].card_number_last4).toBe(lastFour(NUM));
  });

  it('resolves a typed/scanned number to its code via the hash (spacing-tolerant)', async () => {
    expect(await repo.resolveGiftCardCode(ctx, NUM)).toBe('GC-HARDEN1');
    expect(await repo.resolveGiftCardCode(ctx, '4827 1936 5502 8411')).toBe('GC-HARDEN1');
  });

  it('a number that matches no card resolves to null (no plaintext leak, safe miss)', async () => {
    expect(await repo.resolveGiftCardCode(ctx, '9999888877776666')).toBeNull();
  });

  it('a pending at-checkout sale also stores hash + last4, not the plaintext number', async () => {
    await repo.createPendingGiftCardSale(ctx, { code: 'GC-HARDEN2', amountCents: 7500, ticketId: 'ec000000-0000-0000-0000-0000000000a1', reference: 'GC-****-3456', cardNumber: NUM2 } as any);
    const row = await q(`select card_number, card_number_hash, card_number_last4, status from gift_cards where code=$1`, ['GC-HARDEN2']);
    expect(row[0].card_number).toBeNull();
    expect(row[0].card_number_hash).toBe(hashCardNumber(NUM2));
    expect(row[0].card_number_last4).toBe('3456');
  });
});

describe('gift-card replacement — new card + transfer ledger + retire original (§22)', () => {
  const NUM3 = '5555666677778888';
  let oldId = '';
  it('sets up a frozen card with an outstanding barcode', async () => {
    await repo.issueGiftCard(ctx, { code: 'GC-REPL1', amountCents: 4200, cardNumber: NUM3 } as any);
    const r = await q(`select id from gift_cards where code=$1`, ['GC-REPL1']);
    oldId = r[0].id;
    await q(`update gift_cards set status='frozen' where id=$1`, [oldId]);
    await q(`insert into gift_card_presentation_tokens (id, tenant_id, gift_card_id, token_hash, nonce, expires_at) values (gen_random_uuid(),$1,$2,'replptok','replnonce', now() + interval '90 seconds')`, [T, oldId]);
    expect(oldId).toBeTruthy();
  });

  it('mints a replacement, moves the balance via transfer ledger, and retires the original', async () => {
    const res = await repo.replaceGiftCardByCode(ctx, 'GC-REPL1');
    expect(res.ok).toBe(true);
    expect(res.balanceCents).toBe(4200);
    expect(!!res.newCardNumber && /^\d{16}$/.test(res.newCardNumber!)).toBe(true);
    expect(res.newReference).toBe('GC-****-' + (res.newCode || '').slice(-4));

    // New card: active, full balance, hashed number (plaintext null), lineage back to the old card.
    const nw = await q(`select id, status, balance_cents, card_number, card_number_hash, replacement_of_card_id from gift_cards where code=$1`, [res.newCode]);
    expect(nw[0].status).toBe('active');
    expect(Number(nw[0].balance_cents)).toBe(4200);
    expect(nw[0].card_number).toBeNull();
    expect(nw[0].card_number_hash).toBe(hashCardNumber(res.newCardNumber!));
    expect(nw[0].replacement_of_card_id).toBe(oldId);
    const newId = nw[0].id;

    // Old card: retired, zero balance, forward lineage to the replacement.
    const od = await q(`select status, balance_cents, replaced_by_card_id from gift_cards where id=$1`, [oldId]);
    expect(od[0].status).toBe('replaced');
    expect(Number(od[0].balance_cents)).toBe(0);
    expect(od[0].replaced_by_card_id).toBe(newId);

    // Ledger: a +4200 transfer credit on the new card and a matching -4200 debit on the old.
    const credit = await q(`select amount_cents from gift_card_transactions where gift_card_id=$1 and type='transfer'`, [newId]);
    expect(credit.length).toBe(1); expect(Number(credit[0].amount_cents)).toBe(4200);
    const debit = await q(`select amount_cents from gift_card_transactions where gift_card_id=$1 and type='transfer'`, [oldId]);
    expect(debit.length).toBe(1); expect(Number(debit[0].amount_cents)).toBe(-4200);

    // The old card's barcode is revoked.
    const tok = await q(`select revoked_at from gift_card_presentation_tokens where gift_card_id=$1`, [oldId]);
    expect(tok[0].revoked_at).not.toBeNull();
  });

  it('refuses to replace a retired card (no balance) or an unknown code', async () => {
    expect((await repo.replaceGiftCardByCode(ctx, 'GC-REPL1')).ok).toBe(false); // now 'replaced', 0 balance
    expect((await repo.replaceGiftCardByCode(ctx, 'GC-NOPE')).reason).toBe('not_found');
  });
});
