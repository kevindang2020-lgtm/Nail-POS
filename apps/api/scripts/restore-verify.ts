#!/usr/bin/env tsx
// restore-verify.ts — run after restoring a backup into a SCRATCH database (Constitution 12 §225–238).
//
//   DATABASE_URL=postgres://…scratch…  <the same encryption keys as production>  npx tsx scripts/restore-verify.ts
//   add BACKUP_REPORT_URL + BACKUP_REPORT_TOKEN to report the drill to production's /internal/backups/report.
//
// Read-only. Exit 0 = the backup is usable (schema complete, data present, every sampled encrypted column opens).
// Refuses a database that looks like PRODUCTION's own URL, so it cannot be pointed at the live database by mistake.
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { verifyRestore, defaultMigrationsDir } from '../src/common/restore-verify';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL (the SCRATCH database) is required.'); process.exit(1); }
  if (process.env.PRODUCTION_DATABASE_URL && process.env.PRODUCTION_DATABASE_URL === url) { console.error('Refusing: DATABASE_URL is the production database. Restore into a scratch database first.'); process.exit(1); }
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, max: 2 }) }) });
  const started = new Date().toISOString();
  try {
    const r = await verifyRestore(db, defaultMigrationsDir());
    console.log(JSON.stringify({ ok: r.ok, summary: r.summary, schema: r.schema, data: r.data, keys: r.keys }, null, 2));
    if (process.env.BACKUP_REPORT_URL && process.env.BACKUP_REPORT_TOKEN) {
      const res = await fetch(process.env.BACKUP_REPORT_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-backup-report-token': process.env.BACKUP_REPORT_TOKEN },
        body: JSON.stringify({ kind: 'restore_drill', status: r.ok ? 'success' : 'failure', startedAt: started, completedAt: new Date().toISOString(),
          integrityOk: r.schema.missing.length === 0 && r.data.every((d) => d.rows > 0), smokeTestOk: r.keys.every((k) => k.result !== 'failed'), detail: r.summary }) });
      console.error(res.status === 204 ? 'Drill reported.' : `Drill report NOT accepted (HTTP ${res.status}).`);
      if (res.status !== 204) process.exit(1);
    }
    process.exit(r.ok ? 0 : 1);
  } finally { await db.destroy(); }
}
void main();
