// ops-dashboards.ts — BUILD_PLAN Phase 14 B (Constitution 11 §145, §149–155, §345): the wire shapes of the Super Admin
// System Operations dashboards (GET /super-admin/system/dashboards/*) and the all-branch health list
// (GET /super-admin/branch-health).
//
// SOURCES, stated on every payload: `db` facts are read from the platform's tables (the same for every caller); `live`
// facts are summed over the LIVE processes' heartbeats (process_heartbeats, migration 562) and are "since each live
// process started". An empty source is `null` / an empty list — the screens say "no data yet", never a zero.
import type { BranchHealthSnapshot, BranchHealthStatus } from '../tenant/branch-health';

export interface SuperAdminBranchHealthRow extends BranchHealthSnapshot { tenantId: string; tenantName: string | null }
export interface SuperAdminBranchHealthList {
  rows: SuperAdminBranchHealthRow[]; generatedAt: string; total: number;
  counts: Partial<Record<BranchHealthStatus, number>>; nextCursor: string | null;
}

/** Which live processes a `live` section summed. */
export interface LiveSource { processes: number; roles: string[]; oldestStartedAt: string | null }

export interface DashboardProcess {
  bootId: string; processRole: string; instance: string; version: string; commit: string; deployment: string; environment: string;
  startedAt: string; lastSeenAt: string; live: boolean; uptimeSeconds: number;
  rssBytes: number | null; heapUsedBytes: number | null; cpuSeconds: number | null; eventLoopP99Ms: number | null;
  schemaLatest: string | null; schemaPending: number | null;
}

export interface DeploymentRelease {
  version: string; commit: string; deployment: string; environment: string;
  firstStartedAt: string; lastSeenAt: string; boots: number; liveProcesses: number;
  /** component status changes to a non-healthy state within 30 minutes of this release's first boot (§154 "Health After Deploy") */
  healthChangesAfterDeploy: number | null;
  /** an older release booted again after a newer one had started (§154 "Rollback") */
  rollback: boolean;
}
export interface DeploymentDashboard {
  generatedAt: string; releases: DeploymentRelease[]; processes: DashboardProcess[];
  schema: { status: string; latest: string | null; pending: string[]; mismatches: string[]; error?: string } | null;
  releaseNotesUrl: string | null;
}

export interface StorageStoreRow {
  store: string; ok: number; errors: number; misses: number; bytesWritten: number; bytesRead: number;
  latencyP95Ms: number | null; errorsByOp: Record<string, number>;
}
export interface StorageDashboard {
  generatedAt: string; live: LiveSource; stores: StorageStoreRow[];
  lifecycle: { runs: Array<{ store: string; ok: number; errors: number; removed: number }>;
    job: { lastStartedAt: string | null; lastFinishedAt: string | null; lastOutcome: string | null; runs: number; failures: number } | null };
  usage: { tenants: number; totalBytes: number; totalUploads: number;
    top: Array<{ tenantId: string; tenantName: string | null; bytesUsed: number; uploads: number; limitBytes: number | null; share: number | null }> };
  /** the upload scanner's failures — null until a scanner reports them */
  malwareScanFailures: number | null;
}

export interface MobileAppRow { app: string; platform: string; events: number; errors: number; updateRequired: number; launchP95Ms: number | null; apiP95Ms: number | null; topEvents: Array<{ event: string; count: number }> }
export interface MobileDashboard {
  generatedAt: string; live: LiveSource; apps: MobileAppRow[];
  errorsByKind: Array<{ app: string; platform: string; kind: string; count: number }>;
  versions: Array<{ app: string; platform: string; version: string; activeInstalls7d: number }>;
  policy: Array<{ app: string; platform: string; minSupported: string | null; recommended: string | null; latest: string | null }>;
}

export interface RedisRoleRow {
  role: string; processes: number; up: number; commands: number; errors: number; latencyP95Ms: number | null; reconnects: number;
  memoryBytes: number | null; memoryRatio: number | null; evictedKeys: number | null; hitRatio: number | null; blockedClients: number | null;
}
export interface RedisDashboard { generatedAt: string; live: LiveSource; roles: RedisRoleRow[] }

export interface ProviderRow { provider: string; calls: number; failures: number; byCategory: Record<string, number>; latencyP95Ms: number | null; circuitOpen: boolean }
export interface WebhookRow { provider: string; byOutcome: Record<string, number> }

export interface PaymentsDashboard {
  generatedAt: string; windowHours: number; live: LiveSource;
  attempts: { total: number; approved: number; declined: number; technicalFailures: number; canceled: number; pending: number; refunded: number };
  byProcessor: Array<{ processor: string; total: number; approved: number; declined: number; technicalFailures: number }>;
  stranded: { open: number; resolved24h: number };
  providers: ProviderRow[]; webhooks: WebhookRow[];
}

export interface CommunicationsDashboard {
  generatedAt: string; windowHours: number; live: LiveSource;
  sms: Array<{ provider: string; status: string; count: number }>;
  systemSms: Array<{ status: string; count: number }>;
  notifications: Array<{ channel: string; status: string; count: number }>;
  providers: Array<ProviderRow & { channel: 'sms' | 'email' | 'push' | 'voice' }>;
  webhooks: WebhookRow[];
}

export interface IncidentDashboardRow {
  id: string; reference: string | null; title: string; status: string; severity: string | null; impact: string;
  componentKey: string | null; affectedTenants: number;
  /** the incident commander (status_incidents.recovery_owner — §171) */
  commander: string | null; startedAt: string; detectedAt: string | null;
  resolvedAt: string | null; etaAt: string | null; nextMilestone: string | null;
  timeline: Array<{ at: string; kind: string; body: string; actor: string | null }>;
}
export interface IncidentDashboard { generatedAt: string; active: IncidentDashboardRow[]; recent: IncidentDashboardRow[] }
