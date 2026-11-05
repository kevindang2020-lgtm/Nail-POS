// invitation-phone.pgtest.vitest.spec.ts — token invitations addressed to a PHONE, on the REAL schema (Jul 27, 2026).
//
// Migration 379 already made the invitation record phone-capable (user_invitations.normalized_phone, email nullable,
// and a CHECK that every invitation is reachable by at least one identifier). What was missing was the platform
// invite path USING it. This proves it now does — and, critically, that the account the invitation creates is keyed
// on normalized_phone: the exact column findTenantUserForLogin matches when that person types their number at the
// login screen. NO new column and NO new migration: the constraint from 379 is what makes an unreachable invite
// impossible, and this suite runs against it.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselySuperAdminPlatformRepo } from './super-admin-platform.repository';

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

const T1 = 'e1000000-0000-0000-0000-000000000001';
const T2 = 'e1000000-0000-0000-0000-000000000002';
const PHONE = '+18565551234';
let pg: PGlite;
let repo: KyselySuperAdminPlatformRepo;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselySuperAdminPlatformRepo(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'One','Salon One','e1a','E1A'),($2,'Two','Salon Two','e1b','E1B')`, [T1, T2]);
});

describe('phone-addressed token invitations', () => {
  it('creates the invitation AND an account keyed on normalized_phone — the column sign-in matches', async () => {
    const r = await repo.createInvitation({ tenantId: T1, phone: PHONE, role: 'FRONT_DESK', fullName: 'Desk Staff', channel: 'sms' });
    expect(r.reused).toBe(false);
    expect(r.token).toBeTruthy();               // raw token handed back exactly once

    const inv = (await q(`select email, normalized_phone, delivery_channel, status from user_invitations where id = $1`, [r.id]))[0];
    expect(inv.normalized_phone).toBe(PHONE);
    expect(inv.email).toBeNull();               // 379 dropped NOT NULL — a phone-only invite is a valid record
    expect(inv.delivery_channel).toBe('sms');
    expect(inv.status).toBe('pending');

    const user = (await q(`select tenant_id, normalized_phone, email, role, status from users where id = $1`, [r.userId]))[0];
    expect(user.normalized_phone).toBe(PHONE);  // ← what findTenantUserForLogin looks up
    expect(user.email).toBeNull();
    expect(user.status).toBe('invited');
    expect(String(user.tenant_id)).toBe(T1);

    // The stored token is only a hash; the raw value is never persisted.
    const stored = (await q(`select token_hash from user_invitations where id = $1`, [r.id]))[0];
    expect(stored.token_hash).not.toBe(r.token);
  });

  it('a second phone invite to the same salon reuses the outstanding one instead of minting a duplicate', async () => {
    const again = await repo.createInvitation({ tenantId: T1, phone: PHONE, role: 'FRONT_DESK', channel: 'sms' });
    expect(again.reused).toBe(true);
    expect(again.token).toBeNull();             // an existing token is never re-shown
    const n = Number((await q(`select count(*)::int c from user_invitations where tenant_id = $1 and normalized_phone = $2`, [T1, PHONE]))[0].c);
    expect(n).toBe(1);
  });

  it('the same number in a DIFFERENT salon is a separate invitation and a separate account', async () => {
    const other = await repo.createInvitation({ tenantId: T2, phone: PHONE, role: 'MANAGER', fullName: 'Other Salon', channel: 'sms' });
    expect(other.reused).toBe(false);
    expect(other.userId).toBeTruthy();
    const rows = await q(`select tenant_id from users where normalized_phone = $1 order by created_at`, [PHONE]);
    expect(rows.length).toBe(2);                // sign-in is tenant-scoped, so one number can serve two salons
  });

  it('an invite re-sent to an existing phone-only account reuses that account instead of creating a second login', async () => {
    // cancel the outstanding invite so the dedupe branch doesn't short-circuit, then invite again
    await q(`update user_invitations set status='cancelled' where tenant_id=$1 and normalized_phone=$2`, [T1, PHONE]);
    const before = Number((await q(`select count(*)::int c from users where tenant_id=$1 and normalized_phone=$2`, [T1, PHONE]))[0].c);
    const r = await repo.createInvitation({ tenantId: T1, phone: PHONE, role: 'FRONT_DESK', channel: 'sms' });
    const after = Number((await q(`select count(*)::int c from users where tenant_id=$1 and normalized_phone=$2`, [T1, PHONE]))[0].c);
    expect(r.reused).toBe(false);               // new token
    expect(after).toBe(before);                 // ...but the SAME person, not a second account
  });

  it('email invitations are untouched by any of this', async () => {
    const r = await repo.createInvitation({ tenantId: T2, email: 'Owner@Salon.com', role: 'OWNER', fullName: 'An Owner', channel: 'email' });
    const inv = (await q(`select email, normalized_phone, delivery_channel from user_invitations where id = $1`, [r.id]))[0];
    expect(inv.email).toBe('Owner@Salon.com');
    expect(inv.normalized_phone).toBeNull();
    expect(inv.delivery_channel).toBe('email');
    const user = (await q(`select email, normalized_phone from users where id = $1`, [r.userId]))[0];
    expect(user.email).toBe('Owner@Salon.com');
    expect(user.normalized_phone).toBeNull();
  });
});
