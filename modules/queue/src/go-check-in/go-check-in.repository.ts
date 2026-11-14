// go-check-in.repository.ts — data port + an in-memory implementation used by unit + tenant-isolation tests.
// The port keeps tenant_id at the boundary of every read/write so neither the service nor the kiosk can cross tenants.
import {
  GoCheckInSettings, DEFAULT_SETTINGS, GoCheckInDevice, GoCheckInSession, normalizePhone,
} from './go-check-in.dto';
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import type { KioskTechFacts } from './go-check-in-rules';
import type { WalkInCatalogRow } from './walkin-selection';
import { EMPTY_BRANCH_OVERRIDE } from './walkin-selection';
import type { WalkInBranchOverride } from '@aipowersalon/api-contracts/tenant';
import type { WalkInRequestState } from '@aipowersalon/api-contracts/customer';

export interface DeviceRow extends GoCheckInDevice { deviceTokenHash: string | null; }
export interface SessionRow extends GoCheckInSession { sessionTokenHash: string; }
export interface CustRow { customerId: string; firstName: string; lastName: string; email: string | null; }
/** One of a customer's appointments today at this branch (23-inch spec §16–§17): one technician, its services. Times are
 *  minutes since midnight on the branch's clock; technician names are first names only. */
export interface ApptRow { appointmentId: string; startMinutes: number; endMinutes: number; status: string; items: { serviceName: string; technicianName?: string }[]; }
/** A service of the BRANCH's catalog (§22–§23), with its category; add-ons (§20) flagged by the category convention. */
export interface ServiceRow { id: string; name: string; priceCents: number; durationMinutes: number; category: string; isAddOn: boolean; }
/** A paired customer display that runs check-in sessions with its own identity (§8): usable = paired, not revoked,
 *  not in maintenance. */
export interface DisplayDeviceRow { id: string; tenantId: string; branchId: string | null; usable: boolean; }
export interface LogRow { id: string; tenantId: string; branchId: string | null; deviceId: string | null; sessionId: string | null; eventType: string; safeMessage: string | null; metadata: any; createdAt: string; }

/** A guest's walk-in service request (migration 990) — keyed by (tenant, branch, device, checkin_request_id). */
export interface WalkInRequestRow {
  id: string; tenantId: string; branchId: string; deviceRef: string; checkinRequestId: string; payloadHash: string; catalogRevision: string;
  lines: unknown; servicesPending: boolean; estimatedTotalCents: number; estimatedMinutes: number; status: WalkInRequestState;
  queueItemId: string | null; result: Record<string, unknown> | null; updatedAt: string;
}
export type NewWalkInRequest = Omit<WalkInRequestRow, 'id' | 'status' | 'queueItemId' | 'result' | 'updatedAt'>;
export interface CreateDeviceInput { tenantId: string; branchId?: string | null; deviceName: string; deviceType?: string; checkinSlug: string; publicUrl?: string | null; createdByUserId?: string | null; allowedBranchIds?: string[] | null; welcomeMessage?: string | null; }
/** Exactly one of deviceId (a Go Check-In kiosk) or displayDeviceId (a paired customer display). */
export interface CreateSessionInput { tenantId: string; branchId: string | null; deviceId?: string | null; displayDeviceId?: string | null; sessionTokenHash: string; metadata?: any; }
export interface InsertLogInput { tenantId: string; branchId?: string | null; deviceId?: string | null; sessionId?: string | null; eventType: string; safeMessage?: string | null; metadata?: any; }

