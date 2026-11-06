// health-aggregator.ts — Constitution 11 §295–297, §301, §332–333, §390: the Platform Health Aggregator.
//
// Every 30 s (§297: "15–60 seconds, do not recompute every dashboard render") it reads the signals Phases 4–11 put in
// the metrics registry, plus two it must fetch (a database probe, and the outbox health from Constitution 8 — Phase
// 8's metrics, deliberately here on the aggregator's cadence rather than on a scrape), evaluates each component with
// health-core, applies hysteresis, and writes the result where the status page already reads it.
//
// WINDOWS. Counters in the registry are cumulative. The aggregator keeps the last ten snapshots (5 minutes) and judges
// each component on the DELTA across them — "5% of requests failed in the last five minutes", not "since the process
// started". A process that has just started has a short window, which is correct.
//
// WHAT A HUMAN KEEPS. A component an operator set to MAINTENANCE by hand stays MAINTENANCE; the computed status is
// still recorded in reason_code so the operator can see what the system thinks. Everything else is computed.
//
// FAILURE. An aggregator failure is logged and the tick is skipped — never retried in a loop, never an alert that
// fires an alert (§349). If the aggregator stops altogether, expires_at passes and every reader sees UNKNOWN (§333).
import { ALERT } from '@aipowersalon/super-admin';
import { registry, quantile, type HistogramValue, runTick, jobRunRegistry, allProviderHealth, log as rootLog } from '@aipowersalon/observability';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { syntheticResults, persistedSyntheticResults } from './synthetic-probes';
import { BackupReportsService, evaluateBackups, backupStalenessAlert, BACKUP_STALENESS_KEY, midnightCheckpointAlert, MIDNIGHT_CHECKPOINT_KEY, type BackupSummary } from './backup-reports';
import { AlertNotifier } from './alert-notifier';
import { evaluateIntegrity, lastIntegrityRun } from './integrity-checks';
import { evaluateRealtimeHealth } from '../realtime/realtime-health';
import { ProviderCircuitBreakers } from '@aipowersalon/ai';
import { EventOpsService } from '../events/event-ops.service';
import { desiredAlerts, SEVERITY_RANK, type DesiredAlert } from './alert-rules';
import { SLOS, SLO_COMPONENT, type SloReport } from './slo-core';
import { readAllSlos } from './slo-reader';
import {
  COMPONENTS, evaluateApi, evaluateDatabase, evaluateRedis, evaluateRealtime, evaluateWorkers, evaluateEvents,
  evaluateProviderGroup, evaluateWorkflow, evaluateSynthetic, applyHysteresis, rollup, toStatusPage,
  type Evaluation, type HealthStatus, type HysteresisState,
} from './health-core';
import { runsBackgroundJob } from '@aipowersalon/config';
import { canMoveToSql } from '@aipowersalon/database';
import { STATUS_COMPONENT } from './status-component-lifecycle';

const log = rootLog.withContext({ component: 'health-aggregator' });
export const AGGREGATE_EVERY_MS = 30_000;
const WINDOW = 10;                                  // snapshots kept → 5 minutes at 30 s
export const EXPIRES_AFTER_MS = 3 * AGGREGATE_EVERY_MS;
const PROBE_TIMEOUT_MS = 2_000;
export const SLO_EVERY_TICKS = 10;

/**
 * §106 burn alerts for every SLO that is burning, EXCEPT where the SLO's own health component is already alerting
 * (§104): "checkout is down" and "checkout is burning its error budget" are one incident, not two pages. Page-rate
 * burn is high (P2), ticket-rate burn is medium (P3). Every SLO target is proposed, and the alert says so.
 */
export function sloAlerts(reports: SloReport[], alertingComponents: ReadonlySet<string>): DesiredAlert[] {
  return reports.filter((r) => r.alert && !alertingComponents.has(SLO_COMPONENT[r.id])).map((r) => {
    const comp = COMPONENTS.find((c) => c.key === SLO_COMPONENT[r.id]);   // §177: its component's owner and runbook
    return {
    component: `slo:${r.id}`, severity: r.alert === 'page' ? 'high' as const : 'medium' as const, owner: comp?.owner ?? 'platform', runbook: comp?.runbook ?? 'RUNBOOKS.md#api-outage', causes: [],
    title: `${r.name} is burning its error budget ${r.alert === 'page' ? 'fast' : 'steadily'}`,
    message: `${r.name}: burn rate ${(r.burnRateFast ?? 0).toFixed(1)}x over 1 h, ${(r.burnRateSlow ?? 0).toFixed(1)}x over 6 h against a ${(r.target * 100).toFixed(1)}% target (PROPOSED, not yet validated). ` +
             `Budget remaining: ${r.budgetRemaining === null ? 'unknown' : Math.round(r.budgetRemaining * 100) + '%'}. ` +
             `Owner: ${comp?.owner ?? 'platform'}. Runbook: ${comp?.runbook ?? 'RUNBOOKS.md#api-outage'}`,
    };
  });
}

