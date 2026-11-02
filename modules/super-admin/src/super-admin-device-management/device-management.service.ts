// Device Management service. Composes the overview (10 KPIs, mixes, tenant usage, catalog, shipments/maintenance,
// security alerts, connection logs) and the managed-devices directory. No device secret/token is ever surfaced —
// the device shape carries identity, assignment, connectivity, and status only.
import { buildDeviceKpis, buildDeviceMixes, buildTenantUsage, typeLabel, type ManagedDevice } from './device-management-core';
import { deviceStatus, relativeLabel } from '@aipowersalon/tenants';
import type { DeviceMgmtRepo } from './device-management.repository';

const STATUS_LABEL: Record<string, string> = { online: 'Online', offline: 'Offline', maintenance: 'Maintenance', reconnecting: 'Warning', unpaired: 'Inactive', revoked: 'Revoked' };
const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export class DeviceManagementService {
  constructor(private readonly repo: DeviceMgmtRepo, private readonly now: () => number = () => Date.now()) {}

  private row(d: ManagedDevice, now: number) {
    const st = deviceStatus(d, now);
    return {
      id: d.id, name: d.name || 'Unnamed device', type: typeLabel(d.type || ''), tenant: d.tenantName || d.tenantId || '—',
      branch: d.branchName || '—', serial: d.serial || '—', os: d.os || '—', appVersion: d.appVersion || '—',
      lastConnection: relativeLabel(d.lastSeenMs ?? null, now), status: STATUS_LABEL[st] || cap(st),
      assignedUser: d.assignedUser || '—', merchantTerminalId: d.merchantTerminalId || '—',
      securityStatus: cap(d.securityStatus || 'unknown'), updateStatus: cap(d.updateStatus || 'unknown'),
    };
  }

  async getOverview(scope: { tenantId?: string; branchId?: string } = {}) {
    const now = this.now();
    const [devices, counts, shipments, maintenance, securityAlerts, connectionLogs, catalog] = await Promise.all([
      this.repo.listDevices(scope), this.repo.counts(scope), this.repo.shipments(), this.repo.maintenance(), this.repo.securityAlerts(), this.repo.connectionLogs(), this.repo.catalog(),
    ]);
    const mixes = buildDeviceMixes(devices, now);
    return {
      kpis: buildDeviceKpis(devices, counts, now),
      devices: devices.map((d) => this.row(d, now)),
      byType: mixes.byType, byStatus: mixes.byStatus, byUpdate: mixes.byUpdate,
      tenantUsage: buildTenantUsage(devices, now),
      shipmentsMaintenance: [...shipments, ...maintenance],
      securityAlerts: securityAlerts.map((a) => ({ ...a, severity: cap(a.severity) })),
      connectionLogs,
      catalog: catalog.map((c) => ({ ...c, availability: cap(c.availability) })),
      // Connection Status & Health 7-day trend + merchant-terminal 7-day connectivity need historical heartbeat
      // aggregates not modelled yet → honest NotConnected on the frontend.
      connectionTrend: { available: false, points: [] as { date: string; online: number; offline: number; total: number }[] },
      terminalConnectivity: { available: false, points: [] as { date: string; connected: number }[] },
    };
  }

  async getDirectory(scope: { tenantId?: string; branchId?: string; deviceType?: string; status?: string }) {
    const now = this.now();
    let rows = (await this.repo.listDevices(scope)).map((d) => this.row(d, now));
    if (scope.deviceType) rows = rows.filter((r) => r.type === typeLabel(scope.deviceType!));
    if (scope.status) rows = rows.filter((r) => r.status.toLowerCase() === scope.status!.toLowerCase());
    return { rows, total: rows.length };
  }

  async get(id: string): Promise<{ ok: boolean; device?: ReturnType<DeviceManagementService['detail']>; errors?: string[] }> {
    const now = this.now();
    const d = (await this.repo.listDevices({})).find((x) => x.id === id);
    return d ? { ok: true, device: this.detail(d, now) } : { ok: false, errors: ['Device not found.'] };
  }

  private detail(d: ManagedDevice, now: number) {
    const base = this.row(d, now);
    const st = deviceStatus(d, now);
    return {
      ...base,
      // Identity — no hardware secrets, tokens, or private keys are ever included.
      ownershipType: d.type === 'owner_mobile' || d.type === 'technician_mobile' ? 'Employee owned / BYOD' : 'Tenant owned',
      manufacturer: '—', model: '—',
      // Software
      osVersion: d.os || '—', minRequiredVersion: '—', configVersion: '—',
      // Connectivity
      connectionStatus: base.status, lastHeartbeat: base.lastConnection, ipMasked: '•••.•••.•••.•••', networkType: '—',
      // Security / session
      sessionStatus: d.revokedMs != null ? 'Revoked' : st === 'online' ? 'Active' : 'Expired',
      lockStatus: d.lockedMs != null ? 'Locked' : 'Unlocked',
      certificateStatus: '—',
      // Maintenance
      maintenanceStatus: st === 'maintenance' ? 'In Maintenance' : 'None',
      note: 'Device credentials, tokens, and private keys are never displayed. Sensitive actions require permission, confirmation, and are audit logged.',
    };
  }
}