export interface GoCheckInDataPort {
  // devices
  createDevice(i: CreateDeviceInput): Promise<DeviceRow>;
  deviceBySlug(slug: string): Promise<DeviceRow | null>;
  deviceByTokenHash(hash: string): Promise<DeviceRow | null>;
  deviceById(tenantId: string, id: string): Promise<DeviceRow | null>;
  listDevices(tenantId: string): Promise<DeviceRow[]>;
  setDeviceToken(tenantId: string, id: string, hash: string, tokenExpiresAt?: Date | null): Promise<void>;
  setDeviceStatus(tenantId: string, id: string, status: DeviceRow['status']): Promise<void>;
  setDeviceBranches(tenantId: string, id: string, patch: { branchId?: string | null; allowedBranchIds?: string[]; welcomeMessage?: string | null }): Promise<void>;
  /** round 10 (Tablets 02): `facts` = the OS / battery the device reported (null = not reported; the last reading stays) */
  touchDevice(id: string, tenantId: string, facts?: { os: string | null; battery: { percent: number; charging: boolean | null } | null }): Promise<void>;
  // sessions
  createSession(i: CreateSessionInput): Promise<SessionRow>;
  sessionById(id: string): Promise<SessionRow | null>;
  touchSession(id: string): Promise<void>;
  /** One more phone lookup / new profile in this session — counted on the session row, atomically, so every API
   *  instance counts the same allowance (migration 516). Returns the new count. */
  bumpSessionCounter?(tenantId: string, id: string, kind: 'lookups' | 'creates'): Promise<number>;
  /** Security Deep Scan E10: sessions started and phone lookups made at this salon in the last `minutes` (all kiosks). */
  recentKioskActivity?(tenantId: string, minutes: number): Promise<{ sessions: number; lookups: number }>;
  setSessionStatus(id: string, status: SessionRow['status']): Promise<void>;
  // settings
  getSettings(tenantId: string): Promise<GoCheckInSettings>;
  upsertSettings(tenantId: string, patch: Partial<GoCheckInSettings>): Promise<GoCheckInSettings>;
  /** migration 993: one location's walk-in overrides (null = none saved) */
  getBranchWalkIn?(tenantId: string, branchId: string): Promise<WalkInBranchOverride | null>;
  /** every active location of the salon with its overrides (none saved → all null) */
  listBranchWalkIn?(tenantId: string): Promise<{ branchId: string; branchName: string; override: WalkInBranchOverride }[]>;
  /** apply a cleaned patch to one location; false when the branch is not this salon's */
  upsertBranchWalkIn?(tenantId: string, branchId: string, patch: Partial<WalkInBranchOverride>, userId: string | null): Promise<WalkInBranchOverride | null>;
  // logs
  insertLog(i: InsertLogInput): Promise<void>;
  listLogs(tenantId: string, limit: number): Promise<LogRow[]>;
  /** BUILD_PLAN Phase 6 round 2: did THIS session check this guest in (its own log lines name the check-in / queue item)? */
  sessionOwnsQueueItem(tenantId: string, sessionId: string, queueItemId: string): Promise<boolean>;
  // tenant-safe lookups
  findTenantCustomerByPhone(tenantId: string, normalized: string): Promise<CustRow | null>;
  findTenantCustomersByPhone(tenantId: string, normalized: string): Promise<CustRow[]>;
  findCentralCustomerByPhone(excludeTenantId: string, normalized: string): Promise<CustRow | null>;
  /** The customer's appointments today at this branch in these statuses (default: the check-in-eligible ones). */
  findTodayAppointmentsForCustomer(tenantId: string, branchId: string | null, customerId: string, today: string, statuses?: readonly string[]): Promise<ApptRow[]>;
  /** Whose appointment this is — only an appointment of this tenant and branch, today. */
  appointmentCustomer(tenantId: string, branchId: string | null, appointmentId: string, today: string): Promise<string | null>;
  /** The branch's active catalog (never another branch's rows or prices). */
  listServices(tenantId: string, branchId: string | null): Promise<ServiceRow[]>;
  /** Today's facts about the branch's technicians: skills, shift, blocks, punch, live status (§25). */
  kioskTechnicianFacts(tenantId: string, branchId: string, today: string, weekday: number): Promise<KioskTechFacts[]>;
  /** A paired display's standing, for a session it started (re-checked on every request — a revoke ends it at once). */
  displayDeviceById(tenantId: string, id: string): Promise<DisplayDeviceRow | null>;
  // duplicate-check guards (active queue item today / appointment already arrived)
  /** "today" is the BRANCH's day; dayStartMs is the instant that day began there (so an 11 pm UTC check-in counts on the
   *  right day). */
  hasActiveCheckInToday(tenantId: string, customerId: string, today: string, dayStartMs?: number): Promise<boolean>;
  /** The branch's time zone (branches.timezone → America/New_York). Optional: older stores use the default. */
  branchTimeZone?(tenantId: string, branchId: string | null): Promise<string>;
  markCheckedInToday(tenantId: string, customerId: string, today: string): Promise<void>;
  // clock-out guard: is this technician currently mid-service at this branch (serving started, not yet done)?
  hasTechnicianActiveService(tenantId: string, branchId: string, technicianId: string): Promise<boolean>;
  appointmentCheckedIn(tenantId: string, appointmentId: string): Promise<boolean>;
  resolveSalonBranch(tenantId: string, branchId: string | null): Promise<{ salonName: string; branchName?: string }>;
  listBranchNames(tenantId: string, ids: string[]): Promise<{ id: string; name: string }[]>;
  // ---- CPad 14 Walk-In service selection (SUNMI guide 4A) — optional: a store without them has no walk-in selection ----
  /** The branch's catalog rows (services ⋈ categories, THIS tenant and branch only) with their visibility facts. */
  walkInCatalogRows?(tenantId: string, branchId: string): Promise<WalkInCatalogRow[]>;
  walkInRequestByKey?(tenantId: string, branchId: string, deviceRef: string, checkinRequestId: string): Promise<WalkInRequestRow | null>;
  /** Insert the request; null when the key is already taken (another tap / replica won — read it back). */
  insertWalkInRequest?(row: NewWalkInRequest): Promise<WalkInRequestRow | null>;
  /** The customer's active visit today (any branch of the salon) — the one a second walk-in resolves to (4A.7). */
  activeCheckInIdToday?(tenantId: string, customerId: string, dayStartMs: number): Promise<string | null>;
  updateWalkInRequest?(tenantId: string, id: string, patch: { status: WalkInRequestState; queueItemId?: string | null; result?: Record<string, unknown> | null }): Promise<void>;
}

