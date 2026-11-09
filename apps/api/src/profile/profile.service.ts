// profile.service.ts — current-user profile + avatar. Avatar is a small, client-resized data URL
// stored per (tenant_id, user_id). Reads/writes are always scoped to the authenticated user's own
// id taken from the session (never the client), so a user can only change their own photo.
// Framework-free on purpose (validation lives in avatar-validate.ts); the controller maps
// AvatarError.status onto an HttpException.
import { HttpException, HttpStatus } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { validateAvatarDataUrl, sniffAvatarType } from './avatar-validate';
import { planPricesFromEnv } from '@aipowersalon/super-admin';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { SignInSession } from '@aipowersalon/api-contracts/tenant';
import type { SignInSession } from '@aipowersalon/api-contracts/tenant';

export type MeCtx = { tenantId?: string; userId?: string; role?: string };


export interface MeProfile { userId: string; role: string; avatarUrl: string | null; email: string | null; fullName: string | null; memberSince: string | null; passwordChangedAt: string | null; lastLoginAt: string | null; }

// Friendly "Browser on OS" from a stored user-agent (best-effort; falls back to the device id).
function deviceLabel(ua: string | null, deviceId: string | null): string {
  if (!ua) return deviceId ? `Device ${deviceId.slice(0, 8)}` : 'Unknown device';
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome' : (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : 'Browser';
  return `${br} on ${os}`;
}

export class AvatarError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'AvatarError'; }
}

// ---- Login-alert preferences (Account → Security, §19). Per-user, tenant-scoped like the avatar store,
// accessed via raw sql (no kysely.types entry needed). Defaults are security-forward (every alert on);
// the pure helpers below are unit-tested directly so the mapping/merge logic is covered without a live db. ----
import type { LoginAlertPrefs, NotificationPrefs } from '@aipowersalon/api-contracts/tenant';   // the wire shapes live in api-contracts
export type { LoginAlertPrefs, NotificationPrefs };
export const DEFAULT_LOGIN_ALERTS: LoginAlertPrefs = {
  enabled: true, newDevice: true, newLocation: true, passwordChanged: true, emailChanged: true,
  phoneChanged: true, twofaChanged: true, recoveryCodesChanged: true, sessionRevoked: true, suspiciousBlocked: true,
};
// field (camel) <-> column (snake) map, so both the sql and the row-mapping stay declarative.
const ALERT_COLS: Array<[keyof LoginAlertPrefs, string]> = [
  ['enabled', 'enabled'], ['newDevice', 'new_device'], ['newLocation', 'new_location'], ['passwordChanged', 'password_changed'],
  ['emailChanged', 'email_changed'], ['phoneChanged', 'phone_changed'], ['twofaChanged', 'twofa_changed'],
  ['recoveryCodesChanged', 'recovery_codes_changed'], ['sessionRevoked', 'session_revoked'], ['suspiciousBlocked', 'suspicious_blocked'],
];
export function rowToLoginAlerts(row: Record<string, any>): LoginAlertPrefs {
  const out = { ...DEFAULT_LOGIN_ALERTS };
  for (const [field, col] of ALERT_COLS) if (row[col] != null) out[field] = !!row[col];
  return out;
}
// keep only known boolean keys from an untrusted patch body (drops unknown keys / non-booleans).
export function sanitizeLoginAlertsPatch(patch: unknown): Partial<LoginAlertPrefs> {
  const out: Partial<LoginAlertPrefs> = {};
  if (patch && typeof patch === 'object') for (const [field] of ALERT_COLS) {
    const v = (patch as any)[field];
    if (typeof v === 'boolean') out[field] = v;
  }
  return out;
}
export function mergeLoginAlerts(base: LoginAlertPrefs, patch: Partial<LoginAlertPrefs>): LoginAlertPrefs {
  return { ...base, ...patch };
}

