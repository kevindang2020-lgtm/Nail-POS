import { describe, it, expect } from 'vitest';
import { buildDeviceKpis, buildDeviceMixes, buildTenantUsage, typeLabel, type ManagedDevice, type DeviceCounts } from './device-management-core';

const NOW = Date.parse('2026-05-06T18:00:00Z');
const mk = (o: Partial<ManagedDevice> & { id: string }): ManagedDevice => ({
  name: 'Device', type: 'reception_pos', branchName: 'Downtown', tenantId: 't1', tenantName: 'AI PowerSalon',
  pairingStatus: 'paired', lastSeenMs: NOW - 60_000, revokedMs: null, ...o,
});
const counts: DeviceCounts = { shipmentsPending: 12, maintenanceActive: 9, merchantTerminalsConnected: 82, callerIdOnline: 24, activeBranchAssignments: 38, updatesRequired: 17, lockedOrRevoked: 6 };

const devices: ManagedDevice[] = [
  mk({ id: '1', type: 'reception_pos', lastSeenMs: NOW - 60_000, updateStatus: 'up_to_date' }),
  mk({ id: '2', type: 'check_in_kiosk', lastSeenMs: NOW - 10 * 60_000, updateStatus: 'update_required' }), // offline
  mk({ id: '3', type: 'payment_terminal', pairingStatus: 'maintenance', updateStatus: 'up_to_date' }),
  mk({ id: '4', type: 'caller_id', lastSeenMs: NOW - 30_000, revokedMs: NOW - 1000, updateStatus: 'unknown' }), // revoked
  mk({ id: '5', type: 'reception_pos', lastSeenMs: NOW - 30_000, tenantName: 'Glam Studio', updateStatus: 'update_available' }),
];

describe('device-management engine', () => {
  it('builds the 10 KPIs in order with unfavorable flags', () => {
    const k = buildDeviceKpis(devices, counts, NOW);
    expect(k.map((x) => x.key)).toEqual(['total', 'online', 'offline', 'updates_required', 'maintenance', 'locked_revoked', 'branch_assignments', 'shipments_pending', 'terminals_connected', 'caller_id_online']);
    const byKey = Object.fromEntries(k.map((x) => [x.key, x]));
    expect(byKey.total.value).toBe('5');
    expect(byKey.offline.unfavorableIfUp).toBe(true);
    expect(byKey.terminals_connected.value).toBe('82');
    expect(byKey.shipments_pending.value).toBe('12');
  });

  it('computes type / status / update mixes reconciling by count', () => {
    const m = buildDeviceMixes(devices, NOW);
    expect(m.byType.reduce((s, x) => s + x.value, 0)).toBe(5);
    expect(m.byStatus.find((x) => x.label === 'Online')!.value).toBeGreaterThanOrEqual(1);
    expect(m.byUpdate.find((x) => x.label === 'Update Required')!.value).toBe(1);
  });

  it('builds tenant usage grouped by tenant, sorted by device count', () => {
    const t = buildTenantUsage(devices, NOW);
    expect(t[0].tenant).toBe('AI PowerSalon');
    expect(t[0].total).toBe(4);
    expect(t.find((x) => x.tenant === 'Glam Studio')!.total).toBe(1);
  });

  it('labels device types', () => {
    expect(typeLabel('reception_pos')).toBe('Reception POS');
    expect(typeLabel('caller_id')).toBe('Caller-ID Device');
  });
});
