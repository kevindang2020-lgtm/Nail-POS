// team-data-nightly.ts — TM-07 (Four-Module Completion Guide §10.2 + §14 item 2, 30 Oct 2026): the nightly per-tenant
// Team data-accuracy scan on the ONE durable job queue (packages/database job-queue.ts). Run Check stays as it is.
//
//   schedule    env-gated in-process scheduler (TEAM_DATA_NIGHTLY_ENABLED, off by default so dev / test / CI never scan),
//               hourly tick, in a process that runs 'report' jobs. For every active salon whose LOCAL time has reached
//               TEAM_DATA_NIGHTLY_LOCAL_HOUR (default 2 → 02:00 salon time) it enqueues `team.data_check.nightly` with the
//               idempotency key `<tenant>:<salon-local date>` — one job per salon per day, however many ticks / processes
//   stagger     run_after = now + a stable per-tenant offset (0–15 min) so salons do not all scan at once
//   retries     the queue's exponential backoff with jitter (max 4 attempts); a reaped lease re-runs safely
//   idempotent  the handler claims team_data_nightly_runs (tenant, run_date): a date that already SUCCEEDED returns
//               'already_done' without scanning again; findings dedupe on their fingerprint (only last_seen_at,
//               seen_count and last_run_id move)
//   records     team_data_nightly_runs (status, attempts, last error code, the scan run id, summary) +
//               team_data_alert_runs (run_trigger 'nightly') + an audit row per scan
//   escalation  a date that failed 3 attempts, or 2 consecutive failed dates, raises ONE in-app DATA_CHECK_JOB_FAILED
//               alert (high, fingerprint per failure streak — deduped, never re-sent for an unchanged state) in the same
//               Data Accuracy Alerts list authorized staff already review; no SMS / e-mail is sent
//   never       changes payroll, a commission, attendance, a booking, access or a staff status. The only write beyond the
//               alert / run records is the training sweep marking completions whose validity has passed as expired.
import { systemContext } from '@aipowersalon/tenant-context';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, tenantTimeZone, canMoveToSql } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { withCode } from '@aipowersalon/api-contracts';
import { TeamDataAlertsRepository, type ScanOptions } from '../team-screens/team-data-alerts.repository';
import { logGap, type TeamCtx } from '../team-screens/screen-kit';
import { TeamTrainingRepository } from './team-training.repository';
import { TEAM_DATA_NIGHTLY_RUN } from '../workforce-lifecycles';

export const TEAM_DATA_NIGHTLY_JOB = 'team.data_check.nightly';
export const NIGHTLY_MAX_ATTEMPTS = 4;
export const ESCALATE_AFTER_ATTEMPTS = 3;
export const ESCALATE_AFTER_DAYS = 2;
const TICK_MS = 60 * 60 * 1000;
const STAGGER_S = 15 * 60;
const UUIDR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function teamDataNightlyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.TEAM_DATA_NIGHTLY_ENABLED ?? '').trim().toLowerCase());
}
export function nightlyLocalHour(env: NodeJS.ProcessEnv = process.env): number {
  const h = Math.trunc(Number(env.TEAM_DATA_NIGHTLY_LOCAL_HOUR)); return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 2;
}
/** a stable 0–15 min offset per salon */
export function staggerSeconds(tenantId: string): number { return parseInt(createHash('sha256').update(tenantId).digest('hex').slice(0, 8), 16) % STAGGER_S; }
/** the system context a nightly scan runs in: the whole salon (no branch), no human actor */
// §72: the job's context comes from systemContext(); userId stays '' (no person — actorOf() stamps NULL, audits name no user)
export const systemCtx = (tenantId: string): TeamCtx => { const s = systemContext({ tenantId, actor: 'team-data-nightly' }); return { tenantId: s.tenantId, branchId: '', userId: '', role: s.role, permissions: [] }; };

export interface NightlyDeps { scan?: (ctx: TeamCtx, requestId: string, opts: ScanOptions) => Promise<any>; jobId?: string | null }