// ---- Notification preferences (Account → Notifications, §20). The user's own personal alert
// channels/categories — per-user, tenant-scoped, distinct from salon customer-comms config (§21).
// Same raw-sql + pure-helper shape as login alerts; helpers are unit-tested directly. ----
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  smsNotifications: true, emailNotifications: true, pushNotifications: true, missedCallAlerts: true,
  bookingAlerts: true, lowStockAlerts: true, payrollApprovals: true, weeklyReportSummaries: true,
};
const NOTIF_COLS: Array<[keyof NotificationPrefs, string]> = [
  ['smsNotifications', 'sms_notifications'], ['emailNotifications', 'email_notifications'], ['pushNotifications', 'push_notifications'],
  ['missedCallAlerts', 'missed_call_alerts'], ['bookingAlerts', 'booking_alerts'], ['lowStockAlerts', 'low_stock_alerts'],
  ['payrollApprovals', 'payroll_approvals'], ['weeklyReportSummaries', 'weekly_report_summaries'],
];
export function rowToNotificationPrefs(row: Record<string, any>): NotificationPrefs {
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const [field, col] of NOTIF_COLS) if (row[col] != null) out[field] = !!row[col];
  return out;
}
export function sanitizeNotificationPrefsPatch(patch: unknown): Partial<NotificationPrefs> {
  const out: Partial<NotificationPrefs> = {};
  if (patch && typeof patch === 'object') for (const [field] of NOTIF_COLS) {
    const v = (patch as any)[field];
    if (typeof v === 'boolean') out[field] = v;
  }
  return out;
}
export function mergeNotificationPrefs(base: NotificationPrefs, patch: Partial<NotificationPrefs>): NotificationPrefs {
  return { ...base, ...patch };
}

// ---- UI preferences (Account → Preferences, §33). The user's own per-tenant UI prefs. Deliberately
// minimal + honest: only default_landing (the screen shown on app open) — a preference that actually takes
// effect via the pos-web root redirect. No theme/language/density here (those systems don't exist yet, so
// such toggles would be hollow). Same raw-sql + pure-helper shape as the other per-user prefs. ----
export interface UiPrefs {
  defaultLanding: string;
}
// Allow-list of landing values — every entry MUST be a real pos-web top-level route. Validation lives here
// (server-side) so an unknown/garbage value can never be persisted; the frontend mirrors these as labels.
export const ALLOWED_LANDINGS = ['overview', 'customers', 'messages', 'follow-ups', 'reports'] as const;
export const DEFAULT_UI_PREFS: UiPrefs = { defaultLanding: 'overview' };
export function rowToUiPrefs(row: Record<string, any>): UiPrefs {
  const out = { ...DEFAULT_UI_PREFS };
  const dl = row['default_landing'];
  if (typeof dl === 'string' && (ALLOWED_LANDINGS as readonly string[]).includes(dl)) out.defaultLanding = dl;
  return out;
}
export function sanitizeUiPrefsPatch(patch: unknown): Partial<UiPrefs> {
  const out: Partial<UiPrefs> = {};
  if (patch && typeof patch === 'object') {
    const dl = (patch as any).defaultLanding;
    if (typeof dl === 'string' && (ALLOWED_LANDINGS as readonly string[]).includes(dl)) out.defaultLanding = dl;
  }
  return out;
}
export function mergeUiPrefs(base: UiPrefs, patch: Partial<UiPrefs>): UiPrefs {
  return { ...base, ...patch };
}

// ---- Billing summary (Account → Subscription & Billing). READ-ONLY tenant view of the tenant's own
// subscription + payment-config + plan price (subscription changes stay Super-Admin-controlled, §3).
// Reuses the canonical plan prices (planPricesFromEnv) so the fee matches platform MRR. Money is integer
// cents; nothing is fabricated — a field is null when its source isn't present, so the UI shows "—". ----
export interface BillingSummary {
  plan: string | null;
  status: string | null;
  active: boolean;
  currentPeriodEnd: string | null;   // ISO renewal date
  monthlyFeeCents: number | null;    // the plan's configured price (cents), or null if not in PLAN_PRICES_JSON
  processor: string | null;          // cardpointe | fiserv | clover | none
  merchantIdLast4: string | null;    // last 4 of the live MID only (never the raw id)
  paymentConfigured: boolean;
  paymentStatus: string | null;      // active | pending | error | disabled | none
}
export function toBillingSummary(
  sub: { plan?: string | null; status?: string | null; current_period_end?: any } | null,
  pay: { processor?: string | null; merchant_id?: string | null; fiserv_configured?: boolean | null; status?: string | null } | null,
  planPrices: Record<string, number>,
): BillingSummary {
  const plan = sub?.plan ?? null;
  const status = sub?.status ?? null;
  const cpe = sub?.current_period_end ?? null;
  const mid = pay?.merchant_id ?? null;
  const fee = plan != null ? planPrices[plan] : undefined;
  return {
    plan,
    status,
    active: status === 'active',
    currentPeriodEnd: cpe ? new Date(cpe).toISOString() : null,
    monthlyFeeCents: typeof fee === 'number' ? fee : null,
    processor: pay?.processor ?? null,
    merchantIdLast4: mid && mid.length >= 4 ? mid.slice(-4) : (mid || null),
    paymentConfigured: !!pay?.fiserv_configured,
    paymentStatus: pay?.status ?? null,
  };
}

