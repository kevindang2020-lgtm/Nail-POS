// password-reset.service.ts — orchestrates the reset flow over the tested core. Framework-free (constructor
// injection); register as an @Injectable provider in your Nest auth module. Ports are tiny interfaces so it
// runs against in-memory fakes here and Kysely/Twilio/Argon2 in production.
import { InMemoryEphemeralGrants, type EphemeralGrants } from '@aipowersalon/auth';
import {
  GENERIC_RESET_MESSAGE, normalizeSalonCode, normalizePhoneE164, isResetAllowedRole,
  formatTempCode, expiryFrom, isTokenUsable, tokenFailureReason, isRateLimited,
  validateNewPassword, redirectAfterReset, buildResetAudit, RateCounts,
} from "./password-reset-core";
import { SmsSender } from '@aipowersalon/notifications';
import { resetSmsBody } from "./reset-messages";

export interface TenantRow { tenantId: string; salonName: string; tenantCode: string; status: string; }
export interface UserRow { userId: string; tenantId: string; fullName: string; role: string; status: string; normalizedPhone: string | null; permissions: string[]; branchId: string; branchName: string; }
export interface TokenRow { id: string; tenantId: string; userId: string; tokenHash: string; tokenType: string; expiresAt: number; usedAt: number | null; attemptCount: number; maxAttempts: number; }

export interface Ports {
  tenants: { findActiveByCode(code: string): Promise<TenantRow | null> };
  users: { findActiveByTenantPhone(tenantId: string, phone: string): Promise<UserRow | null>; findForLogin(tenantCodeOrSlug: string, emailOrPhone: string): Promise<{ user: UserRow; tenant: TenantRow } | null>; setPasswordHash(userId: string, hash: string): Promise<void> };
  tokens: { create(row: Omit<TokenRow, "id">): Promise<TokenRow>; latestUsable(tenantId: string, userId: string): Promise<TokenRow | null>; markUsed(id: string, nowMs: number): Promise<void>; incAttempt(id: string): Promise<void>;
    /** Constitution 12 §112–114: ATOMICALLY claim one attempt on a usable token (one statement). */ claimAttempt(id: string, nowMs: number): Promise<boolean>;
    /** ATOMICALLY mark used: true only for the ONE caller that flips it. */ markUsedOnce(id: string, nowMs: number): Promise<boolean> };
  sessions: { revokeAllForUser(userId: string): Promise<void>; create(userId: string): Promise<{ accessToken: string; refreshToken: string }> };
  hasher: { hash(s: string): Promise<string>; verify(s: string, h: string): Promise<boolean> };
  sms: SmsSender;
  audit: { record(a: ReturnType<typeof buildResetAudit>): Promise<void> };
  rate: { counts(phone: string, ip?: string): Promise<RateCounts>; bump(phone: string, ip?: string): Promise<void> };
  clock: { now(): number; iso(): string };
  rng: { sixDigits(): number; token(): string };
  /** Durable reset sessions (migration 456). Absent → an in-process store (tests, database-less dev). */
  grants?: EphemeralGrants;
}

export class PasswordResetService {
  constructor(private p: Ports) {}
  // Reset sessions live in ephemeral_grants (migration 456): they survive a deploy and work on any instance. They carry
  // ids only — the old in-memory map also held the temporary password in plaintext for the "new password must differ"
  // check; that check now compares against the token row's existing hash instead.
  private get grants(): EphemeralGrants { return (this.p.grants ??= new InMemoryEphemeralGrants(() => this.p.clock.now())); }

  // §5 — ALWAYS returns the generic message.
  async requestReset(input: { salonCode: string; phone: string; ip?: string; ua?: string }) {
    const salon = normalizeSalonCode(input.salonCode);
    const phone = normalizePhoneE164(input.phone);
    const generic = { ok: true as const, message: GENERIC_RESET_MESSAGE };
    if (!phone) return generic; // invalid input still generic
    const counts = await this.p.rate.counts(phone, input.ip);
    if (isRateLimited(counts)) {
      await this.p.audit.record(buildResetAudit("tenant_password_reset_rate_limited", { phone, ip: input.ip, ua: input.ua, nowIso: this.p.clock.iso() }));
      return generic;
    }
    await this.p.rate.bump(phone, input.ip);
    const tenant = await this.p.tenants.findActiveByCode(salon);
    await this.p.audit.record(buildResetAudit("tenant_password_reset_requested", { tenantId: tenant?.tenantId, phone, ip: input.ip, ua: input.ua, nowIso: this.p.clock.iso() }));
    if (!tenant) return generic;
    const user = await this.p.users.findActiveByTenantPhone(tenant.tenantId, phone);
    if (!user || !isResetAllowedRole(user.role)) return generic; // no leak
    const tempPlain = formatTempCode(this.p.rng.sixDigits());
    const tokenHash = await this.p.hasher.hash(tempPlain);
    const now = this.p.clock.now();
    await this.p.tokens.create({ tenantId: tenant.tenantId, userId: user.userId, tokenHash, tokenType: "temporary_password", expiresAt: expiryFrom(now, 15), usedAt: null, attemptCount: 0, maxAttempts: 5 });
    try {
      await this.p.sms.send(phone, resetSmsBody(tempPlain));
      await this.p.audit.record(buildResetAudit("tenant_password_reset_sms_sent", { tenantId: tenant.tenantId, userId: user.userId, phone, ip: input.ip, nowIso: this.p.clock.iso() }));
    } catch (e) {
      await this.p.audit.record(buildResetAudit("tenant_password_reset_sms_failed", { tenantId: tenant.tenantId, userId: user.userId, phone, ip: input.ip, nowIso: this.p.clock.iso(), metadata: { error: String(e) } }));
    }
    return generic;
  }

