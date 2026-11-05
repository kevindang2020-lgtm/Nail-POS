// schema-version.ts — BUILD_PLAN Phase 11 (Constitution 4 §131): which database schema is this instance talking to?
//
// The migration ledger (schema_migrations: filename, applied_at, checksum since Phase 10) against the migration files
// shipped IN THIS IMAGE (apps/api/db/migrations, copied by the Dockerfile):
//   latest      the newest applied file (by name — files sort in apply order) and when it ran
//   applied     ledger rows
//   pending     files in the image the database has not run — the deploy's pre-deploy migrate step did not finish
//   unknown     ledger rows with no file here — the database is AHEAD of this image (a rollback to an older image)
//   mismatches  files edited after they ran on this database (sha256 differs; the edit never reached it)
// Shown on System Operations (detail) and on /health as `schemaVersion` (counts + latest name only; no secrets, no SQL).
// File checksums are computed once per process (the image's files never change); the ledger read is cached for 60 s and
// bounded by a timeout, so /health never waits on a slow database for this.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { MIGRATIONS_DIR } from '@aipowersalon/database';

import type { SchemaVersion, SchemaVersionSummary } from '@aipowersalon/api-contracts/platform';   // the wire contract

/** The image's migrations directory: MIGRATIONS_DIR from @aipowersalon/database (the Dockerfile copies the files to
 *  apps/api/db/migrations beside packages/ — the same layout as the repo); MIGRATIONS_DIR env overrides it (tests). */
export function migrationsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const c of [env.MIGRATIONS_DIR, MIGRATIONS_DIR]) if (c && existsSync(c)) return c;
  return null;
}

const fileSums = new Map<string, Map<string, string>>();
/** sha256 of every .sql file — the same digest scripts/migrate.mjs writes to the ledger. Once per directory per process. */
export function imageMigrations(dir: string): Map<string, string> {
  let m = fileSums.get(dir);
  if (!m) {
    m = new Map();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) m.set(f, createHash('sha256').update(readFileSync(join(dir, f), 'utf8')).digest('hex'));
    fileSums.set(dir, m);
  }
  return m;
}

/** Pure: ledger rows + image files → the schema version. */
export function compareSchema(ledger: Array<{ filename: string; checksum: string | null; applied_at: Date | string | null }>, files: Map<string, string>, dir: string | null, now = new Date()): SchemaVersion {
  const applied = new Set(ledger.map((r) => r.filename));
  const pending = [...files.keys()].filter((f) => !applied.has(f)).sort();
  const unknown = ledger.map((r) => r.filename).filter((f) => !files.has(f)).sort();
  const mismatches = ledger.filter((r) => r.checksum && files.has(r.filename) && files.get(r.filename) !== r.checksum).map((r) => r.filename).sort();
  const sorted = [...ledger].sort((a, b) => a.filename.localeCompare(b.filename));
  const last = sorted[sorted.length - 1];
  const status: SchemaVersion['status'] = pending.length ? 'pending' : unknown.length ? 'ahead' : mismatches.length ? 'drift' : 'ok';
  return {
    status, latest: last?.filename ?? null, latestAppliedAt: last?.applied_at ? new Date(last.applied_at).toISOString() : null,
    applied: ledger.length, files: files.size, pending, unknown, mismatches, migrationsDir: dir, checkedAt: now.toISOString(),
  };
}

const unknownVersion = (error: string, dir: string | null = null): SchemaVersion => ({ status: 'unknown', latest: null, latestAppliedAt: null, applied: 0, files: 0, pending: [], unknown: [], mismatches: [], migrationsDir: dir, checkedAt: new Date().toISOString(), error });

export async function readSchemaVersion(db: any, dir: string | null = migrationsDir()): Promise<SchemaVersion> {
  if (!db) return unknownVersion('no database configured', dir);
  if (!dir) return unknownVersion('migrations directory not found in this image');
  try {
    // `select *`: the ledger's checksum / duration_ms columns are added by scripts/migrate.mjs itself (Phase 10), not by
    // a migration file, so a ledger written before Phase 10 may not have them yet.
    const rows = (await sql<any>`select * from schema_migrations`.execute(db)).rows
      .map((r: any) => ({ filename: String(r.filename), checksum: r.checksum ?? null, applied_at: r.applied_at ?? null }));
    return compareSchema(rows, imageMigrations(dir), dir);
  } catch (e: any) {
    return unknownVersion(/schema_migrations/.test(String(e?.message)) ? 'no migration ledger' : 'database unavailable', dir);
  }
}

export const SCHEMA_VERSION_TTL_MS = 60_000;
export const SCHEMA_VERSION_TIMEOUT_MS = 1_000;
let cached: { at: number; v: SchemaVersion } | null = null;
let inflight: Promise<SchemaVersion> | null = null;

/** Cached + time-bounded: what /health and System Operations call. Never throws. */
export async function cachedSchemaVersion(db: any, now = Date.now()): Promise<SchemaVersion> {
  if (cached && now - cached.at < SCHEMA_VERSION_TTL_MS) return cached.v;
  if (!inflight) inflight = readSchemaVersion(db).then((v) => { cached = { at: Date.now(), v }; return v; }).finally(() => { inflight = null; });
  const timeout = new Promise<SchemaVersion>((r) => { const t = setTimeout(() => r(cached?.v ?? unknownVersion('database did not answer in time')), SCHEMA_VERSION_TIMEOUT_MS); t.unref?.(); });
  return Promise.race([inflight, timeout]);
}
export function _resetSchemaVersionCache(): void { cached = null; inflight = null; fileSums.clear(); }

export function summarizeSchema(v: SchemaVersion): SchemaVersionSummary {
  return { status: v.status, latest: v.latest, applied: v.applied, pending: v.pending.length, mismatches: v.mismatches.length, unknown: v.unknown.length };
}
