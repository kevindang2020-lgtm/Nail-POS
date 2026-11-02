// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { DeployStatus } from '@aipowersalon/api-contracts/tenant';
import type { DeployStatus } from '@aipowersalon/api-contracts/tenant';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { DeploySummary } from '@aipowersalon/api-contracts/tenant';
import type { DeploySummary } from '@aipowersalon/api-contracts/tenant';
// deployments-core.ts — PURE logic for app/firmware deployments. No IO. Derives whether an update is available,
// the pending count (for the "Pending Updates" KPI), a display status, and validates lifecycle transitions. An
// update is NEVER auto-marked completed here — completion requires an explicit 'complete' transition.

export interface DeployRecord {
  id: string; component: string; componentKind: string;
  installedVersion: string | null; latestVersion: string | null; targetCount: number; status: DeployStatus;
  scheduledIso: string | null; branchId: string | null;
}

const SETTLED = new Set<DeployStatus>(['completed', 'up_to_date']);
const PENDING_STATUSES = new Set<DeployStatus>(['available', 'scheduled', 'deferred']);

// updateAvailable: a known newer version exists and the component is not already settled.
export function updateAvailable(d: { installedVersion: string | null; latestVersion: string | null; status: DeployStatus }): boolean {
  if (SETTLED.has(d.status)) return false;
  if (!d.latestVersion) return false;
  if (d.installedVersion == null) return true; // unknown installed + a known latest ⇒ treat as update available
  return d.installedVersion !== d.latestVersion;
}

// isPending: update available AND still awaiting action (not in-progress / failed / rolled back).
export function isPending(d: DeployRecord): boolean {
  return updateAvailable(d) && PENDING_STATUSES.has(d.status);
}

export function pendingCount(list: DeployRecord[]): number {
  return list.filter(isPending).length;
}

export function summarize(list: DeployRecord[]): DeploySummary {
  let pending = 0, upToDate = 0, inProgress = 0;
  for (const d of list) {
    if (isPending(d)) pending++;
    if (!updateAvailable(d)) upToDate++;
    if (d.status === 'in_progress') inProgress++;
  }
  return { total: list.length, pending, upToDate, inProgress };
}

// Lifecycle transitions. Returns the next status or null if the action is invalid for the current status.
const TRANSITIONS: Record<string, Partial<Record<DeployStatus, DeployStatus>>> = {
  schedule: { available: 'scheduled', deferred: 'scheduled' },
  start: { available: 'in_progress', scheduled: 'in_progress', deferred: 'in_progress' },
  complete: { in_progress: 'completed' },
  fail: { in_progress: 'failed' },
  rollback: { completed: 'rolled_back', failed: 'rolled_back', in_progress: 'rolled_back' },
  defer: { available: 'deferred', scheduled: 'deferred' },
  block: { available: 'blocked', scheduled: 'blocked' },
};
export function nextStatus(current: DeployStatus, action: string): DeployStatus | null {
  return TRANSITIONS[action]?.[current] ?? null;
}
