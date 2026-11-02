// salon-logo.pgtest.vitest.spec.ts — the salon logo and the customer display's own words on the REAL schema (every
// migration, PGlite), through the real settings service and repositories (23-inch dual-screen spec §13).
//   • the logo is stored (a file in media storage + the salon-wide 'salon-logo' row) — not process memory
//   • one logo per salon: a replacement updates the row and removes the old file; another salon is untouched
//   • the generic settings PATCH can never point the logo somewhere else (the row is not a settings category)
//   • the Customer Display settings (tagline, branch name) persist for the branch they were saved from
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselySettingsRepository } from './settings.kysely.repository';
import { PosSettingsService, ValidationError } from './settings.service';
import { KyselySalonLogoStore, SALON_LOGO_CATEGORY, safeSalonLogoUrl } from './salon-logo';
import type { SettingsContext } from './settings.dto';

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

const T1 = 'e1000000-0000-4000-8000-0000000000a1', T2 = 'e1000000-0000-4000-8000-0000000000a2';
const B1 = 'e1000000-0000-4000-8000-0000000000b1', B2 = 'e1000000-0000-4000-8000-0000000000b2';
const U1 = 'e1000000-0000-4000-8000-0000000000c1', U2 = 'e1000000-0000-4000-8000-0000000000c2';
const perms = ['settings.view', 'settings.edit'];
const owner: SettingsContext = { tenantId: T1, branchId: B1, userId: U1, role: 'OWNER', permissions: perms };
const ownerB2: SettingsContext = { ...owner, branchId: B2 };
const owner2: SettingsContext = { tenantId: T2, branchId: null as any, userId: U2, role: 'OWNER', permissions: perms };

