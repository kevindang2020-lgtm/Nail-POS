// response-exposure.pgtest — BUILD_PLAN Phase 12 / Constitution 5 §37 + §138 (API_DEFINITION_OF_DONE #19):
// "do not return raw database rows automatically" / "return only needed data".
//
// Three layers:
//   1. the static audit (scripts/audit-response-exposure.mjs, gate check:response-exposure) finds what it claims to find —
//      planted star / alias-star / sensitive-column / returning reads, and NOT a boolean aliased like the column;
//   2. against the MIGRATED schema (every migration, PGlite): the classifier sees every sensitive column the database
//      really has (the types-file parser had gone blind to every table after a one-line interface — fixed here), and
//      every table the Phase 10 registry calls SECURITY_SECRET carries a column the gate guards (or a reviewed reason);
//   3. the fixed read paths, run on the real schema, return the mapped fields only — no hash, no token.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from '@aipowersalon/inventory';
import { KyselyDisplayDevicesRepository } from '../customer-display/display-devices.repository';
import { KyselyDisplayRepository } from '../customer-display/customer-display.repository';
// plain ESM helpers shared with the CLI (no type declarations)
const { readsIn, schemaColumns, isSensitiveColumn, typeLeaks, audit, registrySensitivity }: any = await import('../../scripts/audit-response-exposure.mjs');

const API = join(__dirname, '..', '..');
const T = 'd1200000-0000-0000-0000-000000000001', B = 'd1200000-0000-0000-0000-0000000000b1';

describe('the static audit finds what it claims (#19)', () => {
  const tables = new Map<string, string[]>([['secrets_t', ['id', 'name', 'api_key_enc', 'token_hash']], ['plain_t', ['id', 'name']]]);
  const sensitive = new Map([['secrets_t', new Set(['api_key_enc', 'token_hash'])]]);
  const kinds = (src: string) => readsIn(src, tables, sensitive).map((r: any) => `${r.table}:${r.kind}${r.col ? ':' + r.col : ''}`).sort();

  it('Kysely selectAll / returningAll and raw `select *`, `x.*`, `returning *` are whole-row reads', () => {
    expect(kinds(`db.selectFrom('secrets_t').selectAll().where('id','=',id)`)).toEqual(['secrets_t:star']);
    expect(kinds(`db.insertInto('plain_t').values(v).returningAll().execute()`)).toEqual(['plain_t:star']);
    expect(kinds('sql`SELECT * FROM plain_t WHERE id = ${id}`')).toEqual(['plain_t:star']);
    expect(kinds('sql`SELECT s.*, p.name FROM secrets_t s JOIN plain_t p ON p.id = s.id`')).toContain('secrets_t:star');
    expect(kinds('sql`UPDATE plain_t SET name = ${n} WHERE id = ${id} RETURNING *`')).toEqual(['plain_t:star']);
  });
  it('a sensitive column named in a select list is a column read — in Kysely and in raw SQL', () => {
    expect(kinds(`db.selectFrom('secrets_t').select(['id', 'token_hash'])`)).toEqual(['secrets_t:column:token_hash']);
    expect(kinds('sql`select id, api_key_enc from secrets_t where id = ${id}`')).toEqual(['secrets_t:column:api_key_enc']);
  });
  it('a boolean ALIASED like the column, or a comparison in WHERE, is not a read of it (the ai_providers false positive)', () => {
    expect(kinds('sql`SELECT id, (api_key_enc IS NOT NULL) AS api_key_enc FROM secrets_t`')).toEqual([]);
    expect(kinds('sql`SELECT id, name FROM secrets_t WHERE token_hash = ${h}`')).toEqual([]);
    expect(kinds(`db.selectFrom('secrets_t').select(['id', 'name'])`)).toEqual([]);
  });
  it('the classifier: credentials, sealed values, card / bank numbers, lookup hashes — not content hashes or counters', () => {
    for (const c of ['password_hash', 'api_key_enc', 'client_secret', 'card_number', 'token', 'device_token_hash', 'phone_hash', 'otp_code']) expect(isSensitiveColumn(c), c).toBe(true);
    for (const c of ['file_hash', 'input_tokens', 'token_prefix', 'card_last4', 'api_key_masked', 'secret_rotated_at', 'is_secret', 'via_previous_secret']) expect(isSensitiveColumn(c), c).toBe(false);
  });
  it('a response wire type carrying a sensitive column name is a contract leak; a REQUEST type is not', () => {
    const src = 'export interface StaffView {\n  id: string; passwordHash: string;\n}\nexport interface SetPinRequest {\n  pin_hash: string;\n}\n';
    expect(typeLeaks(src, new Set(['password_hash', 'pin_hash']))).toEqual([{ type: 'StaffView', prop: 'passwordHash' }]);
  });
  it('one-line interfaces in the types file are parsed on their own (oauth_tokens had no columns before)', () => {
    const cols = schemaColumns('export interface DB {\n  a_t: ATable;\n  b_t: BTable;\n}\nexport interface ATable { id: string; token_hash: string; }   // 501\nexport interface BTable { id: string; code_hash: string; }\n');
    expect(cols.get('a_t')).toEqual(['id', 'token_hash']);
    expect(cols.get('b_t')).toEqual(['id', 'code_hash']);
  });
  it('the committed tree passes the gate (0 open findings, no ratchet growth, no contract leak)', () => {
    const r = spawnSync('node', ['scripts/audit-response-exposure.mjs'], { cwd: API, encoding: 'utf8' });
    expect(r.stdout + r.stderr).toMatch(/0 open\)/);
    expect(r.status, r.stdout).toBe(0);
  });
});

