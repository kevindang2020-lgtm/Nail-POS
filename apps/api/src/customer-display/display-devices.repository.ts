// display-devices.repository.ts — 23-inch dual-screen spec §9–§10, §81–§86: a salon's customer displays and POS
// registers, for the POS (Devices → Customer Displays, the Checkout display card) and for the display's own heartbeat.
// Every statement here is scoped to ONE tenant (and, for lists, one branch) taken from the signed session or from the
// display's own credential — never from the request. The pairing handshake itself is display-pairing.repository.ts.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DisplayProfile, DisplayReportedMode } from '@aipowersalon/api-contracts';
import type { DisplayActor, DisplayPairingPort, DisplayPlatform, PairingClaim, PairingRow, PickedUp } from './display-pairing.repository';
import { deviceTypeFor, writeDisplayAudit } from './display-pairing.repository';

export interface DeviceRow {
  id: string; tenantId: string; branchId: string | null; branchName: string | null;
  name: string | null; deviceType: string | null; stationId: string | null; stationName: string | null;
  pairingStatus: string | null; revokedAt: string | null; lastSeenAt: string | null; createdAt: string | null;
  reportedMode: DisplayReportedMode | null; appVersion: string | null;
  screenWidth: number | null; screenHeight: number | null; pixelRatio: number | null; profile: DisplayProfile | null;
  maintenanceAt: string | null;
}
/** The checkout attached to a display right now — the staff-facing facts only (§81: first name and ticket number). */
export interface ActiveSessionRow { sessionId: string; deviceId: string; ticketId: string | null; ticketNumber: string | null; customerFirstName: string | null; state: string }
export interface StationRow { id: string; branchId: string; name: string }
export interface HeartbeatFacts { mode: DisplayReportedMode; appVersion: string; width: number; height: number; pixelRatio: number; profile: DisplayProfile; adPolicy?: { version: number; mode: 'PLATFORM_ONLY' | 'TENANT_ONLY' } | null }
export interface DevicePatch { name?: string; stationId?: string | null; maintenance?: boolean }
/** An audit_logs row written in the SAME transaction as the change it records. */
export interface DisplayAudit { action: string; metadata: Record<string, unknown> }

export interface DisplayDevicesPort {
  /** A branch's displays that are paired or waiting for their pickup (revoked ones are history). */
  listDevices(tenantId: string, branchId: string): Promise<DeviceRow[]>;
  device(tenantId: string, deviceId: string): Promise<DeviceRow | null>;
  /** Open checkouts on these displays (closed, completed, disconnected and expired sessions are not "on" a display). */
  activeSessions(tenantId: string, deviceIds: string[]): Promise<ActiveSessionRow[]>;
  updateDevice(actor: DisplayActor, deviceId: string, patch: DevicePatch, audits: DisplayAudit[]): Promise<boolean>;
  /** Revoke: the credential is destroyed (token hash cleared) and any checkout on it is ended. The ended sessions return. */
  revokeDevice(actor: DisplayActor, deviceId: string): Promise<{ endedSessionIds: string[] } | null>;
  /** The display's own report. Returns the row BEFORE the write (the caller decides whether anything changed). */
  recordHeartbeat(tenantId: string, deviceId: string, hb: HeartbeatFacts): Promise<DeviceRow | null>;
  listStations(tenantId: string, branchId: string): Promise<StationRow[]>;
  station(tenantId: string, stationId: string): Promise<StationRow | null>;
  createStation(actor: DisplayActor, branchId: string, name: string): Promise<StationRow | 'duplicate'>;
  renameStation(actor: DisplayActor, stationId: string, name: string): Promise<StationRow | 'duplicate' | null>;
  /** Retired, never deleted; the displays dedicated to it become SHARED. */
  retireStation(actor: DisplayActor, stationId: string): Promise<{ unassignedDeviceIds: string[] } | null>;
  salonAndBranch(tenantId: string, branchId: string | null): Promise<{ salonName: string; branchName: string | null }>;
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

function toDevice(r: any): DeviceRow {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ?? null, branchName: r.branch_name ?? null,
    name: r.device_name ?? null, deviceType: r.device_type ?? null, stationId: r.pos_station_id ?? null, stationName: r.station_name ?? null,
    pairingStatus: r.pairing_status ?? null, revokedAt: iso(r.revoked_at), lastSeenAt: iso(r.last_seen_at), createdAt: iso(r.created_at),
    reportedMode: (r.reported_mode ?? null) as DisplayReportedMode | null, appVersion: r.app_version ?? null,
    screenWidth: num(r.screen_width), screenHeight: num(r.screen_height), pixelRatio: num(r.pixel_ratio), profile: (r.display_profile ?? null) as DisplayProfile | null,
    maintenanceAt: iso(r.maintenance_at),
  };
}

