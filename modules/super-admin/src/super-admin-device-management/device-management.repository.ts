// Repository for Device Management. In production, devices come from the existing device sources (payment terminals,
// customer displays, check-in devices, sessions) and the greenfield support tables (catalog/shipments/maintenance/
// security alerts). The in-memory impl seeds realistic dev fixtures so the page renders without a database.
import type { ManagedDevice } from './device-management-core';

export interface ShipmentRow { reference: string; device: string; branch: string; status: string; eta: string | null }
export interface MaintenanceRow { reference: string; device: string; branch: string; status: string; eta: string | null }
export interface SecurityAlertRow { device: string; tenant: string; issue: string; severity: string; lastAction: string | null }
export interface ConnectionLogRow { time: string; device: string; tenant: string; event: string; result: string }
export interface CatalogCard { deviceType: string; displayName: string; modelCount: number; availability: string }

export interface DeviceMgmtRepo {
  listDevices(scope: { tenantId?: string; branchId?: string }): Promise<ManagedDevice[]>;
  counts(scope: { tenantId?: string }): Promise<{ shipmentsPending: number; maintenanceActive: number; merchantTerminalsConnected: number; callerIdOnline: number; activeBranchAssignments: number; updatesRequired: number; lockedOrRevoked: number }>;
  shipments(): Promise<ShipmentRow[]>;
  maintenance(): Promise<MaintenanceRow[]>;
  securityAlerts(): Promise<SecurityAlertRow[]>;
  connectionLogs(): Promise<ConnectionLogRow[]>;
  catalog(): Promise<CatalogCard[]>;
}

const NOW = Date.now();
const T = '2026-05-06T';
const dev = (id: string, name: string, type: string, branch: string, tenant: string, serial: string, os: string, app: string, lastSeenMin: number, sec: string, upd: string, user: string | null, mtid: string | null, extra: Partial<ManagedDevice> = {}): ManagedDevice => ({
  id, name, type, branchId: branch.toLowerCase().replace(/\s/g, '_'), branchName: branch, station: null, tenantId: tenant.toLowerCase().replace(/\s/g, '_'), tenantName: tenant, serial, os, appVersion: app,
  pairingStatus: 'paired', lastSeenMs: NOW - lastSeenMin * 60_000, revokedMs: null, securityStatus: sec, updateStatus: upd, assignedUser: user, merchantTerminalId: mtid, ...extra,
});

const seedDevices: ManagedDevice[] = [
  dev('1', 'iMac Reception POS', 'reception_pos', 'Downtown Branch', 'AI PowerSalon', 'IMAC-RECP-001', 'macOS 14.4', '3.7.2', 1, 'compliant', 'up_to_date', 'Jessica Miller', 'MT-8821-0091'),
  dev('2', 'iPad Check-In Kiosk', 'check_in_kiosk', 'Downtown Branch', 'AI PowerSalon', 'IPAD-KIOSK-012', 'iPadOS 17.4', '3.7.2', 2, 'compliant', 'up_to_date', null, null),
  dev('3', 'Android Check-In Kiosk', 'check_in_kiosk', 'Uptown Branch', 'AI PowerSalon', 'KIOSK-AND-021', 'Android 13', '3.6.9', 12, 'compliant', 'update_required', null, null),
  dev('4', 'Credit Card Terminal', 'payment_terminal', 'Downtown Branch', 'AI PowerSalon', 'PAX-A920-7782', 'Linux 7.1', '2.1.8', 3, 'compliant', 'up_to_date', null, 'MT-8821-0091'),
  dev('5', 'Owner App Device', 'owner_mobile', 'Downtown Branch', 'AI PowerSalon', 'IPHONE-14PRO-11', 'iOS 17.4.1', '3.7.2', 1, 'compliant', 'up_to_date', 'Sophia Martinez', null),
  dev('6', 'Technician App Device', 'technician_mobile', 'Uptown Branch', 'AI PowerSalon', 'SAMS-S23-TECH-07', 'Android 14', '3.6.9', 5, 'compliant', 'update_required', 'Olivia Brown', null),
  dev('7', 'Customer-Facing Display', 'customer_display', 'Midtown Branch', 'AI PowerSalon', 'DISPLAY-S5-004', 'Android 11', '3.5.3', 20, 'compliant', 'update_required', null, null),
  dev('8', 'Caller-ID Device', 'caller_id', 'Uptown Branch', 'AI PowerSalon', 'CALLERID-0012', 'Device OS 2.3', '1.0.6', 4, 'compliant', 'up_to_date', null, null),
];

