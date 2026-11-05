// display-branding.pgtest.vitest.spec.ts — 23-inch dual-screen spec §13 on the REAL schema (every migration, PGlite):
// the header of a paired customer display is the SALON's — its name, its stored logo, its tagline and (when it wants)
// the branch — resolved for the device's own tenant and branch, never another salon's, never a logo from elsewhere.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyDisplayRepository } from './customer-display.repository';
import { CustomerDisplayService } from './customer-display.service';

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

const T = 'd6000000-0000-4000-8000-000000000001', T2 = 'd6000000-0000-4000-8000-000000000002';
const B1 = 'd6000000-0000-4000-8000-0000000000b1', B2 = 'd6000000-0000-4000-8000-0000000000b2', B3 = 'd6000000-0000-4000-8000-0000000000b3';
const D1 = 'd6000000-0000-4000-8000-0000000000d1', D2 = 'd6000000-0000-4000-8000-0000000000d2', D3 = 'd6000000-0000-4000-8000-0000000000d3';
const CUST = 'd6000000-0000-4000-8000-0000000000c1', TK = 'd6000000-0000-4000-8000-0000000000e1', S = 'd6000000-0000-4000-8000-0000000005e1';
const TOK = { d1: 'brand-device-1', d2: 'brand-device-2', d3: 'brand-device-3' };
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const LOGO_KEY = `salon-logos/${T}/logo-0123456789abcdef01234567.png`;
const LOGO_KEY_T2 = `salon-logos/${T2}/logo-89abcdef0123456789abcdef.webp`;

let pg: PGlite; let svc: CustomerDisplayService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const setDisplay = (tenant: string, branch: string | null, json: object) =>
  q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1,$2,'customer-display-devices',$3::jsonb)
     on conflict (tenant_id, branch_id, category) do update set settings_json = excluded.settings_json`, [tenant, branch, JSON.stringify(json)])
    .catch(async () => {   // the salon-wide row (branch NULL) is unique through its own partial index
      await q(`delete from tenant_settings where tenant_id=$1 and branch_id is null and category='customer-display-devices'`, [tenant]);
      await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1,null,'customer-display-devices',$2::jsonb)`, [tenant, JSON.stringify(json)]);
    });
