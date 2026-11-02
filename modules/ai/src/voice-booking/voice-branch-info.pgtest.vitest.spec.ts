// voice-branch-info.pgtest — the AI receptionist speaks the SALON's hours and the SALON's clock (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: the AI receptionist booked "12:00" for a salon whose zone is UTC−8 and told the voice
// platform startAt "…T12:00:00-04:00" — New York. VoiceBranchInfoService.storeHours read tenant_settings category
// 'store_hours', but the Settings screen saves the category as 'store-hours-auto-logout' (the row never matched), so
// every salon got the DEFAULT hours and the default zone: closed Sundays even when the owner opened them, and every
// absolute time the voice platform was given was off by the zone difference. The zone is the branch's own
// (branches.timezone, the one "salon day" source); the hours are the ones the owner saved.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR, clearBranchTimeZoneCache } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { VoiceBranchInfoService } from './voice-idempotency.service';

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

const T = 'e4000000-0000-4000-8000-0000000000a1', B = 'e4000000-0000-4000-8000-0000000000b1', B2 = 'e4000000-0000-4000-8000-0000000000b2';
let pg: PGlite; let svc: VoiceBranchInfoService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new VoiceBranchInfoService(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Voice LLC','Voice Salon','voice-salon','VOICE01')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$3,'West','America/Los_Angeles'), ($2,$3,'Unset',null)`, [B, B2, T]);
  // exactly what Settings → Store Hours saves (PosSettingsService → KyselySettingsRepository.saveCategory)
  const hours = { storeHours: { sunday: { isOpen: true, openTime: '10:00', closeTime: '17:00' } }, timezone: 'America/Chicago' };
  await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1,$2,'store-hours-auto-logout',$3)`, [T, B, JSON.stringify(hours)]);
  clearBranchTimeZoneCache();
}, 240_000);

describe('AI receptionist branch info', () => {
  it('the owner\'s saved store hours are the hours the AI receptionist reads (Sunday opened)', async () => {
    const h = await svc.storeHours({ tenantId: T, branchId: B } as any);
    expect(h.storeHours.sunday).toMatchObject({ isOpen: true, openTime: '10:00', closeTime: '17:00' });
  });
  it('the zone is the BRANCH\'s own (branches.timezone) — not the default New York', async () => {
    expect((await svc.storeHours({ tenantId: T, branchId: B } as any)).timezone).toBe('America/Los_Angeles');
  });
  it('a branch with no zone of its own keeps the platform default', async () => {
    expect((await svc.storeHours({ tenantId: T, branchId: B2 } as any)).timezone).toBe('America/New_York');
  });
});
