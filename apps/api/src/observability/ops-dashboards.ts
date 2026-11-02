// ops-dashboards.ts — BUILD_PLAN Phase 14 B (Constitution 11 §145 Redis, §149 Payments, §150 Communications, §152 Storage,
// §153 Mobile Apps, §154 Deployments, §155 Incidents): the System Operations dashboards that were a component card or
// nothing.
//
// EVERY NUMBER HAS A SOURCE, AND NONE IS INVENTED:
//   • DB facts — read from the platform's own tables (payment_attempts, sms_usage_records, sms_delivery_logs,
//     notification_delivery_logs, tenant_storage_usage + tenant_quotas, mobile_app_installs_seen + mobile_app_versions,
//     scheduler_runs, status_incidents + status_incident_events, system_health_snapshots). The same for every caller.
//   • LIVE facts — the registry series each process wrote into its heartbeat (process_heartbeats.metrics, migration 562):
//     summed over the processes seen in the last LIVE_WINDOW_MS, "since each live process started". Histograms are merged
//     bucket by bucket, so a p95 is the fleet's, not one box's.
// An empty source answers an empty list or null and the screen says "no data yet" — a zero is only ever a counted zero.
//
// NOT DUPLICATED: the Database page (Phase 10 — /super-admin/database) and the capacity / cost / quota panels (Phase 11 —
// SystemOpsCapacity) stay where they are; these dashboards link to them. The API dashboard (§143) is the System Operations
// "API — last hour" section; the Queue (§146) and Realtime (§148) dashboards are the Events and Live-ops screens.
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Inject, Injectable, NotFoundException, Optional, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { quantile } from '@aipowersalon/observability';
import type {
  CommunicationsDashboard, DashboardProcess, DeploymentDashboard, DeploymentRelease, IncidentDashboard, IncidentDashboardRow, LiveSource,
  MobileDashboard, PaymentsDashboard, ProviderRow, RedisDashboard, StorageDashboard, WebhookRow,
} from '@aipowersalon/api-contracts/platform';
import { LIVE_WINDOW_MS, type DigestValue, type MetricsDigest } from './process-heartbeat';
import { readSchemaVersion } from './schema-version';

// ── pure helpers over heartbeat digests ──────────────────────────────────────────────────────────────────────────────
export interface HeartbeatRow { bootId: string; processRole: string; startedAt: Date; lastSeenAt: Date; metrics: MetricsDigest }
type Hist = { b: number[]; c: number[]; s: number; n: number };
const isHist = (v: DigestValue): v is Hist => typeof v === 'object' && v !== null && Array.isArray((v as Hist).c);

/** Sum a counter / gauge series over processes, grouped by the given label names. */
export function sumBy(beats: readonly HeartbeatRow[], metric: string, groupBy: readonly string[], filter: (l: Record<string, string>) => boolean = () => true): Map<string, { labels: Record<string, string>; value: number }> {
  const out = new Map<string, { labels: Record<string, string>; value: number }>();
  for (const b of beats) for (const s of b.metrics?.[metric] ?? []) {
    if (isHist(s.v) || !filter(s.l)) continue;
    const labels = Object.fromEntries(groupBy.map((k) => [k, s.l[k] ?? '']));
    const k = JSON.stringify(labels);
    const cur = out.get(k);
    if (cur) cur.value += Number(s.v) || 0; else out.set(k, { labels, value: Number(s.v) || 0 });
  }
  return out;
}
/** Max of a gauge series over processes (a shared server's memory is the same number seen by every process). */
export function maxBy(beats: readonly HeartbeatRow[], metric: string, groupBy: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of beats) for (const s of b.metrics?.[metric] ?? []) {
    if (isHist(s.v)) continue;
    const k = JSON.stringify(Object.fromEntries(groupBy.map((g) => [g, s.l[g] ?? ''])));
    out.set(k, Math.max(out.get(k) ?? -Infinity, Number(s.v)));
  }
  return out;
}
/** Merge histogram series (same buckets) over processes, grouped; returns p-quantile per group (null without samples). */
export function quantileBy(beats: readonly HeartbeatRow[], metric: string, groupBy: readonly string[], q: number, filter: (l: Record<string, string>) => boolean = () => true): Map<string, number | null> {
  const merged = new Map<string, Hist>();
  for (const b of beats) for (const s of b.metrics?.[metric] ?? []) {
    if (!isHist(s.v) || !filter(s.l)) continue;
    const k = JSON.stringify(Object.fromEntries(groupBy.map((g) => [g, s.l[g] ?? ''])));
    const cur = merged.get(k);
    if (!cur) { merged.set(k, { b: [...s.v.b], c: [...s.v.c], s: s.v.s, n: s.v.n }); continue; }
    if (cur.b.length !== s.v.b.length) continue;   // a different bucket layout (an older build) is not mergeable
    for (let i = 0; i < cur.c.length; i++) cur.c[i] += s.v.c[i] ?? 0;
    cur.s += s.v.s; cur.n += s.v.n;
  }
  const out = new Map<string, number | null>();
  for (const [k, h] of merged) out.set(k, quantile({ buckets: h.b, counts: h.c, sum: h.s, count: h.n }, q));
  return out;
}
export const liveSource = (beats: readonly HeartbeatRow[]): LiveSource => ({
  processes: beats.length, roles: [...new Set(beats.map((b) => b.processRole))].sort(),
  oldestStartedAt: beats.length ? new Date(Math.min(...beats.map((b) => b.startedAt.getTime()))).toISOString() : null,
});
const lbl = (k: string) => JSON.parse(k) as Record<string, string>;
const ms = (seconds: number | null | undefined) => (seconds == null ? null : Math.round(seconds * 1000 * 10) / 10);

