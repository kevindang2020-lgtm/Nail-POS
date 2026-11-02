// gift-card-clearing.pgtest.vitest.spec.ts — proves the cross-tenant clearing/settlement schema (migration 406) applies
// from scratch and that its guardrails hold: a clearing entry only exists for genuinely cross-tenant redemptions, amounts
// are positive integer cents, one obligation per redemption, and program membership is unique. Pure schema test — no repo.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '@aipowersalon/database';

const T = 'fc000000-0000-0000-0000-000000000001';   // issuing tenant
const T2 = 'fc000000-0000-0000-0000-000000000002';  // redeeming tenant
const GC = 'fc000000-0000-0000-0000-0000000000d1';  // a gift card
const OWNER = 'fc000000-0000-0000-0000-00000000000a';

let pg: PGlite;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);
const throws = async (fn: () => Promise<unknown>) => { try { await fn(); return false; } catch { return true; } };

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;   // stated by @aipowersalon/database — never process.cwd() (from a module that path does not exist)
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','a','A') , ($2,'B','B','b','B')`, [T, T2]);
  await q(`insert into gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status) values ($1,$2,'GC-CLR1',10000,10000,'active')`, [GC, T]);
});

describe('gift-card cross-tenant clearing schema (§15-17)', () => {
  it('applied migration 406: clearing tables + program scope + member lifecycle exist', async () => {
    const tables = await q(`select table_name from information_schema.tables where table_name in ('gift_card_settlement_batches','gift_card_clearing_entries')`);
    expect(tables.map((r: any) => r.table_name).sort()).toEqual(['gift_card_clearing_entries', 'gift_card_settlement_batches']);
    const scope = await q(`select column_name from information_schema.columns where table_name='gift_card_programs' and column_name='scope'`);
    expect(scope.length).toBe(1);
    const memberStatus = await q(`select column_name from information_schema.columns where table_name='gift_card_program_members' and column_name='status'`);
    expect(memberStatus.length).toBe(1);
  });

  it('records a cross-tenant clearing obligation (issuer owes redeemer)', async () => {
    await q(`insert into gift_card_clearing_entries (gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents, platform_fee_cents) values ($1,$2,$3,4000,100)`, [GC, T, T2]);
    const row = await q(`select issuing_tenant_id, redeeming_tenant_id, amount_cents, platform_fee_cents, status from gift_card_clearing_entries where gift_card_id=$1`, [GC]);
    expect(row.length).toBe(1);
    expect(row[0].issuing_tenant_id).toBe(T);
    expect(row[0].redeeming_tenant_id).toBe(T2);
    expect(Number(row[0].amount_cents)).toBe(4000);
    expect(row[0].status).toBe('pending'); // default
  });

  it('rejects a same-tenant clearing entry (nothing to clear)', async () => {
    expect(await throws(() => q(`insert into gift_card_clearing_entries (gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents) values ($1,$2,$2,1000)`, [GC, T]))).toBe(true);
  });

  it('rejects a non-positive amount', async () => {
    expect(await throws(() => q(`insert into gift_card_clearing_entries (gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents) values ($1,$2,$3,0)`, [GC, T, T2]))).toBe(true);
    expect(await throws(() => q(`insert into gift_card_clearing_entries (gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents) values ($1,$2,$3,-50)`, [GC, T, T2]))).toBe(true);
  });

  it('enforces one clearing entry per redemption ledger row', async () => {
    const RID = 'fc000000-0000-0000-0000-0000000000e1';
    await q(`insert into gift_card_clearing_entries (gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents, redemption_transaction_id) values ($1,$2,$3,500,$4)`, [GC, T, T2, RID]);
    expect(await throws(() => q(`insert into gift_card_clearing_entries (gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents, redemption_transaction_id) values ($1,$2,$3,500,$4)`, [GC, T, T2, RID]))).toBe(true);
  });

  it('links a clearing entry to a settlement batch', async () => {
    const b = await q(`insert into gift_card_settlement_batches (status, total_cents) values ('open', 4000) returning id`);
    const batchId = b[0].id;
    await q(`update gift_card_clearing_entries set settlement_batch_id=$1 where gift_card_id=$2 and redemption_transaction_id is null`, [batchId, GC]);
    const linked = await q(`select count(*)::int as c from gift_card_clearing_entries where settlement_batch_id=$1`, [batchId]);
    expect(linked[0].c).toBeGreaterThanOrEqual(1);
  });

  it('program scope defaults to tenant_only and membership is unique per tenant', async () => {
    const p = await q(`insert into gift_card_programs (owner_tenant_id, name) values ($1,'Network') returning id, scope`, [OWNER]);
    expect(p[0].scope).toBe('tenant_only');
    const programId = p[0].id;
    await q(`insert into gift_card_program_members (program_id, tenant_id) values ($1,$2)`, [programId, T]);
    expect(await throws(() => q(`insert into gift_card_program_members (program_id, tenant_id) values ($1,$2)`, [programId, T]))).toBe(true);
    // the enrichment columns exist with sane defaults
    const m = await q(`select status from gift_card_program_members where program_id=$1 and tenant_id=$2`, [programId, T]);
    expect(m[0].status).toBe('active');
  });
});
