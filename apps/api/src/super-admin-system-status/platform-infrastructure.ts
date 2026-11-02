// platform-infrastructure.ts — Oct 14 build plan ("System Status: storage and deployments panels"), rebuilt Oct 21 2026.
//
// Two panels the System Status screen had no data for. Both read what the platform already knows about itself — nothing
// is invented and nothing secret leaves (§252: non-secret configuration only — a bucket NAME, never a key):
//   storage      — the database's size and its heaviest tables (pg_catalog), and WHERE media lives (MEDIA_STORE: object
//                  storage with its bucket / region, or the container disk — which production refuses unless the owner
//                  accepted the loss with MEDIA_STORE_ALLOW_DISK=1, see packages/media).
//   deployments  — the running build (version / commit / Railway deployment / environment / started), its uptime, the
//                  schema ledger (latest migration, pending, drift — the same reading /health gives) and the last
//                  migrations applied, newest first: the platform's own release history.
// Every reading says `available: false` with a reason when the source cannot answer, so the panel shows NotConnected
// rather than a number that means nothing.
import { sql, type Kysely } from 'kysely';
import { BUILD, type BuildInfo } from '@aipowersalon/observability';
import { cachedSchemaVersion } from '../observability/schema-version';
import type { SchemaVersion } from '@aipowersalon/api-contracts/platform';

export interface StorageReading {
  database: { available: boolean; reason?: string; sizeBytes: number | null; tables: { table: string; totalBytes: number; rows: number | null }[] };
  media: { store: 'object_storage' | 'disk'; bucket: string | null; region: string | null; endpoint: string | null; envSegment: string; diskAccepted: boolean; productionSafe: boolean };
}
export interface DeploymentsReading {
  build: BuildInfo; uptimeSeconds: number;
  schema: Pick<SchemaVersion, 'status' | 'latest' | 'latestAppliedAt' | 'applied' | 'files' | 'pending' | 'mismatches'> | null;
  migrations: { available: boolean; reason?: string; recent: { filename: string; appliedAt: string | null }[] };
}

const TOP_TABLES = 10;

export class PlatformInfrastructureService {
  constructor(private readonly db: Kysely<any> | null, private readonly env: NodeJS.ProcessEnv = process.env, private readonly startedAt = Date.now()) {}

  async storage(): Promise<StorageReading> {
    const store = String(this.env.MEDIA_STORE ?? '').trim().toLowerCase() === 's3' ? 'object_storage' : 'disk';
    const diskAccepted = String(this.env.MEDIA_STORE_ALLOW_DISK ?? '').trim() === '1';
    const media: StorageReading['media'] = {
      store, bucket: store === 'object_storage' ? String(this.env.MEDIA_S3_BUCKET ?? '').trim() || null : null,
      region: store === 'object_storage' ? (String(this.env.MEDIA_S3_REGION ?? '').trim() || String(this.env.AWS_REGION ?? '').trim() || null) : null,
      endpoint: store === 'object_storage' ? hostOnly(this.env.MEDIA_S3_ENDPOINT) : null,
      envSegment: String(this.env.MEDIA_ENV ?? '').trim() || String(this.env.NODE_ENV ?? '').trim() || 'development',
      diskAccepted, productionSafe: store === 'object_storage' || diskAccepted,
    };
    if (!this.db) return { database: { available: false, reason: 'no database', sizeBytes: null, tables: [] }, media };
    try {
      const size = await sql<{ bytes: string | number }>`select pg_database_size(current_database())::bigint as bytes`.execute(this.db);
      const tables = await sql<{ table: string; total_bytes: string | number; rows: string | number | null }>`select c.relname as table, pg_total_relation_size(c.oid)::bigint as total_bytes, case when c.reltuples < 0 then null else c.reltuples::bigint end as rows
        from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') order by pg_total_relation_size(c.oid) desc limit ${TOP_TABLES}`.execute(this.db);
      return {
        database: { available: true, sizeBytes: Number(size.rows[0]?.bytes ?? 0), tables: tables.rows.map((r) => ({ table: String(r.table), totalBytes: Number(r.total_bytes), rows: r.rows == null ? null : Number(r.rows) })) },
        media,
      };
    } catch (e: any) {
      return { database: { available: false, reason: String(e?.message ?? e).slice(0, 160), sizeBytes: null, tables: [] }, media };
    }
  }

  async deployments(now = Date.now()): Promise<DeploymentsReading> {
    const base = { build: BUILD, uptimeSeconds: Math.max(0, Math.round((now - this.startedAt) / 1000)) };
    if (!this.db) return { ...base, schema: null, migrations: { available: false, reason: 'no database', recent: [] } };
    let schema: DeploymentsReading['schema'] = null;
    try {
      const v = await cachedSchemaVersion(this.db, now);
      schema = { status: v.status, latest: v.latest, latestAppliedAt: v.latestAppliedAt, applied: v.applied, files: v.files, pending: v.pending, mismatches: v.mismatches };
    } catch { schema = null; }
    try {
      const r = await sql<{ filename: string; applied_at: Date | string | null }>`select filename, applied_at from schema_migrations order by applied_at desc, filename desc limit 12`.execute(this.db);
      return { ...base, schema, migrations: { available: true, recent: r.rows.map((x) => ({ filename: String(x.filename), appliedAt: x.applied_at ? new Date(x.applied_at).toISOString() : null })) } };
    } catch (e: any) {
      return { ...base, schema, migrations: { available: false, reason: String(e?.message ?? e).slice(0, 160), recent: [] } };
    }
  }
}

/** an endpoint URL's host only — never a query string or credentials someone put in the URL */
function hostOnly(v: unknown): string | null {
  const s = String(v ?? '').trim(); if (!s) return null;
  try { return new URL(s).host || null; } catch { const bare = s.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]; return bare.slice(bare.lastIndexOf('@') + 1) || null; }
}
