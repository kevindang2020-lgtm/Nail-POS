// setup-health.repository.ts — Four-Module Completion Guide (Oct 30 2026) HL-01 / HL-02: running the readiness checks,
// storing each run with provenance (health_check_runs / health_check_results, migration 729), deduplicating alerts
// (health_check_alerts), escalating what stays broken, and the nightly per-salon job (durable queue, idempotent per
// salon-local date, staggered, retried by the queue; env-gated scheduler, off by default).
// Nothing here changes billing, registration, payroll or sends a message: it reads, records and raises in-app alerts.
import { systemContext } from '@aipowersalon/tenant-context';
import { sql, type Kysely } from 'kysely';
import { enqueueJob, tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { HEALTH_CHECK_RUN, HEALTH_CHECK_ALERT } from '../lifecycles';
import { runAllChecks, twilioChecks, worstOf, isAlerting, type CheckResult, type CheckCtx, type HealthStatus } from './setup-health-checks';

export interface HealthCtx { tenantId: string; userId?: string; role?: string; permissions?: string[]; branchIds?: string[] | null }
export class SetupHealthError extends Error {
  constructor(message: string, readonly code: 'HEALTH_RUN_RATE_LIMITED' | 'BRANCH_NOT_AUTHORIZED' | 'HEALTH_ALERT_NOT_FOUND' | 'PERMISSION_DENIED' | 'EVIDENCE_INVALID', readonly status: 400 | 403 | 404 | 429 = 400, readonly details?: Record<string, unknown>) {
    super(message); this.name = 'SetupHealthError';
  }
}
export const SETUP_HEALTH_NIGHTLY_JOB = 'setup_health.nightly';
export const MANUAL_RUN_MIN_INTERVAL_MS = 60_000;
export const ESCALATE_AFTER_MS = 48 * 3600 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | Date).toISOString());
const N = (v: unknown) => Number(v ?? 0) || 0;
const fp = (r: { key: string; branchId: string | null }) => `${r.key}:${r.branchId ?? 'all'}`;
export const appVersion = () => process.env.APP_VERSION || 'v2.4.1';

export class SetupHealthRepository {
  constructor(readonly db: Kysely<any>, private readonly env: Record<string, string | undefined> = process.env, private readonly clock: () => Date = () => new Date()) {}

  /** the salon's branches this user may see (owner / tenant scope = all; otherwise the session's branch list) */
  async authorizedBranches(ctx: HealthCtx): Promise<{ id: string; name: string }[]> {
    const all = (await sql<any>`select id, name from branches where tenant_id = ${ctx.tenantId} and coalesce(status, 'active') <> 'archived' order by name, id`.execute(this.db)).rows
      .map((r: any) => ({ id: String(r.id), name: String(r.name ?? '') }));
    if (ctx.branchIds == null) return all;   // the session's authorized branches: null = every branch (owners and salon-wide roles)
    const allow = new Set(ctx.branchIds); return all.filter((b) => allow.has(b.id));
  }
  private async scope(ctx: HealthCtx, branchId?: string | null) {
    const branches = await this.authorizedBranches(ctx);
    if (branchId && !branches.some((b) => b.id === branchId)) throw new SetupHealthError('You cannot view that branch.', 'BRANCH_NOT_AUTHORIZED', 403);
    return { branches, branchId: branchId || null };
  }

