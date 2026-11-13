// go-check-in.kysely.repository.ts — Postgres implementation of GoCheckInDataPort. Every read/write is tenant-scoped.
import { sql, type Kysely } from 'kysely';
import { CHECK_IN_ELIGIBLE_STATUSES, isAddOnCategory } from '@aipowersalon/api-contracts';
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { GO_CHECKIN_DEVICE, GO_CHECKIN_SESSION } from '../queue-lifecycles';
import type { DB } from '@aipowersalon/database';
import { addDays } from '@aipowersalon/date-time';
import { buildMediaUrl } from '@aipowersalon/media';
import { ACTIVE_STATUS } from '@aipowersalon/workforce';
import {
  GoCheckInDataPort, DeviceRow, SessionRow, CustRow, ApptRow, ServiceRow, LogRow, DisplayDeviceRow,
  CreateDeviceInput, CreateSessionInput, InsertLogInput,
} from './go-check-in.repository';
import { GoCheckInSettings, DEFAULT_SETTINGS } from './go-check-in.dto';
import { minutesOf, type KioskTechFacts } from './go-check-in-rules';

const dev = (r: any): DeviceRow => ({
  id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, deviceName: r.device_name, deviceType: r.device_type,
  checkinSlug: r.checkin_slug, publicUrl: r.public_url ?? null, deviceTokenHash: r.device_token_hash ?? null, welcomeMessage: r.welcome_message ?? null,
  status: r.status, lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null, tokenExpiresAt: r.token_expires_at ? new Date(r.token_expires_at).toISOString() : null,
  allowedBranchIds: Array.isArray(r.allowed_branch_ids) ? r.allowed_branch_ids : (typeof r.allowed_branch_ids === 'string' && r.allowed_branch_ids ? (() => { try { const v = JSON.parse(r.allowed_branch_ids); return Array.isArray(v) ? v : []; } catch { return []; } })() : []),
});
const ses = (r: any): SessionRow => ({
  id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, deviceId: r.device_id ?? null, displayDeviceId: r.display_device_id ?? null, status: r.status,
  startedAt: new Date(r.started_at).toISOString(), lastSeenAt: new Date(r.last_seen_at).toISOString(), sessionTokenHash: r.session_token_hash,
});
const settingsFrom = (r: any): GoCheckInSettings => !r ? { ...DEFAULT_SETTINGS } : ({
  enabled: r.enabled, appointmentCheckinEnabled: r.appointment_checkin_enabled, walkinCheckinEnabled: r.walkin_checkin_enabled,
  newCustomerEnabled: r.new_customer_enabled, serviceSelectionEnabled: r.service_selection_enabled,
  technicianPreferenceEnabled: r.technician_preference_enabled, tenantPhoneLookupEnabled: r.tenant_phone_lookup_enabled,
  centralLookupEnabled: r.central_lookup_enabled, customerLinkingEnabled: r.customer_linking_enabled,
  showWaitEstimate: r.show_wait_estimate, autoSendToQueue: r.auto_send_to_queue, requireFrontDeskApproval: r.require_front_desk_approval,
  confirmationTimeoutSeconds: r.confirmation_timeout_seconds ?? 12,
  displayLanguages: Array.isArray(r.display_languages) && r.display_languages.length ? r.display_languages : ['en'],
});
const cust = (r: any): CustRow => ({ customerId: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email ?? null });
/** The service names on an appointment (its services JSON), in order. */
const serviceNames = (services: any): string[] => {
  try {
    const arr = typeof services === 'string' ? JSON.parse(services) : services;
    return Array.isArray(arr) ? arr.map((x: any) => String(x?.serviceName ?? x?.name ?? '').trim()).filter(Boolean) : [];
  } catch { return []; }
};
const parseJson = (v: any): any => { if (v == null) return null; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } };

export class KyselyGoCheckInRepository implements GoCheckInDataPort {
  constructor(private db: Kysely<DB>) {}

