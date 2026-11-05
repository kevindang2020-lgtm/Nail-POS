// system-password-reset.service.ts — one cohesive orchestrator backing the tenant / super-admin /
// user-password-admin controllers. Framework-free (constructor injection) so it runs against fakes here.
import { SmsSender, EmailSender } from '@aipowersalon/notifications';
import { generateTempPassword, validateNewPassword } from '@aipowersalon/auth';
import { chooseDelivery, canResetTargetRole, okSameTenantReset, isTenantSelfServeRole, isSuperAdminRole, landingRoute, changePasswordRoute, isRateLimited, RateCounts, AnyRole } from "./reset-authz";
import { maskPhone, normalizePhoneE164, normalizeSalonCode, GENERIC_RESET_MESSAGE, buildResetAudit } from "./password-reset-core";
import { resetSmsBody, resetEmail } from "./reset-messages";

export const GENERIC_TENANT = "If this account exists, we sent reset instructions.";
export const GENERIC_SUPER = "If this Super Admin account exists, we sent reset instructions.";
const FIFTEEN_MIN = 15 * 60_000;

export interface UserRow { userId: string; tenantId: string | null; branchId: string | null; fullName: string; role: AnyRole; status: string; email: string | null; normalizedPhone: string | null; permissions: string[]; }
export interface TenantRow { tenantId: string; salonName: string; tenantCode: string; status: string; prefersSms: boolean; }

export interface Ports {
  tenants: { findActiveByCode(code: string): Promise<TenantRow | null> };
  users: {
    findActiveInTenantByEmailOrPhone(tenantId: string, email: string | null, phone: string | null): Promise<UserRow | null>;
    findSuperAdminByEmailOrPhone(email: string | null, phone: string | null): Promise<UserRow | null>;
    findById(userId: string): Promise<UserRow | null>;
    setTemporaryPassword(userId: string, hash: string, expiresAt: number, delivery: string): Promise<void>;
    setNewPassword(userId: string, hash: string): Promise<void>; // clears temp + must_change, sets password_changed_at
  };
  sessions: { revokeAllForUser(userId: string): Promise<void>; create(userId: string): Promise<{ accessToken: string; refreshToken: string }> };
  hasher: { hash(s: string): Promise<string>; verify(s: string, h: string): Promise<boolean> };
  sms: SmsSender; email: EmailSender;
  audit: { record(a: ReturnType<typeof buildResetAudit>): Promise<void> };
  rate: { counts(identifier: string, ip?: string, tenantId?: string): Promise<RateCounts>; bump(identifier: string, ip?: string, tenantId?: string): Promise<void> };
  clock: { now(): number; iso(): string };
  rng: { int(maxExclusive: number): number; token(): string };
}

export class SystemPasswordResetService {
  constructor(private p: Ports) {}
  private changeSessions = new Map<string, { userId: string; role: AnyRole; tenantId: string | null; tempPlain: string; exp: number }>();

  // deliver a freshly generated temp password to a matched user; returns false if no usable channel.
  private async issueAndSend(user: UserRow, method: "sms" | "email" | "auto" | undefined, prefersSms: boolean, from: string, ip?: string): Promise<boolean> {
    const delivery = chooseDelivery(method, !!user.normalizedPhone, !!user.email, prefersSms);
    if (!delivery) return false;
    const tempPlain = generateTempPassword((m) => this.p.rng.int(m), 12);
    const hash = await this.p.hasher.hash(tempPlain);
    await this.p.users.setTemporaryPassword(user.userId, hash, this.p.clock.now() + FIFTEEN_MIN, delivery);
    const targetMasked = delivery === "sms" ? maskPhone(user.normalizedPhone || "") : (user.email || "").replace(/^(.).*(@.*)$/, "$1***$2");
    try {
      if (delivery === "sms") await this.p.sms.send(user.normalizedPhone!, resetSmsBody(tempPlain));
      else { const e = resetEmail(tempPlain); await this.p.email.send(user.email!, e.subject, e.body); }
      await this.p.audit.record(buildResetAudit("password_reset_sent", { tenantId: user.tenantId || undefined, userId: user.userId, nowIso: this.p.clock.iso(), metadata: { deliveryMethod: delivery, deliveryTargetMasked: targetMasked, requestedFrom: from } }));
      await this.p.audit.record(buildResetAudit("temporary_password_created", { tenantId: user.tenantId || undefined, userId: user.userId, nowIso: this.p.clock.iso(), metadata: { deliveryMethod: delivery } }));
      return true;
    } catch (e) {
      await this.p.audit.record(buildResetAudit("password_reset_failed", { tenantId: user.tenantId || undefined, userId: user.userId, nowIso: this.p.clock.iso(), metadata: { error: String(e) } }));
      return false;
    }
  }

