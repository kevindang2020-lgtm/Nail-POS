import type { DeviceStatus, FleetDevice, TerminalView, DevicesKpis, DevicesOverviewCore, BranchCount, StatusMix } from '@aipowersalon/api-contracts/tenant';
import { DISPLAY_ONLINE_WINDOW_MS, terminalOperationalStatus, TERMINAL_STATUS_LABEL } from '@aipowersalon/api-contracts';
export type { DeviceStatus, FleetDevice, TerminalView, DevicesKpis, DevicesOverviewCore, BranchCount, StatusMix };   // owned by packages/api-contracts (Constitution 13 §13)
// devices-overview-core.ts — PURE composition logic for the salon Devices & Integrations overview.
// No IO: every function takes already-normalized primitives (timestamps as epoch-ms) so it is deterministic and
// fully unit-testable. Online/offline is derived from a heartbeat window (last_seen_at), NOT a stale session flag —
// a device is only "online" if it has reported within ONLINE_TIMEOUT_MS. Metrics with no canonical backend source
// (integration health %, API calls, sync success, pending updates) are returned as null here and surfaced as "—"
// in the UI; this core NEVER invents those numbers.


export interface RawDevice {
  id: string; name: string | null; type: string | null;
  branchId: string | null; branchName: string | null; station: string | null;
  pairingStatus: string | null; lastSeenMs: number | null; revokedMs: number | null;
}
export interface RawTerminal {
  id: string; label: string; station: string | null; status: string; pairedMs: number | null; branchId: string | null;
  // wave 3 PAYI §12 / §50 (migration 638 + the live lease): what the normalized status is derived from
  disabledAt?: string | null; lastSeenAt?: string | null; lastPingAt?: string | null; lastPingOk?: boolean | null; leaseHolder?: string | null; lastTransactionAt?: string | null;
}



/** The fleet IS the salon's customer displays (customer_display_devices — the only registry with a heartbeat), so a device
 *  is online on the displays' own rule: heard from within DISPLAY_ONLINE_WINDOW_MS (23-inch spec §85 — a display reports
 *  every 30 s). It was 5 minutes, so the overview kept calling a switched-off display "online" for minutes. */
export const ONLINE_TIMEOUT_MS = DISPLAY_ONLINE_WINDOW_MS;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const TERMINAL_OK = new Set(['paired', 'online', 'connected']);
/** wave 3 PAYI §12: the normalized status; a terminal that never answered is UNKNOWN, never "connected". */
function terminalStatusOf(t: RawTerminal, nowMs: number) {
  return terminalOperationalStatus({ paired: TERMINAL_OK.has((t.status || '').toLowerCase()), disabledAt: t.disabledAt ?? null, lastSeenAt: t.lastSeenAt ?? null, lastPingAt: t.lastPingAt ?? null, lastPingOk: t.lastPingOk ?? null, leaseHolder: t.leaseHolder ?? null }, new Date(nowMs));
}

export function deviceStatus(d: RawDevice, nowMs: number, timeoutMs = ONLINE_TIMEOUT_MS): DeviceStatus {
  if (d.revokedMs != null) return 'revoked';
  const ps = (d.pairingStatus || '').toLowerCase();
  if (ps === 'maintenance') return 'maintenance';
  if (ps === 'reconnecting') return 'reconnecting';
  if (ps === 'unpaired') return 'unpaired';
  if (d.lastSeenMs == null) return ps === 'paired' ? 'offline' : 'unpaired';
  return nowMs - d.lastSeenMs <= timeoutMs ? 'online' : 'offline';
}

export function relativeLabel(ms: number | null, nowMs: number): string {
  if (ms == null) return '—';
  const delta = Math.max(0, nowMs - ms);
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s} sec ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const days = Math.floor(h / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function toFleetDevice(d: RawDevice, nowMs: number, timeoutMs = ONLINE_TIMEOUT_MS): FleetDevice {
  const status = deviceStatus(d, nowMs, timeoutMs);
  return {
    id: d.id,
    name: d.name || 'Unnamed device',
    type: d.type || '—',
    branch: d.branchName || '—',
    branchId: d.branchId,
    station: d.station,
    status,
    lastSyncIso: d.lastSeenMs != null ? new Date(d.lastSeenMs).toISOString() : null,
    lastSyncLabel: relativeLabel(d.lastSeenMs, nowMs),
  };
}

export function statusMix(statuses: DeviceStatus[]): StatusMix {
  let online = 0, maintenance = 0, offline = 0;
  for (const s of statuses) {
    if (s === 'online') online++;
    else if (s === 'maintenance') maintenance++;
    else offline++; // offline / reconnecting / revoked / unpaired / unknown
  }
  return { online, offline, maintenance };
}

export function devicesByBranch(devices: Array<{ branch: string; branchId: string | null }>): BranchCount[] {
  const map = new Map<string, BranchCount>();
  for (const d of devices) {
    const key = d.branchId || d.branch || '—';
    const cur = map.get(key) || { branch: d.branch || '—', branchId: d.branchId, count: 0 };
    cur.count++;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch));
}

export function computeKpis(fleet: FleetDevice[], terminals: TerminalView[]): DevicesKpis {
  const connectedDevices = fleet.length;
  const onlineDevices = fleet.filter((d) => d.status === 'online').length;
  const branchIds = new Set(fleet.map((d) => d.branchId || d.branch).filter(Boolean));
  return {
    connectedDevices,
    onlineDevices,
    onlinePct: connectedDevices > 0 ? round1((onlineDevices / connectedDevices) * 100) : null,
    paymentTerminals: terminals.length,
    // wave 3 PAYI §50: "All Connected" means every terminal ANSWERED recently (ONLINE) — paired alone was a lie
    terminalsAllConnected: terminals.length > 0 && terminals.every((t) => (t.operationalStatus ?? (TERMINAL_OK.has((t.status || '').toLowerCase()) ? 'UNKNOWN' : 'OFFLINE')) === 'ONLINE'),
    locationsConnected: branchIds.size,
    integrationHealthPct: null,
    apiCallsToday: null,
    syncSuccessRate: null,
    pendingUpdates: null,
  };
}


export function buildOverview(rawDevices: RawDevice[], rawTerminals: RawTerminal[], nowMs: number, timeoutMs = ONLINE_TIMEOUT_MS): DevicesOverviewCore {
  const fleet = rawDevices.map((d) => toFleetDevice(d, nowMs, timeoutMs));
  const terminals: TerminalView[] = rawTerminals.map((t) => { const op = terminalStatusOf(t, nowMs); return { id: t.id, label: t.label, station: t.station, status: t.status, operationalStatus: op, operationalLabel: TERMINAL_STATUS_LABEL[op], lastSeenAt: t.lastSeenAt ?? null, lastTransactionAt: t.lastTransactionAt ?? null }; });
  
  const kpis = computeKpis(fleet, terminals);
  
  // Removed in the Sep 2026 merge: hard-coded / Math.random() telemetry (98% health, 1,420 API calls, 95–99% sync) that
  // the dashboard would have shown as real. These stay unset until real sources exist (see DevicesKpis: null = not connected).

  return {
    kpis,
    fleet,
    terminals,
    charts: {
      statusMix: statusMix(fleet.map((d) => d.status)),
      devicesByBranch: devicesByBranch(fleet),
      integrationHealthMix: null,   // no integration-state source yet
      syncSuccess7d: [],            // no sync-log source yet
    },
  };
}
