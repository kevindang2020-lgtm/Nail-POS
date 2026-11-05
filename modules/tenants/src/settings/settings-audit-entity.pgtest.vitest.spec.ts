// settings-audit-entity.pgtest — every settings change leaves an audit row (wave 4 SQL, Oct 13 2026). Found in the pilot's
// PostgreSQL log: `null value in column "entity_id" of relation "settings_audit_logs" violates not-null constraint` x98 —
// patchCategory and the provider/hardware actions never set entityId, the insert failed, and appendAudit's catch swallowed it,
// so the settings audit trail (GET /pos/settings/audit-logs) stayed EMPTY however much was changed.
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

const T = 'e2200000-0000-4000-8000-0000000000a1', B1 = 'e2200000-0000-4000-8000-0000000000b1', B2 = 'e2200000-0000-4000-8000-0000000000b2';
const U = 'e2200000-0000-4000-8000-0000000000c1';
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
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Zone LLC','Zone Salon','audit-salon','AUDT01')`, [T]);
  await q(`insert into branches (id, tenant_id, name) values ($1,$3,'Main'), ($2,$3,'Second')`, [B1, B2, T]);
}, 240_000);

describe('settings audit trail is written', () => {
  it('a category save writes an audit row whose entity is the category', async () => {
    await svc.patchCategory(owner, 'business-branch', { address: '1 Audit Way' });
    const rows = await svc.listAudit(owner, 10);
    expect(rows.length).toBe(1);
    expect(rows[0].actionType).toBe('pos_settings_business_branch_updated');
    expect(rows[0].entityId).toBe('business-branch');
  });
  it('a provider/hardware action (Twilio/terminal style) writes an audit row with a non-empty entity id', async () => {
    await (svc as any).audit(owner, 'pos_settings_notifications_updated', 'notifications', { a2pStatus: 'pending' });
    await (svc as any).audit(owner, 'pos_settings_terminal_unpaired', 'payments_checkout', { id: 'term-1' });
    const rows = await svc.listAudit(owner, 10);
    expect(rows.length).toBe(3);
    const byAction = Object.fromEntries(rows.map((r) => [r.actionType, r.entityId]));
    expect(byAction.pos_settings_notifications_updated).toBe('notifications');
    expect(byAction.pos_settings_terminal_unpaired).toBe('term-1');
  });
});