/** Sessions that are ON a display: open, not ended by any path, not past their clock. */
const OPEN_SESSION = sql`s.closed_at IS NULL AND s.state NOT IN ('closed', 'disconnected', 'completed') AND (s.expires_at IS NULL OR s.expires_at > now())`;

export class KyselyDisplayDevicesRepository implements DisplayDevicesPort {
  constructor(private readonly db: Kysely<DB>) {}

  private deviceQuery(tenantId: string) {
    return sql`
      SELECT d.id, d.tenant_id, d.branch_id, d.device_name, d.device_type, d.pos_station_id, d.pairing_status, d.revoked_at,
             d.last_seen_at, d.created_at, d.reported_mode, d.app_version, d.screen_width, d.screen_height, d.pixel_ratio,
             d.display_profile, d.maintenance_at,
             b.name AS branch_name, st.name AS station_name   -- Phase 12 #19: exactly what toDevice() maps — never the pairing / token hashes
        FROM customer_display_devices d
        LEFT JOIN branches b ON b.tenant_id = d.tenant_id AND b.id = d.branch_id
        LEFT JOIN pos_stations st ON st.tenant_id = d.tenant_id AND st.id = d.pos_station_id
       WHERE d.tenant_id = ${tenantId}`;
  }

  async listDevices(tenantId: string, branchId: string): Promise<DeviceRow[]> {
    const r = await sql<any>`${this.deviceQuery(tenantId)}
         AND d.branch_id = ${branchId} AND d.revoked_at IS NULL AND d.pairing_status IN ('paired', 'pending')
       ORDER BY d.created_at ASC`.execute(this.db);
    return r.rows.map(toDevice);
  }

  async device(tenantId: string, deviceId: string): Promise<DeviceRow | null> {
    if (!isUuid(deviceId)) return null;
    const r = await sql<any>`${this.deviceQuery(tenantId)} AND d.id = ${deviceId}`.execute(this.db);
    return r.rows[0] ? toDevice(r.rows[0]) : null;
  }

  async activeSessions(tenantId: string, deviceIds: string[]): Promise<ActiveSessionRow[]> {
    const ids = deviceIds.filter(isUuid);
    if (!ids.length) return [];
    const r = await sql<any>`
      SELECT s.id, s.display_device_id, s.ticket_id, s.state, t.ticket_number, c.first_name
        FROM customer_display_sessions s
        LEFT JOIN tickets t ON t.tenant_id = s.tenant_id AND t.id = s.ticket_id
        LEFT JOIN customers c ON c.tenant_id = s.tenant_id AND c.id = s.customer_id
       WHERE s.tenant_id = ${tenantId} AND s.display_device_id IN (${sql.join(ids)}) AND ${OPEN_SESSION}
       ORDER BY s.created_at DESC`.execute(this.db);
    return r.rows.map((x: any) => ({
      sessionId: String(x.id), deviceId: String(x.display_device_id), ticketId: x.ticket_id ?? null,
      ticketNumber: x.ticket_number != null ? String(x.ticket_number) : null, customerFirstName: x.first_name || null, state: String(x.state),
    }));
  }

