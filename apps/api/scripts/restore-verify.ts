#!/usr/bin/env tsx
// restore-verify.ts — run after restoring a backup into a SCRATCH database (Constitution 12 §225–238).
//
//   DATABASE_URL=postgres://…scratch…  <the same encryption keys as production>  npx tsx scripts/restore-verify.ts
//   add BACKUP_REPORT_URL + BACKUP_REPORT_TOKEN to report the drill to production's /internal/backups/report.
//   G9 (Nov 5 2026): add RECOVERY_POINT_ID=<catalog id> to post this run as that recovery point's VERIFICATION evidence
//   (…/internal/backups/recovery-points/<id>/verification, derived from BACKUP_REPORT_URL). Only a point verified this
//   way is shown as recoverable in Super Admin → Backup & Disaster Recovery. ARTIFACT_PATH + ARTIFACT_SHA256 (the manifest's
//   value) hash the restored dump here; without them the checksum check is "not run" and the point stays PARTIAL.
//
// Read-only. Exit 0 = the backup is usable (schema complete, data present, every sampled encrypted column opens).
// Refuses a database that looks like PRODUCTION's own URL, so it cannot be pointed at the live database by mistake.
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { verifyRestore, defaultMigrationsDir } from '../src/common/restore-verify';

/** G9: the dump that was restored, hashed here — present only when ARTIFACT_PATH + ARTIFACT_SHA256 are given (else not run → PARTIAL). */
async function artifactChecksum(): Promise<{ checksums?: boolean }> {
  const path = process.env.ARTIFACT_PATH, want = process.env.ARTIFACT_SHA256;
  if (!path || !want) return {};
  const { createHash } = await import('node:crypto'); const { createReadStream } = await import('node:fs');
  const h = createHash('sha256');
  await new Promise<void>((res, rej) => createReadStream(path).on('data', (c) => h.update(c)).on('end', () => res()).on('error', rej));
  return { checksums: h.digest('hex') === want.toLowerCase() };
}

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
      const pointId = process.env.RECOVERY_POINT_ID;
      if (pointId) {
        if (!/^[0-9a-f-]{36}$/i.test(pointId)) { console.error('RECOVERY_POINT_ID must be the catalog uuid.'); process.exit(1); }
        const vurl = process.env.BACKUP_REPORT_URL.replace(/\/report$/, `/recovery-points/${pointId}/verification`);
        const vr = await fetch(vurl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-backup-report-token': process.env.BACKUP_REPORT_TOKEN },
          body: JSON.stringify({ startedAt: started, completedAt: new Date().toISOString(), detail: r.summary,
            checks: { schema: r.schema.missing.length === 0, data: r.data.every((d) => d.rows > 0), ...(await artifactChecksum()), decrypt: r.keys.every((k) => k.result !== 'failed') } }) });
        console.error(vr.ok ? `Verification recorded: ${JSON.stringify(await vr.json()).slice(0, 200)}` : `Verification NOT accepted (HTTP ${vr.status}).`);
        if (!vr.ok) process.exit(1);
      }
    }
    process.exit(r.ok ? 0 : 1);
  } finally { await db.destroy(); }
}
void main();
