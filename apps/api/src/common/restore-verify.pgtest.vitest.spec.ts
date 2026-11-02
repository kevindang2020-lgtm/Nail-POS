// restore-verify.pgtest — Constitution 12 §225–238: a restored backup is proven USABLE, keys included.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';

import { verifyRestore, ENCRYPTED_COLUMNS, CORE_TABLES } from './restore-verify';
import { encryptSecret as encryptProvider } from './provider-crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const MIG = MIGRATIONS_DIR;
const T = 'aeaeaeae-0000-4000-8000-00000000000a';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  // The pgtest harness applies migrations without the production ledger, so record them as a real deploy would.
  await pg.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql'))) await pg.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
});

describe('every encrypted column in the schema is covered', () => {
  it('each listed table.column exists — a typo would verify nothing, forever', async () => {
    for (const c of ENCRYPTED_COLUMNS) expect((await pg.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [c.table, c.column])).rows.length, `${c.table}.${c.column}`).toBe(1);
  });
  it('no *_enc column in the schema is left out (transient OAuth verifiers excepted, reviewed)', async () => {
    const all = (await pg.query(`SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = 'public' AND column_name LIKE '%\\_enc' ESCAPE '\\'`)).rows.map((r: any) => `${r.t}.${r.c}`);
    const listed = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`));
    // (An earlier draft also excluded tenant_payment_config.webhook_secret_enc with a comment pointing at a note that did
    // not exist. It is a real payment secret, written through the payments key — it is now verified, not excluded.)
    const REVIEWED = new Set(['integration_oauth_states.code_verifier_enc' /* ten-minute PKCE verifier; meaningless after restore */,
      'admin_commission_auth_codes.code_enc' /* a one-way SHA-256 of a 24-hour single-use code — nothing to decrypt */]);
    expect(all.filter((x: string) => !listed.has(x) && !REVIEWED.has(x))).toEqual([]);
  });
});

describe('the verdict', () => {
  it('an EMPTY restore fails — core tables hold no data', async () => {
    // Unconditional: an earlier draft wrapped this in `if (some table is empty)`, which would have asserted NOTHING the
    // day the harness gained seed rows. The harness is empty at this point (it runs first); asserting that too.
    const r = await verifyRestore(db, MIG);
    expect(r.data.every((d) => d.rows === 0)).toBe(true);
    expect(r.ok).toBe(false); expect(r.summary).toMatch(/empty core tables/);
  });
  it('a missing migration is caught', async () => {
    await pg.exec(`DELETE FROM schema_migrations WHERE filename = '455_fraud_pattern_event.sql'`);
    const r = await verifyRestore(db, MIG);
    expect(r.schema.missing).toContain('455_fraud_pattern_event.sql'); expect(r.ok).toBe(false);
    await pg.exec(`INSERT INTO schema_migrations (filename) VALUES ('455_fraud_pattern_event.sql')`);
  });
  it('a column encrypted with the RIGHT key decrypts; one encrypted with a DIFFERENT key is named as undecryptable', async () => {
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'R', 'R', 'rv-t', 'RVT01', 'active') ON CONFLICT DO NOTHING`);
    await pg.query(`INSERT INTO tenant_messaging_credentials (tenant_id, status, auth_token_enc) VALUES ($1, 'configured', $2)`, [T, encryptProvider('real-twilio-token')]);
    let r = await verifyRestore(db, MIG);
    expect(r.keys.find((k) => k.table === 'tenant_messaging_credentials')?.result).toBe('ok');
    // Now simulate "the key was lost / rotated away": the same ciphertext, but a different key in this environment.
    const prev = process.env.PROVIDER_VAULT_KEK; process.env.PROVIDER_VAULT_KEK = 'd'.repeat(64);
    try { r = await verifyRestore(db, MIG); } finally { if (prev === undefined) delete process.env.PROVIDER_VAULT_KEK; else process.env.PROVIDER_VAULT_KEK = prev; }
    expect(r.keys.find((k) => k.table === 'tenant_messaging_credentials')).toMatchObject({ result: 'failed' });
    expect(r.ok).toBe(false); expect(r.summary).toMatch(/CANNOT DECRYPT: .*tenant_messaging_credentials\.auth_token_enc/);
  });
  it('an encrypted column with NO rows is "not sampled" — never counted as proven', async () => {
    const r = await verifyRestore(db, MIG);
    expect(r.keys.find((k) => k.table === 'ticket_deletion_codes')?.result).toBe('not_sampled');
  });
  it('the report never contains a decrypted value', async () => {
    expect(JSON.stringify(await verifyRestore(db, MIG))).not.toContain('real-twilio-token');
  });
  it('core tables checked are the ones that matter', () => expect([...CORE_TABLES]).toEqual(['tenants', 'users', 'customers', 'tickets', 'payments']));
  it('a COMPLETE, decryptable restore PASSES — proof the verifier can say yes, not only no', async () => {
    const B = 'aeaeaeae-0000-4000-8000-0000000000b1', C = 'aeaeaeae-0000-4000-8000-0000000000c1', K = 'aeaeaeae-0000-4000-8000-0000000000d1';
    await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'Main') ON CONFLICT DO NOTHING;
      INSERT INTO users (tenant_id, full_name, email, password_hash, status, role) VALUES ('${T}', 'U', 'rv@x.test', 'x', 'active', 'OWNER') ON CONFLICT DO NOTHING;
      INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'C', 'C', 'C C') ON CONFLICT DO NOTHING;
      INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${K}', '${T}', '${B}', '${C}') ON CONFLICT DO NOTHING;
      INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ('${T}', '${B}', '${K}', 'cash', 1000, 'approved')`);
    const r = await verifyRestore(db, MIG);
    expect(r.summary).not.toMatch(/empty|missing|CANNOT/);
    expect(r.ok).toBe(true);
    // …and a missing migration ALONE now flips it. (The earlier missing-migration test ran while the core tables were
    // empty, so the verdict already failed for that reason and a mutation ignoring migrations survived.)
    await pg.exec(`DELETE FROM schema_migrations WHERE filename = '455_fraud_pattern_event.sql'`);
    const partial = await verifyRestore(db, MIG);
    await pg.exec(`INSERT INTO schema_migrations (filename) VALUES ('455_fraud_pattern_event.sql')`);
    expect(partial.ok).toBe(false); expect(partial.summary).toMatch(/1 migration\(s\) missing/);

    // …and an UNDECRYPTABLE column ALONE flips it too. The wrong-key test above ran while core tables were empty, so
    // its "ok is false" held for that reason — a mutation making the verdict ignore undecryptable columns survived
    // (found in an independent re-verification of this phase). This is the claim that matters most: a drill must
    // never say "usable" while naming a credential it cannot open.
    const prev = process.env.PROVIDER_VAULT_KEK; process.env.PROVIDER_VAULT_KEK = 'd'.repeat(64);
    let lostKey;
    try { lostKey = await verifyRestore(db, MIG); } finally { if (prev === undefined) delete process.env.PROVIDER_VAULT_KEK; else process.env.PROVIDER_VAULT_KEK = prev; }
    expect(lostKey.summary).not.toMatch(/empty|missing/);             // nothing else is wrong…
    expect(lostKey.ok).toBe(false);                                    // …yet the verdict is NOT usable
    expect(lostKey.summary).toMatch(/CANNOT DECRYPT/);

    // …and a core table that cannot be READ at all is not "full". (Survived the same re-verification: nothing tested
    // an unreadable table.) Renamed away for one call, restored in finally.
    await pg.exec('ALTER TABLE payments RENAME TO payments_rv_hidden');
    let unreadable;
    try { unreadable = await verifyRestore(db, MIG); } finally { await pg.exec('ALTER TABLE payments_rv_hidden RENAME TO payments'); }
    expect(unreadable.ok).toBe(false); expect(unreadable.summary).toMatch(/empty core tables: payments/);
  });
});
