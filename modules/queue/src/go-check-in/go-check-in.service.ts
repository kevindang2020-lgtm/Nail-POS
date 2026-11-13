// go-check-in.service.ts — orchestrates the customer-facing kiosk check-in.
// SECURITY MODEL: tenant_id/branch_id come ONLY from the device record (resolved from the slug/token on the server)
// and are carried in the session. The kiosk never sends a tenantId. The actual check-in work reuses the existing
// CheckInService, called with a synthetic "kiosk" CheckInContext built from the session's tenant/branch — so all the
// validated, tenant-scoped check-in logic (dedup, queue creation, idempotent appointment arrival) is shared, and a
// Tenant A kiosk physically cannot act on Tenant B.
import type { TechnicianEligibilityService } from '@aipowersalon/workforce';
import { assertTransition } from '@aipowersalon/database';
import { GO_CHECKIN_DEVICE } from '../queue-lifecycles';
import { businessDate, localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';
import type { GoCheckInDeviceView } from '@aipowersalon/api-contracts/tenant';
import type { AppointmentToday, KioskServiceOption, KioskTechnicianOption } from '@aipowersalon/api-contracts/customer';
import { CHECK_IN_ELIGIBLE_STATUSES, withCode } from '@aipowersalon/api-contracts';
import { CheckInService } from '../check-in/check-in.service';
import { QueueService } from '../queue/queue.service';
import { QueueAssignmentConflict, type QueueAlternatesView, type AcceptAlternateResult } from '../queue/queue.dto';
import type { QueueContext } from '../queue/queue.repository';

/** BUILD_PLAN Phase 6 round 2: what the kiosk needs from the queue (QueueService in production, a stub in tests). */
export interface KioskQueuePort {
  alternatesForItem(ctx: QueueContext, queueItemId: string): Promise<QueueAlternatesView>;
  acceptAlternateForItem(ctx: QueueContext, queueItemId: string, technicianId: string, source: 'customer' | 'kiosk'): Promise<AcceptAlternateResult>;
}
/** The check-in result's round-2 additions (mirrored in @aipowersalon/api-contracts/customer CheckInConfirmation). */
export type KioskQueueFields = { queueItemId?: string } & QueueAlternatesView;
import { type CheckInContext } from '../check-in/check-in.repository';
import { TechnicianClockPinService, KioskPinLockedError, TimeClockService, type TimeClockContext } from '@aipowersalon/workforce';
import { REALTIME, type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { Injectable, Inject, Optional } from '@nestjs/common';
import type { GoCheckInDataPort, DeviceRow, SessionRow, DisplayDeviceRow, ApptRow } from './go-check-in.repository';
import { clockLabel, waitRangeFor, visitFor, visitAnchoredAt, kioskTechnicians, requiredCategories } from './go-check-in-rules';
import { BOOKING_CHECKIN_RECORDER, type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import {
  GoCheckInSettings, normalizePhone, maskEmail, lastInitial, sha256Hex, newToken, newSlug, tokenMatches,
  deviceTokenExpiry, isTokenExpired, selectableBranchIds, resolveSessionBranch,
  LookupResult, CheckInConfirmation, KioskConfig, MAX_LOOKUPS_PER_SESSION, KIOSK_WINDOW_MINUTES, MAX_KIOSK_SESSIONS_PER_WINDOW, MAX_KIOSK_LOOKUPS_PER_WINDOW, MAX_CREATES_PER_SESSION, SESSION_IDLE_MS,
} from './go-check-in.dto';

/**
 * The wait estimate the kiosk may show. showWaitEstimate is configurable on the Super Admin check-in screen and was
 * read by NOTHING: both check-in responses returned the estimate unconditionally, and the kiosk displays whatever it
 * receives — so switching it off changed nothing a customer saw. Enforced here, server-side, because the kiosk is a
 * thin display: it cannot be trusted to honour a flag it is never sent, and should not have to.
 */
export function waitEstimateFor(settings: { showWaitEstimate?: boolean }, quoted: unknown): number | undefined {
  if (settings.showWaitEstimate === false) return undefined;   // omitted — the kiosk already handles "no estimate"
  return typeof quoted === 'number' && Number.isFinite(quoted) ? quoted : undefined;
}

export class GoCheckInError extends Error { constructor(msg: string, public status = 400, public code = 'go_check_in_error') { super(msg); } }

const KIOSK_PERMISSIONS = [
  'pos.check_in.view', 'pos.check_in.walk_in', 'pos.check_in.create_customer', 'pos.check_in.appointment',
  'pos.customers.view', 'pos.customers.create', 'pos.check_in.move_to_queue', 'pos.queue.create',
];
// The BRANCH's day (Oct 2 2026). toISOString() is the UTC day: after 8 pm in New Jersey the kiosk looked for TOMORROW's
// appointment and never found tonight's.
const DEFAULT_TZ = 'America/New_York';

/** A session is a Go Check-In kiosk's (device) or a paired customer display's (display) — exactly one (migration 512). */
interface Resolved { device: DeviceRow | null; display: DisplayDeviceRow | null; session: SessionRow; settings: GoCheckInSettings; }
const actorOf = (r: { device: DeviceRow | null; display: DisplayDeviceRow | null }) => (r.device ? 'kiosk:' + r.device.id : 'display:' + r.display!.id);
/** Ids from a request: strings only, bounded, de-duplicated. */
const cleanIds = (v: unknown, max = 20): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, max) : []);
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
/**
 * §16–§17: the visit as the guest's screen shows it — every service with its technician's first name. Each appointment's
 * first service leads (so the compact screen's first rows show every technician: "Gel Manicure with Olivia / Spa Pedicure
 * with Lisa"), their other services follow ("+ 1 more" — a Paraffin Dip). Found by the Unit 7 live proof: in visit order,
 * a two-service appointment filled both compact rows and hid the other technician behind "+ 1 more".
 */
function toAppointmentToday(visit: ApptRow[]): AppointmentToday | null {
  if (!visit.length) return null;
  const rows = visit.map((a) => a.items.map((i) => ({ serviceName: i.serviceName, ...(i.technicianName ? { technicianName: i.technicianName } : {}), startTimeLabel: clockLabel(hhmm(a.startMinutes)) })));
  const items = [...rows.filter((r) => r.length).map((r) => r[0]), ...rows.flatMap((r) => r.slice(1))];
  const first = items[0];
  return { appointmentId: visit[0].appointmentId, startTimeLabel: clockLabel(hhmm(visit[0].startMinutes)), serviceName: first?.serviceName ?? 'Appointment', ...(first?.technicianName ? { technicianName: first.technicianName } : {}), items };
}

@Injectable()
export class GoCheckInService {
  // per-session allowance counters for a repository that cannot count on the session row (the Postgres one does)
  private counters = new Map<string, { lookups: number; creates: number }>();
  // Short-lived idempotency cache for kiosk clock actions: a double-tap or retry that carries the SAME request key
  // returns the first result instead of a second write or an "already clocked in" error. Best-effort, in-memory.
  private clockIdem = new Map<string, { result: unknown; ts: number }>();
  private static readonly CLOCK_IDEM_TTL_MS = 30_000;
  private idemGet(key: string | undefined): unknown | undefined {
    if (!key) return undefined;
    const hit = this.clockIdem.get(key);
    if (hit && Date.now() - hit.ts < GoCheckInService.CLOCK_IDEM_TTL_MS) return hit.result;
    return undefined;
  }
  private idemPut(key: string | undefined, result: unknown): void {
    if (!key) return;
    this.clockIdem.set(key, { result, ts: Date.now() });
    if (this.clockIdem.size > 500) { const cut = Date.now() - GoCheckInService.CLOCK_IDEM_TTL_MS; for (const [k, v] of this.clockIdem) if (v.ts < cut) this.clockIdem.delete(k); }
  }

  constructor(
    @Inject('GoCheckInDataPort') private readonly repo: GoCheckInDataPort,
    @Optional() @Inject(CheckInService) private readonly checkIn?: CheckInService,
    @Optional() @Inject(REALTIME) private readonly rt?: RealtimeEmitter,
    @Optional() @Inject(BOOKING_CHECKIN_RECORDER) private readonly recorder?: BookingCheckinRecorderPort,
    @Optional() @Inject(TechnicianClockPinService) private readonly clockPin?: TechnicianClockPinService,
    @Optional() @Inject(TimeClockService) private readonly timeClock?: TimeClockService,
    @Optional() @Inject(QueueService) private readonly queue?: KioskQueuePort,
  ) {}
  /** The queue context for a kiosk session (tenant + branch from the device, never the client). */
  private queueCtx(r: Resolved): QueueContext { const c = this.kioskCtx(r); return { tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: 'KIOSK', permissions: [] }; }
  /** Round 2: is the requested technician busy, and who else could take this guest. Best-effort — never fails a check-in. */
  private async queueFields(r: Resolved, queueItemId: string | null | undefined): Promise<KioskQueueFields> {
    const none: QueueAlternatesView = { requestedTechnician: null, alternates: [] };
    if (!queueItemId) return none;
    if (!this.queue) return { queueItemId, ...none };
    try { return { queueItemId, ...(await this.queue.alternatesForItem(this.queueCtx(r), queueItemId)) }; } catch { return { queueItemId, ...none }; }
  }
  /**
   * POST go-check-in/session/:sessionId/accept-alternate { queueItemId, technicianId } — the guest at the kiosk agrees to
   * another technician. Only a guest THIS session checked in (its own log lines); 409 when that technician was taken.
   */
  async acceptAlternate(sessionId: string, token: string | undefined, body: { queueItemId?: string; technicianId?: string }): Promise<{ ok: true; technicianName: string }> {
    const r = await this.resolveSession(sessionId, token);
    const queueItemId = String(body?.queueItemId ?? ''); const technicianId = String(body?.technicianId ?? '');
    if (!queueItemId || !technicianId) throw withCode(new GoCheckInError('Choose a technician.', 400, 'bad_request'), 'TECHNICIAN_REQUIRED');
    if (!(await this.repo.sessionOwnsQueueItem(r.session.tenantId, r.session.id, queueItemId))) throw withCode(new GoCheckInError('We could not find this check-in.', 404, 'not_found'), 'CHECKIN_NOT_FOUND');
    if (!this.queue) throw withCode(new GoCheckInError('The queue is unavailable right now. Please see the front desk.', 503, 'unavailable'), 'QUEUE_UNAVAILABLE');
    try {
      const res = await this.queue.acceptAlternateForItem(this.queueCtx(r), queueItemId, technicianId, 'kiosk');
      await this.logS(r.session, 'alternate_accepted', 'Guest accepted another technician', { queueItemId, technicianId });
      this.emit(r, EVENTS.queueUpdated, { queueItemId });
      return { ok: true, technicianName: res.technicianName };
    } catch (e: any) {
      if (e instanceof QueueAssignmentConflict) throw new GoCheckInError(e.message, 409, 'technician_taken');
      if (e instanceof GoCheckInError) throw e;
      throw new GoCheckInError(e?.message || 'We could not change your technician. Please see the front desk.', 400, 'accept_failed');
    }
  }
  /** The clock (tests set it). */
  now: () => Date = () => new Date();
  /** The branch's day, the instant it began there, and its wall clock now (minutes since midnight, weekday). */
  private async todayInfo(session: { tenantId: string; branchId: string | null }): Promise<{ today: string; dayStartMs: number; nowMinutes: number; weekday: number }> {
    const tz = (await this.repo.branchTimeZone?.(session.tenantId, session.branchId).catch(() => DEFAULT_TZ)) || DEFAULT_TZ;
    const now = this.now();
    const today = businessDate(tz, now);
    const p = zonedParts(now, tz);
    return { today, dayStartMs: localDateTimeToEpochMs(today, '00:00', tz), nowMinutes: p.hour * 60 + p.minute, weekday: p.weekday };
  }
  private async today(session: { tenantId: string; branchId: string | null }): Promise<string> { return (await this.todayInfo(session)).today; }

  private kioskCtx(r: Resolved): CheckInContext {
    // The branch for every check-in write is the session's chosen branch (validated against the device's allow-list at
    // session start), NOT re-derived from the device — that's what makes a multi-branch kiosk land in the right branch.
    if (!r.session.branchId) throw withCode(new GoCheckInError('This check-in device is not assigned to a branch.', 409, 'no_branch'), 'DEVICE_NO_BRANCH');
    return { tenantId: r.session.tenantId, branchId: r.session.branchId, userId: actorOf(r), role: 'KIOSK', permissions: [...KIOSK_PERMISSIONS] };
  }
  private requireCheckIn(): CheckInService { if (!this.checkIn) throw withCode(new GoCheckInError('Check-in service unavailable', 503, 'unavailable'), 'SERVICE_UNAVAILABLE'); return this.checkIn; }
  private async log(r: { tenantId: string; branchId: string | null; deviceId?: string | null; sessionId?: string | null }, eventType: string, safeMessage?: string, metadata?: any) {
    try { await this.repo.insertLog({ tenantId: r.tenantId, branchId: r.branchId, deviceId: r.deviceId ?? null, sessionId: r.sessionId ?? null, eventType, safeMessage: safeMessage ?? null, metadata }); } catch { /* logging is best-effort */ }
  }
  /** A session's log line: its id, its kiosk or its display. (Log lines written from a session row used to drop the
   *  session id — the row's field is `id`, not `sessionId`.) */
  private logS(s: SessionRow, eventType: string, safeMessage?: string, metadata?: any) {
    return this.log({ tenantId: s.tenantId, branchId: s.branchId, deviceId: s.deviceId, sessionId: s.id }, eventType, safeMessage, s.displayDeviceId ? { ...(metadata ?? {}), displayDeviceId: s.displayDeviceId } : metadata);
  }
  // push a realtime event to the tenant/branch room the POS (dashboard/check-in/queue/tech-queue) subscribes to.
  // §343 / B-14 (Oct 20 2026): the fallback only. Every kiosk fact is a recorded domain event the projection broadcasts —
  // a check-in = queue.customer_joined (+ checkin.customer_checked_in on the appointment), an accepted alternate =
  // queue.item_updated — so with the publisher on this pushes nothing (a second, unrecorded copy of the same fact).
  private emit(r: Resolved, event: any, payload: unknown) {
    if (this.checkIn?.emitsDomainEvents?.()) return;
    if (!this.rt || !r.session.branchId) return;
    try { this.rt.toTenant({ tenantId: r.session.tenantId, branchId: r.session.branchId }, event, payload); } catch { /* realtime is best-effort */ }
  }

  // ---- device→branch slug lookup (reused by the customer display so ONE paired device can render both Go Check-In and
  //      checkout). A device bound to this branch, else a tenant-wide device. NEVER another branch's kiosk: a session on
  //      it starts in THAT kiosk's branch, so the display's guests would land in another branch's queue (the old
  //      "then any active device" fallback did exactly that in a multi-branch salon — removed Oct 6 2026). A display
  //      with no branch of its own, in a salon with exactly one kiosk, can only mean that one. ----
  async slugForBranch(tenantId: string, branchId: string | null): Promise<string | null> {
    const active = (await this.repo.listDevices(tenantId)).filter((d) => d.status === 'active' && !!d.checkinSlug);
    const dev = active.find((d) => d.branchId === branchId) ?? active.find((d) => d.branchId == null)
      ?? (branchId == null && active.length === 1 ? active[0] : null);
    return dev ? dev.checkinSlug : null;
  }

  // ---- device + config (public, by slug) ----
  private async resolveDeviceBySlug(slug: string): Promise<{ device: DeviceRow; settings: GoCheckInSettings }> {
    const device = await this.repo.deviceBySlug(slug);
    if (!device) throw withCode(new GoCheckInError('Check-in is not available here.', 404, 'device_not_found'), 'CHECKIN_DISABLED');
    if (device.status !== 'active') throw withCode(new GoCheckInError('This check-in device has been disabled.', 403, 'device_disabled'), 'DEVICE_DISABLED');
    // Pairing-token expiry: a kiosk that hasn't been refreshed within the TTL is locked out until Super Admin regenerates
    // its token (which re-activates it). Flip the stored status to 'expired' so the admin console reflects it.
    if (isTokenExpired(device.tokenExpiresAt)) {
      await this.repo.setDeviceStatus(device.tenantId, device.id, 'expired');
      await this.log({ tenantId: device.tenantId, branchId: device.branchId, deviceId: device.id }, 'error', 'Device token expired');
      throw withCode(new GoCheckInError('This check-in device’s access has expired. Please ask the front desk to re-pair it.', 403, 'device_token_expired'), 'DEVICE_ACCESS_EXPIRED');
    }
    const settings = await this.repo.getSettings(device.tenantId);
    if (!settings.enabled) throw withCode(new GoCheckInError('Check-in is currently turned off for this salon.', 403, 'disabled'), 'CHECKIN_DISABLED');
    return { device, settings };
  }

  async getConfig(slug: string): Promise<KioskConfig> {
    const { device, settings } = await this.resolveDeviceBySlug(slug);
    const salon = await this.repo.resolveSalonBranch(device.tenantId, device.branchId);
    const ids = selectableBranchIds(device);
    const named = ids.length > 1 ? await this.repo.listBranchNames(device.tenantId, ids) : [];
    const branches = named.map((b) => ({ id: b.id, name: b.name, isDefault: b.id === device.branchId }));
    const { enabled: _drop, ...rest } = settings;
    return { salonName: salon.salonName || device.deviceName, branchName: salon.branchName, branches, settings: { ...rest, enabled: true }, ...(device.welcomeMessage ? { welcomeMessage: device.welcomeMessage } : {}) } as KioskConfig;
  }

  async startSession(slug: string, requestedBranchId?: string | null): Promise<{ sessionId: string; sessionToken: string; config: KioskConfig }> {
    const { device, settings } = await this.resolveDeviceBySlug(slug);
    if (this.repo.recentKioskActivity && (await this.repo.recentKioskActivity(device.tenantId, KIOSK_WINDOW_MINUTES)).sessions >= MAX_KIOSK_SESSIONS_PER_WINDOW)
      throw withCode(new GoCheckInError('Too many check-ins started — please wait a moment or ask the front desk.', 429, 'rate_limited'), 'RATE_LIMITED');   // E10
    // Airtight allow-list: a requested branch MUST be in the device's selectable set (default ∪ allowed); otherwise the
    // default branch is used. The chosen branch is then carried on the session and drives every check-in write.
    const choice = resolveSessionBranch(device, requestedBranchId);
    if (!choice.ok) throw new GoCheckInError('That location isn’t available on this check-in device.', 403, 'CHECKIN_BRANCH_MISMATCH');   // Dual-Screen §104
    const branchId = choice.branchId;
    const token = newToken();
    const session = await this.repo.createSession({ tenantId: device.tenantId, branchId, deviceId: device.id, sessionTokenHash: sha256Hex(token) });
    await this.repo.touchDevice(device.id);
    await this.log({ tenantId: device.tenantId, branchId, deviceId: device.id, sessionId: session.id }, 'session_started', 'Kiosk session started');
    const salon = await this.repo.resolveSalonBranch(device.tenantId, branchId);
    const { enabled: _d, ...rest } = settings;
    return { sessionId: session.id, sessionToken: token, config: { salonName: salon.salonName || device.deviceName, branchName: salon.branchName, settings: { ...rest, enabled: true }, ...(device.welcomeMessage ? { welcomeMessage: device.welcomeMessage } : {}) } as KioskConfig };
  }

  // ---- a paired CUSTOMER DISPLAY's check-in (23-inch spec §8, §12, §18) ----
  /** Is the salon's check-in on for this display's branch? (The display's state says so; the display then starts each
   *  guest's session with its own credential.) */
  async checkInAvailable(tenantId: string, branchId: string | null): Promise<boolean> {
    if (!branchId) return false;
    return (await this.repo.getSettings(tenantId)).enabled;
  }
  /**
   * A guest's check-in session for a paired customer display. The caller (the API) has already proved the display's
   * credential: tenant and branch are the DISPLAY's — no slug, no borrowed kiosk identity, nothing from the request.
   * One session per guest: the display starts a fresh one after every check-in, so the per-session limits (phone
   * lookups, new profiles) count one guest, not the whole day.
   */
  async startDisplaySession(display: { id: string; tenantId: string; branchId: string | null }): Promise<{ sessionId: string; sessionToken: string; config: KioskConfig }> {
    const settings = await this.repo.getSettings(display.tenantId);
    if (!settings.enabled) throw withCode(new GoCheckInError('Check-in is currently turned off for this salon.', 403, 'disabled'), 'CHECKIN_DISABLED');
    if (!display.branchId) throw withCode(new GoCheckInError('This display is not assigned to a branch.', 409, 'no_branch'), 'DEVICE_NO_BRANCH');
    const token = newToken();
    const session = await this.repo.createSession({ tenantId: display.tenantId, branchId: display.branchId, displayDeviceId: display.id, sessionTokenHash: sha256Hex(token) });
    await this.logS(session, 'session_started', 'Customer display check-in session started');
    const salon = await this.repo.resolveSalonBranch(display.tenantId, display.branchId);
    const { enabled: _d, ...rest } = settings;
    return { sessionId: session.id, sessionToken: token, config: { salonName: salon.salonName, branchName: salon.branchName, settings: { ...rest, enabled: true } } as KioskConfig };
  }

  // ---- session validation (server-side; every action goes through this) ----
  private async resolveSession(sessionId: string, token: string | undefined): Promise<Resolved> {
    const session = await this.repo.sessionById(sessionId);
    if (!session) throw withCode(new GoCheckInError('Session not found. Please start again.', 404, 'session_not_found'), 'CHECKIN_SESSION_INVALID');
    if (!tokenMatches(session.sessionTokenHash, token)) throw withCode(new GoCheckInError('Invalid session.', 401, 'bad_session_token'), 'CHECKIN_SESSION_INVALID');
    if (session.status !== 'active') throw withCode(new GoCheckInError('This session has ended. Please start again.', 410, 'session_ended'), 'CHECKIN_SESSION_INVALID');
    if (Date.now() - new Date(session.lastSeenAt).getTime() > SESSION_IDLE_MS) {
      await this.repo.setSessionStatus(session.id, 'expired');
      await this.logS(session, 'session_expired', 'Session expired (idle)');
      // Emit a real failed check-in event for the Booking & Check-In Monitor (fail-soft; never blocks the response).
      void this.recorder?.recordFailedEvent({ tenantId: session.tenantId, branchId: session.branchId, checkinId: session.id, deviceId: session.deviceId ?? session.displayDeviceId, category: 'check_in', source: 'kiosk', checkInMethod: 'kiosk', failureType: 'session_timeout', retryStatus: 'not_retryable' });
      throw withCode(new GoCheckInError('This session timed out. Please start again.', 410, 'session_expired'), 'CHECKIN_SESSION_INVALID');
    }
    let device: DeviceRow | null = null; let display: DisplayDeviceRow | null = null;
    if (session.displayDeviceId) {
      // §8/§12: the display's own standing, every request — revoked, unpaired or in maintenance ends its check-in at once
      display = await this.repo.displayDeviceById(session.tenantId, session.displayDeviceId);
      if (!display || !display.usable) throw withCode(new GoCheckInError('This display is not available for check-in right now.', 403, 'display_unavailable'), 'DISPLAY_NOT_AVAILABLE');
      // Dual-Screen §104: the display was moved to another branch — this guest's session belongs to the old one
      if (display.branchId !== session.branchId) throw new GoCheckInError('This display now belongs to another location. Please start again.', 403, 'CHECKIN_BRANCH_MISMATCH');
    } else {
      device = session.deviceId ? await this.repo.deviceById(session.tenantId, session.deviceId) : null;
      if (!device || device.status !== 'active') throw withCode(new GoCheckInError('This check-in device has been disabled.', 403, 'device_disabled'), 'DEVICE_DISABLED');
    }
    const settings = await this.repo.getSettings(session.tenantId);
    if (!settings.enabled) throw withCode(new GoCheckInError('Check-in is currently turned off for this salon.', 403, 'disabled'), 'CHECKIN_DISABLED');
    await this.repo.touchSession(session.id);
    return { device, display, session, settings };
  }

  async heartbeat(sessionId: string, token: string | undefined, body?: unknown): Promise<{ ok: true }> {
    const r = await this.resolveSession(sessionId, token);
    if (r.device) await this.repo.touchDevice(r.device.id, deviceHealthFacts(body));   // a display reports its own heartbeat (§85)
    return { ok: true };
  }

  /** The session's allowance, counted on its row (every API instance sees the same count — migration 516); this
   *  instance's memory only for a repository that cannot count. */
  private async bump(tenantId: string, sessionId: string, kind: 'lookups' | 'creates'): Promise<number> {
    if (this.repo.bumpSessionCounter) return this.repo.bumpSessionCounter(tenantId, sessionId, kind);
    const c = this.counters.get(sessionId) ?? { lookups: 0, creates: 0 };
    c[kind] += 1; this.counters.set(sessionId, c);
    return c[kind];
  }

  // ---- phone lookup: tenant POS first, then central (safe fields only) ----
  async lookupPhone(sessionId: string, token: string | undefined, phoneRaw: string): Promise<LookupResult> {
    const r = await this.resolveSession(sessionId, token);
    if ((await this.bump(r.session.tenantId, sessionId, 'lookups')) > MAX_LOOKUPS_PER_SESSION) {
      await this.logS(r.session, 'rate_limited', 'Too many phone lookups');
      throw withCode(new GoCheckInError('Too many attempts. Please ask the front desk for help.', 429, 'rate_limited'), 'TOO_MANY_ATTEMPTS');
    }
    if (this.repo.recentKioskActivity && (await this.repo.recentKioskActivity(r.session.tenantId, KIOSK_WINDOW_MINUTES)).lookups > MAX_KIOSK_LOOKUPS_PER_WINDOW) {
      await this.logS(r.session, 'rate_limited', 'Salon-wide phone lookup limit reached');   // E10: the cap a new session cannot reset
      throw withCode(new GoCheckInError('Too many attempts. Please ask the front desk for help.', 429, 'rate_limited'), 'TOO_MANY_ATTEMPTS');
    }
    const normalized = normalizePhone(phoneRaw);
    if (normalized.length < 7) throw withCode(new GoCheckInError('Please enter a valid phone number.', 400, 'bad_phone'), 'PHONE_INVALID');
    await this.logS(r.session, 'phone_entered', 'Phone entered', { phoneLast4: normalized.slice(-4) });

    // Step 1 — tenant POS (only if enabled)
    if (r.settings.tenantPhoneLookupEnabled) {
      const matches = await this.repo.findTenantCustomersByPhone(r.session.tenantId, normalized);
      if (matches.length > 1) {
        // §8 safety: never auto-select when more than one profile shares a phone — route to the front desk and raise
        // a staff alert (surfaced in the Super-Admin logs). Only safe disambiguation labels leave the server.
        await this.logS(r.session, 'ambiguous_match', 'Multiple profiles share this phone — routed to front desk', { count: matches.length, staffAlert: true });
        return { match: null, foundInTenant: true, appointment: null, canWalkIn: false, canCreate: false, ambiguous: true, askFrontDesk: true, choices: matches.map((m) => ({ firstName: m.firstName, lastInitial: lastInitial(m.lastName) })) };
      }
      if (matches.length === 1) {
        const tc = matches[0];
        const appt = r.settings.appointmentCheckinEnabled ? await this.visitToday(r, tc.customerId) : null;
        await this.logS(r.session, 'tenant_customer_found', 'Existing customer matched', { hasAppointment: !!appt });
        if (appt) await this.logS(r.session, 'appointment_found', 'Appointment found for today');
        return { match: { source: 'tenant', customerId: tc.customerId, firstName: tc.firstName, lastInitial: lastInitial(tc.lastName) }, foundInTenant: true, appointment: appt, canWalkIn: r.settings.walkinCheckinEnabled, canCreate: false };
      }
    }
    // Step 2 — central (safe minimal fields only; no other-tenant identity/history)
    if (r.settings.centralLookupEnabled) {
      const cc = await this.repo.findCentralCustomerByPhone(r.session.tenantId, normalized);
      if (cc) {
        await this.logS(r.session, 'central_customer_found', 'Matched in central directory');
        return { match: { source: 'central', firstName: cc.firstName, lastInitial: lastInitial(cc.lastName), maskedEmail: maskEmail(cc.email) }, foundInTenant: false, appointment: null, canWalkIn: r.settings.walkinCheckinEnabled, canCreate: r.settings.newCustomerEnabled };
      }
    }
    // Step 3 — not found
    await this.logS(r.session, 'customer_not_found', 'No match; can create new profile');
    return { match: null, foundInTenant: false, appointment: null, canWalkIn: r.settings.walkinCheckinEnabled, canCreate: r.settings.newCustomerEnabled };
  }

  // confirm an existing tenant customer (no-op beyond returning the id; central matches go through createCustomer to link)
  async confirmCustomer(sessionId: string, token: string | undefined, customerId: string): Promise<{ customerId: string }> {
    // Confirming an EXISTING tenant match. Tenant safety for any subsequent action is enforced by the kiosk context
    // (tenant/branch from the device) and the check-in repo's tenant scoping, so the id is simply echoed back.
    await this.resolveSession(sessionId, token);
    return { customerId };
  }

  // create (or link) a customer UNDER the resolved tenant — covers brand-new and "link a central match here"
  async createCustomer(sessionId: string, token: string | undefined, body: { firstName: string; lastName?: string; phone: string; email?: string; smsConsent?: boolean }): Promise<{ customerId: string; firstName: string }> {
    const r = await this.resolveSession(sessionId, token);
    if (!r.settings.newCustomerEnabled) throw withCode(new GoCheckInError('New customer creation is turned off here.', 403, 'create_disabled'), 'NEW_CUSTOMERS_DISABLED');
    if ((await this.bump(r.session.tenantId, sessionId, 'creates')) > MAX_CREATES_PER_SESSION) {
      await this.logS(r.session, 'rate_limited', 'Too many new-customer attempts');
      throw withCode(new GoCheckInError('Too many attempts. Please ask the front desk for help.', 429, 'rate_limited'), 'TOO_MANY_ATTEMPTS');
    }
    if (!body?.firstName?.trim()) throw withCode(new GoCheckInError('First name is required.', 400, 'bad_name'), 'FIRST_NAME_REQUIRED');
    const fullName = [body.firstName.trim(), (body.lastName ?? '').trim()].filter(Boolean).join(' ');
    const created = await this.requireCheckIn().createCustomer(this.kioskCtx(r), { fullName, phone: body.phone, email: body.email, smsOptIn: !!body.smsConsent });
    await this.logS(r.session, 'customer_created', 'New customer profile created', { smsConsent: !!body.smsConsent });
    return { customerId: created.customerId, firstName: body.firstName.trim() };
  }

  // ---- today's visit (23-inch spec §15–§17) ----
  /** The guest's visit today at this branch, as the screen shows it: every service with its technician (first names). */
  private async visitToday(r: Resolved, customerId: string): Promise<AppointmentToday | null> {
    const day = await this.todayInfo(r.session);
    const appts = await this.repo.findTodayAppointmentsForCustomer(r.session.tenantId, r.session.branchId, customerId, day.today);
    return toAppointmentToday(visitFor(appts, day.nowMinutes));
  }
  async todayAppointments(sessionId: string, token: string | undefined, customerId: string) {
    const r = await this.resolveSession(sessionId, token);
    const visit = typeof customerId === 'string' && customerId ? await this.visitToday(r, customerId) : null;
    return { appointments: visit ? [visit] : [] };
  }

  // ---- appointment check-in ("I'm Here", §18–§19) ----
  /**
   * The visit the screen showed, anchored on `appointmentId`: every appointment of it is checked in, all or none (one
   * transaction — Oct 6 2026), and idempotently — a double tap, or a second display, finds the same check-ins; the
   * database allows one active entry per appointment, migration 503. An appointment of another branch or another day is
   * not found.
   */
  async checkInAppointment(sessionId: string, token: string | undefined, appointmentId: string): Promise<CheckInConfirmation> {
    const r = await this.resolveSession(sessionId, token);
    if (!r.settings.appointmentCheckinEnabled) throw withCode(new GoCheckInError('Appointment check-in is turned off here.', 403, 'appt_disabled'), 'CHECKIN_DISABLED');
    const ctx = this.kioskCtx(r);
    const day = await this.todayInfo(r.session);
    const notFound = () => new GoCheckInError('We could not find that appointment for this salon.', 404, 'CHECKIN_APPOINTMENT_NOT_FOUND');   // Dual-Screen §104
    const customerId = typeof appointmentId === 'string' && appointmentId ? await this.repo.appointmentCustomer(r.session.tenantId, r.session.branchId, appointmentId, day.today) : null;
    if (!customerId) throw notFound();
    const visit = visitAnchoredAt(await this.repo.findTodayAppointmentsForCustomer(r.session.tenantId, r.session.branchId, customerId, day.today, [...CHECK_IN_ELIGIBLE_STATUSES, 'checked_in']), appointmentId);
    if (!visit.length) throw notFound();
    let firstName = ''; let firstCheckIn: string | null = null; let quoted: unknown; let fresh = 0;
    // Oct 6 2026: the whole visit at once — every appointment is checked in, or none (it was one at a time, so a failure
    // between two left the visit half checked in). visitCheckIn verifies each appointment belongs to THIS tenant and
    // branch, and is idempotent (an appointment already checked in comes back as a duplicate, no second record).
    const results = await this.requireCheckIn().visitCheckIn(ctx, visit.map((a) => a.appointmentId)).catch((e: any) => {
      if (e?.message?.includes('not found')) throw notFound();
      throw new GoCheckInError(e?.message || 'Check-in failed', 400, 'appt_checkin_failed');
    });
    for (const [i, a] of visit.entries()) {
      const { row, duplicate } = results[i];
      const already = a.status === 'checked_in' || duplicate;
      firstName ||= (row.customerName || '').split(' ')[0];
      if (row.customerId) await this.repo.markCheckedInToday(r.session.tenantId, row.customerId, day.today);
      if (already) { await this.logS(r.session, 'duplicate_blocked', 'Appointment already checked in', { appointmentId: a.appointmentId }); firstCheckIn ??= row.checkInId; continue; }
      fresh++;
      await this.logS(r.session, 'appointment_checked_in', 'Appointment checked in', { checkInId: row.checkInId });
      const queued = await this.maybeEnqueue(ctx, r, row.checkInId);
      if (quoted === undefined) quoted = row.quotedWaitMinutes;
      if (firstCheckIn == null || fresh === 1) firstCheckIn = queued ?? row.checkInId;
      this.emit(r, EVENTS.appointmentUpdated, { appointmentId: a.appointmentId, status: 'checked_in' });
      this.emit(r, EVENTS.customerCheckedIn, { checkInId: row.checkInId, customerName: row.customerName, source: 'appointment', appointmentId: a.appointmentId, queueItemId: queued });
    }
    const extra = await this.queueFields(r, firstCheckIn);   // round 2: queueItemId + requested technician + alternates
    if (!fresh) return { status: 'already_checked_in', firstName, ...(firstCheckIn ? { checkInId: firstCheckIn } : {}), ...extra } as CheckInConfirmation;
    const wait = waitEstimateFor(r.settings, quoted);
    return { status: 'checked_in', firstName, estimatedWaitMinutes: wait, ...(wait !== undefined ? { estimatedWait: waitRangeFor(wait) } : {}), appointmentsCheckedIn: fresh, ...(firstCheckIn ? { checkInId: firstCheckIn } : {}), ...extra } as CheckInConfirmation;
  }

  // ---- services / technicians for walk-in selection (§22–§25) ----
  /** §22–§23: the BRANCH's catalog and prices — another branch's rows (its own prices) never appear. */
  async services(sessionId: string, token: string | undefined): Promise<{ services: KioskServiceOption[] }> {
    const r = await this.resolveSession(sessionId, token);
    if (!r.settings.serviceSelectionEnabled) return { services: [] };
    return { services: await this.repo.listServices(r.session.tenantId, r.session.branchId) };
  }
  /**
   * §25: technicians the guest may ask for — working the rest of today at this branch and qualified for every chosen
   * service (the queue's own skill rule). Asked again as the guest picks services. "Any available" needs no list.
   */
  async technicians(sessionId: string, token: string | undefined, serviceIds?: unknown): Promise<{ technicians: KioskTechnicianOption[] }> {
    const r = await this.resolveSession(sessionId, token);
    if (!r.settings.technicianPreferenceEnabled || !r.session.branchId) return { technicians: [] };
    return { technicians: await this.eligibleTechnicians(r, cleanIds(serviceIds)) };
  }
  private async eligibleTechnicians(r: Resolved, serviceIds: string[]): Promise<KioskTechnicianOption[]> {
    const day = await this.todayInfo(r.session);
    const [facts, catalog] = await Promise.all([
      this.repo.kioskTechnicianFacts(r.session.tenantId, r.session.branchId!, day.today, day.weekday),
      this.repo.listServices(r.session.tenantId, r.session.branchId),
    ]);
    // §24 (Kevin, Oct 27 2026): with the authority bound the category pre-filter is skipped — a technician with no services
    // set up has no category skills yet, and the authority's category fallback (not this pre-filter) decides for her
    const listed = kioskTechnicians(facts, day.nowMinutes, this.eligibility && serviceIds.length ? [] : requiredCategories(serviceIds, catalog));
    // B-82 (Oct 23 2026): the category pre-filter is only the fast first cut — who may actually be asked for is the EXACT
    // service rule (the workforce authority booking and the queue use), so a technician not approved for acrylic is never
    // offered for acrylic even when all services sit in one "Nails" category. Without the authority (dev) the category stands.
    if (!this.eligibility || !serviceIds.length || !listed.length) return listed;
    const v = await this.eligibility.eligibleAmong({ tenantId: r.session.tenantId, branchId: r.session.branchId ?? null, technicianIds: listed.map((t) => t.technicianId), serviceIds });
    return listed.filter((t) => v.get(t.technicianId)?.eligible === true);
  }
  /** B-82: the exact-service authority (workforce TechnicianEligibilityService, @Global); null in-memory / dev. */
  eligibility: Pick<TechnicianEligibilityService, 'eligibleAmong'> | null = null;

  // ---- Technician time clock (PIN-driven, on the kiosk) ----
  // The device's session decides tenant + branch; the PIN decides WHO. We never trust a client-supplied technicianId,
  // and every action (identify AND clock) re-verifies the PIN — so one technician cannot clock another in or out.
  // The attendance write reuses the existing TimeClockService (authoritative server time + duplicate guard).
  private techClockCtx(r: Resolved): TimeClockContext {
    if (!r.session.branchId) throw withCode(new GoCheckInError('This check-in device is not assigned to a branch.', 409, 'no_branch'), 'DEVICE_NO_BRANCH');
    return { tenantId: r.session.tenantId, branchId: r.session.branchId, userId: actorOf(r), role: 'KIOSK', permissions: [] };
  }
  private requireClock(): { pin: TechnicianClockPinService; clock: TimeClockService } {
    if (!this.clockPin || !this.timeClock) throw withCode(new GoCheckInError('The technician time clock is not available on this device.', 503, 'unavailable'), 'FEATURE_NOT_AVAILABLE');
    return { pin: this.clockPin, clock: this.timeClock };
  }
  /** Resolve a PIN to exactly one active technician at THIS device's tenant/branch. Safe outcomes only — never a
   *  profile list, never a hint about which technicians or codes exist. */
  private async resolveTechByPin(ctx: TimeClockContext, pin: string): Promise<string> {
    const { pin: pinSvc } = this.requireClock();
    let res: Awaited<ReturnType<TechnicianClockPinService['identifyByPin']>>;
    try { res = await pinSvc.identifyByPin({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null }, String(pin ?? ''), new Date().toISOString(), ctx.branchId ?? null); }
    catch (e) { if (e instanceof KioskPinLockedError) throw new GoCheckInError(e.message, 429, 'rate_limited'); throw e; }   // WF merge: per-kiosk PIN lockout
    if (res.outcome === 'identified') return res.technicianId;
    if (res.outcome === 'invalid_format') throw withCode(new GoCheckInError('Enter your 4-digit Clock PIN.', 400, 'invalid_pin'), 'CLOCK_PIN_REQUIRED');
    if (res.outcome === 'duplicate_match') throw withCode(new GoCheckInError('That PIN matches more than one technician here. Please see a manager.', 409, 'duplicate_pin'), 'CLOCK_PIN_AMBIGUOUS');
    throw withCode(new GoCheckInError('That PIN was not recognised at this location.', 401, 'pin_not_recognised'), 'CLOCK_PIN_NOT_RECOGNISED');
  }

  async technicianIdentify(sessionId: string, token: string | undefined, pin: string) {
    const r = await this.resolveSession(sessionId, token);
    const { clock } = this.requireClock();
    const ctx = this.techClockCtx(r);
    const technicianId = await this.resolveTechByPin(ctx, pin);
    const row = (await clock.getState(ctx)).technicians.find((t) => t.technicianId === technicianId);
    const clockedIn = row?.state === 'clocked_in' || row?.state === 'on_break';   // WF merge: a break is still on the clock
    // Real profile avatar + display name — best-effort from the existing technician roster (never blocks the clock).
    let avatarUrl: string | null = null;
    let displayName = row?.technicianName ?? null;
    try {
      if (this.checkIn) {
        const techs = await this.checkIn.technicians(this.kioskCtx(r));
        const t = (techs as Array<{ technicianId: string; displayName?: string; avatarUrl?: string }>).find((x) => x.technicianId === technicianId);
        if (t) { avatarUrl = t.avatarUrl ?? null; if (!displayName) displayName = t.displayName ?? null; }
      }
    } catch { /* avatar/name are decorative here — the clock works without them */ }
    await this.logS(r.session, 'tech_clock_identify', 'Technician identified at kiosk');
    return {
      technicianId, technicianName: displayName, avatarUrl, clockedIn,
      action: clockedIn ? 'clock_out' : 'clock_in',
      clockedInAt: row?.clockedInAt ?? null, lastClockOutAt: row?.lastClockOutAt ?? null,
      hoursToday: row?.hoursToday ?? 0, serverTime: new Date().toISOString(),
    };
  }

  async technicianClockIn(sessionId: string, token: string | undefined, pin: string, idempotencyKey?: string) {
    const r = await this.resolveSession(sessionId, token);   // always authenticate, even on a replay
    const cacheKey = idempotencyKey ? `${sessionId}:in:${idempotencyKey}` : undefined;
    const cached = this.idemGet(cacheKey);
    if (cached) return cached;   // same-key double-tap/retry → return the first result, no second write
    const { clock } = this.requireClock();
    const ctx = this.techClockCtx(r);
    const technicianId = await this.resolveTechByPin(ctx, pin);
    const row = await clock.clockIn(ctx, technicianId);   // authoritative server time + "already clocked in" guard
    await this.logS(r.session, 'tech_clock_in', 'Technician clocked in at kiosk');
    const result = { ok: true as const, action: 'clock_out' as const, technicianName: row.technicianName, clockedInAt: row.clockedInAt, serverTime: new Date().toISOString() };
    this.idemPut(cacheKey, result);
    return result;
  }

  async technicianClockOut(sessionId: string, token: string | undefined, pin: string, idempotencyKey?: string) {
    const r = await this.resolveSession(sessionId, token);   // always authenticate, even on a replay
    const cacheKey = idempotencyKey ? `${sessionId}:out:${idempotencyKey}` : undefined;
    const cached = this.idemGet(cacheKey);
    if (cached) return cached;   // same-key double-tap/retry → return the first result, no second write
    const { clock } = this.requireClock();
    const ctx = this.techClockCtx(r);
    const technicianId = await this.resolveTechByPin(ctx, pin);
    // Clock-out guard: don't let a technician clock out while still on an active service — explain the safe reason.
    if (r.session.branchId && await this.repo.hasTechnicianActiveService(r.session.tenantId, r.session.branchId, technicianId)) {
      throw withCode(new GoCheckInError("You're still on an active service. Please finish or hand it off, then clock out — or ask a manager to complete it.", 409, 'active_service'), 'CLOCK_OUT_ACTIVE_SERVICE');
    }
    const row = await clock.clockOut(ctx, technicianId);  // authoritative server time + "not clocked in" guard
    await this.logS(r.session, 'tech_clock_out', 'Technician clocked out at kiosk');
    const result = { ok: true as const, action: 'clock_in' as const, technicianName: row.technicianName, lastClockOutAt: row.lastClockOutAt, hoursToday: row.hoursToday, serverTime: new Date().toISOString() };
    this.idemPut(cacheKey, result);
    return result;
  }

  // ---- walk-in check-in (§20–§25) ----
  /**
   * The guest's own walk-in. Services must be THIS branch's (§22–§23 — another branch's row carries another price);
   * add-ons (§20) go with the first service, as on the POS walk-in; a preferred technician must be working the rest
   * of today here and qualified for the chosen services (§25) — "Any available" (no technician) always works. When the
   * salon switched service choice off, the guest joins the queue without services and the front desk adds them (that
   * walk-in used to be refused outright: the check-in required a service the screen could not offer).
   */
  async checkInWalkIn(sessionId: string, token: string | undefined, body: { customerId?: string; customerName: string; phone?: string; serviceIds?: string[]; addOnIds?: string[]; technicianId?: string; notes?: string }): Promise<CheckInConfirmation> {
    const r = await this.resolveSession(sessionId, token);
    if (!r.settings.walkinCheckinEnabled) throw withCode(new GoCheckInError('Walk-in check-in is turned off here.', 403, 'walkin_disabled'), 'WALK_IN_CHECKIN_DISABLED');
    const name = String(body?.customerName ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw withCode(new GoCheckInError('Please enter your name.', 400, 'bad_name'), 'NAME_REQUIRED');
    const asked = cleanIds(body?.serviceIds); const askedAddOns = cleanIds(body?.addOnIds);
    const catalog = asked.length || askedAddOns.length ? await this.repo.listServices(r.session.tenantId, r.session.branchId) : [];
    const byId = new Map(catalog.map((c) => [c.id, c]));
    if ([...asked, ...askedAddOns].some((id) => !byId.has(id))) throw withCode(new GoCheckInError('That service isn’t offered at this location.', 400, 'unknown_service'), 'SERVICE_NOT_AT_LOCATION');
    const mains = asked.filter((id) => !byId.get(id)!.isAddOn);
    const addOns = [...new Set([...askedAddOns, ...asked.filter((id) => byId.get(id)!.isAddOn)])];
    if (askedAddOns.some((id) => !byId.get(id)!.isAddOn)) throw withCode(new GoCheckInError('That isn’t an add-on.', 400, 'not_an_add_on'), 'NOT_AN_ADDON');
    if (addOns.length && !mains.length) throw withCode(new GoCheckInError('Choose a service first — add-ons go with a service.', 400, 'add_on_needs_service'), 'SERVICE_REQUIRED_FOR_ADDON');
    if (!mains.length && r.settings.serviceSelectionEnabled) throw withCode(new GoCheckInError('Please choose at least one service.', 400, 'no_service'), 'SERVICES_REQUIRED');
    let technicianId: string | undefined;
    if (typeof body?.technicianId === 'string' && body.technicianId && r.settings.technicianPreferenceEnabled) {
      // §25 on the server too: a stale screen or a forged request cannot ask for someone off today or unqualified
      if (!(await this.eligibleTechnicians(r, mains)).some((t) => t.technicianId === body.technicianId)) {
        throw withCode(new GoCheckInError('That technician isn’t available for these services today. Choose another, or Any available.', 400, 'technician_unavailable'), 'TECHNICIAN_UNAVAILABLE_TODAY');
      }
      technicianId = body.technicianId;
    }
    const ctx = this.kioskCtx(r);
    // duplicate guard: same customer already in an active queue today
    const day = await this.todayInfo(r.session);
    if (body.customerId && await this.repo.hasActiveCheckInToday(r.session.tenantId, body.customerId, day.today, day.dayStartMs)) {
      await this.logS(r.session, 'duplicate_blocked', 'Customer already checked in today');
      return { status: 'already_checked_in', firstName: name.split(' ')[0] };
    }
    const lines = [...mains.map((serviceId) => ({ serviceId })), ...addOns.map((serviceId) => ({ serviceId, isAddon: true, parentServiceId: mains[0] }))];
    const row = await this.requireCheckIn().walkIn(ctx, {
      customerId: body.customerId, customerName: name, customerPhone: body.phone,
      serviceIds: lines.map((l) => l.serviceId), ...(lines.length ? { serviceLines: lines } : { allowNoServices: true }),
      technicianId, notes: body.notes,
    }).catch((e: any) => {
      // Dual-Screen §104: another screen checked this guest in a moment ago (the database's one-active-entry index)
      if (e?.code === 'CHECKIN_ALREADY_EXISTS') throw new GoCheckInError(e.message, 409, 'CHECKIN_ALREADY_EXISTS');
      throw new GoCheckInError(e?.message || 'Walk-in check-in failed', 400, 'walkin_failed');
    });
    if (row.customerId) await this.repo.markCheckedInToday(r.session.tenantId, row.customerId, day.today);
    await this.logS(r.session, 'walkin_checked_in', 'Walk-in checked in', { checkInId: row.checkInId });
    const queued = await this.maybeEnqueue(ctx, r, row.checkInId);
    this.emit(r, EVENTS.customerCheckedIn, { checkInId: row.checkInId, customerName: row.customerName, source: 'walk_in', queueItemId: queued });
    const wait = waitEstimateFor(r.settings, row.quotedWaitMinutes);
    const serviceMinutes = lines.reduce((sum, l) => sum + (byId.get(l.serviceId)?.durationMinutes ?? 0), 0);
    return {
      status: 'checked_in', firstName: (row.customerName || name).split(' ')[0], estimatedWaitMinutes: wait,
      ...(wait !== undefined ? { estimatedWait: waitRangeFor(wait) } : {}), ...(lines.length ? { estimatedServiceMinutes: serviceMinutes } : {}),
      checkInId: queued ?? row.checkInId,
      ...(await this.queueFields(r, queued ?? row.checkInId)),   // round 2: queueItemId + requested technician + alternates
    } as CheckInConfirmation;
  }

  // Materialize the check-in into the tenant POS queue (pos_queue_items) unless the tenant requires front-desk
  // approval first. Reuses CheckInService.moveToQueue (idempotent). Best-effort: a queue hiccup never fails check-in.
  private async maybeEnqueue(ctx: CheckInContext, r: Resolved, checkInId: string): Promise<string | null> {
    if (!r.settings.autoSendToQueue || r.settings.requireFrontDeskApproval) return null;
    try {
      const res = await this.requireCheckIn().moveToQueue(ctx, checkInId);
      await this.logS(r.session, 'queue_item_created', 'Queue item created', { queueItemId: res.queueItemId });
      this.emit(r, EVENTS.queueUpdated, { queueItemId: res.queueItemId });
      return res.queueItemId;
    } catch { await this.logS(r.session, 'error', 'Queue creation deferred'); return null; }
  }

  async status(sessionId: string, token: string | undefined) {
    const r = await this.resolveSession(sessionId, token);
    return { status: r.session.status, tenantScoped: true };
  }

  // Real place-in-line for the just-checked-in guest, from the branch's waiting queue (tenant/branch server-derived).
  async placeInLine(sessionId: string, token: string | undefined, checkInId: string): Promise<{ position: number; waitingAhead: number } | null> {
    if (!checkInId) return null;
    const r = await this.resolveSession(sessionId, token);
    return this.requireCheckIn().placeInLine(this.kioskCtx(r), checkInId);
  }

  async complete(sessionId: string, token: string | undefined): Promise<{ ok: true }> {
    const r = await this.resolveSession(sessionId, token);
    await this.repo.setSessionStatus(r.session.id, 'completed');
    await this.logS(r.session, 'session_completed', 'Session completed');
    this.counters.delete(sessionId);
    return { ok: true };
  }

  // ================= Super Admin / device management =================
  async createDevice(tenantId: string, body: { deviceName: string; branchId?: string | null; deviceType?: string; baseUrl?: string; allowedBranchIds?: string[]; welcomeMessage?: string | null }, createdByUserId?: string): Promise<{ deviceId: string; checkinSlug: string; publicUrl: string; deviceToken: string; tokenExpiresAt: string | null }> {
    const slug = newSlug();
    const publicUrl = `${(body.baseUrl || '').replace(/\/+$/, '')}/go-check-in/${slug}`;
    const allowedBranchIds = (body.allowedBranchIds || []).filter((x) => x && x !== body.branchId); // de-dupe the default out of "additional"
    const device = await this.repo.createDevice({ tenantId, branchId: body.branchId ?? null, deviceName: body.deviceName, deviceType: body.deviceType, checkinSlug: slug, publicUrl, createdByUserId, allowedBranchIds, welcomeMessage: body.welcomeMessage ?? null });
    const token = newToken();
    const expiry = deviceTokenExpiry();
    await this.repo.setDeviceToken(tenantId, device.id, sha256Hex(token), expiry);
    await this.log({ tenantId, branchId: device.branchId, deviceId: device.id }, 'session_started', 'Device created'); // audit
    return { deviceId: device.id, checkinSlug: slug, publicUrl, deviceToken: token, tokenExpiresAt: expiry ? expiry.toISOString() : null };
  }
  async listDevices(tenantId: string): Promise<{ devices: GoCheckInDeviceView[] }> {   // the wire contract (Constitution 13 §15)
    const rows = await this.repo.listDevices(tenantId);
    return { devices: rows.map((d) => ({ deviceId: d.id, deviceName: d.deviceName, branchId: d.branchId, deviceType: d.deviceType, checkinSlug: d.checkinSlug, publicUrl: d.publicUrl, status: d.status, lastSeenAt: d.lastSeenAt, tokenExpiresAt: d.tokenExpiresAt, allowedBranchIds: d.allowedBranchIds })) };
  }
  async updateDevice(tenantId: string, deviceId: string, patch: { status?: DeviceRow['status']; branchId?: string | null; allowedBranchIds?: string[]; welcomeMessage?: string | null }) {
    const d = await this.repo.deviceById(tenantId, deviceId); if (!d) throw withCode(new GoCheckInError('Device not found', 404, 'device_not_found'), 'DEVICE_NOT_FOUND');
    if (patch.status) { assertTransition(GO_CHECKIN_DEVICE, d.status, patch.status); await this.repo.setDeviceStatus(tenantId, deviceId, patch.status); }   // Phase 12 (#27): 409 on reviving a revoked kiosk
    if (patch.branchId !== undefined || patch.allowedBranchIds !== undefined || patch.welcomeMessage !== undefined) {
      const branchId = patch.branchId !== undefined ? patch.branchId : d.branchId;
      const allowedBranchIds = patch.allowedBranchIds !== undefined
        ? patch.allowedBranchIds.filter((x) => x && x !== branchId) // keep the default out of "additional"
        : undefined;
      await this.repo.setDeviceBranches(tenantId, deviceId, { ...(patch.branchId !== undefined ? { branchId } : {}), ...(allowedBranchIds !== undefined ? { allowedBranchIds } : {}), ...(patch.welcomeMessage !== undefined ? { welcomeMessage: patch.welcomeMessage } : {}) });
    }
    return { ok: true };
  }
  async regenerateToken(tenantId: string, deviceId: string): Promise<{ deviceToken: string; tokenExpiresAt: string | null }> {
    const d = await this.repo.deviceById(tenantId, deviceId); if (!d) throw withCode(new GoCheckInError('Device not found', 404, 'device_not_found'), 'DEVICE_NOT_FOUND');
    const token = newToken();
    const expiry = deviceTokenExpiry();
    await this.repo.setDeviceToken(tenantId, deviceId, sha256Hex(token), expiry);
    // A regenerated token re-activates a device that had expired (it's freshly paired again).
    if (d.status === 'expired') await this.repo.setDeviceStatus(tenantId, deviceId, 'active');
    return { deviceToken: token, tokenExpiresAt: expiry ? expiry.toISOString() : null };
  }
  async disableDevice(tenantId: string, deviceId: string) {
    const d = await this.repo.deviceById(tenantId, deviceId); if (!d) throw withCode(new GoCheckInError('Device not found', 404, 'device_not_found'), 'DEVICE_NOT_FOUND');
    await this.repo.setDeviceStatus(tenantId, deviceId, 'disabled');
    return { ok: true };
  }
  async logs(tenantId: string, limit = 100) { return { logs: await this.repo.listLogs(tenantId, Math.min(500, Math.max(1, limit))) }; }

  // ================= tenant POS settings =================
  async getSettings(tenantId: string) { return this.repo.getSettings(tenantId); }
  async updateSettings(tenantId: string, patch: Partial<GoCheckInSettings>) {
    // Dual-Screen §118–§119: the display's languages, cleaned (default first) — an unusable list is refused, not guessed
    // Kevin (Oct 28 2026): the customer display is English only — a saved language list is always English
    if (patch && 'displayLanguages' in patch) patch = { ...patch, displayLanguages: ['en'] };
    return this.repo.upsertSettings(tenantId, patch);
  }
  /** The languages the customer display offers. Kevin (Oct 28 2026): only the POS is bilingual — the customer display is
   *  English for every salon, whatever was saved before (the column is kept; nothing reads another value). */
  async displayLanguages(_tenantId: string): Promise<string[]> {
    return ['en'];
  }
}

/** round 10 (Tablets 02): the OS / battery a kiosk's browser reported with its heartbeat — kept only when well-formed (never
 *  fatal, never guessed); null fields are simply not recorded. */
export function deviceHealthFacts(body: unknown): { os: string | null; battery: { percent: number; charging: boolean | null } | null } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const osRaw = typeof b.os === 'string' ? b.os.trim() : '';
  const os = /^[\x20-\x7e]{1,64}$/.test(osRaw) ? osRaw : null;
  const bt = b.battery && typeof b.battery === 'object' ? b.battery as Record<string, unknown> : null;
  const pct = bt ? Number(bt.percent) : NaN;
  return { os, battery: bt && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? { percent: Math.round(pct), charging: typeof bt.charging === 'boolean' ? bt.charging : null } : null };
}