// ---- in-memory (tests) ----
interface MemCustomer { tenantId: string; customerId: string; firstName: string; lastName: string; email: string | null; normalizedPhone: string; }
interface MemAppt { tenantId: string; branchId: string | null; customerId: string; date: string; appointmentId: string; start: string; end: string; status?: string; items: { serviceName: string; technicianName?: string }[]; }
interface MemService extends ServiceRow { tenantId: string; branchId: string | null; }
const ELIGIBLE = ['booked', 'confirmed', 'arrived'] as const;
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export class InMemoryGoCheckInRepository implements GoCheckInDataPort {
  private devices: DeviceRow[] = [];
  private sessions = new Map<string, SessionRow>();
  private settings = new Map<string, GoCheckInSettings>();
  private logs: LogRow[] = [];
  private customers: MemCustomer[] = [];
  private appts: MemAppt[] = [];
  private services: MemService[] = [];
  private techFacts = new Map<string, KioskTechFacts[]>();   // key: tenant|branch
  private displays: DisplayDeviceRow[] = [];
  private seq = 0;
  private id(p: string) { return `${p}_${++this.seq}`; }

  // ---- test seeding ----
  seedCustomer(c: { tenantId: string; customerId?: string; firstName: string; lastName: string; email?: string | null; phone: string }) {
    const row: MemCustomer = { tenantId: c.tenantId, customerId: c.customerId ?? this.id('cust'), firstName: c.firstName, lastName: c.lastName, email: c.email ?? null, normalizedPhone: normalizePhone(c.phone) };
    this.customers.push(row); return row;
  }
  seedAppointment(a: MemAppt) { this.appts.push({ status: 'booked', ...a }); return a; }
  setAppointmentStatus(appointmentId: string, status: string) { const a = this.appts.find((x) => x.appointmentId === appointmentId); if (a) a.status = status; }
  /** A branch's catalog (branchId null = the rows a test does not care to place). Category "Add-ons" marks add-ons. */
  seedServices(tenantId: string, rows: (Omit<ServiceRow, 'category' | 'isAddOn'> & { category?: string })[], branchId: string | null = null) {
    this.services = this.services.filter((x) => !(x.tenantId === tenantId && x.branchId === branchId));
    for (const r of rows) { const category = r.category ?? 'Services'; this.services.push({ ...r, category, isAddOn: isAddOnCategory(category), tenantId, branchId }); }
  }
  seedTechnicians(tenantId: string, branchId: string, facts: KioskTechFacts[]) { this.techFacts.set(`${tenantId}|${branchId}`, facts); }
  seedDisplay(d: DisplayDeviceRow) { this.displays = this.displays.filter((x) => x.id !== d.id); this.displays.push({ ...d }); return d; }
  allLogs() { return this.logs; }

  async createDevice(i: CreateDeviceInput): Promise<DeviceRow> {
    const row: DeviceRow = { id: this.id('dev'), tenantId: i.tenantId, branchId: i.branchId ?? null, deviceName: i.deviceName, deviceType: i.deviceType ?? 'kiosk', checkinSlug: i.checkinSlug, publicUrl: i.publicUrl ?? null, deviceTokenHash: null, status: 'active', lastSeenAt: null, tokenExpiresAt: null, allowedBranchIds: i.allowedBranchIds ?? [], welcomeMessage: i.welcomeMessage ?? null };
    this.devices.push(row); return row;
  }
  async deviceBySlug(slug: string) { return this.devices.find((d) => d.checkinSlug === slug) ?? null; }
  async deviceByTokenHash(hash: string) { return this.devices.find((d) => d.deviceTokenHash === hash) ?? null; }
  async deviceById(tenantId: string, id: string) { return this.devices.find((d) => d.id === id && d.tenantId === tenantId) ?? null; }
  async listDevices(tenantId: string) { return this.devices.filter((d) => d.tenantId === tenantId); }
  async setDeviceToken(tenantId: string, id: string, hash: string, tokenExpiresAt?: Date | null) { const d = await this.deviceById(tenantId, id); if (d) { d.deviceTokenHash = hash; d.tokenExpiresAt = tokenExpiresAt ? tokenExpiresAt.toISOString() : null; } }
  async setDeviceStatus(tenantId: string, id: string, status: DeviceRow['status']) { const d = await this.deviceById(tenantId, id); if (d) d.status = status; }
  async setDeviceBranches(tenantId: string, id: string, patch: { branchId?: string | null; allowedBranchIds?: string[]; welcomeMessage?: string | null }) { const d = await this.deviceById(tenantId, id); if (d) { if (patch.branchId !== undefined) d.branchId = patch.branchId; if (patch.allowedBranchIds !== undefined) d.allowedBranchIds = patch.allowedBranchIds; if (patch.welcomeMessage !== undefined) d.welcomeMessage = patch.welcomeMessage; } }
  async touchDevice(id: string, tenantId: string) { const d = this.devices.find((x) => x.id === id && x.tenantId === tenantId); if (d) d.lastSeenAt = new Date().toISOString(); }

  async createSession(i: CreateSessionInput): Promise<SessionRow> {
    const now = new Date().toISOString();
    if (!!i.deviceId === !!i.displayDeviceId) throw new Error('a session belongs to exactly one device (ck_gcs_one_device)');
    const row: SessionRow = { id: this.id('ses'), tenantId: i.tenantId, branchId: i.branchId, deviceId: i.deviceId ?? null, displayDeviceId: i.displayDeviceId ?? null, status: 'active', startedAt: now, lastSeenAt: now, sessionTokenHash: i.sessionTokenHash };
    this.sessions.set(row.id, row); return row;
  }
  async sessionById(id: string) { return this.sessions.get(id) ?? null; }
  async touchSession(id: string) { const s = this.sessions.get(id); if (s) s.lastSeenAt = new Date().toISOString(); }
  private sessionCounts = new Map<string, { lookups: number; creates: number }>();
  async bumpSessionCounter(tenantId: string, id: string, kind: 'lookups' | 'creates') { if (this.sessions.get(id)?.tenantId !== tenantId) return Number.MAX_SAFE_INTEGER; const c = this.sessionCounts.get(id) ?? { lookups: 0, creates: 0 }; c[kind] += 1; this.sessionCounts.set(id, c); return c[kind]; }
  async setSessionStatus(id: string, status: SessionRow['status']) { const s = this.sessions.get(id); if (s) s.status = status; }
  async getSettings(tenantId: string) { return this.settings.get(tenantId) ?? { ...DEFAULT_SETTINGS }; }
  private branchWalkIn = new Map<string, WalkInBranchOverride>();
  async getBranchWalkIn(tenantId: string, branchId: string) { return this.branchWalkIn.get(`${tenantId}:${branchId}`) ?? null; }
  async listBranchWalkIn(tenantId: string) {
    return [...this.branchNames.entries()].map(([branchId, branchName]) => ({ branchId, branchName, override: this.branchWalkIn.get(`${tenantId}:${branchId}`) ?? { ...EMPTY_BRANCH_OVERRIDE } }));
  }
  async upsertBranchWalkIn(tenantId: string, branchId: string, patch: Partial<WalkInBranchOverride>) {
    if (!this.branchNames.has(branchId)) return null;
    const next = { ...(this.branchWalkIn.get(`${tenantId}:${branchId}`) ?? EMPTY_BRANCH_OVERRIDE), ...patch };
    this.branchWalkIn.set(`${tenantId}:${branchId}`, next); return next;
  }
  async upsertSettings(tenantId: string, patch: Partial<GoCheckInSettings>) { const cur = await this.getSettings(tenantId); const next = { ...cur, ...patch }; this.settings.set(tenantId, next); return next; }

  async insertLog(i: InsertLogInput) { this.logs.push({ id: this.id('log'), tenantId: i.tenantId, branchId: i.branchId ?? null, deviceId: i.deviceId ?? null, sessionId: i.sessionId ?? null, eventType: i.eventType, safeMessage: i.safeMessage ?? null, metadata: i.metadata ?? {}, createdAt: new Date().toISOString() }); }
  async listLogs(tenantId: string, limit: number) { return this.logs.filter((l) => l.tenantId === tenantId).slice(-limit).reverse(); }
  async sessionOwnsQueueItem(tenantId: string, sessionId: string, queueItemId: string) {
    return !!queueItemId && this.logs.some((l) => l.tenantId === tenantId && l.sessionId === sessionId && (l.metadata?.queueItemId === queueItemId || l.metadata?.checkInId === queueItemId));
  }

  async findTenantCustomerByPhone(tenantId: string, normalized: string) {
    if (!normalized) return null;
    const c = this.customers.find((x) => x.tenantId === tenantId && x.normalizedPhone === normalized);
    return c ? { customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, email: c.email } : null;
  }
  async findTenantCustomersByPhone(tenantId: string, normalized: string) {
    if (!normalized) return [];
    return this.customers.filter((x) => x.tenantId === tenantId && x.normalizedPhone === normalized)
      .map((c) => ({ customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, email: c.email }));
  }
  async findCentralCustomerByPhone(excludeTenantId: string, normalized: string) {
    if (!normalized) return null;
    const c = this.customers.find((x) => x.tenantId !== excludeTenantId && x.normalizedPhone === normalized);
    return c ? { customerId: c.customerId, firstName: c.firstName, lastName: c.lastName, email: c.email } : null;
  }
  async findTodayAppointmentsForCustomer(tenantId: string, branchId: string | null, customerId: string, today: string, statuses: readonly string[] = ELIGIBLE) {
    return this.appts.filter((x) => x.tenantId === tenantId && x.customerId === customerId && x.date === today && (branchId == null || x.branchId === branchId) && statuses.includes(x.status ?? 'booked'))
      .map((a) => ({ appointmentId: a.appointmentId, startMinutes: mins(a.start), endMinutes: mins(a.end), status: a.status ?? 'booked', items: a.items.map((i) => ({ ...i })) }));
  }
  async appointmentCustomer(tenantId: string, branchId: string | null, appointmentId: string, today: string) {
    const a = this.appts.find((x) => x.appointmentId === appointmentId && x.tenantId === tenantId && x.date === today && (branchId == null || x.branchId === branchId));
    return a ? a.customerId : null;
  }
  async listServices(tenantId: string, branchId: string | null) {
    return this.services.filter((x) => x.tenantId === tenantId && (x.branchId === branchId || x.branchId == null))
      .map(({ tenantId: _t, branchId: _b, ...r }) => r);
  }
  async kioskTechnicianFacts(tenantId: string, branchId: string) { return (this.techFacts.get(`${tenantId}|${branchId}`) ?? []).map((t) => ({ ...t, skills: [...t.skills], blocks: [...t.blocks] })); }
  async displayDeviceById(tenantId: string, id: string) { const d = this.displays.find((x) => x.id === id && x.tenantId === tenantId); return d ? { ...d } : null; }
  private checkedIn = new Set<string>();
  private checkedInAppts = new Set<string>();
  seedAppointmentCheckedIn(appointmentId: string) { this.checkedInAppts.add(appointmentId); }
  async hasActiveCheckInToday(tenantId: string, customerId: string, today: string) { return this.checkedIn.has(`${tenantId}|${customerId}|${today}`); }
  async hasTechnicianActiveService() { return false; }   // in-memory has no ticket store; the guard is a no-op locally
  async markCheckedInToday(tenantId: string, customerId: string, today: string) { this.checkedIn.add(`${tenantId}|${customerId}|${today}`); }
  async appointmentCheckedIn(_tenantId: string, appointmentId: string) { return this.checkedInAppts.has(appointmentId); }
  private salonNames = new Map<string, string>();
  private branchNames = new Map<string, string>();
  seedSalon(tenantId: string, name: string, branchId?: string, branchName?: string) { this.salonNames.set(tenantId, name); if (branchId && branchName) this.branchNames.set(branchId, branchName); }
  async resolveSalonBranch(tenantId: string, branchId: string | null) { return { salonName: this.salonNames.get(tenantId) ?? '', branchName: branchId ? this.branchNames.get(branchId) : undefined }; }
  async listBranchNames(_tenantId: string, ids: string[]) { return ids.map((id) => ({ id, name: this.branchNames.get(id) ?? id })); }

  // ---- walk-in selection (4A): the same seeded catalog; extra facts (description, visibility, status) per service id ----
  private walkInExtra = new Map<string, Partial<WalkInCatalogRow>>();
  seedWalkInFacts(serviceId: string, facts: Partial<WalkInCatalogRow>) { this.walkInExtra.set(serviceId, { ...(this.walkInExtra.get(serviceId) ?? {}), ...facts }); }
  async walkInCatalogRows(tenantId: string, branchId: string): Promise<WalkInCatalogRow[]> {
    const cats: string[] = [];
    return this.services.filter((x) => x.tenantId === tenantId && x.branchId === branchId).map((x, i) => {
      if (!cats.includes(x.category)) cats.push(x.category);
      return { serviceId: x.id, serviceName: x.name, description: null, priceCents: x.priceCents, durationMinutes: x.durationMinutes, serviceStatus: 'active', archived: false, customerVisible: true, serviceSort: i,
        categoryId: 'cat:' + x.category, categoryName: x.category, categoryDescription: null, categoryIconKey: null, categoryStatus: 'active', categorySort: cats.indexOf(x.category), ...(this.walkInExtra.get(x.id) ?? {}) };
    });
  }
  private walkIns: WalkInRequestRow[] = [];
  allWalkInRequests() { return this.walkIns.map((r) => ({ ...r })); }
  async walkInRequestByKey(tenantId: string, branchId: string, deviceRef: string, checkinRequestId: string) {
    const r = this.walkIns.find((x) => x.tenantId === tenantId && x.branchId === branchId && x.deviceRef === deviceRef && x.checkinRequestId === checkinRequestId);
    return r ? { ...r } : null;
  }
  async insertWalkInRequest(row: NewWalkInRequest) {
    if (await this.walkInRequestByKey(row.tenantId, row.branchId, row.deviceRef, row.checkinRequestId)) return null;
    const r: WalkInRequestRow = { ...row, id: this.id('wir'), status: 'pending', queueItemId: null, result: null, updatedAt: new Date().toISOString() };
    this.walkIns.push(r); return { ...r };
  }
  /** test seam: age a request (a crashed confirm left it pending) */
  ageWalkInRequest(id: string, ms: number) { const r = this.walkIns.find((x) => x.id === id); if (r) r.updatedAt = new Date(Date.parse(r.updatedAt) - ms).toISOString(); }
  async activeCheckInIdToday() { return null; }   // the in-memory store has no queue; hasActiveCheckInToday answers the guard
  async updateWalkInRequest(tenantId: string, id: string, patch: { status: WalkInRequestState; queueItemId?: string | null; result?: Record<string, unknown> | null }) {
    const r = this.walkIns.find((x) => x.id === id && x.tenantId === tenantId);
    if (r) { r.status = patch.status; r.updatedAt = new Date().toISOString(); if (patch.queueItemId !== undefined) r.queueItemId = patch.queueItemId; if (patch.result !== undefined) r.result = patch.result; }
  }
}