let pg: PGlite; let svc: PosSettingsService;
const files = new Map<string, Buffer>();
const media = { put: async (k: string, b: Buffer) => { files.set(k, b); return { url: '/media/' + k }; }, remove: async (k: string) => { files.delete(k); }, resolvePath: () => null };
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); b[24] = 8; b[25] = 6;
  return 'data:image/png;base64,' + b.toString('base64');
};
const logoRows = (t: string) => q(`select branch_id, settings_json from tenant_settings where tenant_id=$1 and category=$2`, [t, SALON_LOGO_CATEGORY]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new PosSettingsService(new KyselySettingsRepository(db as any), undefined, undefined, undefined, new KyselySalonLogoStore(db as any), media);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Luxury Nails LLC','Luxury Nails','e1a','E1A'), ($2,'Other Salon LLC','Other Salon','e1b','E1B')`, [T1, T2]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Cherry Hill'), ($2,$3,'Marlton')`, [B1, B2, T1]);
}, 120_000);

describe('the salon logo is stored, one per salon', () => {
  it('an upload stores the file and the salon-wide row (not process memory)', async () => {
    const up = await svc.uploadReceiptLogo(owner, png(400, 160));
    const rows = await logoRows(T1);
    expect(rows).toHaveLength(1);
    expect(rows[0].branch_id).toBeNull();
    const j = typeof rows[0].settings_json === 'string' ? JSON.parse(rows[0].settings_json) : rows[0].settings_json;
    expect(j.key).toMatch(new RegExp(`^salon-logos/${T1}/logo-[0-9a-f]{24}\\.png$`));
    expect(j.url).toBe('/media/' + j.key);
    expect({ w: j.width, h: j.height }).toEqual({ w: 400, h: 160 });
    expect(files.has(j.key)).toBe(true);
    expect(up.logoUrl).toBe(j.url);
    expect(safeSalonLogoUrl(T1, j)).toBe(j.url);
    // a second store (a restart, a second API instance) reads the same logo
    const fresh = new KyselySalonLogoStore(new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } }) as any);
    expect((await fresh.get(T1))?.url).toBe(j.url);
  });

  it('saved from another branch, it is still the SALON\'s logo — replaced in place, the old file removed', async () => {
    const before = (await svc.getSalonLogo(owner))!.url;
    const up = await svc.uploadReceiptLogo(ownerB2, png(512, 512));
    expect(up.logoUrl).not.toBe(before);
    expect(await logoRows(T1)).toHaveLength(1);
    expect((await svc.getSalonLogo(owner))!.url).toBe(up.logoUrl);
    expect([...files.keys()].filter((k) => k.startsWith(`salon-logos/${T1}/`))).toEqual([up.logoUrl.replace('/media/', '')]);
  });

  it('Phase 12 (#34): the stored logo has no text / EXIF chunks, and the upload is charged to the salon\'s storage quota', async () => {
    const { crc32 } = await import('node:zlib');
    const chunk = (type: string, data: Buffer) => { const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const n = Buffer.alloc(4); n.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([n, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(400, 0); ihdr.writeUInt32BE(160, 4); ihdr[8] = 8; ihdr[9] = 6;
    const withText = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Author\0SECRET-OWNER-HOME', 'latin1')), chunk('IDAT', Buffer.from([0x78, 0x9c, 3, 0])), chunk('IEND', Buffer.alloc(0))]);
    const charged: number[] = [];
    const quota = { reserveStorage: async (_t: string, n: number) => { charged.push(n); }, releaseStorage: async () => undefined };
    const s2 = new PosSettingsService((svc as any).repo, undefined, undefined, undefined, (svc as any).logos, media, quota);
    const up = await s2.uploadReceiptLogo(owner, 'data:image/png;base64,' + withText.toString('base64'));
    const key = up.logoUrl.replace('/media/', '');
    expect(files.get(key)!.toString('latin1')).not.toMatch(/SECRET|tEXt/);
    expect(charged).toEqual([files.get(key)!.length]);
  });

  it('the database itself refuses a second salon-wide logo row', async () => {
    await expect(q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, $2, '{}'::jsonb)`, [T1, SALON_LOGO_CATEGORY])).rejects.toThrow();
  });

  it('another salon is untouched: no logo, then its own', async () => {
    expect(await svc.getSalonLogo(owner2)).toBeNull();
    const up = await svc.uploadReceiptLogo(owner2, png(300, 100));
    expect(up.logoUrl).toMatch(new RegExp(`^/media/salon-logos/${T2}/`));
    // each salon reads ITS row — asked in both orders (a read that lost its tenant filter returns whichever row comes first)
    expect((await svc.getSalonLogo(owner2))!.url).toBe(up.logoUrl);
    expect((await svc.getSalonLogo(owner))!.url).toMatch(new RegExp(`^/media/salon-logos/${T1}/`));
    expect((await svc.getSalonLogo(owner2))!.url).toBe(up.logoUrl);
  });

  it('the generic settings PATCH can never redirect the logo', async () => {
    const mine = (await svc.getSalonLogo(owner))!.url;
    await svc.patchCategory(owner, 'receipts-branding', { logoRef: 'https://evil.example/x.png', logoUrl: 'https://evil.example/x.png' } as any);
    expect((await svc.getSalonLogo(owner))!.url).toBe(mine);
    expect((await svc.previewReceipt(owner)).logoRef).toBe(mine);
  });

  it('a refused upload changes nothing', async () => {
    const mine = (await svc.getSalonLogo(owner))!.url; const n = files.size;
    await expect(svc.uploadReceiptLogo(owner, 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>..........').toString('base64'))).rejects.toBeInstanceOf(ValidationError);
    expect((await svc.getSalonLogo(owner))!.url).toBe(mine);
    expect(files.size).toBe(n);
  });

  it('remove deletes the row and the file', async () => {
    const mine = (await svc.getSalonLogo(owner))!.url;
    expect((await svc.removeReceiptLogo(owner)).removed).toBe(true);
    expect(await logoRows(T1)).toHaveLength(0);
    expect(files.has(mine.replace('/media/', ''))).toBe(false);
    expect(await svc.getSalonLogo(owner)).toBeNull();
    expect((await svc.getSalonLogo(owner2))).not.toBeNull();   // the other salon keeps its logo
  });
});

describe('the customer display\'s own words persist for the branch they were saved from', () => {
  it('tagline and branch name', async () => {
    await svc.patchCategory(owner, 'customer-display-devices', { tagline: 'Relax • Refresh • Renew', showBranchName: true, idleMessage: 'Ready for our next guest' });
    const r = (await q(`select settings_json from tenant_settings where tenant_id=$1 and branch_id=$2 and category='customer-display-devices'`, [T1, B1]))[0];
    const j = typeof r.settings_json === 'string' ? JSON.parse(r.settings_json) : r.settings_json;
    expect(j).toMatchObject({ tagline: 'Relax • Refresh • Renew', showBranchName: true, idleMessage: 'Ready for our next guest' });
    await expect(svc.patchCategory(owner, 'customer-display-devices', { tagline: '<b>hi</b>' })).rejects.toBeInstanceOf(ValidationError);
  });
});
