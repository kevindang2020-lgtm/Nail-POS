// Verifies the DB-backed repo degrades honestly (empty lists / zero counts, never a throw) when the database
// is unavailable — this is what makes the production wiring safe: a bad/absent connection yields "no data",
// never fabricated data and never a crashed page. (Live-DB query correctness is covered by integration tests
// against Postgres, not this unit env.)
import { describe, it, expect } from 'vitest';
import { KyselyDeviceMgmtRepo } from './device-management.kysely.repository';

describe('KyselyDeviceMgmtRepo — honest degradation without a DB', () => {
  const repo = new KyselyDeviceMgmtRepo(null as any);

  it('listDevices returns [] rather than throwing', async () => {
    await expect(repo.listDevices({})).resolves.toEqual([]);
  });

  it('counts returns all-zero rather than fabricated numbers', async () => {
    await expect(repo.counts({})).resolves.toEqual({
      shipmentsPending: 0, maintenanceActive: 0, merchantTerminalsConnected: 0,
      callerIdOnline: 0, activeBranchAssignments: 0, updatesRequired: 0, lockedOrRevoked: 0,
    });
  });

  it('list-shaped reads return [] rather than throwing', async () => {
    await expect(repo.shipments()).resolves.toEqual([]);
    await expect(repo.maintenance()).resolves.toEqual([]);
    await expect(repo.securityAlerts()).resolves.toEqual([]);
    await expect(repo.connectionLogs()).resolves.toEqual([]);
    await expect(repo.catalog()).resolves.toEqual([]);
  });
});
