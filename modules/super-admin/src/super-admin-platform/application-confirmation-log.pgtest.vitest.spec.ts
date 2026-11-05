// application-confirmation-log.pgtest — an applicant confirmation the platform could NOT send is still logged (wave 4 SQL,
// Oct 13 2026). Found in the pilot's PostgreSQL log: `notification_delivery_logs_status_check` violated x80 — with no
// SendGrid/Twilio configured the sender logged status 'skipped', which the CHECK (migration 375: queued/sent/delivered/
// failed/suppressed/blocked) never allowed; the .catch swallowed it, so the Super Admin Communications overview never saw
// a single unsent confirmation. The vocabulary is the CHECK's (and migration 663's): a channel with no provider is
// 'blocked' with reason not_configured. The writer was wrong, not the CHECK.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { ApplicationConfirmationSender } from './application-confirmation';

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

let pg: PGlite; let db: Kysely<any>;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    try { await pg.exec(s); } catch { /* tolerated */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
}, 240_000);

describe('applicant confirmations with no provider are logged as blocked (not_configured)', () => {
  it('email + sms not configured, and a phone that cannot be normalised → three rows, all storable', async () => {
    const s = new ApplicationConfirmationSender({ email: null, sms: null, db: db as any });
    await s.sendConfirmation({ email: 'grace@pilot.test', phone: '6095550100', consent_given: true, salon_name: 'Pilot Nails', reference_number: 'APP-1' });
    await s.sendConfirmation({ phone: '12', consent_given: true, salon_name: 'Pilot Nails', reference_number: 'APP-2' });
    const rows = await q(`select channel, status, error_message from notification_delivery_logs order by channel, error_message`);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.status === 'blocked')).toBe(true);
    expect(rows.map((r) => r.error_message)).toEqual(['not_configured: email provider not configured', 'invalid_target: phone not E.164-normalizable', 'not_configured: sms provider not configured']);
  });
});
