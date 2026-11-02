// devices.kysely.repository.ts — production DevicesRepositoryPort over Postgres.
// Fleet comes from the real device-registry table `customer_display_devices` (the only registry with heartbeat
// `last_seen_at` + `revoked_at`); terminals from `pos_payment_terminals` (migration 017). SCOPE is session-derived
// (tenant_id + branch-or-null), never the client. Reads are resilient (.catch → []) so one bad table never takes
// down the overview. Timestamps are normalized to epoch-ms for the pure core to classify online/offline.
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { RawDevice, RawTerminal } from './devices-overview-core';
import type { DevicesContext } from './devices.dto';
import type { DevicesRepositoryPort } from './devices.repository';

const toMs = (v: unknown): number | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? null : n;
};

export class KyselyDevicesRepository implements DevicesRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async fleet(ctx: DevicesContext): Promise<RawDevice[]> {
    const rows = await sql<{
      id: string; device_name: string | null; device_type: string | null; branch_id: string | null;
      branch_name: string | null; pos_station_id: string | null; pairing_status: string | null;
      last_seen_at: unknown; revoked_at: unknown;
    }>`
      SELECT d.id, d.device_name, d.device_type, d.branch_id, b.name AS branch_name,
             -- 23-inch spec §10, §85: the register by NAME (a display dedicated to it), and the owner's maintenance switch
             st.name AS pos_station_id,
             CASE WHEN d.maintenance_at IS NOT NULL AND d.revoked_at IS NULL THEN 'maintenance' ELSE d.pairing_status END AS pairing_status,
             d.last_seen_at, d.revoked_at
      FROM customer_display_devices d
      LEFT JOIN branches b ON b.id = d.branch_id AND b.tenant_id = d.tenant_id
      LEFT JOIN pos_stations st ON st.tenant_id = d.tenant_id AND st.id = d.pos_station_id
      WHERE d.tenant_id = ${ctx.tenantId}
        ${ctx.branchId ? sql`AND (d.branch_id = ${ctx.branchId} OR d.branch_id IS NULL)` : sql``}
      ORDER BY d.device_name NULLS LAST
    `.execute(this.db).then((r) => r.rows).catch(() => []);

    return rows.map((r) => ({
      id: r.id,
      name: r.device_name,
      type: r.device_type,
      branchId: r.branch_id,
      branchName: r.branch_name,
      station: r.pos_station_id,
      pairingStatus: r.pairing_status,
      lastSeenMs: toMs(r.last_seen_at),
      revokedMs: toMs(r.revoked_at),
    }));
  }

  async terminals(ctx: DevicesContext): Promise<RawTerminal[]> {
    const rows = await sql<{
      id: string; label: string; station_id: string | null; status: string; paired_at: unknown; branch_id: string | null;
      disabled_at: unknown; last_seen_at: unknown; last_ping_at: unknown; last_ping_ok: boolean | null; last_transaction_at: unknown; lease_holder: string | null;
    }>`
      SELECT t.id, t.label, COALESCE(st.name, t.station_id) AS station_id, t.status, t.paired_at, t.branch_id,
             t.disabled_at, t.last_seen_at, t.last_ping_at, t.last_ping_ok, t.last_transaction_at,
             (SELECT l.holder FROM payment_terminal_leases l WHERE l.tenant_id::text = t.tenant_id AND l.terminal_id = t.id AND l.expires_at > now() LIMIT 1) AS lease_holder
      FROM pos_payment_terminals t
      -- the register it serves, by name (Oct 6 2026: terminals are tied to registers); an older free-text value shows as typed
      LEFT JOIN pos_stations st ON st.tenant_id::text = t.tenant_id AND st.id::text = t.station_id AND st.retired_at IS NULL
      WHERE t.tenant_id = ${ctx.tenantId}
        ${ctx.branchId ? sql`AND (t.branch_id = ${ctx.branchId} OR t.branch_id IS NULL)` : sql``}
      ORDER BY t.label
    `.execute(this.db).then((r) => r.rows).catch((e) => {
      // w4 sweep SW-07: this used to be a SILENT [] — a uuid = text error hid every terminal from the Devices screen
      new Logger('DevicesRepository').warn(`payment terminals query failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      return [];
    });

    const iso = (v: unknown): string | null => { const n = toMs(v); return n == null ? null : new Date(n).toISOString(); };
    return rows.map((t) => ({
      id: t.id,
      label: t.label,
      station: t.station_id,
      status: t.status,
      pairedMs: toMs(t.paired_at),
      branchId: t.branch_id,
      // wave 3 PAYI §12 / §50: the registry + the live lease feed the ONE normalized status
      disabledAt: iso(t.disabled_at), lastSeenAt: iso(t.last_seen_at), lastPingAt: iso(t.last_ping_at), lastPingOk: t.last_ping_ok ?? null,
      lastTransactionAt: iso(t.last_transaction_at), leaseHolder: t.lease_holder ?? null,
    }));
  }
}
