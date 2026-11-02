// Pure, DB-free engine for the Device Management page. Computes the 10 KPIs, the by-type / online-vs-offline / update
// mixes, and the tenant usage rows from managed-device records + greenfield support rows (shipments, maintenance,
// security alerts). Reuses the heartbeat-based connection status from devices-overview-core. Honest rendering:
// metrics with no backing source are surfaced as available:false rather than the reference's development fixtures.
import { deviceStatus, type RawDevice } from '@aipowersalon/tenants';

export interface ManagedDevice extends RawDevice {
  tenantId?: string | null; tenantName?: string | null; serial?: string | null; os?: string | null; appVersion?: string | null;
  assignedUser?: string | null; merchantTerminalId?: string | null; securityStatus?: string | null; updateStatus?: string | null;
  lockedMs?: number | null; maintenance?: boolean;
}

export interface Kpi { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean }

const TYPE_LABEL: Record<string, string> = {
  reception_pos: 'Reception POS', check_in_kiosk: 'Check-In Kiosk', payment_terminal: 'Payment Terminal',
  printer: 'Printer', caller_id: 'Caller-ID Device', owner_mobile: 'Owner Mobile', technician_mobile: 'Technician Mobile',
  customer_display: 'Customer Display', mobile: 'Mobile Devices',
};
export const typeLabel = (t: string) => TYPE_LABEL[t] || (t ? t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown');

export interface DeviceCounts {
  shipmentsPending: number; maintenanceActive: number; merchantTerminalsConnected: number; callerIdOnline: number;
  activeBranchAssignments: number; updatesRequired: number; lockedOrRevoked: number;
}

export function buildDeviceKpis(devices: ManagedDevice[], counts: DeviceCounts, now: number): Kpi[] {
  const statuses = devices.map((d) => ({ d, s: deviceStatus(d, now) }));
  const online = statuses.filter((x) => x.s === 'online').length;
  const offline = statuses.filter((x) => x.s === 'offline').length;
  const maintenance = statuses.filter((x) => x.s === 'maintenance').length || counts.maintenanceActive;
  const kpi = (key: string, label: string, value: string | null, extra: Partial<Kpi> = {}): Kpi => ({ key, label, value, available: value !== null, ...extra });
  return [
    kpi('total', 'Total Managed Devices', devices.length.toLocaleString()),
    kpi('online', 'Online Devices', online.toLocaleString()),
    kpi('offline', 'Offline Devices', offline.toLocaleString(), { unfavorableIfUp: true }),
    kpi('updates_required', 'Devices Requiring Updates', counts.updatesRequired.toLocaleString(), { unfavorableIfUp: true }),
    kpi('maintenance', 'Devices in Maintenance Mode', maintenance.toLocaleString()),
    kpi('locked_revoked', 'Locked or Revoked Devices', counts.lockedOrRevoked.toLocaleString(), { unfavorableIfUp: true }),
    kpi('branch_assignments', 'Active Branch Assignments', counts.activeBranchAssignments.toLocaleString()),
    kpi('shipments_pending', 'Pending Hardware Shipments', counts.shipmentsPending.toLocaleString()),
    kpi('terminals_connected', 'Merchant Terminals Connected', counts.merchantTerminalsConnected.toLocaleString()),
    kpi('caller_id_online', 'Caller-ID Devices Online', counts.callerIdOnline.toLocaleString()),
  ];
}

const mix = (rows: { key: string; count: number }[]) => {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count).map((r) => ({ label: r.key, value: r.count, pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0 }));
};

export function buildDeviceMixes(devices: ManagedDevice[], now: number) {
  const byTypeMap = new Map<string, number>();
  for (const d of devices) { const t = typeLabel(d.type || 'unknown'); byTypeMap.set(t, (byTypeMap.get(t) || 0) + 1); }
  const statuses = devices.map((d) => deviceStatus(d, now));
  const statusMix = [
    { key: 'Online', count: statuses.filter((s) => s === 'online').length },
    { key: 'Offline', count: statuses.filter((s) => s === 'offline').length },
    { key: 'Maintenance', count: statuses.filter((s) => s === 'maintenance').length },
    { key: 'Locked', count: devices.filter((d) => d.lockedMs != null || d.revokedMs != null).length },
  ];
  const updateMix = [
    { key: 'Up to Date', count: devices.filter((d) => (d.updateStatus || 'up_to_date') === 'up_to_date').length },
    { key: 'Update Required', count: devices.filter((d) => d.updateStatus === 'update_required').length },
    { key: 'Update Available', count: devices.filter((d) => d.updateStatus === 'update_available').length },
    { key: 'Unknown', count: devices.filter((d) => d.updateStatus === 'unknown' || d.updateStatus == null).length },
  ];
  return {
    byType: mix([...byTypeMap.entries()].map(([key, count]) => ({ key, count }))),
    byStatus: mix(statusMix),
    byUpdate: mix(updateMix),
  };
}

export interface TenantUsageRow { tenant: string; total: number; online: number; offline: number; assignedUsers: number; lastSync: string | null }
export function buildTenantUsage(devices: ManagedDevice[], now: number): TenantUsageRow[] {
  const groups = new Map<string, ManagedDevice[]>();
  for (const d of devices) { const k = d.tenantName || d.tenantId || '—'; (groups.get(k) ?? groups.set(k, []).get(k)!).push(d); }
  return [...groups.entries()].map(([tenant, rows]) => {
    const st = rows.map((r) => deviceStatus(r, now));
    const lastSyncMs = rows.map((r) => r.lastSeenMs).filter((m): m is number => m != null).sort((a, b) => b - a)[0] ?? null;
    return {
      tenant, total: rows.length, online: st.filter((s) => s === 'online').length, offline: st.filter((s) => s === 'offline').length,
      assignedUsers: new Set(rows.map((r) => r.assignedUser).filter(Boolean)).size,
      lastSync: lastSyncMs ? new Date(lastSyncMs).toISOString() : null,
    };
  }).sort((a, b) => b.total - a.total);
}