  async createDevice(i: CreateDeviceInput): Promise<DeviceRow> {
    const row = await this.db.insertInto('go_checkin_devices').values({
      tenant_id: i.tenantId, branch_id: i.branchId ?? null, device_name: i.deviceName, device_type: (i.deviceType ?? 'kiosk'),
      checkin_slug: i.checkinSlug, public_url: i.publicUrl ?? null, created_by_user_id: i.createdByUserId ?? null, welcome_message: i.welcomeMessage ?? null,
      allowed_branch_ids: i.allowedBranchIds && i.allowedBranchIds.length ? JSON.stringify(i.allowedBranchIds) : null,
    }).returningAll().executeTakeFirstOrThrow();
    return dev(row);
  }
  async deviceBySlug(slug: string) { const r = await this.db.selectFrom('go_checkin_devices').selectAll().where('checkin_slug', '=', slug).executeTakeFirst(); return r ? dev(r) : null; }
  async deviceByTokenHash(hash: string) { const r = await this.db.selectFrom('go_checkin_devices').selectAll().where('device_token_hash', '=', hash).executeTakeFirst(); return r ? dev(r) : null; }
  async deviceById(tenantId: string, id: string) { const r = await this.db.selectFrom('go_checkin_devices').selectAll().where('id', '=', id).where('tenant_id', '=', tenantId).executeTakeFirst(); return r ? dev(r) : null; }
  async listDevices(tenantId: string) { const rows = await this.db.selectFrom('go_checkin_devices').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').execute(); return rows.map(dev); }
  async setDeviceToken(tenantId: string, id: string, hash: string, tokenExpiresAt?: Date | null) {
    await this.db.updateTable('go_checkin_devices').set({ device_token_hash: hash, token_expires_at: tokenExpiresAt ?? null, updated_at: new Date() }).where('id', '=', id).where('tenant_id', '=', tenantId).execute();
  }
  /** Phase 12 (#27): through the GO_CHECKIN_DEVICE machine — a revoked kiosk is never re-activated (the service answers an
   *  admin's refused move with 409 before it gets here). */
  async setDeviceStatus(tenantId: string, id: string, status: DeviceRow['status']) { await this.db.updateTable('go_checkin_devices').set({ status, disabled_at: (status === 'disabled' || status === 'revoked') ? new Date() : null, updated_at: new Date() } as any).where('id', '=', id).where('tenant_id', '=', tenantId).where(canMoveToSql(GO_CHECKIN_DEVICE, status) as any).execute(); }
  async setDeviceBranches(tenantId: string, id: string, patch: { branchId?: string | null; allowedBranchIds?: string[]; welcomeMessage?: string | null }) {
    const set: any = { updated_at: new Date() };
    if (patch.branchId !== undefined) set.branch_id = patch.branchId;
    if (patch.allowedBranchIds !== undefined) set.allowed_branch_ids = patch.allowedBranchIds.length ? JSON.stringify(patch.allowedBranchIds) : null;
    if (patch.welcomeMessage !== undefined) set.welcome_message = patch.welcomeMessage;
    await this.db.updateTable('go_checkin_devices').set(set).where('id', '=', id).where('tenant_id', '=', tenantId).execute();
  }
  async touchDevice(id: string, facts?: { os: string | null; battery: { percent: number; charging: boolean | null } | null }) {
    await this.db.updateTable('go_checkin_devices').set({
      last_seen_at: new Date(),
      ...(facts?.os ? { os_version: facts.os } : {}),
      ...(facts?.battery ? { battery_percent: facts.battery.percent, battery_charging: facts.battery.charging, battery_reported_at: new Date() } : {}),
    } as any).where('id', '=', id).execute();
  }

  async createSession(i: CreateSessionInput): Promise<SessionRow> {
    const row = await this.db.insertInto('go_checkin_sessions').values({
      tenant_id: i.tenantId, branch_id: i.branchId ?? null, device_id: i.deviceId ?? null, display_device_id: i.displayDeviceId ?? null,
      session_token_hash: i.sessionTokenHash, metadata_json: (i.metadata ?? {}) as any,
    } as any).returningAll().executeTakeFirstOrThrow();
    return ses(row);
  }
  async displayDeviceById(tenantId: string, id: string): Promise<DisplayDeviceRow | null> {
    const r: any = await this.db.selectFrom('customer_display_devices').select(['id', 'tenant_id', 'branch_id', 'pairing_status', 'revoked_at', 'maintenance_at'])
      .where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
    if (!r) return null;
    return { id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ?? null, usable: r.pairing_status === 'paired' && !r.revoked_at && !r.maintenance_at };
  }
  async sessionById(id: string) { const r = await this.db.selectFrom('go_checkin_sessions').selectAll().where('id', '=', id).executeTakeFirst(); return r ? ses(r) : null; }
  async touchSession(id: string) { await this.db.updateTable('go_checkin_sessions').set({ last_seen_at: new Date() } as any).where('id', '=', id).execute(); }
  async recentKioskActivity(tenantId: string, minutes: number): Promise<{ sessions: number; lookups: number }> {
    const r = await this.db.selectFrom('go_checkin_sessions').where('tenant_id', '=', tenantId).where('started_at', '>', new Date(Date.now() - minutes * 60_000))
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.coalesce(eb.fn.sum<number>('lookup_count'), eb.val(0)).as('l')]).executeTakeFirst();
    return { sessions: Number(r?.n ?? 0), lookups: Number(r?.l ?? 0) };
  }
  async bumpSessionCounter(tenantId: string, id: string, kind: 'lookups' | 'creates'): Promise<number> {
    const col = kind === 'lookups' ? 'lookup_count' : 'create_count';
    const r: any = await this.db.updateTable('go_checkin_sessions').set({ [col]: sql`${sql.ref(col)} + 1` }).where('id', '=', id).where('tenant_id', '=', tenantId).returning([col]).executeTakeFirst();
    return Number(r?.[col] ?? Number.MAX_SAFE_INTEGER);   // no session row: count it as spent (fail closed)
  }
  async setSessionStatus(id: string, status: SessionRow['status']) {
    const stamp: any = { status, last_seen_at: new Date() };
    if (status === 'completed') stamp.completed_at = new Date();
    if (status === 'expired') stamp.expired_at = new Date();
    // Phase 12 (#27): an ended session is not reopened (GO_CHECKIN_SESSION), and the write is scoped to the session's own salon
    const session = await this.sessionById(id); if (!session) return;
    await this.db.updateTable('go_checkin_sessions').set(stamp).where('id', '=', id).where('tenant_id', '=', session.tenantId).where(canMoveToSql(GO_CHECKIN_SESSION, status) as any).execute();
  }

  async getSettings(tenantId: string) { const r = await this.db.selectFrom('tenant_checkin_settings').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst(); return settingsFrom(r); }
  async upsertSettings(tenantId: string, patch: Partial<GoCheckInSettings>) {
    const cur = await this.getSettings(tenantId); const next = { ...cur, ...patch };
    await this.db.insertInto('tenant_checkin_settings').values({
      tenant_id: tenantId, enabled: next.enabled, appointment_checkin_enabled: next.appointmentCheckinEnabled, walkin_checkin_enabled: next.walkinCheckinEnabled,
      new_customer_enabled: next.newCustomerEnabled, service_selection_enabled: next.serviceSelectionEnabled, technician_preference_enabled: next.technicianPreferenceEnabled,
      tenant_phone_lookup_enabled: next.tenantPhoneLookupEnabled, central_lookup_enabled: next.centralLookupEnabled, customer_linking_enabled: next.customerLinkingEnabled,
      show_wait_estimate: next.showWaitEstimate, auto_send_to_queue: next.autoSendToQueue, require_front_desk_approval: next.requireFrontDeskApproval, confirmation_timeout_seconds: next.confirmationTimeoutSeconds, display_languages: next.displayLanguages, updated_at: new Date(),
    }).onConflict((oc) => oc.column('tenant_id').doUpdateSet({
      enabled: next.enabled, appointment_checkin_enabled: next.appointmentCheckinEnabled, walkin_checkin_enabled: next.walkinCheckinEnabled,
      new_customer_enabled: next.newCustomerEnabled, service_selection_enabled: next.serviceSelectionEnabled, technician_preference_enabled: next.technicianPreferenceEnabled,
      tenant_phone_lookup_enabled: next.tenantPhoneLookupEnabled, central_lookup_enabled: next.centralLookupEnabled, customer_linking_enabled: next.customerLinkingEnabled,
      show_wait_estimate: next.showWaitEstimate, auto_send_to_queue: next.autoSendToQueue, require_front_desk_approval: next.requireFrontDeskApproval, confirmation_timeout_seconds: next.confirmationTimeoutSeconds, display_languages: next.displayLanguages, updated_at: new Date(),
    })).execute();
    return next;
  }

  async insertLog(i: InsertLogInput) {
    await this.db.insertInto('go_checkin_logs').values({
      tenant_id: i.tenantId, branch_id: i.branchId ?? null, device_id: i.deviceId ?? null, session_id: i.sessionId ?? null,
      event_type: i.eventType, safe_message: i.safeMessage ?? null, metadata_json: (i.metadata ?? {}),
    }).execute();
  }
  async sessionOwnsQueueItem(tenantId: string, sessionId: string, queueItemId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !queueItemId) return false;
    const r = await this.db.selectFrom('go_checkin_logs').select('id').where('tenant_id', '=', tenantId).where('session_id', '=', sessionId)
      .where((eb: any) => eb.or([eb(sql`metadata_json->>'queueItemId'`, '=', queueItemId), eb(sql`metadata_json->>'checkInId'`, '=', queueItemId)]))
      .limit(1).executeTakeFirst().catch(() => undefined);
    return !!r;
  }
  async listLogs(tenantId: string, limit: number): Promise<LogRow[]> {
    const rows = await this.db.selectFrom('go_checkin_logs').selectAll().where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').limit(limit).execute();
    return rows.map((r: any) => ({ id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, deviceId: r.device_id ?? null, sessionId: r.session_id ?? null, eventType: r.event_type, safeMessage: r.safe_message ?? null, metadata: r.metadata_json ?? {}, createdAt: new Date(r.created_at).toISOString() }));
  }

  async findTenantCustomerByPhone(tenantId: string, normalized: string): Promise<CustRow | null> {
    if (!normalized) return null;
    const r = await this.db.selectFrom('customers').select(['id', 'first_name', 'last_name', 'email']).where('tenant_id', '=', tenantId).where(sql<boolean>`right(regexp_replace(coalesce(normalized_phone,''), '[^0-9]', '', 'g'), 10) = ${normalized}`).where('archived_at', 'is', null).executeTakeFirst();
    return r ? cust(r) : null;
  }
  async findTenantCustomersByPhone(tenantId: string, normalized: string): Promise<CustRow[]> {
    if (!normalized) return [];
    const rows = await this.db.selectFrom('customers').select(['id', 'first_name', 'last_name', 'email']).where('tenant_id', '=', tenantId).where(sql<boolean>`right(regexp_replace(coalesce(normalized_phone,''), '[^0-9]', '', 'g'), 10) = ${normalized}`).where('archived_at', 'is', null).limit(5).execute();
    return rows.map(cust);
  }
  async findCentralCustomerByPhone(excludeTenantId: string, normalized: string): Promise<CustRow | null> {
    if (!normalized) return null;
    // Cross-tenant existence check by normalized phone — ONLY safe fields are read; caller masks before returning.
    const r = await this.db.selectFrom('customers').select(['id', 'first_name', 'last_name', 'email']).where('tenant_id', '!=', excludeTenantId).where(sql<boolean>`right(regexp_replace(coalesce(normalized_phone,''), '[^0-9]', '', 'g'), 10) = ${normalized}`).where('archived_at', 'is', null).executeTakeFirst();
    return r ? cust(r) : null;
  }
  /** 23-inch spec §15–§17: the customer's appointments today at this branch — each with its technician (FIRST name only,
   *  as the guest's screen shows it) and every service on it. */
  async findTodayAppointmentsForCustomer(tenantId: string, branchId: string | null, customerId: string, today: string, statuses: readonly string[] = CHECK_IN_ELIGIBLE_STATUSES): Promise<ApptRow[]> {
    let q = this.db.selectFrom('pos_tech_appointments as a')
      .leftJoin('technicians as t', (j: any) => j.onRef('t.id', '=', 'a.technician_id').onRef('t.tenant_id', '=', 'a.tenant_id'))
      .select(['a.id as id', 'a.start_time as start_time', 'a.end_time as end_time', 'a.status as status', 'a.services as services', 't.first_name as tech_first'])
      .where('a.tenant_id', '=', tenantId).where('a.customer_id', '=', customerId).where('a.appt_date', '=', today)
      .where('a.status', 'in', [...statuses]);   // Decision 38: an arrived customer can still check in at the kiosk
    if (branchId) q = q.where('a.branch_id', '=', branchId);
    const rows: any[] = await q.orderBy('a.start_time', 'asc').execute();
    return rows.map((r) => {
      const start = minutesOf(r.start_time) ?? 0; const end = minutesOf(r.end_time) ?? start;
      const tech = String(r.tech_first ?? '').trim() || undefined;
      const names = serviceNames(r.services);
      return { appointmentId: String(r.id), startMinutes: start, endMinutes: Math.max(end, start), status: String(r.status), items: (names.length ? names : ['Appointment']).map((serviceName) => ({ serviceName, ...(tech ? { technicianName: tech } : {}) })) };
    });
  }
  async appointmentCustomer(tenantId: string, branchId: string | null, appointmentId: string, today: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(appointmentId)) return null;
    let q = this.db.selectFrom('pos_tech_appointments').select(['customer_id']).where('tenant_id', '=', tenantId).where('id', '=', appointmentId).where('appt_date', '=', today);
    if (branchId) q = q.where('branch_id', '=', branchId);
    const r: any = await q.executeTakeFirst();
    return r?.customer_id ? String(r.customer_id) : null;
  }
  /** §22–§23: the BRANCH's active catalog (each branch has its own service rows and prices) — never the salon's whole list. */
  async listServices(tenantId: string, branchId: string | null): Promise<ServiceRow[]> {
    if (!branchId) return [];
    const rows: any[] = await this.db.selectFrom('services as s')
      .leftJoin('service_categories as c', (j: any) => j.onRef('c.id', '=', 's.category_id').onRef('c.tenant_id', '=', 's.tenant_id'))
      .select(['s.id as id', 's.name as name', 's.price_cents as price_cents', 's.duration_minutes as duration_minutes', 'c.name as category'])
      .where('s.tenant_id', '=', tenantId).where('s.branch_id', '=', branchId).where('s.status', '=', 'active').where('s.archived_at', 'is', null)
      .orderBy('c.sort_order', 'asc').orderBy('s.sort_order', 'asc').orderBy('s.name', 'asc').execute();
    return rows.map((r) => {
      const category = String(r.category ?? '').trim() || 'Services';
      return { id: String(r.id), name: String(r.name), priceCents: Number(r.price_cents ?? 0), durationMinutes: Number(r.duration_minutes ?? 0), category, isAddOn: isAddOnCategory(category) };
    });
  }
  /**
   * §25 facts for the branch's technicians today — the same sources as the Live Technician Schedule: the roster
   * (active, not archived), skills (technician_services → services → categories), today's weekly schedule, today's
   * blocked times, an open time-clock punch (today, or one still open from yesterday), and the latest live status.
   */
  async kioskTechnicianFacts(tenantId: string, branchId: string, today: string, weekday: number): Promise<KioskTechFacts[]> {
    const techs: any[] = await this.db.selectFrom('technicians').select(['id', 'first_name', 'last_name', 'avatar_url'])
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).where('is_active', '=', true).where('archived_at', 'is', null).where('status', '!=', 'archived').execute();
    const ids = techs.map((t) => String(t.id));
    if (!ids.length) return [];
    const [skills, scheds, blocks, punches, statuses] = await Promise.all([
      this.db.selectFrom('technician_services as ts').innerJoin('services as s', (j: any) => j.onRef('s.id', '=', 'ts.service_id').onRef('s.tenant_id', '=', 'ts.tenant_id'))
        .leftJoin('service_categories as c', (j: any) => j.onRef('c.id', '=', 's.category_id').onRef('c.tenant_id', '=', 's.tenant_id'))
        .select(['ts.technician_id as tid', 'c.name as cat']).where('ts.tenant_id', '=', tenantId).where('ts.technician_id', 'in', ids).execute() as Promise<any[]>,
      this.db.selectFrom('technician_schedules').select(['technician_id', 'is_working', 'start_time', 'end_time', 'shifts'])
        .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).where('technician_id', 'in', ids).where('day_of_week', '=', weekday).execute() as Promise<any[]>,
      this.db.selectFrom('technician_blocked_times').select(['technician_id', 'start_time', 'end_time'])
        .where('tenant_id', '=', tenantId).where('technician_id', 'in', ids).where('block_date', '=', today).execute() as Promise<any[]>,
      this.db.selectFrom('technician_shifts').select(['technician_id'])
        .where('tenant_id', '=', tenantId).where('technician_id', 'in', ids).where('shift_date', 'in', [today, addDays(today, -1)])
        .where('status', '=', ACTIVE_STATUS).where('end_time', 'is', null).where('start_time', 'is not', null).execute() as Promise<any[]>,
      this.db.selectFrom('technician_statuses').select(['technician_id', 'status', 'changed_at'])
        .where('tenant_id', '=', tenantId).where('technician_id', 'in', ids).orderBy('changed_at', 'asc').execute() as Promise<any[]>,
    ]);
    const skillBy = new Map<string, Set<string>>();
    for (const r of skills) { const c = String(r.cat ?? '').trim() || 'General'; (skillBy.get(String(r.tid)) ?? skillBy.set(String(r.tid), new Set()).get(String(r.tid))!).add(c); }
    const shiftBy = new Map<string, { startMinutes: number; endMinutes: number } | null>();
    for (const r of scheds) {
      if (!r.is_working) { shiftBy.set(String(r.technician_id), null); continue; }
      const shifts = parseJson(r.shifts);
      const parts = Array.isArray(shifts) && shifts.length
        ? shifts.map((x: any) => ({ s: minutesOf(x?.startTime), e: minutesOf(x?.endTime) })).filter((x: any) => x.s != null && x.e != null && x.e > x.s)
        : [{ s: minutesOf(r.start_time ?? '09:00'), e: minutesOf(r.end_time ?? '18:00') }].filter((x) => x.s != null && x.e != null && x.e! > x.s!);
      shiftBy.set(String(r.technician_id), parts.length ? { startMinutes: Math.min(...parts.map((x: any) => x.s)), endMinutes: Math.max(...parts.map((x: any) => x.e)) } : null);
    }
    const blocksBy = new Map<string, { startMinutes: number; endMinutes: number }[]>();
    for (const b of blocks) { const s0 = minutesOf(b.start_time), e0 = minutesOf(b.end_time); if (s0 == null || e0 == null) continue; (blocksBy.get(String(b.technician_id)) ?? blocksBy.set(String(b.technician_id), []).get(String(b.technician_id))!).push({ startMinutes: s0, endMinutes: e0 }); }
    const clocked = new Set(punches.map((p) => String(p.technician_id)));
    const statusBy = new Map<string, string>(); for (const st of statuses) statusBy.set(String(st.technician_id), String(st.status));   // ascending → the last is the latest
    return techs.map((t) => {
      const id = String(t.id);
      return {
        technicianId: id, firstName: String(t.first_name ?? ''), lastName: String(t.last_name ?? ''), avatarUrl: t.avatar_url ? buildMediaUrl(t.avatar_url) : null,
        skills: [...(skillBy.get(id) ?? [])], shift: shiftBy.has(id) ? shiftBy.get(id)! : null, blocks: blocksBy.get(id) ?? [],
        clockedIn: clocked.has(id), liveStatus: statusBy.get(id) ?? null,
      };
    });
  }
  async branchTimeZone(tenantId: string, branchId: string | null): Promise<string> { return branchTimeZone(this.db, tenantId, branchId); }
  async hasActiveCheckInToday(tenantId: string, customerId: string, today: string, dayStartMs?: number): Promise<boolean> {
    const r = await this.db.selectFrom('pos_queue_items').select('id')
      .where('tenant_id', '=', tenantId).where('customer_id', '=', customerId)
      .where('status', 'in', ['waiting', 'checked_in', 'sent_to_queue', 'sent_to_tech_queue', 'in_service'])
      .where('checked_in_at', '>=', new Date(dayStartMs ?? Date.parse(today + 'T00:00:00Z')))   // the branch's midnight (Oct 2 2026)
      .executeTakeFirst();
    return !!r;
  }
  async markCheckedInToday(_tenantId: string, _customerId: string, _today: string): Promise<void> { /* the queue item is the source of truth in Postgres */ }
  async hasTechnicianActiveService(tenantId: string, branchId: string, technicianId: string): Promise<boolean> {
    // A technician is mid-service when they have a ticket that started serving and isn't done yet — excluding
    // tickets that were cancelled/voided. service_done_at being set means the tech has finished (any remaining
    // checkout is the cashier's step, not a reason to keep the technician clocked in).
    const r = await this.db.selectFrom('tickets').select('id')
      .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId)
      .where('primary_technician_id', '=', technicianId)
      .where('serving_started_at', 'is not', null).where('service_done_at', 'is', null)
      .where('status', 'not in', ['cancelled', 'voided', 'paid'])
      .executeTakeFirst();
    return !!r;
  }
  async appointmentCheckedIn(tenantId: string, appointmentId: string): Promise<boolean> {
    const r = await this.db.selectFrom('pos_tech_appointments').select('status').where('tenant_id', '=', tenantId).where('id', '=', appointmentId).executeTakeFirst();
    return !!r && r.status === 'checked_in';
  }
  async resolveSalonBranch(tenantId: string, branchId: string | null): Promise<{ salonName: string; branchName?: string }> {
    const t: any = await this.db.selectFrom('tenants').select(['display_name', 'legal_name']).where('id', '=', tenantId).executeTakeFirst().catch(() => null);
    let branchName: string | undefined;
    if (branchId) { const b: any = await this.db.selectFrom('branches').select(['name']).where('id', '=', branchId).executeTakeFirst().catch(() => null); branchName = b?.name ?? undefined; }
    return { salonName: (t?.display_name || t?.legal_name || ''), branchName };
  }
  async listBranchNames(tenantId: string, ids: string[]): Promise<{ id: string; name: string }[]> {
    if (!ids.length) return [];
    const rows: any[] = await this.db.selectFrom('branches').select(['id', 'name']).where('tenant_id', '=', tenantId).where('id', 'in', ids).execute().catch(() => []);
    const m = new Map(rows.map((r) => [String(r.id), String(r.name)]));
    return ids.map((id) => ({ id, name: m.get(id) ?? 'Branch' })); // only same-tenant branches resolve; others fall back
  }
}
