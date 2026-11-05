// display-tip-provenance.pgtest.vitest.spec.ts — closes the Custom Tip arc's deferred item on the REAL schema:
// a kiosk tip selection persists TRUE provenance on the session (selected_tip_type/percent, migration 419) AND on
// the ticket (tip_type/tip_percent, migration 418) — a percent preset is no longer collapsed to 'custom'. A paid
// ticket is never touched by the display write.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyDisplayRepository } from './customer-display.repository';

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

const T = 'df000000-0000-0000-0000-000000000001';
const BR = 'df000000-0000-0000-0000-0000000000b1';
const CUST = 'df000000-0000-0000-0000-0000000000c1';
const TK = 'df000000-0000-0000-0000-0000000000e1';
const TK_PAID = 'df000000-0000-0000-0000-0000000000e2';

let pg: PGlite;
let repo: KyselyDisplayRepository;
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
  repo = new KyselyDisplayRepository(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'D','D','dfA','DFA')`, [T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Kiosk','Guest','Kiosk Guest')`, [CUST, T, BR]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK, T, BR, CUST]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, tip_cents, tip_type) values ($1,$2,$3,$4,'paid',500,'custom')`, [TK_PAID, T, BR, CUST]);
  await q(`insert into customer_display_sessions (id, tenant_id, branch_id, ticket_id, state, public_token_hash) values ('df000000-0000-0000-0000-00000000005e',$1,$2,$3,'ticket_review','tokhash-df')`, [T, BR, TK]);
});

describe('display tip provenance (real schema)', () => {
  it('session persists selected_tip_type/percent; the ticket receives TRUE provenance (percent stays percent)', async () => {
    await repo.applyTip('df000000-0000-0000-0000-00000000005e', 2000, 10000, 700, 0, 12700, { tipType: 'percent', tipPercent: 20 });
    await repo.setTicketTipFromDisplay({ tenantId: T, ticketId: TK }, 2000, { tipType: 'percent', tipPercent: 20 });
    const sess = (await q(`select selected_tip_cents, selected_tip_type, selected_tip_percent from customer_display_sessions where id='df000000-0000-0000-0000-00000000005e'`))[0];
    expect(Number(sess.selected_tip_cents)).toBe(2000);
    expect(sess.selected_tip_type).toBe('percent');
    expect(Number(sess.selected_tip_percent)).toBe(20);
    const tk = (await q(`select tip_cents, tip_type, tip_percent from tickets where id=$1`, [TK]))[0];
    expect(Number(tk.tip_cents)).toBe(2000);
    expect(tk.tip_type).toBe('percent');
    expect(Number(tk.tip_percent)).toBe(20);

    await repo.setTicketTipFromDisplay({ tenantId: T, ticketId: TK }, 1750, { tipType: 'custom', tipPercent: null });
    const tk2 = (await q(`select tip_cents, tip_type, tip_percent from tickets where id=$1`, [TK]))[0];
    expect(Number(tk2.tip_cents)).toBe(1750);
    expect(tk2.tip_type).toBe('custom');
    expect(tk2.tip_percent).toBeNull();
  });

  it('a PAID ticket is never touched by the display write', async () => {
    await repo.setTicketTipFromDisplay({ tenantId: T, ticketId: TK_PAID }, 9999, { tipType: 'percent', tipPercent: 99 });
    const tk = (await q(`select tip_cents, tip_type from tickets where id=$1`, [TK_PAID]))[0];
    expect(Number(tk.tip_cents)).toBe(500);
    expect(tk.tip_type).toBe('custom');
  });
});