  // §4 tenant self-serve — ALWAYS generic.
  async tenantForgotPassword(input: { tenantCodeOrSlug: string; emailOrPhone: string; deliveryMethod?: "sms" | "email" | "auto"; ip?: string; ua?: string }) {
    const generic = { ok: true as const, message: GENERIC_TENANT };
    const raw = (input.emailOrPhone || "").trim();
    const isEmail = raw.indexOf("@") >= 0;
    const email = isEmail ? raw.toLowerCase() : null;
    const phone = isEmail ? null : normalizePhoneE164(raw);
    const counts = await this.p.rate.counts(raw);
    if (isRateLimited(counts, false)) { await this.p.audit.record(buildResetAudit("password_reset_rate_limited", { nowIso: this.p.clock.iso(), metadata: { requestedFrom: "tenant_login" } })); return generic; }
    await this.p.rate.bump(raw, input.ip);
    const tenant = await this.p.tenants.findActiveByCode(normalizeSalonCode(input.tenantCodeOrSlug));
    await this.p.audit.record(buildResetAudit("password_reset_requested", { tenantId: tenant?.tenantId, phone: phone || undefined, nowIso: this.p.clock.iso(), metadata: { requestedFrom: "tenant_login" } }));
    if (!tenant) return generic;
    const user = await this.p.users.findActiveInTenantByEmailOrPhone(tenant.tenantId, email, phone);
    if (!user || !isTenantSelfServeRole(user.role)) return generic; // excludes SUPER_ADMIN; no leak
    await this.issueAndSend(user, input.deliveryMethod, tenant.prefersSms, "tenant_login", input.ip);
    return generic;
  }

  // §5 super admin self-serve — separate, no salon code, stricter rate.
  async superAdminForgotPassword(input: { emailOrPhone: string; deliveryMethod?: "sms" | "email" | "auto"; ip?: string }) {
    const generic = { ok: true as const, message: GENERIC_SUPER };
    const raw = (input.emailOrPhone || "").trim(); const isEmail = raw.indexOf("@") >= 0;
    const counts = await this.p.rate.counts(raw, input.ip);
    if (isRateLimited(counts, true)) { await this.p.audit.record(buildResetAudit("password_reset_rate_limited", { nowIso: this.p.clock.iso(), metadata: { requestedFrom: "super_admin_login" } })); return generic; }
    await this.p.rate.bump(raw, input.ip);
    const user = await this.p.users.findSuperAdminByEmailOrPhone(isEmail ? raw.toLowerCase() : null, isEmail ? null : normalizePhoneE164(raw));
    await this.p.audit.record(buildResetAudit("super_admin_password_reset_requested", { userId: user?.userId, nowIso: this.p.clock.iso(), metadata: { requestedFrom: "super_admin_login" } }));
    if (!user || !isSuperAdminRole(user.role)) return generic; // tenant users can't reset via this path
    await this.issueAndSend(user, input.deliveryMethod, false, "super_admin_login", input.ip);
    return generic;
  }

