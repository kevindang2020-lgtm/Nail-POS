// worker-principals.ts — BUILD_PLAN Phase 9 (Constitution 2 "machine plane: worker service principals"; §153 "worker
// authorization"). A background job, sweep or scheduler that acts FOR a salon does so as a NAMED principal —
// `worker:<job>` — holding only the permission keys that job needs, declared here in one reviewed list. Not a blanket
// "system" context that every permission check has to special-case, and never a fabricated user.
//
//   const ctx = workerPrincipal('dormant-accounts', { tenantId });   // role SYSTEM, actor 'worker:dormant-accounts'
//   hasPermission(ctx, 'security_reports.view')  → true;  hasPermission(ctx, 'checkout.approve_refund') → false
//
// The shape is @aipowersalon/tenant-context's SystemContext (built THROUGH systemContext — the one factory), so the
// audit trail records `system:worker:<job>` and isSystemContext() still recognises it. A grant naming a key that is not
// in the catalog, or any super_admin.* key, is refused when the principal is built (and by worker-principals.test).
import { systemContext, type SystemContext } from '@aipowersalon/tenant-context';
import { PERMISSIONS } from './rbac';

/** job → the keys it acts with. Keep each list the minimum the job's own permission checks ask for. */
export const WORKER_GRANTS = {
  // Phase 9 — governance
  'dormant-accounts': ['security_reports.view'],
  'override-expiry': ['permissions.override'],
  // Phase 6 — AI queue assignment: the per-branch scan, auto-resolve and the auto-run (assigns through the queue's own action)
  'ai-queue-scan': ['queue.view', 'queue.manage', 'ai_queue_assignment.view', 'ai_queue_assignment.recommend', 'ai_queue_assignment.assign', 'ai_queue_assignment.manage_auto', 'ai_queue_assignment.resolve_alerts'],
  'ai-queue-auto-assign': ['queue.view', 'queue.manage'],
  // Phase 7 — AI scheduling
  'scheduling-daily-scan': ['ai_scheduling.view', 'ai_scheduling.generate'],
  'scheduling-expiry': ['ai_scheduling.view', 'ai_scheduling.review'],
  'scheduling-insights': ['ai_scheduling.view'],
  // Phase 8 — Safety Community (retention, archive, related, evidence rescan; alert fan-out; notifications; moderation)
  'community-retention': ['community.feed.view'],
  'community-archive': ['community.feed.view'],
  'community-alerts': ['community.feed.view'],
  'community-notify': ['community.feed.view'],
  'community-moderation': ['community.feed.view'],
  // money — membership billing charges members' saved cards on their renewal date
  'membership-billing': ['checkout.process_payment', 'customers.view'],
} as const satisfies Record<string, readonly string[]>;

export type WorkerJob = keyof typeof WORKER_GRANTS;
export interface WorkerPrincipal extends SystemContext { worker: WorkerJob }

const CATALOG = new Set<string>(PERMISSIONS as readonly string[]);
/** Keys in a grant that the catalog does not know, or that belong to the platform plane. Empty = the grant is valid. */
export function invalidWorkerGrant(keys: readonly string[]): string[] {
  return keys.filter((k) => !CATALOG.has(k) || k.startsWith('super_admin.'));
}

/** The named principal a job acts as for one salon (and optionally one branch). */
export function workerPrincipal(job: WorkerJob, scope: { tenantId: string; branchId?: string | null }): WorkerPrincipal {
  const keys = WORKER_GRANTS[job] as readonly string[] | undefined;
  if (!keys) throw new Error(`workerPrincipal: unknown job "${String(job)}" — declare it in WORKER_GRANTS`);
  const bad = invalidWorkerGrant(keys);
  if (bad.length) throw new Error(`workerPrincipal: ${job} is granted keys outside the tenant catalog: ${bad.join(', ')}`);
  const ctx = systemContext({ tenantId: scope.tenantId, branchId: scope.branchId ?? null, actor: `worker:${job}`, permissions: [...keys] });
  return { ...ctx, worker: job };
}

export const isWorkerPrincipal = (ctx: unknown): ctx is WorkerPrincipal =>
  !!ctx && typeof (ctx as any).worker === 'string' && String((ctx as any).actor ?? '').startsWith('worker:');
