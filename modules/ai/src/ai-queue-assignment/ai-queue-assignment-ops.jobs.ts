// ai-queue-assignment-ops.jobs.ts — BUILD_PLAN Phase 6: the AI queue background work, on the platform's ONE job queue
// (Phase 2: jobs table, registerJobHandler, the worker loop; runTick for single-owner scheduling).
//
// Every minute ONE process (runTick lease) runs the dispatcher. CROSS-TENANT BY DESIGN: it is a platform sweep that
// finds the branches with work and enqueues one job PER BRANCH, carrying that branch's own tenant (the worker's per-tenant
// cap keeps one salon from starving the rest — tenant-partitioned):
//   ai.queue_assignment.scan      branches with an open queue OR an unresolved alert (so alerts still auto-resolve after
//                                 the last guest leaves): detection + raise / auto-resolve + notifications; stamps
//                                 queue_assignment_settings.last_scan_at
//   ai.queue_assignment.auto_run  branches with a waiting guest whose effective auto switch is on and NOT blocked (platform
//                                 'ai.auto_actions_disabled', the salon kill switch): QueueAssignmentService.runAutoAssignment
//                                 (ctx, { system: true }) — agent B's auto-run with every one of its own safeguards;
//                                 stamps last_auto_run_at
// Never for a salon that is not active (suspended / cancelled / pending) or does not have the AI package: filtered when
// enqueued AND checked again when the job runs (the salon may have been suspended in between). One job per branch per
// minute (idempotency key), so a slow worker never piles them up.
import { Injectable, Logger, Inject, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import type { QueueAssignmentSettingsPort } from './ai-queue-assignment-settings';
import { QUEUE_ASSIGNMENT_SETTINGS } from './ai-queue-assignment.tokens';
import { QueueAlertService } from './ai-queue-assignment-alerts.service';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { queueOpsSystemContext } from './ai-queue-assignment-ops.ports';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

export const QUEUE_OPS_JOB = { scan: 'ai.queue_assignment.scan', autoRun: 'ai.queue_assignment.auto_run' } as const;
const TICK_MS = 60_000;
const PACKAGE = 'ai_queue_technician_assignment';
const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** On unless AI_QUEUE_OPS_JOBS is explicitly off. */
export function queueOpsJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.AI_QUEUE_OPS_JOBS ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

/** The dispatcher: one job per branch with work. Returns what it enqueued (duplicates within the minute are skipped). */
export async function dispatchQueueOpsJobs(db: Kysely<any>, nowMs = Date.now()): Promise<{ scan: number; autoRun: number; branches: number }> {
  const minute = Math.floor(nowMs / 60_000);
  // active salons with the AI package (the same rule as the module's entitlement port), branches with work
  const targets = rowsOf(await sql`
    with entitled as (
      select t.id from tenants t
       where t.status = 'active'
         and exists (select 1 from tenant_ai_subscriptions sub where sub.tenant_id = t.id and sub.package_code = ${PACKAGE}
                       and sub.status in ('active','trialing') and (sub.trial_ends_at is null or sub.trial_ends_at > now() or sub.status = 'active'))
    ),
    work as (
      select q.tenant_id, q.branch_id, bool_or(q.status = 'waiting' and q.assigned_technician_id is null) as has_unassigned
        from pos_queue_items q join entitled e on e.id = q.tenant_id
       where q.branch_id is not null and q.status not in ('completed','done','cancelled','removed')
       group by q.tenant_id, q.branch_id
      union all
      select a.tenant_id, a.branch_id, false from queue_alerts a join entitled e on e.id = a.tenant_id where a.status <> 'resolved' group by a.tenant_id, a.branch_id
    )
    select w.tenant_id, w.branch_id, bool_or(w.has_unassigned) as has_unassigned,
           bool_or(coalesce(s.auto_enabled, ts.auto_enabled, false) and not coalesce(ts.auto_killed, false)) as auto_on
      from work w
      join branches b on b.id = w.branch_id and b.tenant_id = w.tenant_id and b.status = 'active'
      left join queue_assignment_settings s on s.tenant_id = w.tenant_id and s.branch_id = w.branch_id
      left join queue_assignment_tenant_settings ts on ts.tenant_id = w.tenant_id
     group by w.tenant_id, w.branch_id`.execute(db));
  const platformOff = rowsOf(await sql`select value from platform_settings where setting_key = 'ai.auto_actions_disabled' limit 1`.execute(db).catch(() => ({ rows: [] })))[0];
  const autoBlocked = !!platformOff && (platformOff.value === true || platformOff.value === 'true');
  let scan = 0, autoRun = 0;
  for (const t of targets) {
    const tenantId = String(t.tenant_id), branchId = String(t.branch_id);
    const s = await enqueueJob(db, { jobClass: 'standard', jobType: QUEUE_OPS_JOB.scan, tenantId, payload: { branchId }, priority: 1, maxAttempts: 2, idempotencyKey: `${branchId}:${minute}` });
    if (!s.duplicate) scan++;
    if (t.auto_on && t.has_unassigned && !autoBlocked) {
      const a = await enqueueJob(db, { jobClass: 'standard', jobType: QUEUE_OPS_JOB.autoRun, tenantId, payload: { branchId }, priority: 1, maxAttempts: 1, idempotencyKey: `${branchId}:${minute}` });
      if (!a.duplicate) autoRun++;
    }
  }
  return { scan, autoRun, branches: targets.length };
}

export interface QueueOpsJobDeps {
  db: Kysely<any>;
  settings: QueueAssignmentSettingsPort;
  entitlement: QueueAssignmentEntitlementPort;
  scan(ctx: QueueAssignmentContext): Promise<unknown>;
  /** agent B's auto-run; null while the AI service is not available in this process */
  autoRun: ((ctx: QueueAssignmentContext) => Promise<unknown>) | null;
}

async function branchReady(deps: QueueOpsJobDeps, tenantId: string | null, payload: Record<string, unknown>): Promise<{ ok: true; tenantId: string; branchId: string } | { ok: false; skipped: string }> {
  if (!isUuid(tenantId) || !isUuid(payload.branchId)) throw new PermanentJobError('a queue job needs its tenant and branch');
  const branchId = payload.branchId;
  const t = rowsOf(await sql`select t.status, b.status as branch_status from tenants t left join branches b on b.id = ${branchId} and b.tenant_id = t.id where t.id = ${tenantId}`.execute(deps.db))[0];
  if (!t || t.status !== 'active') return { ok: false, skipped: 'salon_not_active' };
  if (t.branch_status !== 'active') return { ok: false, skipped: 'branch_not_active' };
  if (!(await deps.entitlement.isEnabled(tenantId))) return { ok: false, skipped: 'not_entitled' };
  return { ok: true, tenantId, branchId };
}
async function stamp(db: Kysely<any>, tenantId: string, branchId: string, col: 'last_scan_at' | 'last_auto_run_at') {
  // version 0 = "no location settings yet": stamping must not look like a settings change in the config version
  await sql`insert into queue_assignment_settings (tenant_id, branch_id, version, ${sql.ref(col)}) values (${tenantId}, ${branchId}, 0, now())
            on conflict (tenant_id, branch_id) do update set ${sql.ref(col)} = now()`.execute(db);
}

export async function runScanJob(deps: QueueOpsJobDeps, tenantId: string | null, payload: Record<string, unknown>) {
  const r = await branchReady(deps, tenantId, payload);
  if (!r.ok) return { skipped: r.skipped };
  const out = await deps.scan(queueOpsSystemContext(r.tenantId, r.branchId));
  await stamp(deps.db, r.tenantId, r.branchId, 'last_scan_at');
  return { scanned: true, result: out };
}
export async function runAutoJob(deps: QueueOpsJobDeps, tenantId: string | null, payload: Record<string, unknown>) {
  const r = await branchReady(deps, tenantId, payload);
  if (!r.ok) return { skipped: r.skipped };
  // every switch, read NOW (platform, salon kill, location / salon enabled) — the job may have waited in the queue
  const eff = await deps.settings.effective({ tenantId: r.tenantId, branchId: r.branchId });
  if (!eff.autoAllowed) return { skipped: `auto_blocked:${eff.autoBlockedBy}` };
  if (!deps.autoRun) throw new Error('the AI queue assignment service is not available in this process');
  const out = await deps.autoRun(queueOpsSystemContext(r.tenantId, r.branchId));
  await stamp(deps.db, r.tenantId, r.branchId, 'last_auto_run_at');
  return { ran: true, result: out };
}

export function registerQueueOpsJobHandlers(deps: QueueOpsJobDeps): void {
  if (!jobHandlerFor(QUEUE_OPS_JOB.scan)) registerJobHandler(QUEUE_OPS_JOB.scan, async (payload, ctx) => runScanJob(deps, ctx.tenantId, payload));
  if (!jobHandlerFor(QUEUE_OPS_JOB.autoRun)) registerJobHandler(QUEUE_OPS_JOB.autoRun, async (payload, ctx) => runAutoJob(deps, ctx.tenantId, payload));
}

@Injectable()
export class QueueOpsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AiQueueOps');
  private timer: NodeJS.Timeout | null = null;
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Inject(QUEUE_ASSIGNMENT_SETTINGS) private readonly settings: QueueAssignmentSettingsPort,
    @Inject(QueueAlertService) private readonly alerts: QueueAlertService,
    @Inject('QueueAssignmentEntitlementPort') private readonly entitlement: QueueAssignmentEntitlementPort,
    @Optional() @Inject(QueueAssignmentService) private readonly auto: QueueAssignmentService | null = null,
  ) {}

  deps(): QueueOpsJobDeps | null {
    if (!this.db) return null;
    const db = this.db as unknown as Kysely<any>;
    return {
      db, settings: this.settings, entitlement: this.entitlement,
      scan: (ctx) => this.alerts.runScan(ctx),
      // agent B's auto-run, with every one of its own safeguards; a system actor skips the user-permission check only
      autoRun: this.auto ? (ctx) => (this.auto as any).runAutoAssignment(ctx, { system: true }) : null,
    };
  }

  onModuleInit(): void {
    const deps = this.deps();
    if (!deps) return;
    registerQueueOpsJobHandlers(deps);           // every process: a worker anywhere may take the job
    if (!runsBackgroundJob('standard') || !queueOpsJobsEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.queue_assignment.dispatch', jobClass: 'standard', everyMs: TICK_MS }, () => this.dispatch()).catch(() => undefined); }, TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public so ops and tests can run one dispatch without waiting for the timer. */
  async dispatch() {
    if (!this.db) return null;
    const r = await dispatchQueueOpsJobs(this.db as unknown as Kysely<any>);
    if (r.scan || r.autoRun) this.log.debug?.(`queue ops: ${JSON.stringify(r)}`);
    return r;
  }
}