// ---- Backup requests (Account → Backup & Data Health, §32). Real, audited request records; the panel
// reflects TRUE state and never fabricates a completed backup. The export worker (separate) advances a
// request from 'requested' → 'processing' → 'completed'/'failed'. ----
export type BackupState = 'none' | 'requested' | 'processing' | 'completed' | 'failed';
export interface BackupStatus {
  status: BackupState;
  requestedAt: string | null;
  lastCompletedAt: string | null;
  sizeBytes: number | null;
}
const BACKUP_STATES: BackupState[] = ['requested', 'processing', 'completed', 'failed'];
export const EMPTY_BACKUP_STATUS: BackupStatus = { status: 'none', requestedAt: null, lastCompletedAt: null, sizeBytes: null };
const isoOrNull = (v: any): string | null => (v ? new Date(v).toISOString() : null);
export function toBackupStatus(
  latest: { status?: string; requested_at?: any } | null,
  lastCompleted: { completed_at?: any; size_bytes?: any } | null,
): BackupStatus {
  const status = (latest && BACKUP_STATES.includes(latest.status as BackupState) ? latest.status : 'none') as BackupState;
  const size = lastCompleted?.size_bytes;
  return {
    status,
    requestedAt: isoOrNull(latest?.requested_at),
    lastCompletedAt: isoOrNull(lastCompleted?.completed_at),
    sizeBytes: size != null ? Number(size) : null,
  };
}
import { buildMediaUrl, makeMediaStorage, acceptUpload, uploadObjectKey, UploadRejected, UPLOAD_POLICIES, type StorageQuotaPort } from '@aipowersalon/media';
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from '@aipowersalon/identity';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ProfileService {
  constructor(private readonly db: Kysely<DB> | null, private readonly quota: StorageQuotaPort | null = null) {}

  async get(ctx: MeCtx): Promise<MeProfile> {
    const base: MeProfile = { userId: ctx.userId || '', role: ctx.role || '', avatarUrl: null, email: null, fullName: null, memberSince: null, passwordChangedAt: null, lastLoginAt: null };
    if (!this.db || !ctx.tenantId || !ctx.userId) return base;
    let avatarUrl: string | null = null;
    try {
      const u = await this.db
        .selectFrom('users')
        .select(['avatar_url', 'email', 'full_name', 'created_at', 'password_changed_at', 'last_login_at'])
        .where('id', '=', ctx.userId)
        .executeTakeFirst();
      if (u) {
        avatarUrl = u.avatar_url ? buildMediaUrl(u.avatar_url) : null;
        const iso = (v: any) => (v ? new Date(v).toISOString() : null);
        return { ...base, avatarUrl, email: u.email ?? null, fullName: u.full_name ?? null, memberSince: iso(u.created_at), passwordChangedAt: iso(u.password_changed_at), lastLoginAt: iso(u.last_login_at) };
      }
    } catch { /* fail-soft: avatar store is optional */ }
    try {
      const r = await sql<{ data_url: string }>`
        SELECT data_url FROM user_avatars WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId} LIMIT 1
      `.execute(this.db);
      avatarUrl = r.rows[0]?.data_url ? buildMediaUrl(r.rows[0].data_url) : avatarUrl;
    } catch { /* fail-soft */ }
    return { ...base, avatarUrl };
  }

  async setAvatar(ctx: MeCtx, dataUrl: unknown): Promise<{ avatarUrl: string }> {
    if (!ctx.tenantId || !ctx.userId) throw withCode(new AvatarError(400, 'No active session'), 'AUTH_REQUIRED');
    // Validate BEFORE touching the store (Constitution 12 §159). The developer tree (Sep 28) bypassed the validator: any
    // "data:image/<anything>" was decoded and stored with no size limit and no check that the bytes are an image (an SVG
    // or HTML payload passed), and ANY other string was written straight into users.avatar_url — pointing a profile at
    // an arbitrary key or URL. The only client (POS ProfileMenu) sends a data URL, so the string branch is gone.
    const v = validateAvatarDataUrl(dataUrl);
    if (!v.ok) throw new AvatarError(v.status, v.message);
    if (!this.db) throw withCode(new AvatarError(503, 'Profile store unavailable'), 'SERVICE_UNAVAILABLE');
    const body = v.value.slice(v.value.indexOf(',') + 1).replace(/\s/g, '');
    const buffer = Buffer.from(body, 'base64');
    // Phase 12 (#34): the one upload policy — EXIF (GPS) stripped, the scan hook, the salon's storage quota (a JSON body:
    // the multipart guard never saw it) and a tenant-scoped random key (was `avatar-<ms>.<ext>`: two staff in the same
    // millisecond overwrote each other's picture)
    let up;
    try { up = await acceptUpload(UPLOAD_POLICIES.avatar, { bytes: buffer, declaredType: v.value.slice(5, v.value.indexOf(';')), tenantId: ctx.tenantId }, { quota: this.quota }); }
    catch (e) { if (e instanceof UploadRejected) throw new AvatarError(e.status, e.message); throw e; }
    const key = uploadObjectKey({ tenantId: ctx.tenantId, area: 'avatars', owner: ['staff', ctx.userId], ext: up.ext || (sniffAvatarType(buffer.subarray(0, 64)) ?? 'jpg') });
    try { await makeMediaStorage().put(key, up.bytes); }
    catch (e) { if (up.quotaReservedBytes) await this.quota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch(() => undefined); throw e; }

    await this.db.updateTable('users')
      .set({ avatar_url: key, updated_at: new Date() })
      .where('id', '=', ctx.userId)
      .execute()
      .catch(() => {});

    await sql`
      INSERT INTO user_avatars (tenant_id, user_id, data_url, updated_at)
      VALUES (${ctx.tenantId}, ${ctx.userId}, ${key}, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET data_url = EXCLUDED.data_url, updated_at = now()
    `.execute(this.db).catch(() => {});

    return { avatarUrl: buildMediaUrl(key) || key };
  }

  async removeAvatar(ctx: MeCtx): Promise<{ ok: true }> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return { ok: true };
    const oldUser = await this.db.selectFrom('users').select(['avatar_url']).where('id', '=', ctx.userId).executeTakeFirst().catch(() => null);
    if (oldUser?.avatar_url) {
      await makeMediaStorage().remove(oldUser.avatar_url).catch(() => {});
    }

    await this.db.updateTable('users')
      .set({ avatar_url: null, updated_at: new Date() })
      .where('id', '=', ctx.userId)
      .execute()
      .catch(() => {});

    await sql`DELETE FROM user_avatars WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId}`.execute(this.db).catch(() => {});
    return { ok: true };
  }

  // The authenticated user's own recent sign-in sessions (most recent first), scoped to their id taken from the
  // session — never the client. Fail-soft like the rest of the service so the Account screen never breaks.
  async listSessions(ctx: MeCtx): Promise<{ sessions: SignInSession[] }> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return { sessions: [] };
    try {
      const rows = await this.db
        .selectFrom('sessions')
        .select(['id', 'device_id', 'device_name', 'platform', 'last_seen_at', 'ip_address', 'user_agent', 'status', 'created_at', 'expires_at', 'revoked_at'])
        .where('user_id', '=', ctx.userId)
        .where('tenant_id', '=', ctx.tenantId)
        .orderBy('created_at', 'desc')
        .limit(8)
        .execute();
      const now = Date.now();
      return {
        sessions: rows.map((r) => {
          const expired = r.expires_at ? new Date(r.expires_at).getTime() < now : false;
          const revoked = !!r.revoked_at;
          const active = !revoked && !expired && (r.status === 'active' || !r.status);
          const status: SignInSession['status'] = revoked ? 'revoked' : expired ? 'expired' : 'active';
          // Constitution 12 §144–146: the app's own label ("Maria's iPhone · Tech app") wins over the user-agent guess;
          // platform and last-seen let the owner tell a lost phone from the front desk's browser.
          const label = r.device_name ? `${String(r.device_name).slice(0, 80)}${r.platform ? ` (${r.platform})` : ''}` : deviceLabel(r.user_agent, r.device_id);
          return { id: String(r.id), device: label, platform: r.platform ?? null, lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null, ip: r.ip_address ?? null, signedInAt: new Date(r.created_at).toISOString(), status, active };
        }),
      };
    } catch {
      return { sessions: [] };
    }
  }

  // Revoke one of the user's own sessions (scoped to their id from the session). Idempotent.
  async revokeSession(ctx: MeCtx, sessionId: string): Promise<{ ok: boolean; revoked: boolean }> {
    if (!this.db || !ctx.tenantId || !ctx.userId || !sessionId) return { ok: false, revoked: false };
    try {
      const res: any = await this.db.updateTable('sessions')
        .set({ status: 'revoked', revoked_at: new Date() })
        .where('id', '=', sessionId).where('user_id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).where('revoked_at', 'is', null).where(canMoveToSql(SESSION, 'revoked') as any)
        .executeTakeFirst();
      return { ok: true, revoked: Number(res?.numUpdatedRows ?? 0) > 0 };
    } catch {
      return { ok: false, revoked: false };
    }
  }

  // Revoke ALL of the user's active sessions (sign out everywhere). Returns how many were revoked.
  async revokeAllSessions(ctx: MeCtx): Promise<{ ok: boolean; count: number }> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return { ok: false, count: 0 };
    try {
      const res: any = await this.db.updateTable('sessions')
        .set({ status: 'revoked', revoked_at: new Date() })
        .where('user_id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).where('status', '=', 'active').where('revoked_at', 'is', null).where(canMoveToSql(SESSION, 'revoked') as any)
        .executeTakeFirst();
      return { ok: true, count: Number(res?.numUpdatedRows ?? 0) };
    } catch {
      return { ok: false, count: 0 };
    }
  }

  // The authenticated user's own login-alert preferences (§19), scoped to their session id — never the
  // client. Fail-soft to security-forward defaults so the Security panel always renders.
  async getLoginAlerts(ctx: MeCtx): Promise<LoginAlertPrefs> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return { ...DEFAULT_LOGIN_ALERTS };
    try {
      const r = await sql<Record<string, any>>`
        SELECT * FROM user_login_alert_prefs WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId} LIMIT 1
      `.execute(this.db);
      return r.rows[0] ? rowToLoginAlerts(r.rows[0]) : { ...DEFAULT_LOGIN_ALERTS };
    } catch {
      return { ...DEFAULT_LOGIN_ALERTS };
    }
  }

  // Upsert the user's own login-alert prefs from a sanitized patch (unknown keys ignored). Idempotent;
  // returns the resulting prefs. Always scoped to the session user, so one user can't change another's.
  async updateLoginAlerts(ctx: MeCtx, patch: unknown): Promise<LoginAlertPrefs> {
    const clean = sanitizeLoginAlertsPatch(patch);
    if (!this.db || !ctx.tenantId || !ctx.userId) return mergeLoginAlerts(DEFAULT_LOGIN_ALERTS, clean);
    const next = mergeLoginAlerts(await this.getLoginAlerts(ctx), clean);
    try {
      await sql`
        INSERT INTO user_login_alert_prefs
          (tenant_id, user_id, enabled, new_device, new_location, password_changed, email_changed, phone_changed, twofa_changed, recovery_codes_changed, session_revoked, suspicious_blocked, updated_at)
        VALUES (${ctx.tenantId}, ${ctx.userId}, ${next.enabled}, ${next.newDevice}, ${next.newLocation}, ${next.passwordChanged}, ${next.emailChanged}, ${next.phoneChanged}, ${next.twofaChanged}, ${next.recoveryCodesChanged}, ${next.sessionRevoked}, ${next.suspiciousBlocked}, now())
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
          enabled = EXCLUDED.enabled, new_device = EXCLUDED.new_device, new_location = EXCLUDED.new_location,
          password_changed = EXCLUDED.password_changed, email_changed = EXCLUDED.email_changed, phone_changed = EXCLUDED.phone_changed,
          twofa_changed = EXCLUDED.twofa_changed, recovery_codes_changed = EXCLUDED.recovery_codes_changed,
          session_revoked = EXCLUDED.session_revoked, suspicious_blocked = EXCLUDED.suspicious_blocked, updated_at = now()
      `.execute(this.db);
    } catch {
      /* fail-soft: return the intended prefs even if the write fails so the UI can reflect intent + retry */
    }
    return next;
  }

  // The authenticated user's own notification preferences (§20), scoped to their session id. Fail-soft
  // to "all on" defaults so the panel always renders.
  async getNotificationPrefs(ctx: MeCtx): Promise<NotificationPrefs> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return { ...DEFAULT_NOTIFICATION_PREFS };
    try {
      const r = await sql<Record<string, any>>`
        SELECT * FROM user_notification_prefs WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId} LIMIT 1
      `.execute(this.db);
      return r.rows[0] ? rowToNotificationPrefs(r.rows[0]) : { ...DEFAULT_NOTIFICATION_PREFS };
    } catch {
      return { ...DEFAULT_NOTIFICATION_PREFS };
    }
  }

  // Upsert the user's own notification prefs from a sanitized patch (unknown keys ignored). Idempotent;
  // returns the resulting prefs. Always scoped to the session user.
  async updateNotificationPrefs(ctx: MeCtx, patch: unknown): Promise<NotificationPrefs> {
    const clean = sanitizeNotificationPrefsPatch(patch);
    if (!this.db || !ctx.tenantId || !ctx.userId) return mergeNotificationPrefs(DEFAULT_NOTIFICATION_PREFS, clean);
    const next = mergeNotificationPrefs(await this.getNotificationPrefs(ctx), clean);
    try {
      await sql`
        INSERT INTO user_notification_prefs
          (tenant_id, user_id, sms_notifications, email_notifications, push_notifications, missed_call_alerts, booking_alerts, low_stock_alerts, payroll_approvals, weekly_report_summaries, updated_at)
        VALUES (${ctx.tenantId}, ${ctx.userId}, ${next.smsNotifications}, ${next.emailNotifications}, ${next.pushNotifications}, ${next.missedCallAlerts}, ${next.bookingAlerts}, ${next.lowStockAlerts}, ${next.payrollApprovals}, ${next.weeklyReportSummaries}, now())
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET
          sms_notifications = EXCLUDED.sms_notifications, email_notifications = EXCLUDED.email_notifications, push_notifications = EXCLUDED.push_notifications,
          missed_call_alerts = EXCLUDED.missed_call_alerts, booking_alerts = EXCLUDED.booking_alerts, low_stock_alerts = EXCLUDED.low_stock_alerts,
          payroll_approvals = EXCLUDED.payroll_approvals, weekly_report_summaries = EXCLUDED.weekly_report_summaries, updated_at = now()
      `.execute(this.db);
    } catch {
      // Notification Preferences guide (Nov 9 2026): a toggle is only "saved" when the row is — the screen must not
      // show success for a write that never happened (it used to fail soft and return the unsaved values)
      throw withCode(new HttpException('Your notification preferences could not be saved. Try again.', HttpStatus.SERVICE_UNAVAILABLE), 'NOTIFICATION_PREFS_SAVE_FAILED');
    }
    return next;
  }

  // The authenticated user's own UI preferences (§33), scoped to their session. Fail-soft to defaults so
  // the Preferences screen always renders.
  async getUiPrefs(ctx: MeCtx): Promise<UiPrefs> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return { ...DEFAULT_UI_PREFS };
    try {
      const r = await sql<Record<string, any>>`
        SELECT * FROM user_ui_prefs WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId} LIMIT 1
      `.execute(this.db);
      return r.rows[0] ? rowToUiPrefs(r.rows[0]) : { ...DEFAULT_UI_PREFS };
    } catch {
      return { ...DEFAULT_UI_PREFS };
    }
  }

  // Upsert the user's own UI prefs from a sanitized patch (unknown/invalid landing ignored). Idempotent;
  // returns the resulting prefs. Always scoped to the session user.
  async updateUiPrefs(ctx: MeCtx, patch: unknown): Promise<UiPrefs> {
    const clean = sanitizeUiPrefsPatch(patch);
    if (!this.db || !ctx.tenantId || !ctx.userId) return mergeUiPrefs(DEFAULT_UI_PREFS, clean);
    const next = mergeUiPrefs(await this.getUiPrefs(ctx), clean);
    try {
      await sql`
        INSERT INTO user_ui_prefs (tenant_id, user_id, default_landing, updated_at)
        VALUES (${ctx.tenantId}, ${ctx.userId}, ${next.defaultLanding}, now())
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET default_landing = EXCLUDED.default_landing, updated_at = now()
      `.execute(this.db);
    } catch {
      /* fail-soft like the rest of the service */
    }
    return next;
  }

  // READ-ONLY billing summary for the session tenant: latest subscription (plan/status/renewal) + payment
  // config (processor/MID last4/status) + the plan's configured price. Fail-soft to all-null so the panel
  // always renders. The tenant cannot change billing here — that stays a Super-Admin action (§3).
  async getBillingSummary(ctx: MeCtx): Promise<BillingSummary> {
    const empty = toBillingSummary(null, null, {});
    if (!this.db || !ctx.tenantId) return empty;
    try {
      const sub = await this.db.selectFrom('tenant_subscriptions')
        .select(['plan', 'status', 'current_period_end', 'created_at'])
        .where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      const pay = await this.db.selectFrom('tenant_payment_config')
        .select(['processor', 'merchant_id', 'fiserv_configured', 'status'])
        .where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      return toBillingSummary(sub ?? null, pay ?? null, planPricesFromEnv());
    } catch {
      return empty;
    }
  }

  // The session tenant's backup state: the most recent request's status + the last completed backup.
  // Fail-soft so the panel always renders. Read-only (no fabrication: 'none' until a real request exists).
  async getBackupStatus(ctx: MeCtx): Promise<BackupStatus> {
    if (!this.db || !ctx.tenantId) return EMPTY_BACKUP_STATUS;
    try {
      const latest = await sql<{ status: string; requested_at: any }>`
        SELECT status, requested_at FROM tenant_backup_requests WHERE tenant_id = ${ctx.tenantId} ORDER BY requested_at DESC LIMIT 1
      `.execute(this.db);
      const done = await sql<{ completed_at: any; size_bytes: any }>`
        SELECT completed_at, size_bytes FROM tenant_backup_requests WHERE tenant_id = ${ctx.tenantId} AND status = 'completed' ORDER BY completed_at DESC LIMIT 1
      `.execute(this.db);
      return toBackupStatus(latest.rows[0] ?? null, done.rows[0] ?? null);
    } catch {
      return EMPTY_BACKUP_STATUS;
    }
  }

  // Record a REAL backup request (status 'requested'), scoped to the session tenant + user, and audit it.
  // Idempotent against double-clicks: if a request is already in flight, no new row is created. Returns the
  // resulting true status (a fresh request shows 'requested'/'Queued' — never a fabricated completion).
  async requestBackup(ctx: MeCtx): Promise<BackupStatus> {
    if (!this.db || !ctx.tenantId || !ctx.userId) return this.getBackupStatus(ctx);
    try {
      const inflight = await sql<{ id: string }>`
        SELECT id FROM tenant_backup_requests WHERE tenant_id = ${ctx.tenantId} AND status IN ('requested','processing') LIMIT 1
      `.execute(this.db);
      if (!inflight.rows[0]) {
        await sql`
          INSERT INTO tenant_backup_requests (tenant_id, requested_by_user_id, status) VALUES (${ctx.tenantId}, ${ctx.userId}, 'requested')
        `.execute(this.db);
        await sql`
          INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
          VALUES (${ctx.tenantId}, ${ctx.userId}, ${ctx.role ?? null}, 'tenant_backup_requested', 'backup', ${ctx.tenantId}, '{}'::jsonb)
        `.execute(this.db);
      }
    } catch {
      /* fail-soft */
    }
    return this.getBackupStatus(ctx);
  }
}
