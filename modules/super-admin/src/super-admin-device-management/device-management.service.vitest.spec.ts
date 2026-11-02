import { describe, it, expect } from 'vitest';
import { DeviceManagementService } from './device-management.service';
import { InMemoryDeviceMgmtRepo } from './device-management.repository';

const svc = () => new DeviceManagementService(new InMemoryDeviceMgmtRepo());

describe('DeviceManagementService', () => {
  it('builds the overview with 10 KPIs, mixes, tenant usage, catalog, alerts, logs', async () => {
    const ov = await svc().getOverview();
    expect(ov.kpis).toHaveLength(10);
    expect(ov.devices.length).toBeGreaterThan(0);
    expect(ov.byType.length).toBeGreaterThan(0);
    expect(ov.byStatus.length).toBeGreaterThan(0);
    expect(ov.byUpdate.length).toBeGreaterThan(0);
    expect(ov.tenantUsage.length).toBeGreaterThan(0);
    expect(ov.catalog).toHaveLength(8);
    expect(ov.securityAlerts.length).toBeGreaterThan(0);
    expect(ov.connectionLogs.length).toBeGreaterThan(0);
    expect(ov.shipmentsMaintenance.length).toBeGreaterThan(0);
    // 7-day trends need historical aggregates → honest NotConnected
    expect(ov.connectionTrend.available).toBe(false);
    expect(ov.terminalConnectivity.available).toBe(false);
  });

  it('device rows carry identity/assignment/status but no secret fields', async () => {
    const ov = await svc().getOverview();
    const r = ov.devices[0];
    expect(r).toHaveProperty('serial');
    expect(r).toHaveProperty('merchantTerminalId');
    expect(r).not.toHaveProperty('token');
    expect(r).not.toHaveProperty('privateKey');
    expect(JSON.stringify(ov)).not.toMatch(/private[_ ]?key|secret|token/i);
  });

  it('filters the directory by device type and status', async () => {
    const s = svc();
    const kiosks = await s.getDirectory({ deviceType: 'check_in_kiosk' });
    expect(kiosks.rows.every((r) => r.type === 'Check-In Kiosk')).toBe(true);
    const online = await s.getDirectory({ status: 'online' });
    expect(online.rows.every((r) => r.status === 'Online')).toBe(true);
  });

  it('marks a device offline when its heartbeat is stale', async () => {
    const ov = await svc().getOverview();
    // seed device 7 (Customer-Facing Display) last seen 20 min ago > 5 min threshold → Offline
    expect(ov.devices.find((d) => d.name === 'Customer-Facing Display')!.status).toBe('Offline');
  });

  it('returns a device detail with identity/connectivity/security fields and no secrets', async () => {
    const s = svc();
    const dir = await s.getDirectory({});
    const id = dir.rows[0].id;
    const res = await s.get(id);
    expect(res.ok).toBe(true);
    const d = res.device!;
    expect(d).toHaveProperty('ownershipType');
    expect(d).toHaveProperty('sessionStatus');
    expect(d).toHaveProperty('lockStatus');
    expect(d.ipMasked).toContain('•');
    const { note, ...rest } = d;
    expect(note).toMatch(/never displayed/);
    expect(JSON.stringify(rest)).not.toMatch(/private[_ ]?key|secret|token/i);
    expect((await s.get('nope')).ok).toBe(false);
  });

  it('classifies BYOD ownership for mobile devices', async () => {
    const s = svc();
    const dir = await s.getDirectory({ deviceType: 'owner_mobile' });
    const res = await s.get(dir.rows[0].id);
    expect(res.device!.ownershipType).toMatch(/BYOD/);
  });
});