/** the job handler: one tenant, one salon-local date. Throws on failure so the queue retries with backoff. */
export async function runTeamDataNightly(db: Kysely<any>, payload: Record<string, unknown>, deps: NightlyDeps = {}): Promise<{ outcome: string; runId?: string }> {
  const tenantId = String(payload.tenantId ?? ''); const runDate = String(payload.runDate ?? '');
  if (!UUIDR.test(tenantId) || !YMD.test(runDate)) throw withCode(new PermanentJobError('bad team nightly payload'), 'VALIDATION_FAILED');
  const alerts = new TeamDataAlertsRepository(db); const training = new TeamTrainingRepository(db);
  const scan = deps.scan ?? ((c, r, o) => alerts.scan(c, r, o));
  const claim = (await sql<any>`insert into team_data_nightly_runs (tenant_id, run_date, status, attempts, job_id) values (${tenantId}, ${runDate}::date, 'running', 1, ${deps.jobId ?? null}::uuid)
    on conflict (tenant_id, run_date) do update set status = 'running', attempts = team_data_nightly_runs.attempts + 1, job_id = coalesce(excluded.job_id, team_data_nightly_runs.job_id), started_at = now(), updated_at = now()
      where team_data_nightly_runs.tenant_id = ${tenantId} and ${canMoveToSql(TEAM_DATA_NIGHTLY_RUN, 'running', 'team_data_nightly_runs')}
    returning id, attempts`.execute(db)).rows[0];
  if (!claim) return { outcome: 'already_done' };
  const ctx = systemCtx(tenantId); const requestId = `nightly:${runDate}:${String(claim.id).slice(0, 8)}`;
  try {
    const r = await scan(ctx, requestId, { trigger: 'nightly', runDate });
    const expired = await training.expireDue(ctx, requestId);
    const summary = { detected: r?.detected ?? 0, alreadyKnown: r?.alreadyKnown ?? 0, byType: r?.byType ?? {}, trainingExpired: expired };
    await sql`update team_data_nightly_runs n set status = 'succeeded', alert_run_id = ${r?.runId ?? null}::uuid, last_error = null, summary_json = ${JSON.stringify(summary)}::jsonb, finished_at = now(), updated_at = now()
      where n.tenant_id = ${tenantId} and n.id = ${claim.id} and ${canMoveToSql(TEAM_DATA_NIGHTLY_RUN, 'succeeded', 'n')}`.execute(db);
    return { outcome: 'succeeded', runId: r?.runId };
  } catch (e: any) {
    const code = String(e?.code ?? e?.name ?? 'SCAN_FAILED').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'SCAN_FAILED';
    await sql`update team_data_nightly_runs n set status = 'failed', last_error = ${code}, finished_at = now(), updated_at = now() where n.tenant_id = ${tenantId} and n.id = ${claim.id} and ${canMoveToSql(TEAM_DATA_NIGHTLY_RUN, 'failed', 'n')}`.execute(db)
      .catch(logGap('team_nightly_failure_not_recorded'));
    await escalateIfRepeated(db, alerts, tenantId, requestId).catch(logGap('team_nightly_escalation_failed'));
    throw e;
  }
}

/** ESCALATE_AFTER_ATTEMPTS failed attempts on one date, or ESCALATE_AFTER_DAYS consecutive failed dates → one alert per streak */
export async function escalateIfRepeated(db: Kysely<any>, alerts: TeamDataAlertsRepository, tenantId: string, requestId: string): Promise<boolean> {
  const recent = (await sql<any>`select n.id, to_char(n.run_date, 'YYYY-MM-DD') as d, n.status, n.attempts, n.last_error, n.escalated_at from team_data_nightly_runs n
    where n.tenant_id = ${tenantId} order by n.run_date desc limit 14`.execute(db)).rows;
  const streak: any[] = []; for (const r of recent) { if (r.status !== 'failed') break; streak.push(r); }
  if (!streak.length) return false;
  const head = streak[0];
  if (!(streak.length >= ESCALATE_AFTER_DAYS || Number(head.attempts) >= ESCALATE_AFTER_ATTEMPTS)) return false;
  const since = streak[streak.length - 1].d;
  await alerts.upsert(systemCtx(tenantId), { type: 'DATA_CHECK_JOB_FAILED', fingerprint: `DATA_CHECK_JOB_FAILED|${since}`, severity: 'high', userId: null, technicianId: null, date: head.d,
    evidence: { failingSince: since, failedDates: streak.map((s) => s.d), attemptsOnLatest: Number(head.attempts), lastError: head.last_error ?? null, thresholdAttempts: ESCALATE_AFTER_ATTEMPTS, thresholdDays: ESCALATE_AFTER_DAYS } },
    null, requestId);
  await sql`update team_data_nightly_runs n set escalated_at = coalesce(n.escalated_at, now()), updated_at = now() where n.tenant_id = ${tenantId} and n.id = ${head.id}`.execute(db);
  return true;
}

