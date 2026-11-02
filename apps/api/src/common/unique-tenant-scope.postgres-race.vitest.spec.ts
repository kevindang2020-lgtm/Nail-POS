// unique-tenant-scope.postgres-race — BUILD_PLAN Phase 15 C (docs/UNIQUE_INDEX_TENANT_REVIEW.md), migrations 567 + 568 on a
// REAL Postgres (PG_RACE_URL = a database migrated by scripts/migrate.mjs), with real concurrency:
//   • the card-processor webhook: two salons on the same processor deliver events with the SAME event id at the same time —
//     both are applied; each salon's own retries racing the original are still applied once;
//   • the migrated schema: the tenant-scoped claim index is valid and unique, the platform-wide one is gone;
//   • the real runner over the real 567 / 568 files on fixture databases: when 538's index exists the build is CONCURRENTLY
//     and nothing is deferred; when 538 had been DEFERRED and duplicates exist, 567 defers the new index (count only), closes
//     538's deferral as superseded, 568's build is SKIPPED (the deploy succeeds), and the recorded retry statement builds it
//     once the duplicate is resolved.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { PaymentWebhookService } from '@aipowersalon/payments';
import { MIGRATIONS_DIR as MIGS } from '@aipowersalon/database';
import { allowedRetrySql } from './db-constraints.service';

const url = process.env.PG_RACE_URL;
const RUNNER = resolve(__dirname, '..', '..', 'scripts', 'migrate.mjs');
const TA = 'd1520000-0000-4000-8000-00000000000a', TB = 'd1520000-0000-4000-8000-00000000000b';
const BA = 'd1530000-0000-4000-8000-00000000000a', BB = 'd1530000-0000-4000-8000-00000000000b';
const SECRET_A = 'p15-race-fixture-a', SECRET_B = 'p15-race-fixture-b';   // test fixtures, not credentials
const TAG = `p15c${process.pid}`;
const resolver: any = { resolveTenantByMerchantId: async (mid: string) => mid === 'MID-A' ? { tenantId: TA, webhookSecret: SECRET_A, merchantIdMasked: '***A' } : mid === 'MID-B' ? { tenantId: TB, webhookSecret: SECRET_B, merchantIdMasked: '***B' } : null };

function run(env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [RUNNER], { env: { ...process.env, MIGRATE_DATABASE_URL: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => done({ code, out }));
  });
}

