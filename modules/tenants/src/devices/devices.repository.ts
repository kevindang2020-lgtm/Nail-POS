// devices.repository.ts — DevicesRepositoryPort + the in-memory adapter used as the dev/offline/test default
// (identical pattern to Services/Bundles). The in-memory seed is scoped to tenant 'luxe001' ONLY — any other
// tenant gets empty arrays, which both proves isolation and yields honest empty states. Heartbeat timestamps are
// stored as offsets from "now" at read time, so online/offline is genuinely computed, not hardcoded.
import type { RawDevice, RawTerminal } from './devices-overview-core';
import type { DevicesContext } from './devices.dto';

export interface DevicesRepositoryPort {
  fleet(ctx: DevicesContext): Promise<RawDevice[]>;
  terminals(ctx: DevicesContext): Promise<RawTerminal[]>;
}

const SEED_TENANT = 'luxe001';
const MIN = 60_000;

// device seed: [name, type, station, minutesSinceSeen | null, pairingStatus, revoked?]
const DEVICE_SEED: Array<[string, string, string, number | null, string, boolean?]> = [
  ['Reception iMac 24"', 'iMac (24-inch)', 'Reception Desk', 1, 'paired'],
  ['Front Desk iPad', 'iPad (10th Gen)', 'Front Desk', 1, 'paired'],
  ['Customer Check-In iPad Mini', 'iPad Mini (6th Gen)', 'Check-In Kiosk 1', 2, 'paired'],
  ['Tech iPhone 14 Pro — Mia', 'iPhone 14 Pro', 'Nail Station 3', 1, 'paired'],
  ['Tech iPhone 14 Pro — Lily', 'iPhone 14 Pro', 'Nail Station 5', 9, 'reconnecting'],
  ['Receptionless Kiosk', 'Zettle Kiosk', 'Checkout Area', 2, 'paired'],
  ['Router / Network', 'UniFi Dream Router', 'Network Rack', 1, 'paired'],
  ['Back Office Mac', 'Mac mini', 'Manager Office', 40, 'maintenance'],
];

const TERMINAL_SEED: Array<[string, string]> = [
  ['Clover Flex #1', 'Front Desk'],
  ['Clover Mini #2', 'Front Desk'],
  ['Clover Flex #3', 'Pedicure Area'],
  ['Clover Go #1', 'Mobile'],
  ['Clover Station Solo', 'Manager Office'],
  ['Tap to Pay (iPad)', 'Front Desk iPad'],
];

export class InMemoryDevicesRepository implements DevicesRepositoryPort {
  async fleet(ctx: DevicesContext): Promise<RawDevice[]> {
    if (ctx.tenantId !== SEED_TENANT) return [];
    const now = Date.now();
    return DEVICE_SEED.map(([name, type, station, mins, pairing, revoked], i) => ({
      id: `dev_${i + 1}`,
      name,
      type,
      branchId: 'branch_downtown',
      branchName: 'Downtown Branch',
      station,
      pairingStatus: pairing,
      lastSeenMs: mins == null ? null : now - mins * MIN,
      revokedMs: revoked ? now - 30 * MIN : null,
    }));
  }

  async terminals(ctx: DevicesContext): Promise<RawTerminal[]> {
    if (ctx.tenantId !== SEED_TENANT) return [];
    const now = Date.now();
    return TERMINAL_SEED.map(([label, station], i) => ({
      id: `term_${i + 1}`,
      label,
      station,
      status: 'paired',
      pairedMs: now - 60 * MIN,
      branchId: 'branch_downtown',
    }));
  }
}