type Snap = ReturnType<typeof registry.snapshot>;
const PROVIDER_GROUPS: Record<string, readonly string[]> = {
  payments: ['cardpointe', 'fiserv', 'clover'],
  communications: ['twilio', 'email', 'fcm', 'apns'],
};

// ── Window arithmetic over registry snapshots. Pure; exported for tests. ────────────────────────────────────────

export function counterDelta(cur: Snap, old: Snap | undefined, name: string, match: (l: Record<string, string>) => boolean = () => true): number {
  const sum = (s: Snap | undefined) => (s?.[name] ?? []).filter((x) => match(x.labels)).reduce((a, x) => a + (x.value as number), 0);
  return Math.max(0, sum(cur) - sum(old));
}

export function histogramDelta(cur: Snap, old: Snap | undefined, name: string): HistogramValue | null {
  const merge = (s: Snap | undefined): HistogramValue | null => {
    const rows = (s?.[name] ?? []).map((x) => x.value as HistogramValue);
    if (!rows.length) return null;
    const m: HistogramValue = { buckets: rows[0].buckets, counts: rows[0].counts.map(() => 0), sum: 0, count: 0 };
    for (const r of rows) { r.counts.forEach((c, i) => { m.counts[i] += c; }); m.sum += r.sum; m.count += r.count; }
    return m;
  };
  const a = merge(cur); if (!a) return null;
  const b = merge(old); if (!b) return a;
  return { buckets: a.buckets, counts: a.counts.map((c, i) => Math.max(0, c - (b.counts[i] ?? 0))), sum: Math.max(0, a.sum - b.sum), count: Math.max(0, a.count - b.count) };
}

const gauge = (s: Snap, name: string, match: (l: Record<string, string>) => boolean = () => true): number | null => {
  const row = (s[name] ?? []).find((x) => match(x.labels));
  return row ? (row.value as number) : null;
};

