// go-check-in.dto.ts — types + helpers for the customer-facing Go Check-In kiosk.
// SECURITY: tenant_id/branch_id are NEVER taken from the client. They are resolved on the server from the device's
// check-in slug (or token) and carried in the session. Tokens are compared by sha256 hash with a constant-time check.
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// ---- token hashing (mirrors customer-display) ----
export function sha256Hex(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function newToken(): string { return randomBytes(24).toString('base64url'); }
export function tokenMatches(hash: string | null | undefined, token: string | undefined): boolean {
  if (!hash || !token) return false;
  const h = sha256Hex(token);
  if (h.length !== hash.length) return false;
  try { return timingSafeEqual(Buffer.from(h), Buffer.from(hash)); } catch { return false; }
}
// short, URL-safe, human-distributable slug for the public route /go-check-in/:slug
export function newSlug(): string { return randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12); }

// ---- device pairing-token expiry (security: a kiosk token shouldn't live forever) ----
// Default 90 days; override with GO_CHECKIN_TOKEN_TTL_DAYS. A value of 0 means "never expire" (NULL expiry). Creating a
// device or regenerating its token sets a fresh expiry; the device-facing resolve rejects an expired device until re-paired.
export const DEVICE_TOKEN_TTL_DAYS = 90;
export function deviceTokenTtlDays(): number { const v = Number(process.env.GO_CHECKIN_TOKEN_TTL_DAYS); return Number.isFinite(v) && v >= 0 ? v : DEVICE_TOKEN_TTL_DAYS; }
export function deviceTokenExpiry(nowMs: number = Date.now()): Date | null { const d = deviceTokenTtlDays(); return d > 0 ? new Date(nowMs + d * 86400000) : null; }
export function isTokenExpired(expiresAt: string | Date | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return false; // null = never expires
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

// ---- phone normalization (US-centric, matches the customers.normalized_phone convention) ----
// "856-555-1234", "(856) 555-1234", "+1 856 555 1234" all normalize to the same 10-digit string.
export function normalizePhone(raw: string | null | undefined): string {
  // Reduce to a stable US-style comparison key: the last 10 significant digits. This makes "856-555-1234",
  // "(856) 555-1234", "+1 856 555 1234" and a stored "+18565551234" all compare equal, and is robust to the
  // existing customers.normalized_phone convention (which keeps a leading '+').
  const digits = String(raw ?? '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return null;
  const head = user.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}
export function lastInitial(lastName: string | null | undefined): string {
  const s = String(lastName ?? '').trim();
  return s ? s[0].toUpperCase() + '.' : '';
}

// ---- per-tenant settings (master + feature toggles) ----
export const DEFAULT_SETTINGS: GoCheckInSettings = {
  enabled: false, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true,
  // SUNMI guide 4A.9: "Allow technician preference — OFF until eligibility/assignment rules are verified" (migration 990
  // changed the column default too; a salon that saved ON keeps ON)
  serviceSelectionEnabled: true, technicianPreferenceEnabled: true,   // Kevin Nov 13 2026: guests may pick a technician (ON)
  tenantPhoneLookupEnabled: true,
  centralLookupEnabled: true, customerLinkingEnabled: true, showWaitEstimate: true, autoSendToQueue: true,
  requireFrontDeskApproval: false, confirmationTimeoutSeconds: 12,
  displayLanguages: ['en'],   // Dual-Screen §118–§119: English until the owner adds Vietnamese
  // SUNMI guide 4A.9 (migration 990): the walk-in service selection switches, all ON
  walkinRequireServices: true, walkinShowPrices: true, walkinShowDurations: true, walkinAllowAddOns: true,
};

// ---- device + session records ----
export interface GoCheckInDevice {
  id: string; tenantId: string; branchId: string | null; deviceName: string; deviceType: string;
  checkinSlug: string; publicUrl: string | null; status: 'active' | 'inactive' | 'disabled' | 'revoked' | 'expired';
  lastSeenAt: string | null; tokenExpiresAt: string | null; allowedBranchIds: string[];
  welcomeMessage?: string | null;   // optional custom idle greeting; null → default "Welcome to <salon>"
}

// Multi-branch selection: the device's default branch (branch_id) plus any additional allowed branches. The kiosk may only
// check in to a branch in this set; selection is validated server-side at session start. Pure + exported for tests.
export function selectableBranchIds(device: { branchId: string | null; allowedBranchIds?: string[] | null }): string[] {
  const ids = [device.branchId, ...(device.allowedBranchIds || [])].filter((x): x is string => !!x);
  return Array.from(new Set(ids));
}
export function isBranchAllowed(device: { branchId: string | null; allowedBranchIds?: string[] | null }, branchId: string): boolean {
  return selectableBranchIds(device).includes(branchId);
}
// Resolve the branch a session should use: a provided choice must be in the selectable set; otherwise the default branch.
export function resolveSessionBranch(device: { branchId: string | null; allowedBranchIds?: string[] | null }, requested?: string | null): { ok: true; branchId: string | null } | { ok: false } {
  if (requested) return isBranchAllowed(device, requested) ? { ok: true, branchId: requested } : { ok: false };
  return { ok: true, branchId: device.branchId };
}
export interface GoCheckInSession {
  /** Exactly one of these (migration 512): a Go Check-In kiosk's session, or a paired customer display's (23-inch spec
   *  §8 — the display checks in with its own identity, not a borrowed kiosk's). */
  id: string; tenantId: string; branchId: string | null; deviceId: string | null; displayDeviceId: string | null;
  status: 'active' | 'inactive' | 'completed' | 'expired' | 'revoked' | 'failed';
  startedAt: string; lastSeenAt: string;
}

// ---- public payloads (implements the shapes in check-in/public-check-in.dto.ts) ----

// The wire types (KioskConfig, LookupResult, AppointmentToday, CustomerChoice, CheckInConfirmation, the match types) are
// @aipowersalon/api-contracts/customer's — the kiosk app imports the same definitions (Constitution 13 §15).
export type { KioskConfig, KioskSettings, TenantCustomerMatch, CentralCustomerMatch, AppointmentToday, CustomerChoice, LookupResult, CheckInConfirmation } from '@aipowersalon/api-contracts/customer';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { GoCheckInSettings } from '@aipowersalon/api-contracts/tenant';
import type { GoCheckInSettings } from '@aipowersalon/api-contracts/tenant';

// rate-limit constants
export const MAX_LOOKUPS_PER_SESSION = 8;
/** Security Deep Scan E10: a new kiosk session reset the per-session lookup cap, so the public slug alone allowed unlimited
 *  phone → first-name enumeration. Salon-wide caps over a 15-minute window (generous for a 200-technician opening rush). */
export const KIOSK_WINDOW_MINUTES = 15;
export const MAX_KIOSK_SESSIONS_PER_WINDOW = 300;
export const MAX_KIOSK_LOOKUPS_PER_WINDOW = 600;
export const MAX_CREATES_PER_SESSION = 3;
export const SESSION_IDLE_MS = 10 * 60 * 1000; // expire a session idle for >10 minutes

// log event types (also the Super-Admin log vocabulary)
export type GoCheckInEvent =
  | 'session_started' | 'phone_entered' | 'tenant_customer_found' | 'central_customer_found' | 'customer_not_found'
  | 'customer_created' | 'appointment_found' | 'appointment_checked_in' | 'walkin_checked_in' | 'queue_item_created'
  | 'duplicate_blocked' | 'rate_limited' | 'error' | 'session_completed' | 'session_expired';