/** one scheduler tick: enqueue today's job for every active salon past its local hour (idempotent per salon-local date) */
export async function enqueueDueNightly(db: Kysely<any>, opts: { hour?: number; nowMs?: number; limit?: number } = {}): Promise<{ checked: number; enqueued: number; duplicates: number }> {
  const hour = opts.hour ?? nightlyLocalHour(); const now = opts.nowMs ?? Date.now();
  const tenants = (await sql<any>`select t.id from tenants t where coalesce(t.status, 'active') = 'active' order by t.id limit ${Math.max(1, Math.min(5000, opts.limit ?? 2000))}`.execute(db)).rows;
  let enqueued = 0, duplicates = 0;
  for (const t of tenants) {
    const tenantId = String(t.id); const tz = await tenantTimeZone(db, tenantId);
    const local = (await sql<any>`select to_char((to_timestamp(${now / 1000}) at time zone ${tz})::date, 'YYYY-MM-DD') as d, extract(hour from to_timestamp(${now / 1000}) at time zone ${tz})::int as h`.execute(db)).rows[0];
    if (Number(local.h) < hour) continue;
    const done = (await sql<any>`select 1 as x from team_data_nightly_runs n where n.tenant_id = ${tenantId} and n.run_date = ${local.d}::date and n.status = 'succeeded'`.execute(db)).rows[0];
    if (done) continue;
    const r = await enqueueJob(db, { jobClass: 'report', jobType: TEAM_DATA_NIGHTLY_JOB, tenantId, payload: { tenantId, runDate: local.d }, idempotencyKey: `${tenantId}:${local.d}`,
      runAfter: new Date(now + staggerSeconds(tenantId) * 1000), maxAttempts: NIGHTLY_MAX_ATTEMPTS, priority: 3, createdBy: 'team-data-nightly' });
    if (r.duplicate) duplicates++; else enqueued++;
  }
  return { checked: tenants.length, enqueued, duplicates };
}

@Injectable()
export class TeamDataNightlyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TeamDataNightly');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Optional() @Inject(DATABASE) private readonly db?: Kysely<any> | null) {}
  onModuleInit(): void {
    if (!this.db) return;
    const db = this.db;
    // the handler is registered wherever the module loads, so any worker that claims 'report' jobs can run it
    if (!jobHandlerFor(TEAM_DATA_NIGHTLY_JOB)) registerJobHandler(TEAM_DATA_NIGHTLY_JOB, (payload, jc) => runTeamDataNightly(db, payload, { jobId: jc?.jobId ?? null }));
    if (!runsBackgroundJob('report') || !teamDataNightlyEnabled()) return;
    const tick = () => runTick({ jobType: 'team.data_check.schedule', jobClass: 'report', everyMs: TICK_MS }, () => this.tick());
    void tick().catch(logGap('team_nightly_tick_failed'));
    this.timer = setInterval(() => { void tick().catch(logGap('team_nightly_tick_failed')); }, TICK_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log(`Team data nightly check armed (salon-local ${nightlyLocalHour()}:00, hourly tick).`);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(): Promise<void> {
    if (this.running || !this.db) return;
    this.running = true;
    try { const r = await enqueueDueNightly(this.db); if (r.enqueued) this.log.log(`Team nightly: ${r.enqueued} salon(s) queued.`); }
    finally { this.running = false; }
  }
}
