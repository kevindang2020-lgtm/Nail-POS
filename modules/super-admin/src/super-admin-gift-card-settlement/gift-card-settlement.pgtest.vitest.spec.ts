// gift-card-settlement.pgtest.vitest.spec.ts — proves the settlement surface against real SQL (spec §16/§33): pending
// cross-tenant obligations summarize + roll up per salon, get grouped into a batch, and the batch's reviewed lifecycle
// cascades to its entries. No money moves — a person advances the batch; open -> settled is never a valid jump.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyGiftCardSettlementRepo } from './gift-card-settlement.repository';
import { GiftCardSettlementService } from './gift-card-settlement.service';

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

const A = 'bc000000-0000-0000-0000-000000000001';
const B = 'bc000000-0000-0000-0000-000000000002';
const P = 'bc000000-0000-0000-0000-0000000000f0';
const GC = 'bc000000-0000-0000-0000-0000000000d1';
const ADMIN = 'bc000000-0000-0000-0000-0000000000c1';

let pg: PGlite;
let svc: GiftCardSettlementService;
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
  svc = new GiftCardSettlementService(new KyselyGiftCardSettlementRepo(db as any));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','a','A'),($2,'B','B','b','B')`, [A, B]);
  await q(`insert into gift_card_programs (id, owner_tenant_id, name, scope) values ($1,$2,'Net','network')`, [P, A]);
  await q(`insert into gift_cards (id, tenant_id, code, program_id, initial_balance_cents, balance_cents, status) values ($1,$2,'GC-S1',$3,10000,10000,'active')`, [GC, A, P]);
  // Two pending obligations: A (issuer) owes B (redeemer).
  await q(`insert into gift_card_clearing_entries (program_id, gift_card_id, issuing_tenant_id, redeeming_tenant_id, amount_cents, platform_fee_cents) values ($1,$2,$3,$4,4000,100),($1,$2,$3,$4,2000,50)`, [P, GC, A, B]);
});

describe('gift-card settlement (§16/§33)', () => {
  it('summarizes pending obligations and rolls up per-salon positions', async () => {
    const st = await svc.getState();
    expect(st.pending.count).toBe(2);
    expect(st.pending.totalCents).toBe(6000);
    expect(st.pending.feeCents).toBe(150);
    const aPos = st.positions.find((p: any) => p.tenantId === A)!;
    const bPos = st.positions.find((p: any) => p.tenantId === B)!;
    expect(aPos.payableCents).toBe(6000); expect(aPos.netCents).toBe(-6000);
    expect(bPos.receivableCents).toBe(6000); expect(bPos.netCents).toBe(6000);
  });

  it('groups the pending entries into a batch and empties the queue', async () => {
    const batch = await svc.createBatch({});
    expect(batch.entryCount).toBe(2);
    expect(batch.totalCents).toBe(6000);
    expect(batch.status).toBe('open');
    const st = await svc.getState();
    expect(st.pending.count).toBe(0);
    const entries = await q(`select status, settlement_batch_id from gift_card_clearing_entries`);
    expect(entries.every((e: any) => e.status === 'ready' && e.settlement_batch_id === batch.id)).toBe(true);
  });

  it('drives the batch review -> approved -> settled, cascading entry status', async () => {
    const id = (await svc.getState()).batches[0].id;
    await svc.setBatchStatus(id, { status: 'pending_review' }, ADMIN);
    const approved = await svc.setBatchStatus(id, { status: 'approved' }, ADMIN);
    expect(approved.status).toBe('approved');
    expect(approved.approvedByUserId).toBe(ADMIN);
    const ent = await q(`select status from gift_card_clearing_entries where settlement_batch_id=$1`, [id]);
    expect(ent.every((e: any) => e.status === 'approved')).toBe(true);
    await svc.setBatchStatus(id, { status: 'settled' }, ADMIN);
    const settled = await q(`select status from gift_card_clearing_entries where settlement_batch_id=$1`, [id]);
    expect(settled.every((e: any) => e.status === 'settled')).toBe(true);
    // all settled -> nothing outstanding
    expect((await svc.getState()).positions.length).toBe(0);
  });

  it('rejects an invalid lifecycle jump (a settled batch cannot go back to approved)', async () => {
    const id = (await svc.getState()).batches[0].id;
    await expect(svc.setBatchStatus(id, { status: 'approved' }, ADMIN)).rejects.toThrow(/cannot move/i);
  });
});