export class InMemoryDeviceMgmtRepo implements DeviceMgmtRepo {
  constructor(private readonly seed = seedDevices) {}
  async listDevices(scope: { tenantId?: string; branchId?: string }): Promise<ManagedDevice[]> {
    return this.seed.filter((d) => (!scope.tenantId || d.tenantId === scope.tenantId)).map((d) => ({ ...d }));
  }
  async counts() { return { shipmentsPending: 12, maintenanceActive: 9, merchantTerminalsConnected: 82, callerIdOnline: 24, activeBranchAssignments: 38, updatesRequired: 17, lockedOrRevoked: 6 }; }
  async shipments(): Promise<ShipmentRow[]> {
    return [
      { reference: 'SHIP-2026-0152', device: 'iPad Kiosk', branch: 'Midtown Branch', status: 'In Transit', eta: 'May 08, 2026' },
      { reference: 'SHIP-2026-0153', device: 'Credit Terminal', branch: 'Uptown Branch', status: 'In Transit', eta: 'May 09, 2026' },
      { reference: 'TICKET-2026-0048', device: 'Printer', branch: 'Downtown Branch', status: 'Maintenance', eta: 'May 07, 2:00 PM' },
      { reference: 'TICKET-2026-0049', device: 'Caller-ID Device', branch: 'Uptown Branch', status: 'Scheduled', eta: 'May 10, 10:00 AM' },
    ];
  }
  async maintenance(): Promise<MaintenanceRow[]> { return []; }
  async securityAlerts(): Promise<SecurityAlertRow[]> {
    return [
      { device: 'Android Kiosk', tenant: 'AI PowerSalon', issue: 'Rooted Device Detected', severity: 'high', lastAction: `${T}13:20` },
      { device: 'Technician App', tenant: 'AI PowerSalon', issue: 'Multiple Failed Logins', severity: 'medium', lastAction: `${T}13:18` },
      { device: 'Customer Display', tenant: 'AI PowerSalon', issue: 'App Tampering Risk', severity: 'medium', lastAction: `${T}12:55` },
      { device: 'iPad Kiosk', tenant: 'AI PowerSalon', issue: 'Old Operating-System Version', severity: 'low', lastAction: `${T}12:40` },
    ];
  }
  async connectionLogs(): Promise<ConnectionLogRow[]> {
    return [
      { time: `${T}14:33`, device: 'iMac Reception POS', tenant: 'AI PowerSalon', event: 'Connected', result: 'Success' },
      { time: `${T}14:32`, device: 'iPad Check-In Kiosk', tenant: 'AI PowerSalon', event: 'Heartbeat', result: 'Success' },
      { time: `${T}14:31`, device: 'Credit Card Terminal', tenant: 'AI PowerSalon', event: 'Transaction Sync', result: 'Success' },
      { time: `${T}14:29`, device: 'Caller-ID Device', tenant: 'AI PowerSalon', event: 'Connected', result: 'Success' },
      { time: `${T}14:29`, device: 'Android Kiosk', tenant: 'AI PowerSalon', event: 'Heartbeat', result: 'Failed' },
    ];
  }
  async catalog(): Promise<CatalogCard[]> {
    return [
      { deviceType: 'reception_pos', displayName: 'Reception POS', modelCount: 12, availability: 'available' },
      { deviceType: 'check_in_kiosk', displayName: 'Check-In Kiosk', modelCount: 8, availability: 'available' },
      { deviceType: 'payment_terminal', displayName: 'Payment Terminal', modelCount: 6, availability: 'available' },
      { deviceType: 'printer', displayName: 'Printer', modelCount: 5, availability: 'available' },
      { deviceType: 'caller_id', displayName: 'Caller-ID Device', modelCount: 4, availability: 'available' },
      { deviceType: 'owner_mobile', displayName: 'Owner Mobile', modelCount: 6, availability: 'available' },
      { deviceType: 'technician_mobile', displayName: 'Technician Mobile', modelCount: 6, availability: 'available' },
      { deviceType: 'customer_display', displayName: 'Customer Display', modelCount: 4, availability: 'available' },
    ];
  }
}
