// branch-health.ts — BUILD_PLAN Phase 14 B (Constitution 11 §345): one branch's operational health, every 15 minutes.
// Read by the Owner App (GET /owner/branch-health — the caller's own salon's branches only) and, in a list across every
// salon, by Super Admin (GET /super-admin/branch-health). A NULL fact is NOT MEASURED (no source, or its query failed —
// named in failedQueries), never a zero.

export type BranchHealthStatus = 'HEALTHY' | 'DEGRADED' | 'OUTAGE' | 'UNKNOWN';

export interface BranchHealthFacts {
  /** open tickets created in the last 24 h (not paid, not removed / cancelled) */
  openTickets: number | null;
  /** guests waiting in the walk-in queue (checked in within 24 h) */
  queueWaiting: number | null;
  queueLongestWaitSeconds: number | null;
  techniciansOnShift: number | null;
  paymentsLastHour: number | null;
  paymentsFailedLastHour: number | null;
  displaysTotal: number | null;
  displaysOnline: number | null;
  kiosksTotal: number | null;
  kiosksOnline: number | null;
  /** payment terminals paired to the branch (terminals report no heartbeat, so "online" is not measured) */
  terminalsPaired: number | null;
  lastRealtimeEventAt: string | null;
  smsSentLastHour: number | null;
  smsFailedLastHour: number | null;
}

export interface BranchHealthSnapshot extends BranchHealthFacts {
  branchId: string;
  branchName: string | null;
  observedAt: string;
  overall: BranchHealthStatus;
  /** why the overall is what it is: e.g. payments_failing, long_wait, devices_offline_while_open, idle, query_failed:<fact> */
  reasons: string[];
  failedQueries: string[];
}

/** GET /owner/branch-health — every branch of the caller's salon; `snapshot` null = not snapshotted yet. */
export interface OwnerBranchHealth {
  generatedAt: string;
  branches: Array<{ branchId: string; branchName: string | null; snapshot: BranchHealthSnapshot | null }>;
}