  // §8 — temp-code login path. Returns forcePasswordReset + short-lived resetSessionToken on match.
  async loginWithTemp(input: { tenantCodeOrSlug: string; emailOrPhone: string; password: string }) {
    const found = await this.p.users.findForLogin(input.tenantCodeOrSlug, input.emailOrPhone);
    if (!found) return { ok: false as const };
    const tok = await this.p.tokens.latestUsable(found.tenant.tenantId, found.user.userId);
    const now = this.p.clock.now();
    if (!tok) return { ok: false as const, reason: "expired" as const };
    if (!isTokenUsable(tok, now)) return { ok: false as const, reason: tokenFailureReason(tok, now) };
    // Constitution 12 §112–114. The temporary password is "APS-" + SIX digits: a million possibilities, protected only
    // by the attempt limit. The count used to be incremented AFTER the slow comparison, against a stale snapshot, so
    // parallel guesses outran it — an account-takeover route. Now an attempt is claimed atomically BEFORE comparing.
    if (!(await this.p.tokens.claimAttempt(tok.id, now))) return { ok: false as const, reason: "locked" as const };
    const match = await this.p.hasher.verify(input.password, tok.tokenHash);
    await this.p.audit.record(buildResetAudit("tenant_temporary_password_login_attempted", { tenantId: found.tenant.tenantId, userId: found.user.userId, nowIso: this.p.clock.iso() }));
    if (!match) { await this.p.audit.record(buildResetAudit("tenant_temporary_password_login_failed", { tenantId: found.tenant.tenantId, userId: found.user.userId, nowIso: this.p.clock.iso() })); return { ok: false as const, reason: "invalid" as const }; }
    const rst = await this.grants.put('password_reset_session', { tenantId: found.tenant.tenantId, userId: found.user.userId, tokenId: tok.id }, 10 * 60_000);
    await this.p.audit.record(buildResetAudit("tenant_temporary_password_login_success", { tenantId: found.tenant.tenantId, userId: found.user.userId, nowIso: this.p.clock.iso() }));
    return { ok: true as const, forcePasswordReset: true, resetSessionToken: rst,
      user: { userId: found.user.userId, fullName: found.user.fullName, role: found.user.role },
      tenant: { tenantId: found.tenant.tenantId, salonName: found.tenant.salonName, tenantCode: found.tenant.tenantCode } };
  }

  // §9 — set new password, revoke old sessions, return a fresh login.
  async completeReset(input: { resetSessionToken: string; newPassword: string; confirmPassword: string }) {
    type RS = { tenantId: string; userId: string; tokenId: string };
    const s = await this.grants.peek<RS>('password_reset_session', input.resetSessionToken);   // not consumed: a rejected weak password keeps the session
    const now = this.p.clock.now();
    if (!s) throw new Error("invalid_or_expired_reset_session");
    const v = validateNewPassword(input.newPassword, input.confirmPassword, "");
    if (!v.ok) throw new Error(v.error);
    // "Cannot be the temporary password" — checked against the token's stored HASH (no plaintext is kept anywhere).
    const tok = await this.p.tokens.latestUsable(s.tenantId, s.userId);
    if (tok && tok.id === s.tokenId && (await this.p.hasher.verify(input.newPassword, tok.tokenHash))) throw new Error("New password cannot be the temporary password.");
    // Consume the session atomically — of two concurrent completions, exactly one continues.
    if (!(await this.grants.take<RS>('password_reset_session', input.resetSessionToken))) throw new Error("invalid_or_expired_reset_session");
    // Claim the token FIRST (exactly one caller wins), then change the password — two concurrent completions with the
    // same reset session used to both set a password and both mint a session.
    if (!(await this.p.tokens.markUsedOnce(s.tokenId, now))) throw new Error("invalid_or_expired_reset_session");
    const hash = await this.p.hasher.hash(input.newPassword);
    await this.p.users.setPasswordHash(s.userId, hash);
    await this.p.sessions.revokeAllForUser(s.userId);
    const session = await this.p.sessions.create(s.userId);
    await this.p.audit.record(buildResetAudit("tenant_password_reset_completed", { tenantId: s.tenantId, userId: s.userId, nowIso: this.p.clock.iso() }));
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, redirect: redirectAfterReset("OWNER"), userId: s.userId };
  }
}
