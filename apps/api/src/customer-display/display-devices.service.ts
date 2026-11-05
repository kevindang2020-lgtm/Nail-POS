// display-devices.service.ts — 23-inch dual-screen spec §8–§12, §81–§86, §122–§124: the customer display as a DEVICE.
//
//   pairing (public, §8, §12) ── the display asks for a code, the owner types it into the POS, the display collects a
//                                device credential (a DEVICE principal — no owner credential ever touches the display)
//   heartbeat (§85–§86) ──────── every 30 s the display reports its mode, app version, screen and profile; "online" is
//                                derived from the last report, never stored as a flag that can go stale
//   management (§81–§86) ─────── the branch's displays and registers as the POS sees them, with the actions §82 lists
//                                (refresh) and the owner's (pair, rename, dedicate to a register or share, maintenance,
//                                revoke, registers)
//
// Tenant and branch always come from the signed session (staff) or from the display's own credential (the display) —
// never from a request body. Who may do what is the controller's @RequirePermission; this service checks that what is
// named belongs to the caller's branch.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { secureDigits } from '@aipowersalon/security';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import {
  DISPLAY_ONLINE_WINDOW_MS, DISPLAY_PAIRING_CODE_DIGITS, DISPLAY_PAIRING_TTL_SECONDS, DISPLAY_PROFILES, DISPLAY_REPORTED_MODES,
  displayDeviceState, normalizePairingCode, type DisplayProfile, type DisplayReportedMode,
} from '@aipowersalon/api-contracts';
import type { DisplayHeartbeatAck, DisplayPairingPoll, DisplayPairingStart, DisplayPlatform } from '@aipowersalon/api-contracts/customer';
import type { PosCustomerDisplaysState, PosDisplayDeviceView, PosDisplayRefreshResult, PosStationView } from '@aipowersalon/api-contracts/tenant';
import type { DisplayActor, DisplayPairingPort } from './display-pairing.repository';
import type { ActiveSessionRow, DeviceRow, DisplayAudit, DisplayDevicesPort, HeartbeatFacts } from './display-devices.repository';

export type DisplayDeviceErrorCode = 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'rate_limited' | 'unavailable';
export class DisplayDeviceError extends Error {
  constructor(public readonly code: DisplayDeviceErrorCode, message: string) { super(message); this.name = 'DisplayDeviceError'; }
}

/** The signed-in staff member (from req.ctx). */
export interface DisplayStaffCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; canManage?: boolean }
/** The display, as its credential proves it (customer-display.repository deviceByToken). */
export interface DisplayDeviceRef { id: string; tenantId: string; branchId: string | null }

/** A flood guard for the public start: more open codes than any real fleet could need at once means someone is spraying. */
export const MAX_OPEN_PAIRINGS = 1000;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const PLATFORMS: readonly DisplayPlatform[] = ['android', 'ios', 'web'];

/** A name a person typed: one line, no control characters, 1–40 characters. */
export function cleanDisplayName(v: unknown, what = 'name'): string {
  // eslint-disable-next-line no-control-regex -- the point of this rule is to remove control characters
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!s) throw new DisplayDeviceError('invalid', `Enter a ${what}.`);
  if (s.length > 40) throw new DisplayDeviceError('invalid', `Keep the ${what} to 40 characters.`);
  return s;
}

/** §85–§86: the heartbeat body, checked field by field (the display is a public client — nothing is trusted as sent). */
export function parseHeartbeat(body: unknown): HeartbeatFacts {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, any>;
  const mode = b.mode as DisplayReportedMode;
  if (!DISPLAY_REPORTED_MODES.includes(mode)) throw new DisplayDeviceError('invalid', 'mode must be check_in, checkout, advertisement or idle.');
  const appVersion = typeof b.appVersion === 'string' ? b.appVersion.trim() : '';
  if (!/^[\x20-\x7e]{1,40}$/.test(appVersion)) throw new DisplayDeviceError('invalid', 'appVersion must be 1–40 printable characters.');
  const sc = (b.screen && typeof b.screen === 'object' ? b.screen : {}) as Record<string, unknown>;
  const width = Number(sc.width), height = Number(sc.height), pr = Number(sc.pixelRatio);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 100 || width > 10000 || height > 10000) throw new DisplayDeviceError('invalid', 'screen width and height must be whole pixels between 100 and 10000.');
  if (!Number.isFinite(pr) || pr < 0.5 || pr > 8) throw new DisplayDeviceError('invalid', 'screen pixelRatio must be between 0.5 and 8.');
  const profile = b.profile as DisplayProfile;
  if (!DISPLAY_PROFILES.includes(profile)) throw new DisplayDeviceError('invalid', 'profile is not a display profile.');
  return { mode, appVersion, width, height, pixelRatio: Math.round(pr * 100) / 100, profile };
}

