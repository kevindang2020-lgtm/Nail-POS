// terminal-register.pgtest — a card terminal is tied to one of the location's REGISTERS (Oct 6 2026). The pairing form asked
// for a free-text "Station" that no card charge could ever match — with two terminals the customer display's charge could
// not find its own. Now the register is chosen from the location's registers, can be changed later, and is shown by name.
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
import { KyselyDevicesRepository } from '../devices/devices.kysely.repository';

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

const T = 'e2000000-0000-4000-8000-0000000000a1', B1 = 'e2000000-0000-4000-8000-0000000000b1', B2 = 'e2000000-0000-4000-8000-0000000000b2';
const U = 'e2000000-0000-4000-8000-0000000000c1';
const FRONT = 'e2000000-0000-4000-8000-0000000000d1', BACK = 'e2000000-0000-4000-8000-0000000000d2', ELSEWHERE = 'e2000000-0000-4000-8000-0000000000d3', RETIRED = 'e2000000-0000-4000-8000-0000000000d4';
const owner: any = { tenantId: T, branchId: B1, userId: U, role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
let pg: PGlite; let svc: PosSettingsService; let devices: KyselyDevicesRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const stationOf = async (id: string) => (await q(`select station_id from pos_payment_terminals where tenant_id = $1 and id = $2`, [T, id]))[0]?.station_id ?? null;

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new PosSettingsService(new KyselySettingsRepository(db as any), new KyselyTerminalPairingRepository(db as any));
  devices = new KyselyDevicesRepository(db as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Reg LLC','Reg Salon','reg-salon','REG01')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Main'), ($2,$3,'Second')`, [B1, B2, T]);
  await q(`insert into pos_stations (id, tenant_id, branch_id, name, retired_at) values ($1,$5,$6,'Front Desk',null), ($2,$5,$6,'Back Register',null), ($3,$5,$7,'Second Front',null), ($4,$5,$6,'Old Register',now())`, [FRONT, BACK, ELSEWHERE, RETIRED, T, B1, B2]);
}, 120_000);

describe('a terminal is tied to one of the location\'s registers', () => {
  it('pairs with a register chosen from the location\'s registers, and is listed with that register\'s name', async () => {
    const t = await svc.pairTerminal(owner, '111111', 'Clover Flex', FRONT, 'HSN1');
    expect(t.stationId).toBe(FRONT);
    expect(await stationOf('term_111111')).toBe(FRONT);
    expect((await svc.listTerminals(owner)).find((x: any) => x.id === 'term_111111')).toMatchObject({ stationId: FRONT, registerName: 'Front Desk' });
    expect((await devices.terminals(owner)).find((x: any) => x.id === 'term_111111')?.station).toBe('Front Desk');
  });

  it('pairing without a register is fine; a typed name, another location\'s register or a retired one is refused', async () => {
    await svc.pairTerminal(owner, '222222', 'Clover Mini');
    expect(await stationOf('term_222222')).toBeNull();
    for (const bad of ['Front desk', ELSEWHERE, RETIRED]) await expect(svc.pairTerminal(owner, '333333', 'Bad', bad)).rejects.toThrow(/one of this location's registers/);
    expect(await q(`select id from pos_payment_terminals where id = 'term_333333'`)).toEqual([]);
  });

  it('the register can be changed — or cleared — later; a bad one changes nothing', async () => {
    expect(await svc.setTerminalRegister(owner, 'term_222222', BACK)).toMatchObject({ stationId: BACK, registerName: 'Back Register' });
    await expect(svc.setTerminalRegister(owner, 'term_222222', ELSEWHERE)).rejects.toThrow(/one of this location's registers/);
    expect(await stationOf('term_222222')).toBe(BACK);
    await svc.setTerminalRegister(owner, 'term_222222', null);
    expect(await stationOf('term_222222')).toBeNull();
  });

  it('another location cannot change this location\'s terminal', async () => {
    await expect(svc.setTerminalRegister({ ...owner, branchId: B2 }, 'term_111111', ELSEWHERE)).rejects.toThrow(/not found/);
    expect(await stationOf('term_111111')).toBe(FRONT);
  });

  it('needs the settings edit right', async () => {
    await expect(svc.setTerminalRegister({ ...owner, role: 'FRONT_DESK', permissions: ['settings.view'] }, 'term_111111', BACK)).rejects.toThrow();
  });
});
