// DB-backed DeviceMgmtRepo — reads REAL device inventory (customer displays, check-in devices, payment
// terminals) plus the greenfield support tables from migration 246 (device_catalog / device_shipments /
// device_maintenance / device_security_alerts). Per-device attributes that are not modeled on these tables
// (serial, OS, app version, per-device security/update status) are returned as null and surface as
// "Unknown"/"—" in the UI — they are NEVER fabricated. The module falls back to InMemoryDeviceMgmtRepo only
// when no database is configured (dev/tests).
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { ManagedDevice } from './device-management-core';
import type {
  DeviceMgmtRepo, ShipmentRow, MaintenanceRow, SecurityAlertRow, ConnectionLogRow, CatalogCard,
} from './device-management.repository';

const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => {
  try { return (await q.execute(db)).rows as T[]; } catch { return []; }
};
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => {
  try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; }
};
const msOf = (v: any): number | null => {
  if (!v) return null; const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null;
};
const numOf = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export class KyselyDeviceMgmtRepo implements DeviceMgmtRepo {
  constructor(private readonly db: AppDatabase) {}

  private toManaged(r: any): ManagedDevice {
    return {
      id: String(r.id),
      name: r.name,
      type: r.type,
      branchId: r.branch_id ?? null,
      branchName: r.branch_name ?? null,
      station: r.station ?? null,
      tenantId: r.tenant_id ?? null,
      tenantName: r.tenant_name ?? null,
      serial: null,
      os: null,
      appVersion: null,
      pairingStatus: r.pairing_status ?? null,
      lastSeenMs: msOf(r.last_seen_at),
      revokedMs: msOf(r.revoked_at),
      securityStatus: null,
      updateStatus: null,
      assignedUser: null,
      merchantTerminalId: r.merchant_terminal_id ?? null,
    } as ManagedDevice;
  }

  // Independent per-source reads (one failing source never zeroes out the others).
  async listDevices(scope: { tenantId?: string; branchId?: string }): Promise<ManagedDevice[]> {
    const tf = scope.tenantId ?? null;
    const bf = scope.branchId ?? null;
    const out: ManagedDevice[] = [];

    const displays = await rows<any>(this.db, sql`
      select d.id::text as id, coalesce(d.device_name, 'Customer Display') as name, 'customer_display' as type,
             d.branch_id::text as branch_id, b.name as branch_name, d.pos_station_id::text as station,
             d.tenant_id::text as tenant_id, t.display_name as tenant_name,
             d.pairing_status as pairing_status, d.last_seen_at as last_seen_at, d.revoked_at as revoked_at,
             null as merchant_terminal_id
      from customer_display_devices d
      left join branches b on b.id = d.branch_id
      left join tenants t on t.id = d.tenant_id
      where (${tf}::text is null or d.tenant_id::text = ${tf})
        and (${bf}::text is null or d.branch_id::text = ${bf})
      order by d.last_seen_at desc nulls last limit 500`);
    for (const r of displays) out.push(this.toManaged(r));

    const checkins = await rows<any>(this.db, sql`
      select d.id::text as id, coalesce(d.device_name, 'Check-In Device') as name, 'check_in_kiosk' as type,
             d.branch_id::text as branch_id, b.name as branch_name, null as station,
             d.tenant_id::text as tenant_id, t.display_name as tenant_name,
             d.status as pairing_status, d.last_seen_at as last_seen_at, d.disabled_at as revoked_at,
             null as merchant_terminal_id
      from go_checkin_devices d
      left join branches b on b.id = d.branch_id
      left join tenants t on t.id = d.tenant_id
      where (${tf}::text is null or d.tenant_id::text = ${tf})
        and (${bf}::text is null or d.branch_id::text = ${bf})
      order by d.last_seen_at desc nulls last limit 500`);
    for (const r of checkins) out.push(this.toManaged(r));

    const terminals = await rows<any>(this.db, sql`
      select d.id as id, coalesce(d.label, 'Payment Terminal') as name, 'payment_terminal' as type,
             d.branch_id as branch_id, b.name as branch_name, d.station_id as station,
             d.tenant_id as tenant_id, t.display_name as tenant_name,
             d.status as pairing_status, d.paired_at as last_seen_at, null as revoked_at,
             d.id as merchant_terminal_id
      from pos_payment_terminals d
      left join branches b on b.id::text = d.branch_id
      left join tenants t on t.id::text = d.tenant_id
      where (${tf}::text is null or d.tenant_id = ${tf})
        and (${bf}::text is null or d.branch_id = ${bf})
      order by d.paired_at desc nulls last limit 500`);
    for (const r of terminals) out.push(this.toManaged(r));

    return out;
  }

  async counts(scope: { tenantId?: string }): Promise<{ shipmentsPending: number; maintenanceActive: number; merchantTerminalsConnected: number; callerIdOnline: number; activeBranchAssignments: number; updatesRequired: number; lockedOrRevoked: number }> {
    const tf = scope.tenantId ?? null;
    const shipmentsPending = numOf((await one<{ c: string }>(this.db, sql`
      select count(*)::text as c from device_shipments
      where status not in ('delivered','cancelled','returned','lost')`, { c: '0' })).c);
    const maintenanceActive = numOf((await one<{ c: string }>(this.db, sql`
      select count(*)::text as c from device_maintenance where status not in ('completed','cancelled')`, { c: '0' })).c);
    const merchantTerminalsConnected = numOf((await one<{ c: string }>(this.db, sql`
      select count(*)::text as c from pos_payment_terminals
      where status <> 'unpaired' and (${tf}::text is null or tenant_id = ${tf})`, { c: '0' })).c);
    const activeBranchAssignments = numOf((await one<{ c: string }>(this.db, sql`
      select count(distinct d.branch_id)::text as c from customer_display_devices d
      where d.revoked_at is null and (${tf}::text is null or d.tenant_id::text = ${tf})`, { c: '0' })).c);
    const lockedOrRevoked = numOf((await one<{ c: string }>(this.db, sql`
      select (
        (select count(*) from customer_display_devices where revoked_at is not null
           and (${tf}::text is null or tenant_id::text = ${tf}))
      + (select count(*) from go_checkin_devices where disabled_at is not null
           and (${tf}::text is null or tenant_id::text = ${tf}))
      )::text as c`, { c: '0' })).c);
    // Not modeled per-device on these sources — reported as 0 rather than fabricated.
    const callerIdOnline = 0;
    const updatesRequired = 0;
    return { shipmentsPending, maintenanceActive, merchantTerminalsConnected, callerIdOnline, activeBranchAssignments, updatesRequired, lockedOrRevoked };
  }

  async shipments(): Promise<ShipmentRow[]> {
    return rows<ShipmentRow>(this.db, sql`
      select shipment_reference as reference, coalesce(device_label, device_type, '—') as device,
             coalesce(destination_branch, '—') as branch, status,
             to_char(eta_at, 'Mon DD, YYYY') as eta
      from device_shipments
      where status not in ('delivered','cancelled','returned','lost')
      order by created_at desc limit 50`);
  }

  async maintenance(): Promise<MaintenanceRow[]> {
    return rows<MaintenanceRow>(this.db, sql`
      select ticket_reference as reference, coalesce(device_label, '—') as device,
             coalesce(branch_name, '—') as branch, status,
             to_char(expected_return_at, 'Mon DD, YYYY') as eta
      from device_maintenance
      where status not in ('completed','cancelled')
      order by created_at desc limit 50`);
  }

  async securityAlerts(): Promise<SecurityAlertRow[]> {
    return rows<SecurityAlertRow>(this.db, sql`
      select coalesce(device_label, '—') as device, coalesce(tenant_name, '—') as tenant,
             issue, severity, last_action as "lastAction"
      from device_security_alerts
      where status in ('open','investigating','monitoring')
      order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
               updated_at desc
      limit 50`);
  }

  async connectionLogs(): Promise<ConnectionLogRow[]> {
    // Derived from REAL heartbeats (last_seen_at) on paired displays; there is no dedicated event-log table,
    // so only genuine last-seen rows are shown (no synthesized events).
    return rows<ConnectionLogRow>(this.db, sql`
      select to_char(d.last_seen_at, 'YYYY-MM-DD"T"HH24:MI') as time,
             coalesce(d.device_name, 'Device') as device, coalesce(t.display_name, '—') as tenant,
             'Heartbeat' as event, 'Success' as result
      from customer_display_devices d
      left join tenants t on t.id = d.tenant_id
      where d.last_seen_at is not null
      order by d.last_seen_at desc limit 25`);
  }

  async catalog(): Promise<CatalogCard[]> {
    return rows<CatalogCard>(this.db, sql`
      select device_type as "deviceType", display_name as "displayName",
             model_count::int as "modelCount", availability
      from device_catalog order by sort_order asc, display_name asc`);
  }
}
