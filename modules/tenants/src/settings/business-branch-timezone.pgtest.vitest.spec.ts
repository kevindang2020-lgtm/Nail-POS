// business-branch-timezone.pgtest — the time zone chosen in Settings → Business & Branch IS the location's zone (wave 4
// PILOT, Oct 13 2026). Found by live-pilot-day.mjs: a salon created by the Super Admin has branches.timezone NULL; the owner
// set "America/New_York" in Business & Branch and the save answered 200, but it only went into the settings blob —
// branches.timezone (what every "today", business date, payroll period and report reads through branchTimeZone) stayed
// NULL, so a salon outside the default zone could never move its day. The save now writes the zone through to the
// session's branch row, refuses a zone that is not a real IANA name, and never touches another branch.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselySettingsRepository } from './settings.kysely.repository';
import { PosSettingsService } from './settings.service';
import { KyselyTerminalPairingRepository } from './settings.terminals.kysely.repository';

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

const T = 'e2100000-0000-4000-8000-0000000000a1', B1 = 'e2100000-0000-4000-8000-0000000000b1', B2 = 'e2100000-0000-4000-8000-0000000000b2';
const U = 'e2100000-0000-4000-8000-0000000000c1';
const owner: any = { tenantId: T, branchId: B1, userId: U, role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
let pg: PGlite; let svc: PosSettingsService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const zoneOf = async (b: string) => (await q(`select timezone from branches where id = $1`, [b]))[0]?.timezone ?? null;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new PosSettingsService(new KyselySettingsRepository(db as any), new KyselyTerminalPairingRepository(db as any));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Zone LLC','Zone Salon','zone-salon','ZONE01')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Main'), ($2,$3,'Second')`, [B1, B2, T]);
}, 240_000);

describe('Business & Branch time zone is the location\'s zone', () => {
  it('saving the zone writes it to the session\'s branch row (and only that one)', async () => {
    expect(await zoneOf(B1)).toBeNull();
    const out = await svc.patchCategory(owner, 'business-branch', { timezone: 'America/Los_Angeles', address: '1 Zone Way' });
    expect(out.timezone).toBe('America/Los_Angeles');
    expect(await zoneOf(B1)).toBe('America/Los_Angeles');
    expect(await zoneOf(B2)).toBeNull();
  });
  it('a zone that is not a real IANA name is refused before anything is saved', async () => {
    await expect(svc.patchCategory(owner, 'business-branch', { timezone: 'Mars/Olympus' })).rejects.toThrow(/time ?zone/i);
    expect(await zoneOf(B1)).toBe('America/Los_Angeles');
  });
});

describe('a settings save that fails is reported, never swallowed (wave 4 pilot P3)', () => {
  it('when the database refuses the write the save rejects (the POS shows "Save failed") and no audit row claims it', async () => {
    await pg.exec(`CREATE OR REPLACE FUNCTION w4_refuse_settings() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'settings write refused'; END $$;
      CREATE TRIGGER w4_refuse_settings BEFORE INSERT OR UPDATE ON tenant_settings FOR EACH ROW EXECUTE FUNCTION w4_refuse_settings();`);
    const audits = async () => Number((await q(`select count(*)::int as n from settings_audit_logs where tenant_id = $1`, [T]))[0]?.n ?? 0);
    const before = await audits();
    try {
      await expect(svc.patchCategory(owner, 'business-branch', { address: '2 Zone Way' })).rejects.toThrow(/settings write refused/);
      expect(await audits()).toBe(before);
    } finally {
      await pg.exec(`DROP TRIGGER w4_refuse_settings ON tenant_settings; DROP FUNCTION w4_refuse_settings();`);
    }
  });
});
