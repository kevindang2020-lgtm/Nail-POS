// phase10-c-migrations.pgtest — BUILD_PLAN Phase 10, migrations 540–542 on the real schema, including the paths a fresh
// database never takes (an EXISTING database with duplicates, legacy rows and plaintext secrets):
//   * a fresh database defers nothing, and every file re-runs cleanly (railway runs migrations on every start);
//   * 540 merges duplicate loyalty profiles and seeds the opening balance, so sum(delta) = points_balance everywhere;
//   * 541 copies every legacy support session and idempotency row into the one store before dropping the old tables;
//   * 542 (bug 6) drops the plaintext webhook token, and DEFERS the plaintext secret drop while a row has no encrypted
//     twin — counts only in the record, never the secret.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { applyMigrationToPglite } from '../../db/migration-sql.mjs';

const MIG = MIGRATIONS_DIR;
const FILES = ['540_loyalty_ledger_truth.sql', '541_audit_fields_and_duplicate_stores.sql', '542_unused_audit_tables_and_451_cleanup.sql'];
const rerun = (pg: any, f: string) => applyMigrationToPglite(pg, readFileSync(join(MIG, f), 'utf8'));
const T = 'e4e4e4e4-0000-4000-8000-0000000000a1', B = 'e4e4e4e4-0000-4000-8000-0000000000b1';
const C1 = 'e4e4e4e4-0000-4000-8000-0000000000c1', C2 = 'e4e4e4e4-0000-4000-8000-0000000000c2';
const ADMIN = 'e4e4e4e4-0000-4000-8000-0000000000d1';
let pg: any; let db: any;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const cols = async (t: string) => (await q(sql`select column_name c from information_schema.columns where table_name = ${t}`)).map((r) => r.c);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','M','Mig Salon','mig-salon','MIGS01','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES
      ('${C1}','${T}','${B}','A','A','A A','active'), ('${C2}','${T}','${B}','B','B','B B','active');`);
}, 120_000);

describe('fresh database', () => {
  it('540–542 deferred nothing and re-run cleanly', async () => {
    expect(await q(sql`select name from schema_deferred_constraints where migration = any(${FILES}::text[])`)).toEqual([]);
    for (const f of FILES) await rerun(pg, f);
    expect(await q(sql`select name from schema_deferred_constraints where migration = any(${FILES}::text[])`)).toEqual([]);
    for (const t of ['super_admin_support_sessions', 'membership_support_sessions', 'ai_checkout_upsell_idempotency', 'voice_gateway_idempotency',
      'pos_tech_appointments_audit', 'pos_tech_queue_audit', 'pos_service_done_audit']) expect((await q(sql`select to_regclass(${t}) r`))[0].r, t).toBeNull();
    expect((await q(sql`select to_regclass('pos_queue_audit') r`))[0].r).not.toBeNull();   // 11 readers: stays
    expect(await cols('audit_events')).toEqual(expect.arrayContaining(['before_state', 'after_state', 'reason', 'request_id', 'correlation_id', 'session_id']));
    expect(await cols('global_customers')).toContain('customer_identity_id');
  });
});

describe('540 on a database with duplicate profiles (bug 4) and balances written outside the ledger', () => {
  it('merges the duplicates into the oldest, then seeds ONE opening entry per profile so sum(delta) = balance', async () => {
    for (const r of await q(sql`select indexname from pg_indexes where tablename = 'customer_loyalty_profiles' and indexdef like 'CREATE UNIQUE%' and indexname not like '%pkey'`))
      await sql`drop index ${sql.id(r.indexname)}`.execute(db);                       // an existing database had no unique index
    await pg.exec(`
      INSERT INTO customer_loyalty_profiles (tenant_id, branch_id, customer_id, points_balance, total_earned_points, total_redeemed_points, created_at) VALUES
        ('${T}','${B}','${C1}',30,40,10, now() - interval '2 days'), ('${T}','${B}','${C1}',12,12,0, now()), ('${T}','${B}','${C2}',7,7,0, now());
      INSERT INTO loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance) VALUES ('${T}','${B}','${C1}','earn_purchase',5,'pos',5);`);
    await rerun(pg, FILES[0]);
    expect(await q(sql`select customer_id, points_balance, total_earned_points, total_redeemed_points from customer_loyalty_profiles where tenant_id = ${T} order by customer_id`))
      .toEqual([{ customer_id: C1, points_balance: 42, total_earned_points: 52, total_redeemed_points: 10 }, { customer_id: C2, points_balance: 7, total_earned_points: 7, total_redeemed_points: 0 }]);
    const sums = await q(sql`select p.customer_id, p.points_balance, (select sum(delta)::int from loyalty_ledger l where l.tenant_id = p.tenant_id and l.customer_id = p.customer_id) s
      from customer_loyalty_profiles p where p.tenant_id = ${T}`);
    expect(sums.every((r) => r.s === r.points_balance)).toBe(true);
    expect(await q(sql`select delta::int, entry_type, source_table from loyalty_ledger where tenant_id = ${T} and customer_id = ${C1} order by created_at`))
      .toEqual([{ delta: 5, entry_type: 'earn', source_table: null }, { delta: 37, entry_type: 'adjust', source_table: 'customer_loyalty_profiles' }]);
    await rerun(pg, FILES[0]);                                                          // idempotent: no second opening row
    expect((await q(sql`select count(*)::int n from loyalty_ledger where tenant_id = ${T}`))[0].n).toBe(3);
    await expect(sql`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id) values (${T}, ${B}, ${C2})`.execute(db)).rejects.toThrow();   // one per customer again
  });
});

describe('541 on a database that still has the legacy stores', () => {
  it('copies every legacy support session and idempotency row into the one store, then drops the old tables', async () => {
    const S1 = 'e4e4e4e4-0000-4000-8000-0000000000f1', S2 = 'e4e4e4e4-0000-4000-8000-0000000000f2';
    await pg.exec(`
      CREATE TABLE super_admin_support_sessions (id uuid PRIMARY KEY, super_admin_user_id uuid NOT NULL, tenant_id uuid NOT NULL, reason text NOT NULL,
        ip_address inet, user_agent text, started_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, ended_at timestamptz, extension_count int NOT NULL DEFAULT 0);
      INSERT INTO super_admin_support_sessions (id, super_admin_user_id, tenant_id, reason, expires_at, extension_count) VALUES ('${S1}','${ADMIN}','${T}','legacy view pos', now() + interval '20 minutes', 1);
      CREATE TABLE membership_support_sessions (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, opened_by_user_id uuid, reason text NOT NULL, access_level text NOT NULL DEFAULT 'read_only',
        status text NOT NULL DEFAULT 'active', opened_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, closed_at timestamptz);
      INSERT INTO membership_support_sessions (id, tenant_id, opened_by_user_id, reason, access_level, status, expires_at) VALUES ('${S2}','${T}','${ADMIN}','member dispute','assist','closed', now() - interval '1 hour');
      CREATE TABLE voice_gateway_idempotency (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, operation text NOT NULL, idempotency_key text NOT NULL,
        request_hash text NOT NULL, status text NOT NULL DEFAULT 'pending', response jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO voice_gateway_idempotency (tenant_id, branch_id, operation, idempotency_key, request_hash, status, response) VALUES ('${T}','${B}','book','call-1','h1','committed','{"appointmentId":"a-1"}');
      CREATE TABLE ai_checkout_upsell_idempotency (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, branch_id uuid NOT NULL, checkout_id uuid NOT NULL, operation text NOT NULL,
        target_id text NOT NULL, idem_key text NOT NULL, payload_hash text NOT NULL, status text NOT NULL DEFAULT 'pending', result jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
      INSERT INTO ai_checkout_upsell_idempotency (tenant_id, branch_id, checkout_id, operation, target_id, idem_key, payload_hash, status, result) VALUES ('${T}','${B}','${C1}','add_addon','ao1','k1','p1','done','{"lineId":"L"}');`);
    await rerun(pg, FILES[1]);
    expect(await q(sql`select id, admin_user_id, scope, extension_count, (ended_at is null) open from support_access_sessions where id in (${S1}, ${S2}) order by id`)).toEqual([
      { id: S1, admin_user_id: ADMIN, scope: 'READ_ONLY', extension_count: 1, open: true },
      { id: S2, admin_user_id: ADMIN, scope: 'STANDARD_SUPPORT', extension_count: 0, open: false }]);
    expect(await q(sql`select scope, idem_key, state, response_body from api_idempotency where tenant_id = ${T} order by scope`)).toEqual([
      { scope: `ai_upsell:${T}:${B}:${C1}:add_addon:ao1`, idem_key: 'k1', state: 'done', response_body: { lineId: 'L' } },
      { scope: `voice:${T}:book`, idem_key: 'call-1', state: 'done', response_body: { appointmentId: 'a-1' } }]);
    for (const t of ['super_admin_support_sessions', 'membership_support_sessions', 'voice_gateway_idempotency', 'ai_checkout_upsell_idempotency'])
      expect((await q(sql`select to_regclass(${t}) r`))[0].r).toBeNull();
  });
});

describe('542 (bug 6) on a database that still holds plaintext webhook credentials', () => {
  it('drops the plaintext token (its hash is computable); DEFERS the secret drop while a row has no encrypted twin', async () => {
    const BA = 'e4e4e4e4-0000-4000-8000-0000000000aa';
    await pg.exec(`
      ALTER TABLE bank_webhook_endpoints ADD COLUMN token text; ALTER TABLE bank_webhook_endpoints ADD COLUMN signing_secret text;
      INSERT INTO bank_webhook_endpoints (tenant_id, bank_account_id, token, signing_secret, status) VALUES ('${T}','${BA}','tok-plain','whsec-PLAINTEXT-ONLY','active');
      INSERT INTO bank_webhook_endpoints (tenant_id, bank_account_id, token_hash, signing_secret, signing_secret_enc, status) VALUES ('${T}','${BA}','h2','whsec-has-twin','v1.x.y','active');`);
    await rerun(pg, FILES[2]);
    const c = await cols('bank_webhook_endpoints');
    expect(c).not.toContain('token');                                                   // hashed in SQL, then dropped
    expect(c).toContain('signing_secret');                                              // cannot be sealed in SQL → kept, deferred
    expect((await q(sql`select token_hash from bank_webhook_endpoints where tenant_id = ${T} and signing_secret_enc is null`))[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await q(sql`select signing_secret from bank_webhook_endpoints where token_hash = 'h2'`)).toEqual([{ signing_secret: null }]);   // a redundant plaintext copy is cleared
    const d = await q(sql`select name, kind, blocking_rows, reason, retry_sql, resolved_at from schema_deferred_constraints where table_name = 'bank_webhook_endpoints'`);
    expect(d).toEqual([{ name: 'bank_webhook_endpoints.signing_secret', kind: 'other', blocking_rows: 1, reason: expect.stringMatching(/^1 plaintext signing secrets/),
      retry_sql: 'ALTER TABLE bank_webhook_endpoints DROP COLUMN IF EXISTS signing_secret', resolved_at: null }]);
    expect(JSON.stringify(d)).not.toContain('whsec');                                   // counts only, never the secret
    // once the row is sealed (the seal script's job) the same migration finishes the drop
    await pg.exec(`UPDATE bank_webhook_endpoints SET signing_secret_enc = 'v1.a.b', signing_secret = NULL WHERE tenant_id = '${T}' AND signing_secret_enc IS NULL`);
    await rerun(pg, FILES[2]);
    expect(await cols('bank_webhook_endpoints')).not.toContain('signing_secret');
  });
});
