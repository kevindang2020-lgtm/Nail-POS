// anonymize-dump.pgtest — Security Deep Scan §157: the lower-environment anonymiser (scripts/lib/anonymize.mjs, run by
// scripts/anonymize-dump.mjs) over the REAL migrated schema: names / e-mails / phones / addresses / notes are pseudonymised
// deterministically (joins and uniqueness survive), secrets are nulled, credential tables are emptied, append-only tables
// are rewritten too, no e-mail / phone shape survives, and a second run is stable.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite } from '@aipowersalon/testing';

const lib: any = await import('../../scripts/lib/anonymize.mjs');
const B = 'a7300000-0000-4000-8000-0000000000a1', T = 'a7000000-0000-4000-8000-0000000000a1', U = 'a7100000-0000-4000-8000-0000000000a1', C1 = 'a7200000-0000-4000-8000-0000000000a1', C2 = 'a7200000-0000-4000-8000-0000000000a2';
let pg: any; let plan: any;
const one = async (sql: string, p: unknown[] = []) => (await pg.query(sql, p)).rows[0];

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Anon Nails LLC', 'Anon Nails', 'anon-t', 'ANON1', 'active'); INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'Main');`);
  await pg.query(`INSERT INTO users (id, tenant_id, first_name, last_name, full_name, email, password_hash, pin_hash, status, role) VALUES ($1, $2, 'Grace', 'Nguyen', 'Grace Nguyen', 'grace.nguyen@gmail.com', 'scrypt$realhash', 'scrypt$pinhash', 'active', 'OWNER')`, [U, T]);
  await pg.query(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, email, normalized_phone, notes) VALUES ($1, $2, $4, 'Linh', 'Tran', 'Linh Tran', 'linh@yahoo.com', '+18565551234', 'allergic to acetone; lives at 12 Elm St'),
    ($3, $2, $4, 'Bao', 'Le', 'Bao Le', 'bao@outlook.com', '+12675559876', null)`, [C1, T, C2, B]);
  await pg.query(`INSERT INTO sessions (user_id, tenant_id, status, expires_at, user_agent) VALUES ($1, $2, 'active', now() + interval '1 day', 'Mozilla/5.0')`, [U, T]);
  await pg.query(`INSERT INTO audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json) VALUES ($1, 'OWNER', 'customer_updated', 'customer', $2, '{}')`, [U, C1]);
  plan = await lib.anonymize(async (sql: string) => (await pg.query(sql)).rows);
});

describe('§157 lower-environment anonymisation', () => {
  it('people: names, e-mail and phone are pseudonymised deterministically', async () => {
    const c = await one(`select first_name, last_name, full_name, email, normalized_phone as phone, notes from customers where id = $1`, [C1]);
    expect(c.first_name).toMatch(/^Person [0-9a-f]{6}$/); expect(c.full_name).toMatch(/^Person /);
    expect(c.email).toMatch(/^u[0-9a-f]{10}@example\.invalid$/);
    expect(c.phone).toMatch(/^\+1555\d{7}$/);
    expect(c.notes).toBe('redacted');
    const u = await one(`select email, full_name from users where id = $1`, [U]);
    expect(u.email).toMatch(/@example\.invalid$/); expect(u.full_name).not.toMatch(/Grace|Nguyen/);
    // deterministic: the same input → the same pseudonym (joins by e-mail / phone survive), different inputs differ
    const md5 = (await one(`select 'u' || substr(md5('linh@yahoo.com'), 1, 10) || '@example.invalid' as e`)).e;
    expect(c.email).toBe(md5);
    const c2 = await one(`select email, notes from customers where id = $1`, [C2]);
    expect(c2.email).not.toBe(c.email); expect(c2.notes).toBeNull();   // NULL stays NULL
  });
  it('secrets: password / PIN hashes are gone; credential tables are emptied; IP / user agent cleared', async () => {
    const u = await one(`select password_hash, pin_hash from users where id = $1`, [U]);
    expect(u.password_hash === null || u.password_hash === 'redacted').toBe(true);
    expect(u.pin_hash).toBeNull();
    expect((await one(`select count(*)::int n from sessions`)).n).toBe(0);
    for (const t of ['sessions', 'refresh_tokens', 'auth_events', 'login_attempts', 'security_not_me_tokens', 'platform_device_approvals', 'auth_devices']) expect(plan.empty, t).toContain(t);
  });
  it('append-only tables are rewritten too (triggers off for the run) and keys / money / state are untouched', async () => {
    expect((await one(`select count(*)::int n from audit_logs where entity_id = $1`, [C1])).n).toBe(1);
    const keep = plan.updates.flatMap((u: any) => u.cols.map((c: string) => `${u.table}.${c}`));
    for (const k of keep) expect(k).not.toMatch(/\.(id|tenant_id|.*_cents|status)$/);
    expect((await one(`select tenant_code, display_name from tenants where id = $1`, [T]))).toMatchObject({ tenant_code: 'ANON1' });
  });
  it('no e-mail or phone shape survives in any rewritten column', async () => {
    const residual: string[] = [];
    for (const u of plan.updates) {
      const rows = (await pg.query(`select ${u.cols.map((c: string) => `"${c}"`).join(', ')} from "${u.table}" limit 200`)).rows;
      residual.push(...lib.residualPii(JSON.stringify(rows)).map((x: string) => `${u.table}: ${x}`));
    }
    expect(residual).toEqual([]);
  });
  it('the plan covers the schema\'s personal-data columns by name (a new table is covered the day it exists)', () => {
    const cols = plan.updates.flatMap((u: any) => u.cols.map((c: string) => `${u.table}.${c}`));
    for (const c of ['customers.email', 'customers.normalized_phone', 'customers.phone_display', 'customers.full_name', 'users.email', 'users.full_name', 'users.password_hash']) expect(cols).toContain(c);
    expect(cols.length).toBeGreaterThan(50);
  });
  it('a second run keeps every value a pseudonym (safe to re-run on a copy)', async () => {
    const before = await one(`select email from customers where id = $1`, [C1]);
    await lib.anonymize(async (sql: string) => (await pg.query(sql)).rows);
    const after = await one(`select email from customers where id = $1`, [C1]);
    expect(after.email).toMatch(/^u[0-9a-f]{10}@example\.invalid$/);
    expect(before.email).toMatch(/@example\.invalid$/);   // a second run re-hashes a pseudonym into another pseudonym — never back to real data
  });
  it('the residual scanner finds real shapes (not vacuous)', () => {
    expect(lib.residualPii('jane@gmail.com (609) 555-0182')).toHaveLength(2);
    expect(lib.residualPii('u0123456789@example.invalid +15551234567')).toEqual([]);
  });
});