  async updateDevice(actor: DisplayActor, deviceId: string, patch: DevicePatch, audits: DisplayAudit[]): Promise<boolean> {
    if (!isUuid(deviceId)) return false;
    const tenantId = actor.tenantId;
    const sets = [sql`updated_at = now()`];
    if (patch.name !== undefined) sets.push(sql`device_name = ${patch.name}`);
    if (patch.stationId !== undefined) sets.push(sql`pos_station_id = ${patch.stationId}`);
    if (patch.maintenance !== undefined) sets.push(patch.maintenance ? sql`maintenance_at = COALESCE(maintenance_at, now())` : sql`maintenance_at = NULL`);
    return this.db.transaction().execute(async (trx) => {
      const r = await sql`UPDATE customer_display_devices SET ${sql.join(sets)}
         WHERE tenant_id = ${tenantId} AND id = ${deviceId} AND revoked_at IS NULL`.execute(trx);
      if (Number(r.numAffectedRows ?? 0) === 0) return false;
      for (const a of audits) await writeDisplayAudit(trx, actor, a.action, 'customer_display', deviceId, a.metadata);
      return true;
    });
  }

  async revokeDevice(actor: DisplayActor, deviceId: string): Promise<{ endedSessionIds: string[] } | null> {
    if (!isUuid(deviceId)) return null;
    const tenantId = actor.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const r = await sql`
        UPDATE customer_display_devices
           SET revoked_at = now(), pairing_status = 'unpaired', device_token_hash = NULL, maintenance_at = NULL, updated_at = now()
         WHERE tenant_id = ${tenantId} AND id = ${deviceId} AND revoked_at IS NULL`.execute(trx);
      if (Number(r.numAffectedRows ?? 0) === 0) return null;
      const ended = await sql<{ id: string }>`
        UPDATE customer_display_sessions s SET state = 'disconnected', closed_at = now(), updated_at = now()
         WHERE s.tenant_id = ${tenantId} AND s.display_device_id = ${deviceId} AND s.closed_at IS NULL AND s.state NOT IN ('closed', 'disconnected', 'completed')
        RETURNING s.id`.execute(trx);
      const endedSessionIds = ended.rows.map((x) => String(x.id));
      await writeDisplayAudit(trx, actor, 'customer_display_revoked', 'customer_display', deviceId, { endedSessionIds });
      return { endedSessionIds };
    });
  }

  async recordHeartbeat(tenantId: string, deviceId: string, hb: HeartbeatFacts): Promise<DeviceRow | null> {
    if (!isUuid(deviceId)) return null;
    return this.db.transaction().execute(async (trx) => {
      const before = await sql<any>`${this.deviceQuery(tenantId)} AND d.id = ${deviceId} AND d.revoked_at IS NULL FOR UPDATE OF d`.execute(trx);
      if (!before.rows[0]) return null;
      await sql`
        UPDATE customer_display_devices
           SET last_seen_at = now(), reported_mode = ${hb.mode}, app_version = ${hb.appVersion}, screen_width = ${hb.width},
               screen_height = ${hb.height}, pixel_ratio = ${hb.pixelRatio}, display_profile = ${hb.profile}
         WHERE tenant_id = ${tenantId} AND id = ${deviceId}`.execute(trx);
      // G7: what the display last APPLIED (policy version + mode) — the only source of "policy applied" in the fleet status
      if (hb.adPolicy) await sql`UPDATE customer_display_devices SET applied_ad_policy_version = ${hb.adPolicy.version}, applied_ad_mode = ${hb.adPolicy.mode},
          applied_ad_at = CASE WHEN applied_ad_policy_version IS DISTINCT FROM ${hb.adPolicy.version} OR applied_ad_mode IS DISTINCT FROM ${hb.adPolicy.mode} THEN now() ELSE applied_ad_at END
         WHERE tenant_id = ${tenantId} AND id = ${deviceId}`.execute(trx);
      return toDevice(before.rows[0]);
    });
  }

  async listStations(tenantId: string, branchId: string): Promise<StationRow[]> {
    const r = await sql<any>`
      SELECT id, branch_id, name FROM pos_stations
       WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND retired_at IS NULL
       ORDER BY lower(name), created_at`.execute(this.db);
    return r.rows.map((x: any) => ({ id: String(x.id), branchId: String(x.branch_id), name: String(x.name) }));
  }

  async station(tenantId: string, stationId: string): Promise<StationRow | null> {
    if (!isUuid(stationId)) return null;
    const r = await sql<any>`SELECT id, branch_id, name FROM pos_stations WHERE tenant_id = ${tenantId} AND id = ${stationId} AND retired_at IS NULL`.execute(this.db);
    const x = r.rows[0];
    return x ? { id: String(x.id), branchId: String(x.branch_id), name: String(x.name) } : null;
  }

  async createStation(actor: DisplayActor, branchId: string, name: string): Promise<StationRow | 'duplicate'> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const r = await sql<any>`INSERT INTO pos_stations (tenant_id, branch_id, name) VALUES (${actor.tenantId}, ${branchId}, ${name}) RETURNING id, branch_id, name`.execute(trx);
        const x = r.rows[0];
        await writeDisplayAudit(trx, actor, 'pos_station_created', 'pos_station', String(x.id), { name });
        return { id: String(x.id), branchId: String(x.branch_id), name: String(x.name) };
      });
    } catch (e: any) {
      if (e?.code === '23505') return 'duplicate';
      throw e;
    }
  }

  async renameStation(actor: DisplayActor, stationId: string, name: string): Promise<StationRow | 'duplicate' | null> {
    if (!isUuid(stationId)) return null;
    try {
      return await this.db.transaction().execute(async (trx) => {
        const before = await sql<any>`SELECT name FROM pos_stations WHERE tenant_id = ${actor.tenantId} AND id = ${stationId} AND retired_at IS NULL FOR UPDATE`.execute(trx);
        if (!before.rows[0]) return null;
        const r = await sql<any>`
          UPDATE pos_stations SET name = ${name}, updated_at = now()
           WHERE tenant_id = ${actor.tenantId} AND id = ${stationId} AND retired_at IS NULL
          RETURNING id, branch_id, name`.execute(trx);
        const x = r.rows[0];
        await writeDisplayAudit(trx, actor, 'pos_station_renamed', 'pos_station', stationId, { from: before.rows[0].name, to: name });
        return { id: String(x.id), branchId: String(x.branch_id), name: String(x.name) };
      });
    } catch (e: any) {
      if (e?.code === '23505') return 'duplicate';
      throw e;
    }
  }

  async retireStation(actor: DisplayActor, stationId: string): Promise<{ unassignedDeviceIds: string[] } | null> {
    if (!isUuid(stationId)) return null;
    const tenantId = actor.tenantId;
    return this.db.transaction().execute(async (trx) => {
      const r = await sql`UPDATE pos_stations SET retired_at = now(), updated_at = now() WHERE tenant_id = ${tenantId} AND id = ${stationId} AND retired_at IS NULL`.execute(trx);
      if (Number(r.numAffectedRows ?? 0) === 0) return null;
      const d = await sql<{ id: string }>`
        UPDATE customer_display_devices SET pos_station_id = NULL, updated_at = now()
         WHERE tenant_id = ${tenantId} AND pos_station_id = ${stationId}
        RETURNING id`.execute(trx);
      const unassignedDeviceIds = d.rows.map((x) => String(x.id));
      // Payment Terminals mandate §6 (Oct 29 2026): a card terminal that served this register no longer points at a retired
      // register (it showed "<id> is not a register" and the routing table kept a dead association)
      const t = await sql<{ id: string }>`
        UPDATE pos_payment_terminals SET station_id = NULL, updated_at = now()
         WHERE tenant_id = ${String(tenantId)} AND station_id = ${stationId}
        RETURNING id`.execute(trx);
      const unassignedTerminalIds = t.rows.map((x) => String(x.id));
      await writeDisplayAudit(trx, actor, 'pos_station_retired', 'pos_station', stationId, { unassignedDeviceIds, unassignedTerminalIds });
      return { unassignedDeviceIds };
    });
  }

  async salonAndBranch(tenantId: string, branchId: string | null): Promise<{ salonName: string; branchName: string | null }> {
    const t = await sql<any>`SELECT display_name, legal_name FROM tenants WHERE id = ${tenantId}`.execute(this.db);
    const b = branchId && isUuid(branchId) ? await sql<any>`SELECT name FROM branches WHERE tenant_id = ${tenantId} AND id = ${branchId}`.execute(this.db) : null;
    return { salonName: t.rows[0]?.display_name || t.rows[0]?.legal_name || 'Salon', branchName: b?.rows[0]?.name ?? null };
  }
}