/** Every component's evaluation from one window. Pure given its inputs; the class below only gathers them. */
export function evaluateAll(input: {
  cur: Snap; old: Snap | undefined; now: number; dbProbeOk: boolean | null;
  outbox: { oldestPendingAgeSec: number | null; openDeadLetters: number; criticalConsumerLagSec: number | null } | null;
  aiProviders: Array<{ provider: string; status: HealthStatus }>;
  providers: Array<{ provider: string; status: HealthStatus }>;
  jobs: ReturnType<typeof jobRunRegistry>;
  realtimeBackbone: 'in-process' | 'redis';
  synthetic?: ReturnType<typeof syntheticResults>;
  backups?: BackupSummary | null;
}): Record<string, Evaluation> {
  const { cur, old, now } = input;
  const reqs = counterDelta(cur, old, 'aipowersalon_api_requests_total');
  const e5xx = counterDelta(cur, old, 'aipowersalon_api_requests_total', (l) => l.status_class === '5');
  const hist = histogramDelta(cur, old, 'aipowersalon_api_request_duration_seconds');
  const queries = counterDelta(cur, old, 'aipowersalon_db_queries_total'), qErrors = counterDelta(cur, old, 'aipowersalon_db_query_errors_total');
  const redisRoles = (cur['aipowersalon_redis_connection_up'] ?? []).map((x) => ({ role: x.labels.role, up: (x.value as number) === 1 }));
  const rtConnections = gauge(cur, 'aipowersalon_realtime_connections');
  const sli = (workflows: string[]) => {
    const inWf = (l: Record<string, string>) => workflows.includes(l.workflow);
    const total = counterDelta(cur, old, 'aipowersalon_sli_events_total', inWf);
    return { total, systemFailures: counterDelta(cur, old, 'aipowersalon_sli_events_total', (l) => inWf(l) && l.outcome === 'system_failure') };
  };
  const inGroup = (g: string) => input.providers.filter((p) => PROVIDER_GROUPS[g].includes(p.provider));
  return {
    api: evaluateApi({ requests: reqs, serverErrors: e5xx, p95Seconds: hist ? quantile(hist, 0.95) : null }),
    database: evaluateDatabase({
      probeOk: input.dbProbeOk,
      poolUtilisation: gauge(cur, 'aipowersalon_db_pool_utilisation_ratio'),
      waiting: gauge(cur, 'aipowersalon_db_pool_connections', (l) => l.state === 'waiting') ?? 0,
      queryErrorRate: queries + qErrors > 0 ? qErrors / (queries + qErrors) : null,
    }),
    redis: evaluateRedis(redisRoles),
    realtime: rtConnections === null ? { status: 'UNKNOWN', reason: 'not_measured', summary: {} } : evaluateRealtime(evaluateRealtimeHealth({
      activeConnections: rtConnections,
      reconnectsPerMinute: gauge(cur, 'aipowersalon_realtime_reconnects_per_minute') ?? 0,
      authFailuresPerMinute: gauge(cur, 'aipowersalon_realtime_auth_failures_per_minute') ?? 0,
      latencyP95Ms: (() => { const v = gauge(cur, 'aipowersalon_realtime_delivery_latency_seconds', (l) => l.quantile === '0.95'); return v === null ? null : v * 1000; })(),
      eventsPerMinute: gauge(cur, 'aipowersalon_realtime_events_per_minute') ?? 0,
      backbone: input.realtimeBackbone,
      backbonePublishFailures: gauge(cur, 'aipowersalon_realtime_backbone_publish_failures_total') ?? 0,
      slowClientDisconnects: gauge(cur, 'aipowersalon_realtime_slow_client_disconnects_total') ?? 0,
    })),
    // Phase 2: a tick another process owns is a heartbeat here (the scheduler is alive fleet-wide), and the interval the
    // scheduler declares beats the learned one.
    workers: evaluateWorkers(input.jobs.map((j) => ({ jobType: j.jobType, lastStartedAt: Math.max(j.lastStartedAt ?? 0, j.lastHeartbeatAt ?? 0) || null, lastFailedAt: j.lastFailedAt, lastCompletedAt: j.lastCompletedAt, intervalMs: j.declaredIntervalMs ?? j.observedIntervalMs })), now),
    events: evaluateEvents(input.outbox),
    payments: evaluateProviderGroup(inGroup('payments')),
    communications: evaluateProviderGroup(inGroup('communications')),
    ai: evaluateProviderGroup(input.aiProviders),
    booking: evaluateWorkflow(sli(['booking_completion', 'booking_availability', 'phone_verification'])),
    checkout: evaluateWorkflow(sli(['checkout_payment'])),
    synthetic: evaluateSynthetic(input.synthetic ?? []),
    backups: evaluateBackups(input.backups ?? null, now),
    data_integrity: evaluateIntegrity(lastIntegrityRun(), now),
  };
}