  /** run every check for the salon (tenant-wide + each branch's own messaging scope) and store it with provenance */
  async run(ctx: HealthCtx, trigger: 'manual' | 'nightly', runDate?: string): Promise<{ runId: string; duplicate: boolean }> {
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => 'America/New_York');
    const date = runDate ?? String((await sql<any>`select (now() at time zone ${tz})::date::text as d`.execute(this.db)).rows[0].d);
    let runId: string;
    if (trigger === 'manual') {
      const last = (await sql<any>`select started_at from health_check_runs where tenant_id = ${ctx.tenantId} and trigger_kind = 'manual' order by started_at desc limit 1`.execute(this.db)).rows[0];
      if (last && Date.now() - new Date(last.started_at).getTime() < MANUAL_RUN_MIN_INTERVAL_MS) throw new SetupHealthError('A health check ran a moment ago. Try again in a minute.', 'HEALTH_RUN_RATE_LIMITED', 429);
      runId = String((await sql<any>`insert into health_check_runs (tenant_id, trigger_kind, run_date, requested_by_user_id) values (${ctx.tenantId}, 'manual', ${date}::date, ${UUID.test(ctx.userId ?? '') ? ctx.userId : null}) returning id`.execute(this.db)).rows[0].id);
    } else {
      // one nightly run per salon-local date: a rerun of a SUCCEEDED night is a no-op; a FAILED night may be retried in place
      const ins = await sql<any>`insert into health_check_runs (tenant_id, trigger_kind, run_date) values (${ctx.tenantId}, 'nightly', ${date}::date)
        on conflict (tenant_id, run_date) where trigger_kind = 'nightly' do nothing returning id`.execute(this.db);
      if (!ins.rows.length) {
        const prev = (await sql<any>`select id, status from health_check_runs where tenant_id = ${ctx.tenantId} and trigger_kind = 'nightly' and run_date = ${date}::date`.execute(this.db)).rows[0];
        if (prev.status !== 'failed') return { runId: String(prev.id), duplicate: true };
        await sql`delete from health_check_results where run_id = ${prev.id}`.execute(this.db);
        const retried = await sql<any>`update health_check_runs r set status = 'running', error = null, started_at = now(), finished_at = null
          where r.tenant_id = ${ctx.tenantId} and r.id = ${prev.id} and ${canMoveToSql(HEALTH_CHECK_RUN, 'running', 'r')} returning r.id`.execute(this.db);
        if (!retried.rows.length) return { runId: String(prev.id), duplicate: true };   // another worker retried it first
        runId = String(prev.id);
      } else runId = String(ins.rows[0].id);
    }
    try {
      const branches = (await sql<any>`select id from branches where tenant_id = ${ctx.tenantId} and coalesce(status, 'active') <> 'archived'`.execute(this.db)).rows.map((r: any) => String(r.id));
      const c: CheckCtx = { tenantId: ctx.tenantId, branchId: null, branchIds: branches, now: this.clock(), appVersion: appVersion(), env: this.env };
      const results: CheckResult[] = await runAllChecks(this.db, c);
      const overrides = (await sql<any>`select distinct branch_id from tenant_messaging_credentials where tenant_id = ${ctx.tenantId} and branch_id is not null and offboarded_at is null`.execute(this.db)).rows.map((r: any) => String(r.branch_id));
      for (const b of overrides) results.push(...(await twilioChecks(this.db, { ...c, branchId: b })));
      await this.store(ctx.tenantId, runId, results);
      const alerts = await this.syncAlerts(ctx.tenantId, runId, results);
      const counts = Object.fromEntries(['ready', 'warning', 'action_required', 'pending_external', 'unknown', 'disabled', 'error'].map((s) => [s, results.filter((r) => r.status === s).length]));
      const done = await sql<any>`update health_check_runs r set status = 'succeeded', finished_at = now(), summary_json = ${JSON.stringify({ counts, overall: worstOf(results.map((x) => x.status)), alerts })}::jsonb
        where r.tenant_id = ${ctx.tenantId} and r.id = ${runId} and ${canMoveToSql(HEALTH_CHECK_RUN, 'succeeded', 'r')} returning r.id`.execute(this.db);
      if (!done.rows.length) throw new Error(`setup-health run ${runId} was no longer running when it finished`);
      return { runId, duplicate: false };
    } catch (e) {
      await sql`update health_check_runs r set status = 'failed', finished_at = now(), error = ${String((e as Error)?.message ?? e).slice(0, 300)}
        where r.tenant_id = ${ctx.tenantId} and r.id = ${runId} and ${canMoveToSql(HEALTH_CHECK_RUN, 'failed', 'r')}`.execute(this.db);
      throw e;
    }
  }
  private async store(tenantId: string, runId: string, results: CheckResult[]) {
    for (const r of results) {
      const lastGood = (await sql<any>`select max(coalesce(verified_at, created_at)) as at from health_check_results where tenant_id = ${tenantId} and check_key = ${r.key}
        and branch_id is not distinct from ${r.branchId}::uuid and status = 'ready'`.execute(this.db)).rows[0]?.at;
      await sql`insert into health_check_results (run_id, tenant_id, branch_id, area, check_key, status, severity, source, verified_at, expires_at, last_good_at, detail_json)
        values (${runId}, ${tenantId}, ${r.branchId}, ${r.area}, ${r.key}, ${r.status}, ${r.severity}, ${r.source}, ${r.verifiedAt}, ${r.expiresAt},
          ${r.status === 'ready' ? r.verifiedAt ?? new Date().toISOString() : iso(lastGood)}, ${JSON.stringify({ ...r.detail, action: r.action })}::jsonb)`.execute(this.db);
    }
  }
  /** one alert per salon × check × branch: opened / refreshed while failing, resolved when it passes, escalated once when a
   *  high or critical issue stays open past ESCALATE_AFTER_MS. Unchanged state never creates a second alert. */
  private async syncAlerts(tenantId: string, runId: string, results: CheckResult[]) {
    let opened = 0, refreshed = 0, resolved = 0, escalated = 0;
    for (const r of results) {
      const f = fp(r);
      if (isAlerting(r)) {
        const up = await sql<any>`insert into health_check_alerts (tenant_id, branch_id, check_key, fingerprint, severity, last_status, last_run_id)
          values (${tenantId}, ${r.branchId}, ${r.key}, ${f}, ${r.severity}, ${r.status}, ${runId})
          on conflict (tenant_id, fingerprint) do update set status = 'open', severity = excluded.severity, last_status = excluded.last_status, last_seen_at = now(),
            occurrences = health_check_alerts.occurrences + 1, last_run_id = excluded.last_run_id,
            resolved_at = null, acknowledged_at = case when health_check_alerts.status = 'resolved' then null else health_check_alerts.acknowledged_at end,
            first_seen_at = case when health_check_alerts.status = 'resolved' then now() else health_check_alerts.first_seen_at end,
            escalated_at = case when health_check_alerts.status = 'resolved' then null else health_check_alerts.escalated_at end
          where ${canMoveToSql(HEALTH_CHECK_ALERT, 'open', 'health_check_alerts')}
          returning (xmax = 0) as inserted`.execute(this.db);
        if (up.rows[0]?.inserted) opened++; else refreshed++;
      } else {
        const res = await sql<any>`update health_check_alerts a set status = 'resolved', resolved_at = now(), last_status = ${r.status}, last_run_id = ${runId}
          where a.tenant_id = ${tenantId} and a.fingerprint = ${f} and a.status = 'open' and ${canMoveToSql(HEALTH_CHECK_ALERT, 'resolved', 'a')} returning a.id`.execute(this.db);
        resolved += res.rows.length;
      }
    }
    const esc = await sql<any>`update health_check_alerts set escalated_at = now() where tenant_id = ${tenantId} and status = 'open' and escalated_at is null
      and severity in ('high', 'critical') and first_seen_at < ${new Date(Date.now() - ESCALATE_AFTER_MS)} returning id`.execute(this.db);
    escalated = esc.rows.length;
    return { opened, refreshed, resolved, escalated };
  }

  /** the dashboard: the latest run (any trigger) for the chosen scope, its freshness, open alerts, recent runs */
  async summary(ctx: HealthCtx, f: { branchId?: string | null }) {
    const { branches, branchId } = await this.scope(ctx, f.branchId);
    const run = (await sql<any>`select id, trigger_kind, to_char(run_date, 'YYYY-MM-DD') as run_date, status, started_at, finished_at, summary_json, error from health_check_runs
      where tenant_id = ${ctx.tenantId} order by started_at desc limit 1`.execute(this.db)).rows[0];
    const lastNightly = (await sql<any>`select status, to_char(run_date, 'YYYY-MM-DD') as run_date, finished_at, error from health_check_runs where tenant_id = ${ctx.tenantId} and trigger_kind = 'nightly' order by health_check_runs.run_date desc limit 1`.execute(this.db)).rows[0];
    const allow = branches.map((b) => b.id);
    const rows = run ? (await sql<any>`select area, check_key, branch_id, status, severity, source, verified_at, expires_at, last_good_at, detail_json from health_check_results
      where run_id = ${run.id} and tenant_id = ${ctx.tenantId} and (branch_id is null or branch_id = any(${allow}::uuid[]))
        and (${branchId}::uuid is null or branch_id is null or branch_id = ${branchId}::uuid) order by area, check_key, branch_id nulls first`.execute(this.db)).rows : [];
    const tech = (ctx.permissions ?? []).includes('settings.edit');
    const names = new Map(branches.map((b) => [b.id, b.name]));
    const now = Date.now();
    const checks = rows.map((r: any) => {
      const d = typeof r.detail_json === 'string' ? JSON.parse(r.detail_json) : r.detail_json || {};
      const expired = r.expires_at && new Date(r.expires_at).getTime() < now && r.status === 'ready';
      const { action, ...detail } = d;
      return { key: String(r.check_key), area: String(r.area), branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_id ? names.get(String(r.branch_id)) ?? null : null,
        // a stored Ready past its expiry is shown as Unknown (stale), never green
        status: (expired ? 'unknown' : String(r.status)) as HealthStatus, stale: !!expired, severity: String(r.severity), code: String(detail.code ?? ''),
        verifiedAt: iso(r.verified_at), expiresAt: iso(r.expires_at), lastGoodAt: iso(r.last_good_at), action: action ?? null,
        technical: tech ? { source: String(r.source), detail } : null };
    });
    const alerts = (await sql<any>`select id, check_key, branch_id, severity, last_status, occurrences, first_seen_at, last_seen_at, escalated_at, acknowledged_at from health_check_alerts
      where tenant_id = ${ctx.tenantId} and status = 'open' and (branch_id is null or branch_id = any(${allow}::uuid[])) order by escalated_at desc nulls last, severity, last_seen_at desc limit 50`.execute(this.db)).rows;
    const counts = Object.fromEntries(['ready', 'warning', 'action_required', 'pending_external', 'unknown', 'disabled', 'error'].map((s) => [s, checks.filter((c) => c.status === s).length]));
    return {
      branches, branchId, canRun: (ctx.permissions ?? []).includes('settings.edit'), technical: tech,
      run: run ? { id: String(run.id), trigger: String(run.trigger_kind), runDate: String(run.run_date).slice(0, 10), status: String(run.status), startedAt: iso(run.started_at), finishedAt: iso(run.finished_at),
        stale: now - new Date(run.started_at).getTime() > 26 * 3600 * 1000 } : null,
      nightly: lastNightly ? { status: String(lastNightly.status), runDate: String(lastNightly.run_date).slice(0, 10), finishedAt: iso(lastNightly.finished_at), failed: lastNightly.status === 'failed' } : null,
      overall: checks.length ? worstOf(checks.map((c) => c.status)) : 'unknown', counts, checks,
      alerts: alerts.map((a: any) => ({ id: String(a.id), key: String(a.check_key), branchId: a.branch_id ? String(a.branch_id) : null, severity: String(a.severity), status: String(a.last_status),
        occurrences: N(a.occurrences), firstSeenAt: iso(a.first_seen_at), lastSeenAt: iso(a.last_seen_at), escalatedAt: iso(a.escalated_at), acknowledgedAt: iso(a.acknowledged_at) })),
    };
  }
  async runs(ctx: HealthCtx, f: { page?: unknown; pageSize?: unknown }) {
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10));
    const total = N((await sql<any>`select count(*)::int as n from health_check_runs where tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(Math.max(1, Math.trunc(Number(f.page)) || 1), totalPages);
    const rows = (await sql<any>`select id, trigger_kind, to_char(run_date, 'YYYY-MM-DD') as run_date, status, started_at, finished_at, summary_json, error from health_check_runs where tenant_id = ${ctx.tenantId}
      order by started_at desc, id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => { const s = typeof r.summary_json === 'string' ? JSON.parse(r.summary_json) : r.summary_json || {};
      return { id: String(r.id), trigger: String(r.trigger_kind), runDate: String(r.run_date).slice(0, 10), status: String(r.status), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
        overall: s.overall ?? null, counts: s.counts ?? {}, alerts: s.alerts ?? null, error: r.status === 'failed' ? 'run_failed' : null }; }), page, pageSize, totalItems: total, totalPages };
  }
  async acknowledge(ctx: HealthCtx, id: string) {
    if (!UUID.test(id)) throw new SetupHealthError('Alert not found.', 'HEALTH_ALERT_NOT_FOUND', 404);
    const r = await sql<any>`update health_check_alerts set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by_user_id = coalesce(acknowledged_by_user_id, ${UUID.test(ctx.userId ?? '') ? ctx.userId : null})
      where tenant_id = ${ctx.tenantId} and id = ${id} returning id`.execute(this.db);
    if (!r.rows.length) throw new SetupHealthError('Alert not found.', 'HEALTH_ALERT_NOT_FOUND', 404);
    return { ok: true as const };
  }
  /** open high / critical alerts (the sidebar badge) */
  async openCriticalCount(tenantId: string): Promise<number> {
    return N((await sql<any>`select count(*)::int as n from health_check_alerts where tenant_id = ${tenantId} and status = 'open' and severity in ('high', 'critical') and acknowledged_at is null`.execute(this.db)).rows[0]?.n);
  }

  // ── nightly (HL-02) ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** enqueue one job per active salon whose local time is in the nightly hour; staggered by a stable per-salon minute */
  async scheduleNightly(now = new Date(), hour = 3): Promise<{ enqueued: number; duplicates: number }> {
    const due = (await sql<any>`select t.id, coalesce((select b.timezone from branches b where b.tenant_id = t.id and b.timezone is not null order by b.created_at limit 1), 'America/New_York') as tz
      from tenants t where t.status = 'active'`.execute(this.db)).rows;
    let enqueued = 0, duplicates = 0;
    for (const t of due) {
      const local = (await sql<any>`select extract(hour from ${now}::timestamptz at time zone ${t.tz})::int as h, (${now}::timestamptz at time zone ${t.tz})::date::text as d`.execute(this.db)).rows[0];
      if (N(local.h) !== hour) continue;
      const minute = parseInt(String(t.id).replace(/-/g, '').slice(0, 6), 16) % 50;   // spread salons over the hour
      const r = await enqueueJob(this.db, { jobClass: 'standard', jobType: SETUP_HEALTH_NIGHTLY_JOB, tenantId: String(t.id), payload: { tenantId: String(t.id), runDate: String(local.d) },
        idempotencyKey: `setup-health:${t.id}:${local.d}`, runAfter: new Date(now.getTime() + minute * 60_000), maxAttempts: 4, createdBy: 'setup-health-scheduler' });
      if (r.duplicate) duplicates++; else enqueued++;
    }
    return { enqueued, duplicates };
  }
  /** the job body: one nightly run; two consecutive failed nights raise a critical alert of their own */
  async runNightlyJob(payload: Record<string, unknown>) {
    const tenantId = String(payload.tenantId ?? ''); const runDate = String(payload.runDate ?? '');
    if (!UUID.test(tenantId) || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error('bad setup-health payload');
    try { return await this.run({ tenantId, role: systemContext({ tenantId, actor: 'setup-health-nightly' }).role, branchIds: null, permissions: [] }, 'nightly', runDate); }
    catch (e) {
      const failed = N((await sql<any>`select count(*)::int as n from (select status from health_check_runs where tenant_id = ${tenantId} and trigger_kind = 'nightly' order by run_date desc limit 2) x where x.status = 'failed'`.execute(this.db)).rows[0]?.n);
      if (failed >= 2) await sql`insert into health_check_alerts (tenant_id, check_key, fingerprint, severity, last_status) values (${tenantId}, 'health.nightly_failed', 'health.nightly_failed:all', 'critical', 'error')
        on conflict (tenant_id, fingerprint) do update set status = 'open', last_seen_at = now(), occurrences = health_check_alerts.occurrences + 1, resolved_at = null
          where ${canMoveToSql(HEALTH_CHECK_ALERT, 'open', 'health_check_alerts')}`.execute(this.db);
      throw e;   // the queue retries with backoff, then dead-letters (visible on the next run's jobs.queue check)
    }
  }

  // ── release evidence (QA-01..04): recorded by the platform, shown to the salon ─────────────────────────────────────────
  async recordEvidence(actor: { userId?: string }, b: { kind?: unknown; appVersion?: unknown; commitSha?: unknown; reference?: unknown; outcome?: unknown; summary?: unknown }) {
    const kinds = ['ci_run', 'staging_run', 'migration_apply', 'screen_test', 'device_test'], outs = ['passed', 'failed', 'partial'];
    if (!kinds.includes(String(b.kind)) || !outs.includes(String(b.outcome)) || typeof b.appVersion !== 'string' || !b.appVersion.trim()) throw new SetupHealthError('kind, appVersion and outcome are required.', 'EVIDENCE_INVALID');
    const ref = typeof b.reference === 'string' ? b.reference.trim().slice(0, 300) : null;
    if (!ref) throw new SetupHealthError('A run reference (CI run id / URL / report path) is required — evidence without a reference is not evidence.', 'EVIDENCE_INVALID');
    const r = await sql<any>`insert into release_evidence (kind, app_version, commit_sha, reference, outcome, summary, recorded_by_user_id)
      values (${String(b.kind)}, ${b.appVersion.trim()}, ${typeof b.commitSha === 'string' ? b.commitSha.slice(0, 64) : null}, ${ref}, ${String(b.outcome)}, ${typeof b.summary === 'string' ? b.summary.slice(0, 2000) : null},
        ${UUID.test(actor.userId ?? '') ? actor.userId : null}) returning id`.execute(this.db);
    return { id: String(r.rows[0].id) };
  }
  async listEvidence(f: { appVersion?: string }) {
    const rows = (await sql<any>`select id, kind, app_version, commit_sha, reference, outcome, summary, recorded_at from release_evidence
      where (${f.appVersion ?? null}::text is null or app_version = ${f.appVersion ?? null}) order by recorded_at desc limit 100`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ id: String(r.id), kind: String(r.kind), appVersion: String(r.app_version), commitSha: r.commit_sha ?? null, reference: r.reference ?? null, outcome: String(r.outcome), summary: r.summary ?? null, recordedAt: iso(r.recorded_at) })) };
  }
}
