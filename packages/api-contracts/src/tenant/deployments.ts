// deployments.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Moved from the server's own declaration so the
// server and every app use ONE definition.

export interface DeploymentView {
  id: string; component: string; componentKind: string;
  installedVersion: string | null; latestVersion: string | null; targetCount: number;
  status: DeployStatus; scheduledIso: string | null; branchId: string | null; updateAvailable: boolean;
}
export type DeployStatus =
  | 'available' | 'scheduled' | 'in_progress' | 'completed' | 'failed' | 'rolled_back' | 'up_to_date' | 'deferred' | 'blocked';

export interface DeploySummary { total: number; pending: number; upToDate: number; inProgress: number }
export interface DeploymentsState { deployments: DeploymentView[]; summary: DeploySummary }