  // §11/§12 admin-initiated reset (super-admin portal OR tenant owner/manager). Requires permission + reason.
  async adminResetUserPassword(actor: { userId: string; role: AnyRole; tenantId: string | null; permissions: string[]; mfaVerified?: boolean }, targetUserId: string, opts: { deliveryMethod: "sms" | "email" | "auto"; reason: string }) {
    if (!opts.reason || !opts.reason.trim()) throw new Error("reason_required");
    const target = await this.p.users.findById(targetUserId);
    if (!target) throw new Error("not_found");
    if (isSuperAdminRole(actor.role) && !actor.mfaVerified) throw new Error("mfa_required");
    if (!canResetTargetRole(actor.role, actor.permissions, target.role)) throw new Error("forbidden");
    if (!isSuperAdminRole(actor.role)) { // tenant admins are tenant-scoped
      if (!actor.tenantId || !target.tenantId || !okSameTenantReset(actor.tenantId, target.tenantId)) throw new Error("forbidden_cross_tenant");
    }
    const prefersSms = false;
    const ok = await this.issueAndSend(target, opts.deliveryMethod, prefersSms, isSuperAdminRole(actor.role) ? "super_admin_portal" : "tenant_pos", undefined);
    const action = isSuperAdminRole(actor.role) ? "super_admin_user_password_reset" : (actor.role === "MANAGER" ? "manager_user_password_reset" : "tenant_owner_user_password_reset");
    await this.p.audit.record(buildResetAudit(action, { tenantId: target.tenantId || undefined, userId: actor.userId, nowIso: this.p.clock.iso(), metadata: { reason: opts.reason, deliveryMethod: opts.deliveryMethod } }));
    return { ok }; // never returns the temp password
  }

  // §8 temp-password login. password = the temp password the user received.
  async loginWithTemporaryPassword(user: UserRow, password: string, tempState: { hash: string; expiresAt: number }) {
    const now = this.p.clock.now();
    if (now >= tempState.expiresAt) { await this.p.audit.record(buildResetAudit("temporary_password_expired", { userId: user.userId, nowIso: this.p.clock.iso(), metadata: {} })); return { ok: false as const, reason: "expired" as const }; }
    const match = await this.p.hasher.verify(password, tempState.hash);
    if (!match) { await this.p.audit.record(buildResetAudit("password_reset_failed", { userId: user.userId, nowIso: this.p.clock.iso(), metadata: {} })); return { ok: false as const, reason: "invalid" as const }; }
    const sid = this.p.rng.token();
    this.changeSessions.set(sid, { userId: user.userId, role: user.role, tenantId: user.tenantId, tempPlain: password, exp: now + 10 * 60_000 });
    await this.p.audit.record(buildResetAudit("temporary_password_login", { userId: user.userId, nowIso: this.p.clock.iso(), metadata: {} }));
    return { ok: true as const, mustChangePassword: true, temporaryPasswordLogin: true, changePasswordSessionId: sid, changePasswordRoute: changePasswordRoute(user.role) };
  }

  // §8 change temp password -> set new, clear temp, revoke old sessions, fresh session, role redirect.
  async changeTemporaryPassword(input: { changePasswordSessionId: string; newPassword: string; confirmPassword: string }) {
    const s = this.changeSessions.get(input.changePasswordSessionId);
    const now = this.p.clock.now();
    if (!s || now >= s.exp) throw new Error("invalid_or_expired_session");
    const v = validateNewPassword(input.newPassword, input.confirmPassword, s.tempPlain);
    if (!v.ok) throw new Error(v.error);
    const hash = await this.p.hasher.hash(input.newPassword);
    await this.p.users.setNewPassword(s.userId, hash);     // clears temp hash + must_change, sets password_changed_at
    await this.p.sessions.revokeAllForUser(s.userId);       // §15 revoke old sessions/refresh tokens
    const session = await this.p.sessions.create(s.userId);
    this.changeSessions.delete(input.changePasswordSessionId);
    await this.p.audit.record(buildResetAudit("password_changed", { tenantId: s.tenantId || undefined, userId: s.userId, nowIso: this.p.clock.iso(), metadata: {} }));
    await this.p.audit.record(buildResetAudit("sessions_revoked_after_password_change", { userId: s.userId, nowIso: this.p.clock.iso(), metadata: {} }));
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, redirect: landingRoute(s.role), role: s.role, userId: s.userId };
  }
}