export class DisplayDevicesService {
  constructor(
    private readonly pairing: DisplayPairingPort,
    private readonly devices: DisplayDevicesPort,
    private readonly rt?: RealtimeEmitter,
    private readonly now: () => number = Date.now,
  ) {}

  // ══ pairing — public ═══════════════════════════════════════════════════════════════════════════════════════════════
  /** §8, §12: a display that has no credential asks for a code to show. The code identifies nothing until staff claim it. */
  async startPairing(body: unknown): Promise<DisplayPairingStart> {
    const p = (body && typeof body === 'object' ? (body as Record<string, unknown>).platform : undefined) as DisplayPlatform | undefined;
    const platform = p && PLATFORMS.includes(p) ? p : null;
    await this.pairing.purgeExpired(DISPLAY_PAIRING_TTL_SECONDS);
    if ((await this.pairing.openCount()) >= MAX_OPEN_PAIRINGS) throw new DisplayDeviceError('rate_limited', 'Too many displays are pairing right now. Try again in a minute.');
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = secureDigits(DISPLAY_PAIRING_CODE_DIGITS);
      const pollSecret = randomBytes(32).toString('base64url');
      const r = await this.pairing.create({ codeHash: sha(code), pollSecretHash: sha(pollSecret), ttlSeconds: DISPLAY_PAIRING_TTL_SECONDS, platform });
      if (r !== 'code_taken') return { pairingId: r.id, code, pollSecret, expiresAt: r.expiresAt };
    }
    throw new DisplayDeviceError('unavailable', 'Could not create a pairing code. Try again.');
  }

  /** The display asks whether staff claimed its code. Once claimed, the credential is minted NOW and handed over once. */
  async pollPairing(pairingId: unknown, pollSecret: unknown): Promise<DisplayPairingPoll> {
    if (typeof pairingId !== 'string' || typeof pollSecret !== 'string' || !pollSecret) throw new DisplayDeviceError('forbidden', 'A pairing id and its secret are required.');
    const p = await this.pairing.byId(pairingId);
    if (!p) return { status: 'expired' };
    const given = Buffer.from(sha(pollSecret)), stored = Buffer.from(p.pollSecretHash);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw new DisplayDeviceError('forbidden', 'This pairing belongs to another display.');
    if (!p.claimedAt) return Date.parse(p.expiresAt) <= this.now() ? { status: 'expired' } : { status: 'waiting', expiresAt: p.expiresAt };
    if (p.consumedAt) return { status: 'expired' };
    const deviceToken = randomBytes(32).toString('base64url');
    const got = await this.pairing.pickUp(p.id, sha(deviceToken));
    if (!got) return { status: 'expired' };
    const names = await this.devices.salonAndBranch(got.tenantId, got.branchId);
    this.toBranch(got.tenantId, got.branchId, { deviceId: got.deviceId, reason: 'connected' });
    return { status: 'paired', deviceToken, deviceName: got.name, salonName: names.salonName, branchName: names.branchName };
  }

  // ══ the display's heartbeat ════════════════════════════════════════════════════════════════════════════════════════
  /** §85–§86. The POS hears about it only when something it shows changed (mode, version, screen, back online) — a
   *  steady display does not wake every POS in the branch every 30 seconds. */
  async heartbeat(device: DisplayDeviceRef, body: unknown): Promise<DisplayHeartbeatAck> {
    const hb = parseHeartbeat(body);
    const before = await this.devices.recordHeartbeat(device.tenantId, device.id, hb);
    if (!before) throw new DisplayDeviceError('forbidden', 'This display is no longer paired.');
    const lastMs = before.lastSeenAt ? Date.parse(before.lastSeenAt) : null;
    const wasOffline = lastMs == null || this.now() - lastMs > DISPLAY_ONLINE_WINDOW_MS;
    const changed = wasOffline || before.reportedMode !== hb.mode || before.appVersion !== hb.appVersion || before.profile !== hb.profile
      || before.screenWidth !== hb.width || before.screenHeight !== hb.height || before.pixelRatio !== hb.pixelRatio;
    if (changed) this.toBranch(device.tenantId, device.branchId, { deviceId: device.id, reason: wasOffline ? 'online' : 'heartbeat' });
    return { maintenance: !!before.maintenanceAt };
  }

  // ══ staff ══════════════════════════════════════════════════════════════════════════════════════════════════════════
  private branchOf(ctx: DisplayStaffCtx): string {
    if (!ctx?.tenantId) throw new DisplayDeviceError('forbidden', 'Sign in to a salon first.');
    if (!ctx.branchId) throw new DisplayDeviceError('invalid', 'Choose a branch first — customer displays belong to a branch.');
    return ctx.branchId;
  }
  private actor(ctx: DisplayStaffCtx): DisplayActor { return { tenantId: ctx.tenantId, branchId: ctx.branchId || null, userId: ctx.userId || null, role: ctx.role || null }; }

  /** A display of the caller's branch, or not found (another branch's display is not this POS's to touch). */
  private async ownDevice(ctx: DisplayStaffCtx, deviceId: string): Promise<DeviceRow> {
    const branchId = this.branchOf(ctx);
    const d = typeof deviceId === 'string' ? await this.devices.device(ctx.tenantId, deviceId) : null;
    if (!d || d.revokedAt || d.branchId !== branchId) throw new DisplayDeviceError('not_found', 'That customer display is not in this branch.');
    return d;
  }
  private async ownStation(ctx: DisplayStaffCtx, stationId: unknown, branchId: string): Promise<string | null> {
    if (stationId === null || stationId === undefined || stationId === '') return null;
    const s = typeof stationId === 'string' ? await this.devices.station(ctx.tenantId, stationId) : null;
    if (!s || s.branchId !== branchId) throw new DisplayDeviceError('invalid', 'That register is not in this branch.');
    return s.id;
  }

  /** §81, §86, §123–§124: the branch's displays (with their live state and the checkout on each) and its registers. */
  async list(ctx: DisplayStaffCtx): Promise<PosCustomerDisplaysState> {
    const branchId = this.branchOf(ctx);
    const [rows, stations] = await Promise.all([this.devices.listDevices(ctx.tenantId, branchId), this.devices.listStations(ctx.tenantId, branchId)]);
    const sessions = await this.devices.activeSessions(ctx.tenantId, rows.map((d) => d.id));
    return {
      branchId, canManage: !!ctx.canManage,
      devices: rows.map((d) => this.view(d, sessions.find((s) => s.deviceId === d.id))),
      stations: stations.map((s): PosStationView => ({ id: s.id, name: s.name, branchId: s.branchId })),
    };
  }

  async get(ctx: DisplayStaffCtx, deviceId: string): Promise<PosDisplayDeviceView> {
    const d = await this.ownDevice(ctx, deviceId);
    const [s] = await this.devices.activeSessions(ctx.tenantId, [d.id]);
    return this.view(d, s);
  }

  /** §8–§10: the owner types the code the display shows. The display row is created for THIS session's salon and branch. */
  async pair(ctx: DisplayStaffCtx, body: unknown): Promise<PosDisplayDeviceView> {
    const branchId = this.branchOf(ctx);
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const code = normalizePairingCode(b.code);
    if (!code) throw new DisplayDeviceError('invalid', `Enter the ${DISPLAY_PAIRING_CODE_DIGITS}-digit code shown on the display.`);
    const name = cleanDisplayName(b.name, 'display name');
    const stationId = await this.ownStation(ctx, b.stationId, branchId);
    const claimed = await this.pairing.claim(sha(code), { tenantId: ctx.tenantId, branchId, name, stationId }, this.actor(ctx));
    if (!claimed) throw new DisplayDeviceError('invalid', 'That code is not open — check the code on the display (codes last 10 minutes and work once).');
    this.toBranch(ctx.tenantId, branchId, { deviceId: claimed.deviceId, reason: 'paired' });
    return this.get(ctx, claimed.deviceId);
  }

  /** §86: rename, dedicate to a register (§10 DEDICATED) or share with the branch (stationId null), maintenance (§85). */
  async update(ctx: DisplayStaffCtx, deviceId: string, body: unknown): Promise<PosDisplayDeviceView> {
    const d = await this.ownDevice(ctx, deviceId);
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const patch: { name?: string; stationId?: string | null; maintenance?: boolean } = {};
    const audits: DisplayAudit[] = [];
    if (b.name !== undefined) {
      patch.name = cleanDisplayName(b.name, 'display name');
      if (patch.name !== d.name) audits.push({ action: 'customer_display_renamed', metadata: { from: d.name, to: patch.name } });
    }
    if (b.stationId !== undefined) {
      patch.stationId = await this.ownStation(ctx, b.stationId, d.branchId!);
      if (patch.stationId !== d.stationId) audits.push({ action: 'customer_display_register_changed', metadata: { from: d.stationId, to: patch.stationId, pairing: patch.stationId ? 'dedicated' : 'shared' } });
    }
    if (b.maintenance !== undefined) {
      if (typeof b.maintenance !== 'boolean') throw new DisplayDeviceError('invalid', 'maintenance must be true or false.');
      patch.maintenance = b.maintenance;
      if (b.maintenance && !d.maintenanceAt) {
        // a customer is on it: maintenance would pull their checkout off the screen mid-visit
        const [s] = await this.devices.activeSessions(ctx.tenantId, [d.id]);
        if (s) throw new DisplayDeviceError('conflict', 'A checkout is on this display. Finish or cancel it before maintenance.');
        audits.push({ action: 'customer_display_maintenance_on', metadata: {} });
      } else if (!b.maintenance && d.maintenanceAt) audits.push({ action: 'customer_display_maintenance_off', metadata: {} });
    }
    if (!Object.keys(patch).length) throw new DisplayDeviceError('invalid', 'Nothing to change.');
    if (!(await this.devices.updateDevice(this.actor(ctx), d.id, patch, audits))) throw new DisplayDeviceError('not_found', 'That customer display is not in this branch.');
    this.toBranch(ctx.tenantId, d.branchId, { deviceId: d.id, reason: 'updated' });
    // the display itself shows maintenance (and its name, in the POS only) — it refetches its state on this
    if (patch.maintenance !== undefined) this.rt?.toCustomerDisplayDevice?.(d.id, EVENTS.customerDisplayDeviceUpdated, { deviceId: d.id, reason: 'maintenance' });
    return this.get(ctx, d.id);
  }

  /** §85 REVOKED: the credential is destroyed. The display's next request is refused and it returns to its pairing
   *  screen; a checkout on it is ended there (the POS carries on — §83). */
  async revoke(ctx: DisplayStaffCtx, deviceId: string): Promise<{ revoked: true; endedSessionIds: string[] }> {
    const d = await this.ownDevice(ctx, deviceId);
    const r = await this.devices.revokeDevice(this.actor(ctx), d.id);
    if (!r) throw new DisplayDeviceError('not_found', 'That customer display is not in this branch.');
    this.rt?.toCustomerDisplayDevice?.(d.id, EVENTS.customerDisplayDeviceUpdated, { deviceId: d.id, reason: 'revoked' });
    for (const sessionId of r.endedSessionIds) this.toBranchEvent(ctx.tenantId, d.branchId, EVENTS.customerDisplayCanceled, { sessionId, deviceId: d.id });
    this.toBranch(ctx.tenantId, d.branchId, { deviceId: d.id, reason: 'revoked' });
    return { revoked: true, endedSessionIds: r.endedSessionIds };
  }

  /** §82 "Refresh Display": a stuck or stale screen reloads its state, its advertising and its stream. */
  async refresh(ctx: DisplayStaffCtx, deviceId: string): Promise<PosDisplayRefreshResult> {
    const d = await this.ownDevice(ctx, deviceId);
    if (d.pairingStatus !== 'paired') throw new DisplayDeviceError('invalid', 'That display has not connected yet.');
    this.rt?.toCustomerDisplayDevice?.(d.id, EVENTS.customerDisplayRefreshRequested, { deviceId: d.id });
    return { requested: true, online: this.isOnline(d) };
  }

  // ── registers (§9–§10) ──
  async createStation(ctx: DisplayStaffCtx, body: unknown): Promise<PosStationView> {
    const branchId = this.branchOf(ctx);
    const name = cleanDisplayName((body as any)?.name, 'register name');
    const r = await this.devices.createStation(this.actor(ctx), branchId, name);
    if (r === 'duplicate') throw new DisplayDeviceError('conflict', 'A register with that name already exists in this branch.');
    this.toBranch(ctx.tenantId, branchId, { stationId: r.id, reason: 'registers' });
    return { id: r.id, name: r.name, branchId: r.branchId };
  }
  async renameStation(ctx: DisplayStaffCtx, stationId: string, body: unknown): Promise<PosStationView> {
    const branchId = this.branchOf(ctx);
    await this.ownStation(ctx, stationId, branchId);
    const name = cleanDisplayName((body as any)?.name, 'register name');
    const r = await this.devices.renameStation(this.actor(ctx), stationId, name);
    if (r === 'duplicate') throw new DisplayDeviceError('conflict', 'A register with that name already exists in this branch.');
    if (!r) throw new DisplayDeviceError('not_found', 'That register is not in this branch.');
    this.toBranch(ctx.tenantId, branchId, { stationId: r.id, reason: 'registers' });
    return { id: r.id, name: r.name, branchId: r.branchId };
  }
  async retireStation(ctx: DisplayStaffCtx, stationId: string): Promise<{ retired: true; unassignedDeviceIds: string[] }> {
    const branchId = this.branchOf(ctx);
    await this.ownStation(ctx, stationId, branchId);
    const r = await this.devices.retireStation(this.actor(ctx), stationId);
    if (!r) throw new DisplayDeviceError('not_found', 'That register is not in this branch.');
    this.toBranch(ctx.tenantId, branchId, { stationId, reason: 'registers' });
    return { retired: true, unassignedDeviceIds: r.unassignedDeviceIds };
  }

  // ── internals ──
  private isOnline(d: DeviceRow): boolean {
    const last = d.lastSeenAt ? Date.parse(d.lastSeenAt) : NaN;
    return Number.isFinite(last) && this.now() - last <= DISPLAY_ONLINE_WINDOW_MS;
  }

  private view(d: DeviceRow, s: ActiveSessionRow | undefined): PosDisplayDeviceView {
    const lastSeenMs = d.lastSeenAt ? Date.parse(d.lastSeenAt) : null;
    return {
      deviceId: d.id, name: d.name || 'Customer Display', branchId: d.branchId, branchName: d.branchName,
      pairing: d.stationId ? 'dedicated' : 'shared', stationId: d.stationId, stationName: d.stationName,
      state: displayDeviceState({ revoked: !!d.revokedAt, maintenance: !!d.maintenanceAt, lastSeenMs, reportedMode: d.reportedMode, hasActiveSession: !!s }, this.now()),
      online: this.isOnline(d), maintenance: !!d.maintenanceAt, lastSeenAt: d.lastSeenAt, mode: d.reportedMode, appVersion: d.appVersion,
      screen: d.screenWidth && d.screenHeight ? { width: d.screenWidth, height: d.screenHeight, pixelRatio: d.pixelRatio ?? 1 } : null,
      profile: d.profile,
      session: s ? { sessionId: s.sessionId, ticketId: s.ticketId ?? '', ticketNumber: s.ticketNumber ?? '', customerFirstName: s.customerFirstName, state: s.state } : null,
      pairedAt: d.createdAt, awaitingPickup: d.pairingStatus === 'pending',
    };
  }

  /** ids only — POS screens refetch GET /pos/customer-displays (realtime-contracts screens: checkout, devices). */
  private toBranch(tenantId: string, branchId: string | null, payload: Record<string, unknown>): void {
    this.toBranchEvent(tenantId, branchId, EVENTS.customerDisplayDeviceUpdated, payload);
  }
  private toBranchEvent(tenantId: string, branchId: string | null, event: (typeof EVENTS)[keyof typeof EVENTS], payload: Record<string, unknown>): void {
    // §343 exempt: a screen refresh signal — the device row and its audit_logs row are the record
    if (branchId) this.rt?.toTenant({ tenantId, branchId }, event, payload);
  }
}