let pg: any;
let db: any;
beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Exposure Nails LLC','Exposure Nails','d12a','D12A')`, [T]);
  await pg.query(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
});

describe('the migrated schema (#19 — the audit is not blind)', () => {
  it('every sensitive-shaped column the database really has is a column the audit knows', async () => {
    const live = (await pg.query(`select table_name t, column_name c from information_schema.columns where table_schema = 'public'`)).rows as Array<{ t: string; c: string }>;
    const known = schemaColumns();
    const blind = live.filter((r) => isSensitiveColumn(r.c) && known.has(r.t) && !(known.get(r.t) ?? []).includes(r.c)).map((r) => `${r.t}.${r.c}`);
    expect(blind, `sensitive columns the types file (and so the gate) does not see:\n${blind.join('\n')}`).toEqual([]);
    expect(live.filter((r) => isSensitiveColumn(r.c)).length).toBeGreaterThan(60);
  });
  it('every table the ownership registry classes SECURITY_SECRET has a guarded column — or a reviewed reason', () => {
    const REVIEWED: Record<string, string> = {
      tenant_api_key_uses: 'a usage log (key id, route, method, IP, a was-previous-secret boolean) — no secret value',
      tenant_messaging_health_checks: 'the messaging readiness check results (721): states, reason codes, the masked sender — the credentials stay in tenant_messaging_credentials (encrypted)',
    };
    const { sensitive } = audit();
    const reg = registrySensitivity();
    const unguarded = Object.entries(reg).filter(([t, s]) => s === 'SECURITY_SECRET' && !sensitive.has(t) && !(t in REVIEWED)).map(([t]) => t);
    expect(unguarded).toEqual([]);
    for (const t of Object.keys(REVIEWED)) expect(sensitive.has(t), `${t} gained a sensitive column — drop its reviewed reason`).toBe(false);
  });
});

describe('the fixed read paths return mapped fields only (#19)', () => {
  it('display devices: the list and the single read never carry the pairing-code or device-token hash', async () => {
    const d = (await pg.query(`insert into customer_display_devices (tenant_id, branch_id, device_name, pairing_status, pairing_code_hash, device_token_hash)
      values ($1,$2,'Front display','paired','pair-hash-SECRET','token-hash-SECRET') returning id`, [T, B])).rows[0];
    const repo = new KyselyDisplayDevicesRepository(db);
    const list = await repo.listDevices(T, B);
    const one = await repo.device(T, d.id);
    expect(list.map((x) => x.id)).toEqual([d.id]);
    expect(one?.name).toBe('Front display');
    expect(JSON.stringify([list, one])).not.toMatch(/SECRET/);
  });
  it('the customer display session read selects named columns (every one exists on the real schema)', async () => {
    const s = (await pg.query(`insert into customer_display_sessions (tenant_id, branch_id, state, public_token_hash, subtotal_cents) values ($1,$2,'idle','h',1200) returning id`, [T, B])).rows[0];
    const row = await new KyselyDisplayRepository(db).getSession(s.id);
    expect(row).toMatchObject({ id: s.id, tenantId: T, state: 'idle', subtotalCents: 1200 });
  });
  it('inventory vendors: exactly the fields the POS vendor screens read (no tenant_id, active flag or actor stamps)', async () => {
    const svc = new InventoryService(db);
    await svc.createVendor({ tenantId: T, branchId: B, userId: null, role: 'OWNER' } as any, { name: 'Acme Supply', accountNumber: 'A-100', leadTimeDays: 5 });
    const { vendors } = await svc.listVendors({ tenantId: T } as any);
    expect(vendors).toHaveLength(1);
    expect(Object.keys(vendors[0]).sort()).toEqual(['account_number', 'contact_name', 'created_at', 'email', 'id', 'lead_time_days', 'name', 'payment_terms', 'phone', 'updated_at', 'website']);
    expect(vendors[0]).toMatchObject({ name: 'Acme Supply', account_number: 'A-100', lead_time_days: 5 });
  });
});