const setLogo = async (tenant: string, json: object | null) => {
  await q(`delete from tenant_settings where tenant_id=$1 and branch_id is null and category='salon-logo'`, [tenant]);
  if (json) await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1,null,'salon-logo',$2::jsonb)`, [tenant, JSON.stringify(json)]);
};
const brand = async (tok: string) => (await svc.getDeviceState(tok)).branding;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new CustomerDisplayService(new KyselyDisplayRepository(db as any));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Luxury Nails LLC','Luxury Nails','d6a','D6A'), ($2,'Other Salon LLC','Other Salon','d6b','D6B')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$4,'Cherry Hill'), ($2,$4,'Marlton'), ($3,$5,'Elsewhere')`, [B1, B2, B3, T, T2]);
  for (const [id, t, b, tok] of [[D1, T, B1, TOK.d1], [D2, T, B2, TOK.d2], [D3, T2, B3, TOK.d3]]) {
    await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, pairing_status, device_token_hash) values ($1,$2,$3,'FRONT-DESK','paired',$4)`, [id, t, b, hash(tok)]);
  }
}, 120_000);

describe('§13 the display header is the salon\'s', () => {
  it('with nothing configured: the salon\'s name alone — never the platform\'s', async () => {
    expect(await brand(TOK.d1)).toEqual({ salonName: 'Luxury Nails', logoUrl: null, tagline: null, branchName: null, idleMessage: null });
    expect((await brand(TOK.d3))?.salonName).toBe('Other Salon');
  });

  it('the salon\'s tagline, and a branch that words its own screen and shows its name', async () => {
    await setDisplay(T, null, { tagline: 'Luxury for every hand', idleMessage: 'Ready for our next guest' });
    await setDisplay(T, B1, { tagline: 'Cherry Hill’s favourite', showBranchName: true });
    expect(await brand(TOK.d1)).toMatchObject({ tagline: 'Cherry Hill’s favourite', branchName: 'Cherry Hill', idleMessage: 'Ready for our next guest' });
    expect(await brand(TOK.d2)).toMatchObject({ tagline: 'Luxury for every hand', branchName: null });
    expect((await brand(TOK.d3))?.tagline).toBeNull();   // another salon's words never cross over
  });

  it('the stored logo — salon-wide, never another salon\'s, never an address from elsewhere', async () => {
    await setLogo(T, { key: LOGO_KEY, url: `/media/${LOGO_KEY}` });
    await setLogo(T2, { key: LOGO_KEY_T2, url: `/media/${LOGO_KEY_T2}` });
    expect((await brand(TOK.d1))?.logoUrl).toBe(`/media/${LOGO_KEY}`);
    expect((await brand(TOK.d2))?.logoUrl).toBe(`/media/${LOGO_KEY}`);
    expect((await brand(TOK.d3))?.logoUrl).toBe(`/media/${LOGO_KEY_T2}`);
    // object storage / CDN: an https address that ends with the salon's own key
    await setLogo(T, { key: LOGO_KEY, url: `https://cdn.example.com/media/${LOGO_KEY}` });
    expect((await brand(TOK.d1))?.logoUrl).toBe(`https://cdn.example.com/media/${LOGO_KEY}`);
    // anything else is refused: another salon's key, a foreign address, a data URL, a plain http address
    for (const bad of [{ key: LOGO_KEY_T2, url: `/media/${LOGO_KEY_T2}` }, { key: LOGO_KEY, url: 'https://evil.example/x.png' }, { key: LOGO_KEY, url: 'data:image/png;base64,AAAA' }, { key: LOGO_KEY, url: `http://cdn.example.com/${LOGO_KEY}` }, { key: '../../etc/passwd', url: '/media/../../etc/passwd' }]) {
      await setLogo(T, bad);
      expect((await brand(TOK.d1))?.logoUrl, JSON.stringify(bad)).toBeNull();
    }
    await setLogo(T, { key: LOGO_KEY, url: `/media/${LOGO_KEY}` });
  });

  it('the salon\'s "branding" switch off: the name stays, the logo and tagline go', async () => {
    await setDisplay(T, B1, { tagline: 'Cherry Hill’s favourite', showBranchName: true, displayBranding: false });
    expect(await brand(TOK.d1)).toMatchObject({ salonName: 'Luxury Nails', logoUrl: null, tagline: null, branchName: 'Cherry Hill' });
    expect((await brand(TOK.d2))?.logoUrl).toBe(`/media/${LOGO_KEY}`);   // the other branch keeps it
    await setDisplay(T, B1, { tagline: 'Cherry Hill’s favourite', showBranchName: true });
  });

  it('text is shown as plain, clean text — invisible characters removed, length capped', async () => {
    await setDisplay(T, B2, { tagline: '  Nails\u200b\u202e by\u0007   the   sea  ' + 'x'.repeat(80), idleMessage: '\u2028\u2029' });
    const b = await brand(TOK.d2);
    expect(b?.tagline?.startsWith('Nails by the sea x')).toBe(true);
    expect(b?.tagline?.length).toBeLessThanOrEqual(60);
    expect(b?.idleMessage).toBeNull();
  });

  it('the header stays on screen during a checkout (the right panel changes, the salon does not)', async () => {
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Sophia','Lane','Sophia Lane')`, [CUST, T, B1]);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'ready_for_payment')`, [TK, T, B1, CUST]);
    await q(`insert into customer_display_sessions (id, tenant_id, branch_id, display_device_id, ticket_id, customer_id, state, public_token_hash, expires_at)
             values ($1,$2,$3,$4,$5,$6,'showing_ticket','h', now() + interval '10 minutes')`, [S, T, B1, D1, TK, CUST]);
    const st = await svc.getDeviceState(TOK.d1);
    expect(st.sessionId).toBe(S);
    expect(st.branding).toMatchObject({ salonName: 'Luxury Nails', logoUrl: `/media/${LOGO_KEY}`, branchName: 'Cherry Hill' });
  });
});
