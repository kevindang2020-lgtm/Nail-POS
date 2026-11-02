// process-heartbeat.ts — BUILD_PLAN Phase 14 B (Constitution 11 §154 deployments dashboard, §49 CPU / memory, §145 / §149–
// §153 the per-process numbers the dashboards need, fleet-wide).
//
// THE PROBLEM. The registry is per process. The API instance answering a Super Admin request knows its own Redis
// commands, storage writes and provider latency — not the worker's, not the other replica's. /metrics is the right answer
// for an external scraper, but the platform has none attached yet, and System Operations must not show "whichever box
// answered" (system-operations.ts's own rule). So every process — API or worker — UPSERTS ONE ROW per boot into
// process_heartbeats every minute (migration 562): build (version, commit, deployment, environment), role, instance,
// started / last seen, schema version, RSS / heap / CPU / event-loop p99, and a compact DIGEST of the registry series the
// dashboards read (storage, Redis, providers + breakers, webhooks, mobile client counters). Labels are the registry's own —
// the cardinality guard already refused tenant / user / request ids — so the digest carries no tenant data.
//
// The dashboards then aggregate the LIVE processes (seen within LIVE_WINDOW_MS); counters are "since that process
// started", which the screens say. A boot whose heartbeat stopped is a process that ended — the deployment history.
// Process-local by design (PROCESS_LOCAL_SCHEDULERS in tooling/architecture-tests/graph.mjs): every process reports
// itself, so it does not ask runsBackgroundJob and does not take the fleet-wide tick lease. Never in a request path; a
// failed write is logged once per failure and dropped (§285).
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { processRole } from '@aipowersalon/config';
import { BUILD, attachProcessMetrics, registry, runJob, log, type HistogramValue } from '@aipowersalon/observability';
import { readSchemaVersion } from './schema-version';

export const HEARTBEAT_EVERY_MS = 60_000;
/** A process not seen for this long is not live (three missed beats). */
export const LIVE_WINDOW_MS = 3 * HEARTBEAT_EVERY_MS;

/** The registry series the dashboards read from the heartbeat digest. Prefix match. */
export const DIGEST_PREFIXES = [
  'aipowersalon_storage_',
  'aipowersalon_redis_',
  'aipowersalon_provider_',
  'aipowersalon_webhook_events_total',
  'aipowersalon_client_events_total',
  'aipowersalon_client_errors_total',
  'aipowersalon_client_perf_ms',
  'aipowersalon_update_required_total',
] as const;

export type DigestValue = number | { b: number[]; c: number[]; s: number; n: number };
export type MetricsDigest = Record<string, Array<{ l: Record<string, string>; v: DigestValue }>>;

/** Pure: the registry snapshot → the digest stored with the heartbeat (only DIGEST_PREFIXES; histograms keep buckets so
 *  the dashboards can merge processes and read a p95). Empty series are dropped. */
export function metricsDigest(snapshot: Record<string, Array<{ labels: Record<string, string>; value: number | HistogramValue }>>): MetricsDigest {
  const out: MetricsDigest = {};
  for (const [name, series] of Object.entries(snapshot)) {
    if (!DIGEST_PREFIXES.some((p) => name.startsWith(p))) continue;
    const rows = series.map((s) => ({ l: s.labels, v: typeof s.value === 'number' ? s.value : { b: [...s.value.buckets], c: [...s.value.counts], s: s.value.sum, n: s.value.count } }))
      .filter((r) => (typeof r.v === 'number' ? true : r.v.n > 0));
    if (rows.length) out[name] = rows;
  }
  return out;
}

const gaugeValue = (snap: Record<string, Array<{ labels: Record<string, string>; value: any }>>, name: string, labels: Record<string, string> = {}): number | null => {
  const s = (snap[name] ?? []).find((x) => Object.entries(labels).every(([k, v]) => x.labels[k] === v));
  return s && typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : null;
};

export function instanceName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.RAILWAY_REPLICA_ID || env.HOSTNAME || hostname() || 'unknown');
  return raw.replace(/[^\w.:-]/g, '').slice(0, 120) || 'unknown';
}

@Injectable()
export class ProcessHeartbeat implements OnModuleInit, OnModuleDestroy {
  readonly bootId = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {
    attachProcessMetrics();   // §49: RSS / heap / CPU / handles into the registry in EVERY process (API and worker); idempotent
  }

  onModuleInit(): void {
    if (!this.db || process.env.NODE_ENV === 'test') return;
    void runJob({ jobType: 'process.heartbeat', jobClass: 'standard' }, () => this.beat()).catch(() => undefined);
    this.timer = setInterval(() => { void runJob({ jobType: 'process.heartbeat', jobClass: 'standard' }, () => this.beat()).catch(() => undefined); }, HEARTBEAT_EVERY_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** One upsert of this process's row. Resolves false (and logs) when the write failed. */
  async beat(now = new Date()): Promise<boolean> {
    if (!this.db) return false;
    try {
      const snap = registry.snapshot();   // runs the collectors: process, Redis INFO, queue
      const schema = await readSchemaVersion(this.db).catch(() => null);
      const role = (() => { try { return processRole(); } catch { return 'all'; } })();
      const cpuUser = gaugeValue(snap, 'aipowersalon_process_cpu_seconds_total', { mode: 'user' });
      const cpuSys = gaugeValue(snap, 'aipowersalon_process_cpu_seconds_total', { mode: 'system' });
      await sql`insert into process_heartbeats (boot_id, process_role, instance, version, git_commit, deployment, environment, started_at, last_seen_at,
                  schema_latest, schema_pending, rss_bytes, heap_used_bytes, cpu_user_seconds, cpu_system_seconds, event_loop_p99_seconds, metrics)
        values (${this.bootId}, ${role}, ${instanceName()}, ${BUILD.version.slice(0, 60)}, ${BUILD.commit.slice(0, 60)}, ${BUILD.deployment.slice(0, 60)}, ${BUILD.environment.slice(0, 40)},
                ${new Date(BUILD.startedAt)}, ${now}, ${schema?.latest ?? null}, ${schema && schema.status !== 'unknown' ? schema.pending.length : null},
                ${gaugeValue(snap, 'aipowersalon_process_resident_memory_bytes')}, ${gaugeValue(snap, 'aipowersalon_process_heap_bytes', { space: 'used' })},
                ${cpuUser}, ${cpuSys}, ${gaugeValue(snap, 'aipowersalon_nodejs_event_loop_lag_seconds', { quantile: '0.99' })}, ${JSON.stringify(metricsDigest(snap))}::jsonb)
        on conflict (boot_id) do update set last_seen_at = excluded.last_seen_at, schema_latest = excluded.schema_latest, schema_pending = excluded.schema_pending,
          rss_bytes = excluded.rss_bytes, heap_used_bytes = excluded.heap_used_bytes, cpu_user_seconds = excluded.cpu_user_seconds,
          cpu_system_seconds = excluded.cpu_system_seconds, event_loop_p99_seconds = excluded.event_loop_p99_seconds, metrics = excluded.metrics`.execute(this.db);
      return true;
    } catch (e) {
      log.warn('process_heartbeat.write_failed', { error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
}
