// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type DeviceStatus =
  | 'online' | 'offline' | 'reconnecting' | 'maintenance' | 'revoked' | 'unpaired' | 'unknown';

export interface FleetDevice {
  id: string; name: string; type: string; branch: string; branchId: string | null;
  station: string | null; status: DeviceStatus; lastSyncIso: string | null; lastSyncLabel: string;
}

export interface TerminalView {
  id: string; label: string; station: string | null; status: string;
  /** wave 3 PAYI §12 / §50: the ONE normalized status (ONLINE / OFFLINE / BUSY / PROCESSING / DEGRADED / DISABLED / UNKNOWN) + its sentence.
   *  `status` above stays the pairing state ('paired' / 'unpaired'); a paired terminal is NOT "online" until it answered. */
  operationalStatus?: 'ONLINE' | 'OFFLINE' | 'BUSY' | 'PROCESSING' | 'DEGRADED' | 'DISABLED' | 'UNKNOWN'; operationalLabel?: string;
  lastSeenAt?: string | null; lastTransactionAt?: string | null;
}

export interface DevicesKpis {
  connectedDevices: number;
  onlineDevices: number;
  onlinePct: number | null;
  paymentTerminals: number;
  terminalsAllConnected: boolean;
  locationsConnected: number;
  // No canonical source yet — honest nulls (never the reference's development-fixture numbers):
  integrationHealthPct: number | null;
  apiCallsToday: number | null;
  syncSuccessRate: number | null;
  pendingUpdates: number | null;
}

export interface DevicesOverview extends DevicesOverviewCore {
  dataQuality: DevicesDataQuality;
}

export interface DevicesDataQuality {
  fleetSource: boolean;
  terminalsSource: boolean;
  metricsUnavailable: string[];
}

export interface DevicesOverviewCore {
  kpis: DevicesKpis;
  fleet: FleetDevice[];
  terminals: TerminalView[];
  charts: {
    statusMix: StatusMix;
    devicesByBranch: BranchCount[];
    integrationHealthMix: null | { healthy: number; degraded: number; down: number };   // developer, Sep 2026
    syncSuccess7d: Array<{ date: string; pct: number }>; // [] until a sync-log source exists
  };
}

export interface BranchCount { branch: string; branchId: string | null; count: number }

export interface StatusMix { online: number; offline: number; maintenance: number }