@Injectable()
export class HealthAggregator implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly history: Snap[] = [];
  private readonly state = new Map<string, HysteresisState>();
  private readonly persisted = new Map<string, HealthStatus>();
  private ticks = 0;
  private slos: SloReport[] | null = null;
  private latest: { at: number; overall: HealthStatus; components: Record<string, Evaluation & { effective: HealthStatus }> } | null = null;

  constructor(
    @Optional() @Inject(DATABASE) private readonly db: any,
    @Optional() private readonly breakers?: ProviderCircuitBreakers,
    @Optional() private readonly eventOps?: EventOpsService,
    @Optional() private readonly backups?: BackupReportsService,
    @Optional() private readonly notifier?: AlertNotifier,
  ) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void runTick({ jobType: 'health.aggregate', jobClass: 'critical', everyMs: AGGREGATE_EVERY_MS }, () => this.tick()).catch(() => undefined); }, AGGREGATE_EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** The in-process view, for the System Operations API (Phase 16) and tests. */
  current() { return this.latest; }

  async tick(now = Date.now()): Promise<void> {
    const cur = registry.snapshot();
    const backupSummary = await this.backups?.summary(now).catch(() => null) ?? null;
    this.history.push(cur); if (this.history.length > WINDOW) this.history.shift();
    const old = this.history.length > 1 ? this.history[0] : undefined;
    const evals = evaluateAll({
      cur, old, now,
      dbProbeOk: await this.probeDb(),
      outbox: await this.outbox(),
      aiProviders: Object.entries(this.breakers?.snapshot() ?? {}).map(([provider, h]) => ({ provider, status: h.status === 'UNAVAILABLE' ? 'OUTAGE' : h.status as HealthStatus })),
      providers: allProviderHealth(now).map((h) => ({ provider: h.provider, status: h.status })),
      jobs: jobRunRegistry(),
      realtimeBackbone: (process.env.REALTIME_BUS || '').toLowerCase() === 'redis' ? 'redis' : 'in-process',
      // Phase 14 C: the probes may run in another process (the 'standard' class) — then read what they persisted.
      synthetic: syntheticResults().length ? syntheticResults() : await persistedSyntheticResults(this.db, now),
      backups: backupSummary,
    });
    const components: Record<string, Evaluation & { effective: HealthStatus }> = {};
    for (const def of COMPONENTS) {
      const e = evals[def.key]; if (!e) continue;
      const st = applyHysteresis(this.state.get(def.key) ?? null, e.status);
      this.state.set(def.key, st);
      components[def.key] = { ...e, effective: st.current };
    }
    const overall = rollup(COMPONENTS.filter((d) => components[d.key]).map((d) => ({ key: d.key, status: components[d.key].effective, criticality: d.criticality, availability: d.availability })));
    this.latest = { at: now, overall, components };
    await this.persist(components, now);
    const componentAlerts = desiredAlerts(COMPONENTS.filter((d) => components[d.key]).map((d) => ({
      key: d.key, name: d.name, status: components[d.key].effective, reason: components[d.key].reason, criticality: d.criticality, owner: d.owner, runbook: d.runbook,
    })));
    // BUILD_PLAN Phase 14 C: the backup staleness rule pages (P2) and supersedes the `backups` component's own alert (§104).
    const staleBackup = backupStalenessAlert(backupSummary, now);
    const missedMidnight = midnightCheckpointAlert(backupSummary);   // G9 §34: the 12:00 AM America/New_York checkpoint
    await this.reconcileAlerts([...(staleBackup ? [...componentAlerts.filter((a) => a.component !== 'backups'), staleBackup] : componentAlerts), ...(missedMidnight ? [missedMidnight] : [])],
      now, [...COMPONENTS.map((c) => c.key), BACKUP_STALENESS_KEY, MIDNIGHT_CHECKPOINT_KEY]);
    // §106: SLO burn every 5 minutes (every 10th tick) — a 30-day query does not belong on a 30-second cadence.
    if (this.db && this.ticks++ % SLO_EVERY_TICKS === 0) {
      try {
        this.slos = await readAllSlos(this.db, new Date(now));
        await this.reconcileAlerts(sloAlerts(this.slos, new Set(componentAlerts.map((a) => a.component))), now, SLOS.map((s) => `slo:${s.id}`));
      } catch (e) { log.error('slo.read_failed', { error: (e as Error).message }); }
    }
    // §263: after every reconcile, anything that should reach a human does (idempotent; see alert-notifier).
    if (this.notifier) await this.notifier.dispatch(new Date(now));
  }

  /** The latest SLO reports, for the System Operations API (Phase 16). */
  sloReports(): SloReport[] | null { return this.slos; }

  /**
   * §97–106 against the existing alerts table. For every component: one OPEN alert at most, raised when it should
   * exist and none is open, ESCALATED (never downgraded) when it got worse, and RESOLVED when it no longer should
   * exist. The dedupe key names the EPISODE (component + raise time): the table's dedupe_key is unique forever, so a
   * key per component would let the FIRST outage ever raised silence every later one. "One open alert per component"
   * is enforced by the query instead. A reconcile failure is logged and skipped — never an alert about alerts (§349).
   */
  // `managed` is REQUIRED on purpose. It used to default to the component keys, so an SLO pass that forgot to pass
  // its own keys would have resolved every open component alert every five minutes while the outage continued.
  private async reconcileAlerts(desired: DesiredAlert[], now: number, managed: readonly string[]): Promise<void> {
    if (!this.db) return;
    const want = new Map(desired.map((d) => [d.component, d]));
    for (const key of managed) {
      const def = { key };
      const d = want.get(def.key);
      try {
        if (!d) {
          await sql`update alerts set status = 'resolved', resolved_at = ${new Date(now)}, updated_at = ${new Date(now)}
                    where tenant_id is null and related_module = 'system_health' and related_record_id = ${def.key} and status in ('unread', 'read') and ${canMoveToSql(ALERT, 'resolved')}`.execute(this.db);
          continue;
        }
        const inserted = await sql<{ id: string }>`
          insert into alerts (id, tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
          select gen_random_uuid(), null, 'Platform', ${d.title}, ${d.message}, 'system', ${d.severity}, 'unread', 'system_health', ${def.key},
                 ${`system_health:${def.key}:${now}`}
          where not exists (select 1 from alerts where tenant_id is null and related_module = 'system_health' and related_record_id = ${def.key} and status in ('unread', 'read'))
          on conflict (dedupe_key) do nothing
          returning id`.execute(this.db);
        if (inserted.rows.length) { log.warn('alert.raised', { component: def.key, severity: d.severity }); continue; }
        // Already open: escalate if worse (§264). A worse state re-surfaces the alert as unread even if a human had
        // already acknowledged the milder version. Never downgrade — recovery resolves; it does not quietly soften.
        const ranks = Object.entries(SEVERITY_RANK).filter(([, r]) => r < SEVERITY_RANK[d.severity]).map(([k]) => k);
        if (ranks.length) {
          await sql`update alerts set severity = ${d.severity}, title = ${d.title}, message = ${d.message}, status = 'unread', read_at = null, updated_at = ${new Date(now)}
                    where tenant_id is null and related_module = 'system_health' and related_record_id = ${def.key} and status in ('unread', 'read') and ${canMoveToSql(ALERT, 'unread')}
                      and severity in (${sql.join(ranks.map((r) => sql`${r}`))})`.execute(this.db);
        }
      } catch (e) {
        log.error('alert.reconcile_failed', { component: def.key, error: (e as Error).message });
      }
    }
  }

  private async probeDb(): Promise<boolean | null> {
    if (!this.db) return null;
    try {
      await Promise.race([sql`select 1`.execute(this.db), new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), PROBE_TIMEOUT_MS))]);
      return true;
    } catch { return false; }
  }

  private async outbox() {
    if (!this.eventOps) return null;
    try {
      const h: any = await this.eventOps.health();
      const critical = (h.consumers ?? []).filter((c: any) => c.critical).map((c: any) => c.lagSec ?? 0);
      return { oldestPendingAgeSec: h.outbox?.oldestPendingAgeSec ?? null, openDeadLetters: h.deadLetters?.open ?? 0, criticalConsumerLagSec: critical.length ? Math.max(...critical) : null };
    } catch { return null; }
  }

  /** Upsert each component into status_components; append history only when the effective status CHANGES (§390). */
  private async persist(components: Record<string, Evaluation & { effective: HealthStatus }>, now: number): Promise<void> {
    if (!this.db) return;
    const at = new Date(now), expires = new Date(now + EXPIRES_AFTER_MS);
    for (const def of COMPONENTS) {
      const c = components[def.key]; if (!c) continue;
      try {
        await sql`
          insert into status_components (key, name, status, status_source, reason_code, computed_at, expires_at, criticality, runbook, owner_team, status_page_visible, sort_order, updated_at)
          values (${def.key}, ${def.name}, ${toStatusPage(c.effective, def.criticality)}, 'computed', ${c.reason}, ${at}, ${expires},
                  ${def.criticality.toLowerCase()}, ${def.runbook}, ${def.owner}, ${def.statusPageVisible}, ${COMPONENTS.indexOf(def)}, ${at})
          on conflict (key) do update set
            -- A human's MAINTENANCE is never overridden. The computed verdict is still recorded in reason_code.
            status        = case when status_components.status_source = 'manual' and status_components.status = 'maintenance'
                                 then status_components.status else excluded.status end,
            status_source = case when status_components.status_source = 'manual' and status_components.status = 'maintenance'
                                 then 'manual' else 'computed' end,
            reason_code = excluded.reason_code, computed_at = excluded.computed_at, expires_at = excluded.expires_at,
            criticality = excluded.criticality, runbook = excluded.runbook,
            owner_team = coalesce(status_components.owner_team, excluded.owner_team), updated_at = excluded.updated_at
          where ${canMoveToSql(STATUS_COMPONENT, toStatusPage(c.effective, def.criticality), 'status_components')}`.execute(this.db);
        const prev = this.persisted.get(def.key);
        if (prev !== c.effective) {
          await sql`insert into system_health_snapshots (component_key, status, previous, reason_code, summary, observed_at)
                    values (${def.key}, ${c.effective}, ${prev ?? null}, ${c.reason}, ${JSON.stringify(c.summary)}::jsonb, ${at})`.execute(this.db);
          this.persisted.set(def.key, c.effective);
          if (prev !== undefined) log.warn('health.component_changed', { component: def.key, from: prev, to: c.effective, reason: c.reason });
        }
      } catch (e) {
        log.error('health.persist_failed', { component: def.key, error: (e as Error).message });   // skip; never loop (§349)
      }
    }
  }
}
