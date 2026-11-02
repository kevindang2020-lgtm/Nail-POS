// password-reset-core.ts — pure, tested core for the tenant password-reset flow.
// All security DECISIONS live here so they're verifiable without the framework/DB/Twilio.
import { normalizeIdentifier } from '@aipowersalon/auth';

export type StaffRole = "OWNER" | "MANAGER" | "FRONT_DESK" | "RECEPTION" | "TECHNICIAN";

/**
 * Who may reset their own password with a salon code, a phone number, and an SMS code.
 *
 * ── TECHNICIAN WAS ADDED, AND THIS IS A SECURITY-ALLOWLIST CHANGE. READ IT. ──────────────────────────────
 *
 * tech-web has a LIVE "forgot password" button — LoginScreen.tsx calls
 * `authApi.requestPasswordReset(salonCode, phone)`. TECHNICIAN was not on this list, so the server dutifully
 * returned the generic message —
 *
 *     "If this account exists, we sent temporary login instructions to the phone number on file."
 *
 * — and sent nothing. Ever. And the POS has no way for a manager to reset a technician's password either.
 *
 * So a technician who forgot her password tapped the button, was told help was on the way, and waited forever.
 * There was no other path. She was locked out permanently — and since her password now spans every salon she
 * works at (auth/password-scope.ts), that is every job she has.
 *
 * A button that reports a send that never happens is the exact fabrication this codebase refuses everywhere
 * else, and it was sitting on a login screen.
 *
 * WHY THIS IS SAFE: the bar to pass is knowing the salon code, knowing the phone on the account, and physically
 * receiving the SMS at that phone. That is IDENTICAL to the bar an OWNER already passes — and a technician's
 * account is strictly less privileged than an owner's. Allowing it is therefore strictly safer than the status
 * quo, not looser. The flow is already rate-limited and audited.
 *
 * SUPER_ADMIN and CUSTOMER remain excluded: Super Admin for obvious reasons, and customers have their own flow.
 *
 * To revert: delete "TECHNICIAN" from the array below. But then delete the button in tech-web too, because a
 * button that cannot work must not be shown.
 */
export const RESET_ALLOWED_ROLES: StaffRole[] = ["OWNER", "MANAGER", "FRONT_DESK", "RECEPTION", "TECHNICIAN"];

// the ONE message ever returned to the client for a reset request — never leaks existence.
export const GENERIC_RESET_MESSAGE =
  "If this account exists, we sent temporary login instructions to the phone number on file.";

export function isResetAllowedRole(role: string): boolean {
  return (RESET_ALLOWED_ROLES as string[]).indexOf(role) >= 0; // SUPER_ADMIN and CUSTOMER excluded
}

export function normalizeSalonCode(raw: string): string {
  return (raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

// Staff-family E.164 normalization — DELEGATES to auth/security.normalizeIdentifier (Jul 28, 2026), because reset
// looks up users.normalized_phone, which is WRITTEN by that same function (login + invites). A third semantic here
// meant a staff phone that could sign in couldn't password-reset (non-US numbers, and "+"+10-digit inputs, returned
// null or a value that matched nothing stored). Returns null when the input isn't a phone.
export function normalizePhoneE164(raw: string): string | null {
  const r = normalizeIdentifier(raw || "");
  return r.kind === "phone" ? r.value : null;
}

// (555) ***-1234  — for logs/audit only.
export function maskPhone(phone: string): string {
  const d = (phone.match(/\d/g) || []).join("");
  const last4 = d.slice(-4);
  const area = d.length >= 10 ? d.slice(-10, -7) : "***";
  return "(" + area + ") ***-" + (last4 || "****");
}

// temp code "APS-849271" — digits provided by a CSPRNG in the service (crypto.randomInt) for testability.
export function formatTempCode(sixDigits: number): string {
  const s = String(Math.abs(sixDigits) % 1000000).padStart(6, "0");
  return "APS-" + s;
}

export function expiryFrom(nowMs: number, minutes = 15): number { return nowMs + minutes * 60_000; }
export function isExpired(nowMs: number, expiresAtMs: number): boolean { return nowMs >= expiresAtMs; }

export interface ResetTokenRecord {
  usedAt: number | null; expiresAt: number; attemptCount: number; maxAttempts: number;
}
// a temp code is usable iff: never used, not expired, attempts remain.
export function isTokenUsable(rec: ResetTokenRecord, nowMs: number): boolean {
  return rec.usedAt === null && !isExpired(nowMs, rec.expiresAt) && rec.attemptCount < rec.maxAttempts;
}
// reason for a failed temp login, for the UX copy in §17.
export function tokenFailureReason(rec: ResetTokenRecord, nowMs: number): "expired" | "used" | "locked" | null {
  if (rec.usedAt !== null) return "used";
  if (isExpired(nowMs, rec.expiresAt)) return "expired";
  if (rec.attemptCount >= rec.maxAttempts) return "locked";
  return null;
}

export interface RateCounts { phoneLastHour: number; ipLastHour: number; tokenAttempts: number; }
export const RATE_LIMITS = { perPhoneHour: 5, perIpHour: 10, tokenAttempts: 5 };
export function isRateLimited(c: RateCounts): boolean {
  return c.phoneLastHour >= RATE_LIMITS.perPhoneHour || c.ipLastHour >= RATE_LIMITS.perIpHour || c.tokenAttempts >= RATE_LIMITS.tokenAttempts;
}

// new-password rules (§9). tempPlain so the new password can't equal the temp code.
export function validateNewPassword(newPw: string, confirmPw: string, tempPlain: string): { ok: boolean; error?: string } {
  if (!newPw || newPw.length < 10) return { ok: false, error: "Password must be at least 10 characters." };
  if (newPw !== confirmPw) return { ok: false, error: "Passwords do not match." };
  if (newPw === tempPlain) return { ok: false, error: "New password cannot be the temporary code." };
  if (!/[A-Za-z]/.test(newPw) || !/\d/.test(newPw)) return { ok: false, error: "Use letters and numbers." };
  return { ok: true };
}

// where staff land after completing reset.
export function redirectAfterReset(_role: StaffRole): string { return "/pos/dashboard"; }

export interface ResetAudit { tenantId?: string; userId?: string; phoneMasked?: string; actionType: string; ipAddress?: string; userAgent?: string; metadata: Record<string, unknown>; createdAt: string; }
export function buildResetAudit(actionType: string, p: { tenantId?: string; userId?: string; phone?: string; ip?: string; ua?: string; nowIso: string; metadata?: Record<string, unknown> }): ResetAudit {
  return { tenantId: p.tenantId, userId: p.userId, phoneMasked: p.phone ? maskPhone(p.phone) : undefined,
    actionType: actionType, ipAddress: p.ip, userAgent: p.ua, metadata: p.metadata || {}, createdAt: p.nowIso };
}