// ── DB-less wiring and the service's unit tests: one in-memory store behind BOTH ports, so a claim made through the
//    pairing port is a display the devices port lists (the real tables are one database too). ───────────────────────
interface MemDevice extends Omit<DeviceRow, 'branchName' | 'stationName'> { tokenHash: string | null }
interface MemSession { id: string; tenantId: string; deviceId: string; ticketId: string | null; ticketNumber: string | null; customerFirstName: string | null; state: string; closed: boolean }
interface MemPairing extends PairingRow { codeHash: string; createdAt: number; expiresMs: number }

export class InMemoryDisplayDevices implements DisplayDevicesPort, DisplayPairingPort {
  readonly devices: MemDevice[] = [];
  readonly stations: (StationRow & { tenantId: string; retired: boolean })[] = [];
  readonly sessions: MemSession[] = [];
  readonly pairings: MemPairing[] = [];
  readonly branches = new Map<string, { tenantId: string; name: string }>();
  readonly salons = new Map<string, string>();
  readonly audits: { actor: DisplayActor; action: string; entityId: string | null; metadata: Record<string, unknown> }[] = [];
  private seq = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private uuid(): string { this.seq++; return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`; }
  private view(d: MemDevice): DeviceRow {
    const st = d.stationId ? this.stations.find((s) => s.id === d.stationId && s.tenantId === d.tenantId) : undefined;
    const b = d.branchId ? this.branches.get(d.branchId) : undefined;
    const { tokenHash: _t, ...rest } = d;
    return { ...rest, branchName: b && b.tenantId === d.tenantId ? b.name : null, stationName: st?.name ?? null };
  }
  /** test seam: a display that is already paired */
  seedDevice(d: Partial<MemDevice> & { tenantId: string; branchId: string }): MemDevice {
    const row: MemDevice = {
      id: this.uuid(), name: 'Front Display', deviceType: 'android', stationId: null, pairingStatus: 'paired', revokedAt: null, lastSeenAt: null,
      createdAt: new Date(this.now()).toISOString(), reportedMode: null, appVersion: null, screenWidth: null, screenHeight: null, pixelRatio: null,
      profile: null, maintenanceAt: null, tokenHash: null, ...d,
    };
    this.devices.push(row);
    return row;
  }
  seedSession(s: Omit<MemSession, 'id' | 'closed'> & { closed?: boolean }): MemSession { const row = { id: this.uuid(), closed: false, ...s }; this.sessions.push(row); return row; }

  // ── DisplayDevicesPort ──
  async listDevices(tenantId: string, branchId: string): Promise<DeviceRow[]> {
    return this.devices.filter((d) => d.tenantId === tenantId && d.branchId === branchId && !d.revokedAt && (d.pairingStatus === 'paired' || d.pairingStatus === 'pending')).map((d) => this.view(d));
  }
  async device(tenantId: string, deviceId: string): Promise<DeviceRow | null> {
    const d = this.devices.find((x) => x.tenantId === tenantId && x.id === deviceId);
    return d ? this.view(d) : null;
  }
  async activeSessions(tenantId: string, deviceIds: string[]): Promise<ActiveSessionRow[]> {
    return this.sessions.filter((s) => s.tenantId === tenantId && deviceIds.includes(s.deviceId) && !s.closed && !['closed', 'disconnected', 'completed'].includes(s.state))
      .map((s) => ({ sessionId: s.id, deviceId: s.deviceId, ticketId: s.ticketId, ticketNumber: s.ticketNumber, customerFirstName: s.customerFirstName, state: s.state }));
  }
  async updateDevice(actor: DisplayActor, deviceId: string, patch: DevicePatch, audits: DisplayAudit[]): Promise<boolean> {
    const d = this.devices.find((x) => x.tenantId === actor.tenantId && x.id === deviceId && !x.revokedAt);
    if (!d) return false;
    if (patch.name !== undefined) d.name = patch.name;
    if (patch.stationId !== undefined) d.stationId = patch.stationId;
    if (patch.maintenance !== undefined) d.maintenanceAt = patch.maintenance ? (d.maintenanceAt ?? new Date(this.now()).toISOString()) : null;
    for (const a of audits) this.audits.push({ actor, action: a.action, entityId: deviceId, metadata: a.metadata });
    return true;
  }
  async revokeDevice(actor: DisplayActor, deviceId: string): Promise<{ endedSessionIds: string[] } | null> {
    const d = this.devices.find((x) => x.tenantId === actor.tenantId && x.id === deviceId && !x.revokedAt);
    if (!d) return null;
    d.revokedAt = new Date(this.now()).toISOString(); d.pairingStatus = 'unpaired'; d.tokenHash = null; d.maintenanceAt = null;
    const ended = this.sessions.filter((s) => s.tenantId === actor.tenantId && s.deviceId === deviceId && !s.closed && !['closed', 'disconnected', 'completed'].includes(s.state));
    for (const s of ended) { s.closed = true; s.state = 'disconnected'; }
    this.audits.push({ actor, action: 'customer_display_revoked', entityId: deviceId, metadata: { endedSessionIds: ended.map((s) => s.id) } });
    return { endedSessionIds: ended.map((s) => s.id) };
  }
  async recordHeartbeat(tenantId: string, deviceId: string, hb: HeartbeatFacts): Promise<DeviceRow | null> {
    const d = this.devices.find((x) => x.tenantId === tenantId && x.id === deviceId && !x.revokedAt);
    if (!d) return null;
    const before = this.view(d);
    Object.assign(d, { lastSeenAt: new Date(this.now()).toISOString(), reportedMode: hb.mode, appVersion: hb.appVersion, screenWidth: hb.width, screenHeight: hb.height, pixelRatio: hb.pixelRatio, profile: hb.profile });
    return before;
  }
  async listStations(tenantId: string, branchId: string): Promise<StationRow[]> {
    return this.stations.filter((s) => s.tenantId === tenantId && s.branchId === branchId && !s.retired).map(({ id, branchId: b, name }) => ({ id, branchId: b, name }));
  }
  async station(tenantId: string, stationId: string): Promise<StationRow | null> {
    const s = this.stations.find((x) => x.tenantId === tenantId && x.id === stationId && !x.retired);
    return s ? { id: s.id, branchId: s.branchId, name: s.name } : null;
  }
  async createStation(actor: DisplayActor, branchId: string, name: string): Promise<StationRow | 'duplicate'> {
    const tenantId = actor.tenantId;
    if (this.stations.some((s) => s.tenantId === tenantId && s.branchId === branchId && !s.retired && s.name.trim().toLowerCase() === name.trim().toLowerCase())) return 'duplicate';
    const s = { id: this.uuid(), tenantId, branchId, name, retired: false };
    this.stations.push(s);
    this.audits.push({ actor, action: 'pos_station_created', entityId: s.id, metadata: { name } });
    return { id: s.id, branchId, name };
  }
  async renameStation(actor: DisplayActor, stationId: string, name: string): Promise<StationRow | 'duplicate' | null> {
    const tenantId = actor.tenantId;
    const s = this.stations.find((x) => x.tenantId === tenantId && x.id === stationId && !x.retired);
    if (!s) return null;
    if (this.stations.some((o) => o !== s && o.tenantId === tenantId && o.branchId === s.branchId && !o.retired && o.name.trim().toLowerCase() === name.trim().toLowerCase())) return 'duplicate';
    this.audits.push({ actor, action: 'pos_station_renamed', entityId: s.id, metadata: { from: s.name, to: name } });
    s.name = name;
    return { id: s.id, branchId: s.branchId, name };
  }
  async retireStation(actor: DisplayActor, stationId: string): Promise<{ unassignedDeviceIds: string[] } | null> {
    const tenantId = actor.tenantId;
    const s = this.stations.find((x) => x.tenantId === tenantId && x.id === stationId && !x.retired);
    if (!s) return null;
    s.retired = true;
    const ds = this.devices.filter((d) => d.tenantId === tenantId && d.stationId === stationId);
    for (const d of ds) d.stationId = null;
    this.audits.push({ actor, action: 'pos_station_retired', entityId: s.id, metadata: { unassignedDeviceIds: ds.map((d) => d.id) } });
    return { unassignedDeviceIds: ds.map((d) => d.id) };
  }
  async salonAndBranch(tenantId: string, branchId: string | null): Promise<{ salonName: string; branchName: string | null }> {
    const b = branchId ? this.branches.get(branchId) : undefined;
    return { salonName: this.salons.get(tenantId) ?? 'Salon', branchName: b && b.tenantId === tenantId ? b.name : null };
  }

  // ── DisplayPairingPort ──
  async purgeExpired(ttlSeconds: number): Promise<void> {
    const now = this.now();
    for (const p of this.pairings) {
      if (p.claimedAt && !p.consumedAt && Date.parse(p.claimedAt) < now - ttlSeconds * 1000) {
        const d = this.devices.find((x) => x.tenantId === p.tenantId && x.id === p.deviceId && x.pairingStatus === 'pending' && !x.revokedAt);
        if (d) { d.revokedAt = new Date(now).toISOString(); d.pairingStatus = 'unpaired'; }
      }
    }
    const keep = this.pairings.filter((p) => !((!p.claimedAt && p.expiresMs < now) || (!p.consumedAt && p.claimedAt && Date.parse(p.claimedAt) < now - ttlSeconds * 1000) || (p.consumedAt && Date.parse(p.consumedAt) < now - 86_400_000)));
    this.pairings.splice(0, this.pairings.length, ...keep);
  }
  async openCount(): Promise<number> { const now = this.now(); return this.pairings.filter((p) => !p.claimedAt && p.expiresMs > now).length; }
  async create(p: { codeHash: string; pollSecretHash: string; ttlSeconds: number; platform: DisplayPlatform | null }): Promise<{ id: string; expiresAt: string } | 'code_taken'> {
    if (this.pairings.some((x) => x.codeHash === p.codeHash && !x.claimedAt)) return 'code_taken';
    const expiresMs = this.now() + p.ttlSeconds * 1000;
    const row: MemPairing = { id: this.uuid(), codeHash: p.codeHash, pollSecretHash: p.pollSecretHash, expiresAt: new Date(expiresMs).toISOString(), expiresMs, createdAt: this.now(), platform: p.platform, tenantId: null, deviceId: null, claimedAt: null, consumedAt: null };
    this.pairings.push(row);
    return { id: row.id, expiresAt: row.expiresAt };
  }
  async byId(id: string): Promise<PairingRow | null> {
    const p = this.pairings.find((x) => x.id === id);
    if (!p) return null;
    const { codeHash: _c, createdAt: _a, expiresMs: _e, ...row } = p;
    return { ...row };
  }
  async claim(codeHash: string, c: PairingClaim, actor: DisplayActor): Promise<{ deviceId: string; platform: DisplayPlatform | null } | null> {
    const p = this.pairings.find((x) => x.codeHash === codeHash && !x.claimedAt && x.expiresMs > this.now());
    if (!p) return null;
    const d = this.seedDevice({ tenantId: c.tenantId, branchId: c.branchId, stationId: c.stationId, name: c.name, deviceType: deviceTypeFor(p.platform), pairingStatus: 'pending' });
    Object.assign(p, { tenantId: c.tenantId, deviceId: d.id, claimedAt: new Date(this.now()).toISOString() });
    this.audits.push({ actor, action: 'customer_display_paired', entityId: d.id, metadata: { name: c.name, stationId: c.stationId, platform: p.platform } });
    return { deviceId: d.id, platform: p.platform };
  }
  async pickUp(id: string, tokenHash: string): Promise<PickedUp | null> {
    const p = this.pairings.find((x) => x.id === id && x.claimedAt && !x.consumedAt);
    if (!p) return null;
    p.consumedAt = new Date(this.now()).toISOString();
    const d = this.devices.find((x) => x.tenantId === p.tenantId && x.id === p.deviceId && !x.revokedAt && x.pairingStatus === 'pending');
    if (!d) return null;
    Object.assign(d, { tokenHash, pairingStatus: 'paired', lastSeenAt: new Date(this.now()).toISOString() });
    return { deviceId: d.id, tenantId: d.tenantId, branchId: d.branchId, name: d.name || 'Customer Display' };
  }
  /** test seam: which display a token hash belongs to (the real lookup is customer-display.repository deviceByToken) */
  deviceByTokenHash(hash: string): MemDevice | undefined { return this.devices.find((d) => d.tokenHash === hash && !d.revokedAt); }
}