// Provider families (provider-telemetry.ts names; a prefix match so twilio_verify is SMS, fiserv_commercehub is payments).
export const PAYMENT_PROVIDERS = /^(cardpointe|fiserv|clover|stripe|bank|commercehub|mock_commercehub)/;
export function commsChannel(provider: string): 'sms' | 'email' | 'push' | 'voice' | null {
  if (/^twilio/.test(provider)) return 'sms';
  if (/^(sendgrid|email|smtp|ses)/.test(provider)) return 'email';
  if (/^(fcm|apns|push|expo)/.test(provider)) return 'push';
  if (/^(retell|voice|vapi)/.test(provider)) return 'voice';
  return null;
}

/** Pure: providers matching `pick` → calls, failures by category, merged p95, breaker open on ANY live process. */
export function providerRows(beats: readonly HeartbeatRow[], pick: (provider: string) => boolean): ProviderRow[] {
  const calls = sumBy(beats, 'aipowersalon_provider_calls_total', ['provider', 'category'], (l) => pick(l.provider));
  const p95 = quantileBy(beats, 'aipowersalon_provider_call_duration_seconds', ['provider'], 0.95, (l) => pick(l.provider));
  const open = maxBy(beats, 'aipowersalon_provider_circuit_open', ['provider']);
  const rows = new Map<string, ProviderRow>();
  const row = (p: string) => { let r = rows.get(p); if (!r) { r = { provider: p, calls: 0, failures: 0, byCategory: {}, latencyP95Ms: null, circuitOpen: false }; rows.set(p, r); } return r; };
  for (const { labels, value } of calls.values()) {
    const r = row(labels.provider); r.calls += value; r.byCategory[labels.category] = (r.byCategory[labels.category] ?? 0) + value;
    if (labels.category !== 'ok') r.failures += value;
  }
  for (const [k, v] of p95) row(lbl(k).provider).latencyP95Ms = ms(v);
  for (const [k, v] of open) if (pick(lbl(k).provider)) row(lbl(k).provider).circuitOpen = v >= 1;
  return [...rows.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}
export function webhookRows(beats: readonly HeartbeatRow[], pick: (provider: string) => boolean): WebhookRow[] {
  const rows = new Map<string, WebhookRow>();
  for (const { labels, value } of sumBy(beats, 'aipowersalon_webhook_events_total', ['provider', 'outcome'], (l) => pick(l.provider)).values()) {
    const r = rows.get(labels.provider) ?? { provider: labels.provider, byOutcome: {} };
    r.byOutcome[labels.outcome] = (r.byOutcome[labels.outcome] ?? 0) + value; rows.set(labels.provider, r);
  }
  return [...rows.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

/** Pure (§154): boots → releases, newest first. A release is (version, commit, deployment, environment). `rollback` = an
 *  older release booted again after a newer release's first boot. */
export function releaseHistory(boots: ReadonlyArray<{ version: string; commit: string; deployment: string; environment: string; startedAt: Date; lastSeenAt: Date; live: boolean }>): Omit<DeploymentRelease, 'healthChangesAfterDeploy'>[] {
  const by = new Map<string, Omit<DeploymentRelease, 'healthChangesAfterDeploy'> & { starts: number[] }>();
  for (const b of boots) {
    const k = [b.version, b.commit, b.deployment, b.environment].join('\u0001');
    let r = by.get(k);
    if (!r) { r = { version: b.version, commit: b.commit, deployment: b.deployment, environment: b.environment, firstStartedAt: b.startedAt.toISOString(), lastSeenAt: b.lastSeenAt.toISOString(), boots: 0, liveProcesses: 0, rollback: false, starts: [] }; by.set(k, r); }
    r.boots++; if (b.live) r.liveProcesses++; r.starts.push(b.startedAt.getTime());
    if (b.startedAt.toISOString() < r.firstStartedAt) r.firstStartedAt = b.startedAt.toISOString();
    if (b.lastSeenAt.toISOString() > r.lastSeenAt) r.lastSeenAt = b.lastSeenAt.toISOString();
  }
  const rel = [...by.values()].sort((a, b) => b.firstStartedAt.localeCompare(a.firstStartedAt));
  for (let i = 0; i < rel.length; i++) {
    const newerFirsts = rel.slice(0, i).map((n) => Date.parse(n.firstStartedAt));
    if (newerFirsts.length && rel[i].starts.some((s) => s > Math.min(...newerFirsts))) rel[i].rollback = true;
  }
  return rel.map(({ starts: _s, ...r }) => r);
}

// payment_attempts.status → dashboard class (vocabulary: state-vocabularies.generated.json payment_attempts.status)
export const ATTEMPT_CLASS: Record<string, 'approved' | 'declined' | 'technicalFailures' | 'canceled' | 'refunded'> = {
  succeeded: 'approved', settled: 'approved', confirmed: 'approved', authorized: 'approved',
  declined: 'declined',
  failed: 'technicalFailures', timed_out: 'technicalFailures', unknown: 'technicalFailures', reconciliation_required: 'technicalFailures', needs_review: 'technicalFailures',
  canceled: 'canceled', cancelled: 'canceled', void: 'canceled', voided: 'canceled',
  refunded: 'refunded', partially_refunded: 'refunded',
};

@Injectable()
export class OpsDashboardsService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}
  private need() { if (!this.db) throw new NotFoundException('Dashboards need the database.'); return this.db; }

  async liveBeats(now = new Date()): Promise<HeartbeatRow[]> {
    const since = new Date(now.getTime() - LIVE_WINDOW_MS);
    const r = await sql<any>`select boot_id, process_role, started_at, last_seen_at, metrics from process_heartbeats where last_seen_at >= ${since} order by started_at`.execute(this.need());
    return r.rows.map((x: any) => ({ bootId: String(x.boot_id), processRole: x.process_role, startedAt: new Date(x.started_at), lastSeenAt: new Date(x.last_seen_at),
      metrics: (typeof x.metrics === 'string' ? JSON.parse(x.metrics) : x.metrics) ?? {} }));
  }

  // §154
  async deployments(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<DeploymentDashboard> {
    const db = this.need();
    const since = new Date(now.getTime() - 30 * 86_400_000), live = new Date(now.getTime() - LIVE_WINDOW_MS);
    const rows = (await sql<any>`select boot_id, process_role, instance, version, git_commit, deployment, environment, started_at, last_seen_at, rss_bytes, heap_used_bytes, cpu_user_seconds, cpu_system_seconds, event_loop_p99_seconds, schema_latest, schema_pending from process_heartbeats where started_at >= ${since} or last_seen_at >= ${live} order by started_at desc limit 2000`.execute(db)).rows;
    const boots = rows.map((x: any) => ({ version: x.version, commit: x.git_commit, deployment: x.deployment, environment: x.environment, startedAt: new Date(x.started_at), lastSeenAt: new Date(x.last_seen_at), live: new Date(x.last_seen_at) >= live }));
    const releases: DeploymentRelease[] = [];
    for (const r of releaseHistory(boots).slice(0, 30)) {
      let changes: number | null = null;
      try {
        const from = new Date(r.firstStartedAt), to = new Date(from.getTime() + 30 * 60_000);
        changes = Number((await sql<any>`select count(*)::int n from system_health_snapshots where observed_at >= ${from} and observed_at < ${to} and status <> 'HEALTHY'`.execute(db)).rows[0]?.n ?? 0);
      } catch { changes = null; }
      releases.push({ ...r, healthChangesAfterDeploy: changes });
    }
    const processes: DashboardProcess[] = rows.filter((x: any) => new Date(x.last_seen_at) >= live).map((x: any) => ({
      bootId: String(x.boot_id), processRole: x.process_role, instance: x.instance, version: x.version, commit: x.git_commit, deployment: x.deployment, environment: x.environment,
      startedAt: new Date(x.started_at).toISOString(), lastSeenAt: new Date(x.last_seen_at).toISOString(), live: true,
      uptimeSeconds: Math.max(0, Math.round((new Date(x.last_seen_at).getTime() - new Date(x.started_at).getTime()) / 1000)),
      rssBytes: x.rss_bytes == null ? null : Number(x.rss_bytes), heapUsedBytes: x.heap_used_bytes == null ? null : Number(x.heap_used_bytes),
      cpuSeconds: x.cpu_user_seconds == null && x.cpu_system_seconds == null ? null : Math.round((Number(x.cpu_user_seconds ?? 0) + Number(x.cpu_system_seconds ?? 0)) * 10) / 10,
      eventLoopP99Ms: ms(x.event_loop_p99_seconds == null ? null : Number(x.event_loop_p99_seconds)), schemaLatest: x.schema_latest ?? null, schemaPending: x.schema_pending ?? null,
    }));
    let schema: DeploymentDashboard['schema'] = null;
    try { const s = await readSchemaVersion(db); schema = { status: s.status, latest: s.latest, pending: s.pending, mismatches: s.mismatches, ...(s.error ? { error: s.error } : {}) }; } catch { schema = null; }
    const notes = String(env.RELEASE_NOTES_URL ?? '').trim();
    return { generatedAt: now.toISOString(), releases, processes, schema, releaseNotesUrl: /^https:\/\/[^\s]+$/.test(notes) ? notes : null };
  }

  // §152
  async storage(now = new Date()): Promise<StorageDashboard> {
    const db = this.need(); const beats = await this.liveBeats(now);
    const ops = sumBy(beats, 'aipowersalon_storage_operations_total', ['store', 'op', 'outcome']);
    const bytes = sumBy(beats, 'aipowersalon_storage_bytes_total', ['store', 'direction']);
    const p95 = quantileBy(beats, 'aipowersalon_storage_operation_duration_seconds', ['store'], 0.95);
    const stores = new Map<string, StorageDashboard['stores'][number]>();
    const st = (s: string) => { let r = stores.get(s); if (!r) { r = { store: s, ok: 0, errors: 0, misses: 0, bytesWritten: 0, bytesRead: 0, latencyP95Ms: null, errorsByOp: {} }; stores.set(s, r); } return r; };
    for (const { labels: l, value } of ops.values()) {
      const r = st(l.store);
      if (l.outcome === 'ok') r.ok += value; else if (l.outcome === 'miss') r.misses += value; else { r.errors += value; r.errorsByOp[l.op] = (r.errorsByOp[l.op] ?? 0) + value; }
    }
    for (const { labels: l, value } of bytes.values()) { const r = st(l.store); if (l.direction === 'written') r.bytesWritten += value; else r.bytesRead += value; }
    for (const [k, v] of p95) st(lbl(k).store).latencyP95Ms = ms(v);
    const runs = new Map<string, { store: string; ok: number; errors: number; removed: number }>();
    const run = (s: string) => { let r = runs.get(s); if (!r) { r = { store: s, ok: 0, errors: 0, removed: 0 }; runs.set(s, r); } return r; };
    for (const { labels: l, value } of sumBy(beats, 'aipowersalon_storage_lifecycle_runs_total', ['store', 'outcome']).values()) { if (l.outcome === 'ok') run(l.store).ok += value; else run(l.store).errors += value; }
    for (const { labels: l, value } of sumBy(beats, 'aipowersalon_storage_lifecycle_removed_total', ['store']).values()) run(l.store).removed += value;
    const job = (await sql<any>`select last_started_at, last_finished_at, last_outcome, runs, failures from scheduler_runs where name = 'media.lifecycle'`.execute(db)).rows[0];
    const usage = (await sql<any>`select count(*)::int tenants, coalesce(sum(bytes_used), 0)::bigint bytes, coalesce(sum(uploads), 0)::bigint uploads from tenant_storage_usage`.execute(db)).rows[0];
    const top = (await sql<any>`select u.tenant_id, t.display_name, u.bytes_used, u.uploads, q.storage_bytes limit_bytes
        from tenant_storage_usage u left join tenants t on t.id = u.tenant_id left join tenant_quotas q on q.tenant_id = u.tenant_id
        where u.bytes_used > 0 order by u.bytes_used desc limit 10`.execute(db)).rows;
    return {
      generatedAt: now.toISOString(), live: liveSource(beats), stores: [...stores.values()].sort((a, b) => a.store.localeCompare(b.store)),
      lifecycle: { runs: [...runs.values()].sort((a, b) => a.store.localeCompare(b.store)),
        job: job ? { lastStartedAt: job.last_started_at ? new Date(job.last_started_at).toISOString() : null, lastFinishedAt: job.last_finished_at ? new Date(job.last_finished_at).toISOString() : null,
          lastOutcome: job.last_outcome ?? null, runs: Number(job.runs ?? 0), failures: Number(job.failures ?? 0) } : null },
      usage: { tenants: Number(usage?.tenants ?? 0), totalBytes: Number(usage?.bytes ?? 0), totalUploads: Number(usage?.uploads ?? 0),
        top: top.map((x: any) => { const limit = x.limit_bytes == null ? null : Number(x.limit_bytes); const used = Number(x.bytes_used);
          return { tenantId: String(x.tenant_id), tenantName: x.display_name ?? null, bytesUsed: used, uploads: Number(x.uploads), limitBytes: limit, share: limit && limit > 0 ? Math.round((used / limit) * 1000) / 1000 : null }; }) },
      malwareScanFailures: null,
    };
  }

  // §153
  async mobile(now = new Date()): Promise<MobileDashboard> {
    const db = this.need(); const beats = await this.liveBeats(now);
    const events = sumBy(beats, 'aipowersalon_client_events_total', ['app', 'platform', 'event']);
    const errors = sumBy(beats, 'aipowersalon_client_errors_total', ['app', 'platform', 'kind']);
    const upd = sumBy(beats, 'aipowersalon_update_required_total', ['app', 'platform']);
    const perf = quantileBy(beats, 'aipowersalon_client_perf_ms', ['app', 'platform', 'metric'], 0.95);
    const apps = new Map<string, MobileDashboard['apps'][number] & { ev: Record<string, number> }>();
    const row = (app: string, platform: string) => { const k = `${app}|${platform}`; let r = apps.get(k); if (!r) { r = { app, platform, events: 0, errors: 0, updateRequired: 0, launchP95Ms: null, apiP95Ms: null, topEvents: [], ev: {} }; apps.set(k, r); } return r; };
    for (const { labels: l, value } of events.values()) { const r = row(l.app, l.platform); r.events += value; r.ev[l.event] = (r.ev[l.event] ?? 0) + value; }
    for (const { labels: l, value } of errors.values()) row(l.app, l.platform).errors += value;
    for (const { labels: l, value } of upd.values()) row(l.app, l.platform).updateRequired += value;
    for (const [k, v] of perf) { const l = lbl(k); if (l.metric === 'launch_to_first_screen') row(l.app, l.platform).launchP95Ms = v == null ? null : Math.round(v); if (l.metric === 'api_latency') row(l.app, l.platform).apiP95Ms = v == null ? null : Math.round(v); }
    const versions = (await sql<any>`select app, platform, app_version, count(*)::int n from mobile_app_installs_seen where last_seen_at >= ${new Date(now.getTime() - 7 * 86_400_000)}
        group by app, platform, app_version order by app, platform, n desc`.execute(db)).rows;
    const policy = (await sql<any>`select app, platform, min_supported, recommended, latest from mobile_app_versions order by app, platform`.execute(db)).rows;
    return {
      generatedAt: now.toISOString(), live: liveSource(beats),
      apps: [...apps.values()].map(({ ev, ...r }) => ({ ...r, topEvents: Object.entries(ev).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([event, count]) => ({ event, count })) }))
        .sort((a, b) => a.app.localeCompare(b.app) || a.platform.localeCompare(b.platform)),
      errorsByKind: [...errors.values()].map(({ labels: l, value }) => ({ app: l.app, platform: l.platform, kind: l.kind, count: value })).sort((a, b) => b.count - a.count),
      versions: versions.map((x: any) => ({ app: x.app, platform: x.platform, version: x.app_version, activeInstalls7d: Number(x.n) })),
      policy: policy.map((x: any) => ({ app: x.app, platform: x.platform, minSupported: x.min_supported ?? null, recommended: x.recommended ?? null, latest: x.latest ?? null })),
    };
  }

  // §145
  async redis(now = new Date()): Promise<RedisDashboard> {
    const beats = await this.liveBeats(now);
    const roles = new Map<string, RedisDashboard['roles'][number]>();
    const role = (r: string) => { let x = roles.get(r); if (!x) { x = { role: r, processes: 0, up: 0, commands: 0, errors: 0, latencyP95Ms: null, reconnects: 0, memoryBytes: null, memoryRatio: null, evictedKeys: null, hitRatio: null, blockedClients: null }; roles.set(r, x); } return x; };
    for (const b of beats) for (const s of b.metrics?.aipowersalon_redis_connection_up ?? []) { const x = role(s.l.role); x.processes++; if (Number(s.v) >= 1) x.up++; }
    for (const { labels: l, value } of sumBy(beats, 'aipowersalon_redis_commands_total', ['role']).values()) role(l.role).commands += value;
    for (const { labels: l, value } of sumBy(beats, 'aipowersalon_redis_command_errors_total', ['role']).values()) role(l.role).errors += value;
    for (const { labels: l, value } of sumBy(beats, 'aipowersalon_redis_reconnects_total', ['role']).values()) role(l.role).reconnects += value;
    for (const [k, v] of quantileBy(beats, 'aipowersalon_redis_command_duration_seconds', ['role'], 0.95)) role(lbl(k).role).latencyP95Ms = ms(v);
    const gauge = (metric: string, set: (x: RedisDashboard['roles'][number], v: number) => void) => { for (const [k, v] of maxBy(beats, metric, ['role'])) set(role(lbl(k).role), v); };
    gauge('aipowersalon_redis_memory_used_bytes', (x, v) => { x.memoryBytes = v; });
    gauge('aipowersalon_redis_memory_utilisation_ratio', (x, v) => { x.memoryRatio = v; });
    gauge('aipowersalon_redis_evicted_keys_total', (x, v) => { x.evictedKeys = v; });
    gauge('aipowersalon_redis_keyspace_hit_ratio', (x, v) => { x.hitRatio = v; });
    gauge('aipowersalon_redis_blocked_clients', (x, v) => { x.blockedClients = v; });
    return { generatedAt: now.toISOString(), live: liveSource(beats), roles: [...roles.values()].sort((a, b) => a.role.localeCompare(b.role)) };
  }

  // §149
  async payments(now = new Date()): Promise<PaymentsDashboard> {
    const db = this.need(); const beats = await this.liveBeats(now);
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const rows = (await sql<any>`select coalesce(processor, 'unknown') processor, lower(status) status, count(*)::int n from payment_attempts where created_at >= ${since} group by 1, 2`.execute(db)).rows;
    const attempts = { total: 0, approved: 0, declined: 0, technicalFailures: 0, canceled: 0, pending: 0, refunded: 0 };
    const proc = new Map<string, PaymentsDashboard['byProcessor'][number]>();
    for (const r of rows) {
      const n = Number(r.n); const cls = ATTEMPT_CLASS[r.status] ?? 'pending';
      attempts.total += n; attempts[cls] += n;
      const p = proc.get(r.processor) ?? { processor: r.processor, total: 0, approved: 0, declined: 0, technicalFailures: 0 };
      p.total += n; if (cls === 'approved' || cls === 'declined' || cls === 'technicalFailures') p[cls] += n; proc.set(r.processor, p);
    }
    const stranded = (await sql<any>`select count(*) filter (where stranded_at is not null and resolved_at is null)::int open,
        count(*) filter (where resolved_at >= ${since} and stranded_at is not null)::int resolved from payment_attempts where stranded_at is not null`.execute(db)).rows[0];
    const pay = (p: string) => PAYMENT_PROVIDERS.test(p);
    return { generatedAt: now.toISOString(), windowHours: 24, live: liveSource(beats), attempts, byProcessor: [...proc.values()].sort((a, b) => b.total - a.total),
      stranded: { open: Number(stranded?.open ?? 0), resolved24h: Number(stranded?.resolved ?? 0) }, providers: providerRows(beats, pay), webhooks: webhookRows(beats, pay) };
  }

  // §150
  async communications(now = new Date()): Promise<CommunicationsDashboard> {
    const db = this.need(); const beats = await this.liveBeats(now);
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const sms = (await sql<any>`select provider, status, count(*)::int n from sms_usage_records where created_at >= ${since} group by 1, 2 order by 1, 2`.execute(db)).rows;
    const sys = (await sql<any>`select status, count(*)::int n from sms_delivery_logs where created_at >= ${since} group by 1 order by 1`.execute(db)).rows;
    const notes = (await sql<any>`select channel, status, count(*)::int n from notification_delivery_logs where created_at >= ${since} group by 1, 2 order by 1, 2`.execute(db)).rows;
    const providers = providerRows(beats, (p) => commsChannel(p) !== null).map((r) => ({ ...r, channel: commsChannel(r.provider)! }));
    return { generatedAt: now.toISOString(), windowHours: 24, live: liveSource(beats),
      sms: sms.map((x: any) => ({ provider: x.provider, status: x.status, count: Number(x.n) })),
      systemSms: sys.map((x: any) => ({ status: x.status, count: Number(x.n) })),
      notifications: notes.map((x: any) => ({ channel: x.channel, status: x.status, count: Number(x.n) })),
      providers, webhooks: webhookRows(beats, (p) => commsChannel(p) !== null) };
  }

  // §155
  async incidents(now = new Date()): Promise<IncidentDashboard> {
    const db = this.need();
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const rows = (await sql<any>`select id, incident_reference, title, status, severity, impact, component_key, affected_tenants, recovery_owner, started_at, detected_at, resolved_at, eta_at, next_milestone
        from status_incidents where resolved_at is null or started_at >= ${since}
        order by (resolved_at is null) desc, case severity when 'critical' then 0 when 'high' then 1 when 'major' then 1 when 'medium' then 2 else 3 end, started_at desc limit 50`.execute(db)).rows;
    const ids = rows.map((r: any) => r.id);
    const events = ids.length ? (await sql<any>`select incident_id, kind, body, actor, created_at from status_incident_events where incident_id in (${sql.join(ids.map((i: string) => sql`${i}`))}) order by created_at asc`.execute(db)).rows : [];
    const byInc = new Map<string, IncidentDashboardRow['timeline']>();
    for (const e of events) { const l = byInc.get(String(e.incident_id)) ?? []; if (l.length < 50) l.push({ at: new Date(e.created_at).toISOString(), kind: e.kind, body: e.body, actor: e.actor ?? null }); byInc.set(String(e.incident_id), l); }
    const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
    const map = (r: any): IncidentDashboardRow => ({ id: String(r.id), reference: r.incident_reference ?? null, title: r.title, status: r.status, severity: r.severity ?? null, impact: r.impact,
      componentKey: r.component_key ?? null, affectedTenants: Number(r.affected_tenants ?? 0), commander: r.recovery_owner ?? null, startedAt: new Date(r.started_at).toISOString(),
      detectedAt: iso(r.detected_at), resolvedAt: iso(r.resolved_at), etaAt: iso(r.eta_at), nextMilestone: r.next_milestone ?? null, timeline: byInc.get(String(r.id)) ?? [] });
    return { generatedAt: now.toISOString(), active: rows.filter((r: any) => !r.resolved_at).map(map), recent: rows.filter((r: any) => r.resolved_at).map(map) };
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/system/dashboards')
export class OpsDashboardsController {
  constructor(private readonly svc: OpsDashboardsService) {}
  @Get('deployments') @RequirePermission('super_admin.system_operations.view') deployments(): Promise<DeploymentDashboard> { return this.svc.deployments(); }
  @Get('storage') @RequirePermission('super_admin.system_operations.view') storage(): Promise<StorageDashboard> { return this.svc.storage(); }
  @Get('mobile') @RequirePermission('super_admin.system_operations.view') mobile(): Promise<MobileDashboard> { return this.svc.mobile(); }
  @Get('redis') @RequirePermission('super_admin.system_operations.view') redis(): Promise<RedisDashboard> { return this.svc.redis(); }
  @Get('payments') @RequirePermission('super_admin.system_operations.view') payments(): Promise<PaymentsDashboard> { return this.svc.payments(); }
  @Get('communications') @RequirePermission('super_admin.system_operations.view') communications(): Promise<CommunicationsDashboard> { return this.svc.communications(); }
  @Get('incidents') @RequirePermission('super_admin.system_operations.view') incidents(): Promise<IncidentDashboard> { return this.svc.incidents(); }
}