describe.skipIf(!url)('payment_gateway_events claim is per salon — real Postgres, real concurrency', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) }) });
  const a = url ? mk() : (null as any), b = url ? mk() : (null as any);
  const deliver = (db: any, body: Record<string, unknown>, secret: string) => {
    const raw = JSON.stringify(body);
    const sig = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
    return new PaymentWebhookService(db, resolver).handle('cardpointe', raw, body, sig, { 'x-webhook-signature': sig });
  };
  const n = async (q: any) => Number((await q.execute(a)).rows[0].n);
  beforeAll(async () => {
    for (const [t, code] of [[TA, 'P15RA'], [TB, 'P15RB']]) {
      await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${code}, ${code}, ${code.toLowerCase()}, ${code}, 'active') on conflict (id) do nothing`.execute(a);
    }
    await sql`insert into branches (id, tenant_id, name) values (${BA}, ${TA}, 'A'), (${BB}, ${TB}, 'B') on conflict (id) do nothing`.execute(a);
  });
  afterAll(async () => {
    if (!a) return;
    await sql`delete from payment_settlements where tenant_id in (${TA}, ${TB})`.execute(a);
    await sql`delete from payment_gateway_events where tenant_id in (${TA}, ${TB})`.execute(a);
    await a.destroy(); await b.destroy();
  });

  it('two salons, same processor, same event id, delivered at the same time (each also retried) → one settlement per salon', async () => {
    const ev = `evt-${TAG}`;
    const bodyA = { merchantId: 'MID-A', eventType: 'settlement.batch_closed', eventId: ev, settlementId: `A-${TAG}`, grossCents: 5000 };
    const bodyB = { merchantId: 'MID-B', eventType: 'settlement.batch_closed', eventId: ev, settlementId: `B-${TAG}`, grossCents: 7000 };
    const out = await Promise.all([deliver(a, bodyA, SECRET_A), deliver(b, bodyB, SECRET_B), deliver(b, bodyA, SECRET_A), deliver(a, bodyB, SECRET_B), deliver(a, bodyA, SECRET_A), deliver(b, bodyB, SECRET_B)]);
    expect(out.every((o) => o.status === 200)).toBe(true);
    expect(out.filter((o) => (o.body as any).recordedSettlement).length).toBe(2);
    expect(out.filter((o) => (o.body as any).duplicate === true).length).toBe(4);
    expect(await n(sql`select count(*)::int n from payment_settlements where settlement_id in (${`A-${TAG}`}, ${`B-${TAG}`})`)).toBe(2);
    expect(await n(sql`select count(*)::int n from payment_gateway_events where event_id = ${ev} and processed_at is not null`)).toBe(2);
  });

  it('the migrated schema: the tenant-scoped claim index is valid + unique; the platform-wide one is gone; nothing deferred', async () => {
    const rows = (await sql<any>`select c.relname, i.indisvalid, i.indisunique, pg_get_indexdef(i.indexrelid) def from pg_index i join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'payment_gateway_events'::regclass and i.indisunique and not i.indisprimary`.execute(a)).rows;
    expect(rows.map((r: any) => r.relname)).toEqual(['uq_payment_gateway_events_tenant_processed']);
    expect(rows[0]).toMatchObject({ indisvalid: true, indisunique: true });
    expect(rows[0].def).toMatch(/\(tenant_id, processor_type, event_id\)/);
    expect(await n(sql`select count(*)::int n from schema_deferred_constraints where name like 'uq_payment_gateway_events%' and resolved_at is null`)).toBe(0);
  });
});

describe.skipIf(!url)('567 / 568 through the real runner on fixture databases', () => {
  const dbName = `race_p15_c_fx_${process.pid}`;
  const admin = url ? new pg.Pool({ connectionString: url, max: 1 }) : (null as any);
  afterAll(async () => { if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined); await admin.end(); } });
  async function freshDb() {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    const t = new URL(url!); t.pathname = `/${dbName}`; return t.toString();
  }
  async function q(dbUrl: string, text: string) {
    const c = new pg.Client({ connectionString: dbUrl }); await c.connect();
    try { return (await c.query(text)).rows; } finally { await c.end(); }
  }
  // The real 534 ledger + the real 538 helpers, a minimal payment_gateway_events, then the real 567 / 568 unchanged.
  const real = (f: string) => readFileSync(join(MIGS, f), 'utf8');
  const helpers = () => real('534_schema_operations_ledgers.sql') + '\n' + real('538_core_constraints.sql').split(/^DO \$\$ BEGIN/m)[0];
  function fixture(seed: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'p15c-'));
    writeFileSync(join(dir, '001_helpers.sql'), helpers());
    writeFileSync(join(dir, '002_pge.sql'), `CREATE TABLE payment_gateway_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, processor_type text, event_id text, processed_at timestamptz);\n${seed}`);
    writeFileSync(join(dir, '567_unique_tenant_scope_preflight.sql'), real('567_unique_tenant_scope_preflight.sql'));
    writeFileSync(join(dir, '568_unique_tenant_scope_indexes.sql'), real('568_unique_tenant_scope_indexes.sql'));
    return dir;
  }
  const uniques = (db: string) => q(db, `select c.relname, i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid where i.indrelid = 'payment_gateway_events'::regclass and i.indisunique and not i.indisprimary order by 1`);

  it("538's index present → no deferral, the tenant-scoped index is built CONCURRENTLY and the old one dropped", async () => {
    const db = await freshDb();
    const dir = fixture(`CREATE UNIQUE INDEX uq_payment_gateway_events_processed ON payment_gateway_events (processor_type, event_id) WHERE event_id IS NOT NULL AND processed_at IS NOT NULL;
INSERT INTO payment_gateway_events (tenant_id, processor_type, event_id, processed_at) VALUES ('${TA}', 'clover', 'e1', now()), ('${TB}', 'clover', 'e2', now());`);
    try {
      const r = await run({ DATABASE_URL: db, MIGRATIONS_DIR: dir });
      expect(r.code, r.out).toBe(0);
      expect(r.out).not.toMatch(/skipping/);
      expect(await uniques(db)).toEqual([{ relname: 'uq_payment_gateway_events_tenant_processed', indisvalid: true }]);
      expect(await q(db, `select count(*)::int n from schema_deferred_constraints`)).toEqual([{ n: 0 }]);
      // the two salons may now share an event id; one salon still may not repeat one
      await q(db, `insert into payment_gateway_events (tenant_id, processor_type, event_id, processed_at) values ('${TB}', 'clover', 'e1', now())`);
      await expect(q(db, `insert into payment_gateway_events (tenant_id, processor_type, event_id, processed_at) values ('${TB}', 'clover', 'e1', now())`)).rejects.toMatchObject({ code: '23505' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("538 had been DEFERRED and a salon holds duplicates → 567 defers, 568's build is skipped (deploy succeeds), the retry builds it after the fix", async () => {
    const db = await freshDb();
    const dir = fixture(`INSERT INTO schema_deferred_constraints (name, table_name, kind, migration, reason, blocking_rows, retry_sql) VALUES ('uq_payment_gateway_events_processed', 'payment_gateway_events', 'unique', '538_core_constraints.sql', '1 duplicate group(s)', 1, 'CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_gateway_events_processed ON payment_gateway_events (processor_type, event_id) WHERE event_id IS NOT NULL AND processed_at IS NOT NULL');
INSERT INTO payment_gateway_events (tenant_id, processor_type, event_id, processed_at) VALUES ('${TA}', 'clover', 'dup', now()), ('${TA}', 'clover', 'dup', now()), ('${TB}', 'clover', 'dup', now());`);
    try {
      const r = await run({ DATABASE_URL: db, MIGRATIONS_DIR: dir });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(/skipping uq_payment_gateway_events_tenant_processed — deferred by the pre-flight/);
      expect(await uniques(db)).toEqual([]);
      const d = await q(db, `select name, reason, blocking_rows, retry_sql, resolved_at is not null as resolved, resolved_by from schema_deferred_constraints order by name`);
      expect(d).toEqual([
        expect.objectContaining({ name: 'uq_payment_gateway_events_processed', resolved: true, resolved_by: 'superseded:567_unique_tenant_scope_preflight.sql' }),
        expect.objectContaining({ name: 'uq_payment_gateway_events_tenant_processed', reason: '1 duplicate group(s)', blocking_rows: 1, resolved: false }),
      ]);
      const retry = d[1].retry_sql as string;
      expect(allowedRetrySql(retry), 'the Super Admin retry would refuse the recorded statement').toBe(retry);
      expect(await q(db, `select count(*)::int n from schema_migrations where filename = '568_unique_tenant_scope_indexes.sql'`)).toEqual([{ n: 1 }]);
      // the duplicate is resolved → the recorded statement builds the per-salon index (salon B's same id is NOT a duplicate)
      await q(db, `delete from payment_gateway_events where ctid in (select ctid from payment_gateway_events where tenant_id = '${TA}' limit 1)`);
      await q(db, retry);
      expect(await uniques(db)).toEqual([{ relname: 'uq_payment_gateway_events_tenant_processed', indisvalid: true }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
