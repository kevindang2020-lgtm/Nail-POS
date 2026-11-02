/**
 * auth-login.service.ts — login orchestrator (slice 3).
 *
 * Ties the pieces together without performing any I/O of its own beyond the injected repository:
 *   normalizeIdentifier → repo lookup → verifyPassword → assemble LoginFacts → decideLogin.
 * It returns the decision plus, when the user is authenticated (SUCCESS or BRANCH_SELECTION_REQUIRED), a LoginPrincipal
 * carrying the trusted identity + RBAC permissions. Token/session issuance is deliberately NOT done here — that is the
 * next slice, which will mint a session from this principal and set it on the request. MFA here is gated on code
 * *format* only (isValidMfaCode); real TOTP/WebAuthn verification is a later slice that plugs into the same fact.
 */
import type { LoginRiskPort } from './login-risk';
import { POLICY_MFA_ROLES, MFA_ENROLLMENT_REQUIRED, type TenantAuthPolicyPort } from './tenant-auth-policy';
import { looksLikeRecoveryCode } from './mfa-recovery-codes';
import { pickDefaultSalon } from './auth-user.repository';
import { platformPermissionsFor, isPlatformRole, PLATFORM_FALLBACK_ROLE, type PlatformRole } from '@aipowersalon/permissions';
import { normalizeIdentifier, mfaRequiredForRole, isValidMfaCode, requireRealTotpEnrollment, rateLimitDecision, type NormalizedIdentifier, verifyPassword } from '@aipowersalon/auth';
import type { KeyedRateLimiter } from '@aipowersalon/security';
import { attemptBudgetFromLimiter, guardedAttempt, isAttemptBudget, type AttemptBudget } from './auth-attempt-budget';
import { decideLogin, type LoginDecision, type LoginFacts, type SubStatus } from './auth-flow';
import type { LoginAttemptSink } from './login-attempt-sink';
import type { SuperAdminOtpPort } from './super-admin-login-otp';
import { matchedTotpStep } from './totp';
import { permissionsFor, type Role } from '@aipowersalon/permissions';
import { effectiveTechPermissions } from '@aipowersalon/permissions';
import type { AuthUserRepository, LoginLookup, LoginUserRecord } from './auth-user.repository';

// 'customer' is the CUSTOMER APP portal. It exists so that the customer app can never be used to sign a staff
// member in: the lookup it drives considers ONLY users with role = 'CUSTOMER'. (Spec §11: staff and Super Admin
// must use their own applications.) It also needs no salon code — a customer is found by phone or email.
// 'owner' is the OWNER APP portal. It exists because an owner with several salons has no single Store Code to
// type — asking for one means asking "which of your businesses do you want to be pinned to?", which is exactly the
// question the portfolio is supposed to answer. So the owner signs in with the credentials they actually have
// (email or phone + password) and lands in their portfolio.
//
// Like the customer portal, the lookup is role-filtered in SQL: only `role = 'OWNER'` rows exist to be found, so a
// manager or technician can never authenticate through the Owner App.
export type Portal = 'tenant' | 'super-admin' | 'customer' | 'owner';

// The SAME generic message every other portal uses. A customer-app error must never reveal whether a phone or
// email belongs to an account.
const INVALID_MSG = 'The login information is incorrect. Please try again.';
// A real bcrypt hash of a value nobody knows. Comparing against it when no account matched keeps the timing of a
// nonexistent account close to that of a wrong password, so the endpoint cannot be used to enumerate customers.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1WvJx8ZBqk5F9YQpV1n1qMWkS0P1O2C';

export interface LoginInput {
  portal: Portal;
  salonCode?: string;     // required for the tenant portal
  identifier: string;     // email or phone
  password: string;
  mfaCode?: string;
  ownerAccessCode?: string;  // Owner App only. An OPTIONAL second factor, validated SERVER-side against a per-owner
                             // hash when one is configured; never checked on the client. Opt-in: owners with no code
                             // configured are unaffected. See the 'owner' branch below.
  ip?: string;            // caller IP, used to scope failed-attempt lockout (optional)
  deviceKey?: string | null;   // Constitution 3 Step 10b: the native install id or the browser's aps_device cookie (risk signal only)
  rememberMe?: boolean;   // requests the platform's EXTENDED session policy. The client asks; the SERVER decides
                          // the duration (see AUTH_SESSION_TTL_REMEMBER) — a client can never supply a TTL.
}

// Failed-attempt lockout store for login. Pure decision lives in security.rateLimitDecision; this port just supplies the
// recent failure timestamps for a key and records/clears them. Wiring it into LoginService is opt-in: with no throttle,
// login behaves exactly as before (no lockout). A persistent adapter (e.g. Redis/Postgres) can replace the in-memory one.
export interface LoginThrottlePort {
  recentFailures(key: string): Promise<number[]>; // epoch-ms timestamps of recent failed attempts for this key
  recordFailure(key: string): Promise<void>;
  clear(key: string): Promise<void>;
}

// Per-instance sliding-window store. Good enough for a single API instance; swap for a shared store before scaling out.
export class InMemoryLoginThrottle implements LoginThrottlePort {
  private hits = new Map<string, number[]>();
  constructor(private windowMs = 15 * 60_000) {}
  async recentFailures(key: string): Promise<number[]> {
    const cutoff = Date.now() - this.windowMs;
    const recent = (this.hits.get(key) || []).filter((t) => t >= cutoff);
    if (recent.length) this.hits.set(key, recent); else this.hits.delete(key);
    return recent;
  }
  async recordFailure(key: string): Promise<void> {
    const recent = await this.recentFailures(key);
    recent.push(Date.now());
    this.hits.set(key, recent);
  }
  async clear(key: string): Promise<void> { this.hits.delete(key); }
}

export interface LoginPrincipal {
  userId: string;
  tenantId: string | null;
  branchId: string | null;          // null until a branch is selected (BRANCH_SELECTION_REQUIRED)
  role: Role;
  permissions: string[];
  subscriptionStatus: SubStatus;
  needsBranchSelection: boolean;
  fullName: string | null;
  /** Constitution 7 §5 — a platform account's role (only on SUPER_ADMIN principals). */
  platformRole?: string;
  /** Constitution 7 §19 — a billing-only session for the owner of a suspended salon (signed into the token). */
  restriction?: 'SUSPENDED_BILLING_ONLY' | 'MFA_ENROLLMENT_REQUIRED';
  /** BUILD_PLAN Phase 9: the authorization versions this principal's permissions were derived at (read BEFORE them). */
  av?: number;
  tv?: number | null;
}

export interface LoginResult {
  outcome: LoginDecision['outcome'];
  message: string;
  principal?: LoginPrincipal;
  /** Constitution 3 §21–24 (Step 4): true when THIS sign-in proved a second factor (TOTP, SMS code or recovery code) —
   *  the session records it, and only such a session may mark its device trusted. */
  mfaVerified?: boolean;
  /** Constitution 3 Step 10b: the sign-in's risk assessment (elevated = new device AND new network, for an account with history). */
  risk?: { level: 'normal' | 'elevated'; signals: { newDevice: boolean; newNetwork: boolean; hasHistory: boolean } };
  maskedPhone?: string;   // set on a super-admin MFA_REQUIRED when the SMS code was sent — for "Code sent to (***) ***-4829"
}

/** global_tech_profiles.status values that refuse a technician login everywhere (Oct 12 2026 merge, workforce audit P0 #4). */
export const TECHNICIAN_GLOBAL_BLOCKED: ReadonlySet<string> = new Set(['paused', 'locked', 'suspended', 'anonymized', 'merged']);

export class LoginService {
  constructor(
    private readonly repo: AuthUserRepository,
    private readonly throttle?: LoginThrottlePort,
    private readonly attempts?: LoginAttemptSink,   // records every attempt into `login_attempts` (audit)
    private readonly otp?: SuperAdminOtpPort,        // super-admin SMS second factor; when absent, MFA falls back to TOTP
    // Constitution 12 §58 (finding M3) + Security Deep Scan C4: a correct password no longer means the second factor can be
    // guessed without limit. The API wires the Postgres AttemptBudget (works without Redis, every replica, every portal and
    // every factor — TOTP, recovery code, Super Admin SMS code). A KeyedRateLimiter is still accepted (adapted). Optional:
    // absent in tests → no budget, exactly like `throttle` above.
    mfaLimiter?: KeyedRateLimiter | AttemptBudget,
    // Constitution 3 Step 9: the salon's sign-in policy (absent → today's behaviour)
    private readonly policy?: TenantAuthPolicyPort,
    // Constitution 3 Step 10b: risk signals (credential stuffing, elevated sign-in); absent → none
    private readonly risk?: LoginRiskPort,
  ) {
    this.mfaBudget = !mfaLimiter ? undefined : isAttemptBudget(mfaLimiter) ? mfaLimiter : attemptBudgetFromLimiter(mfaLimiter);
  }
  private readonly mfaBudget?: AttemptBudget;

  /**
   * Security Deep Scan C4: EVERY second-factor check of a sign-in goes through here. No code submitted → not a guess (the
   * first step of a two-step sign-in spends nothing). Otherwise one guess is admitted against the account's budget — while
   * the budget is exhausted even a correct code is refused — and a correct code is refunded.
   */
  private async budgetedFactor(user: LoginUserRecord, code: string | undefined, ip: string | undefined, check: () => Promise<boolean>): Promise<boolean> {
    if (!(code || '').trim()) return false;
    return (await guardedAttempt(this.mfaBudget, 'mfa', user.userId, { tenantId: user.tenantId ?? null, ip: ip ?? null }, check)).ok;
  }

  /** Is the salon's "require two-factor for owners and managers" setting on for this user? */
  private async policyForcesMfa(user: LoginUserRecord | null): Promise<boolean> {
    if (!user?.tenantId || !this.policy || !(POLICY_MFA_ROLES as readonly string[]).includes(user.role)) return false;
    return (await this.policy.get(user.tenantId).catch(() => null))?.mfaForOwner === true;
  }

  // Public entry: enforces failed-attempt lockout (when a throttle is wired) around the pure decision in `decide`.
  // Lockout is keyed per (portal, salon, identifier, ip) so a brute-forcing IP is throttled without letting an attacker
  // lock a victim out from every location. The ±window/threshold come from rateLimitDecision's defaults (5 / 15 min).
  async attempt(input: LoginInput): Promise<LoginResult> {
    const id = normalizeIdentifier(input.identifier || '');
    const key = this.throttle ? [input.portal, input.salonCode || '', id.value || '', input.ip || ''].join('|') : '';
    if (this.throttle && key) {
      const recent = await this.throttle.recentFailures(key);
      if (!rateLimitDecision(recent, Date.now()).allowed) {
        return { outcome: 'RATE_LIMITED', message: 'Too many failed login attempts. Please wait 15 minutes before trying again.' };
      }
    }
    // Constitution 3 Step 10b: one address failing for many different accounts is a credential-stuffing run — refused
    // before any password is checked (the per-account throttle above cannot see this pattern).
    if (this.risk && await this.risk.stuffingBlocked(input.ip)) {
      await this.audit(input, id, null, false, 'STUFFING_BLOCKED');
      return { outcome: 'RATE_LIMITED', message: 'Too many failed sign-ins from your network. Please wait a few minutes before trying again.' };
    }
    const { result, passwordValid, tenantId } = await this.decide(input, id);
    if (this.throttle && key) {
      const authed = result.outcome === 'SUCCESS' || result.outcome === 'BRANCH_SELECTION_REQUIRED';
      if (authed) await this.throttle.clear(key);
      else if (!passwordValid) await this.throttle.recordFailure(key); // only a wrong password counts toward lockout
    }
    // Audit EVERY attempt (success and failure). The `login_attempts` table is what the Super Admin Security
    // screens read; before this, nothing wrote to it and every metric there was permanently zero.
    const success = result.outcome === 'SUCCESS' || result.outcome === 'BRANCH_SELECTION_REQUIRED';
    await this.audit(input, id, tenantId ?? null, success, result.outcome);
    return result;
  }

  /** Best-effort audit write. Never blocks or fails a sign-in; never records the password. */
  private async audit(input: LoginInput, id: NormalizedIdentifier, tenantId: string | null, success: boolean, reason: string): Promise<void> {
    if (!this.attempts) return;
    try {
      await this.attempts.record({
        tenantId,
        identifier: id.value || input.identifier || '',
        ip: input.ip ?? null,
        success,
        reason,
      });
    } catch { /* auditing must not break login */ }
  }

  private async decide(input: LoginInput, id: NormalizedIdentifier): Promise<{ result: LoginResult; passwordValid: boolean; tenantId?: string | null }> {
    const password = input.password || '';

    // ── OWNER APP portal ──
    //
    // No Store Code. An owner with three salons has three codes, and asking for one means asking "which of your
    // businesses do you want to be pinned to?" — the exact question the portfolio exists to answer.
    //
    // Only `role = 'OWNER'` rows can be found (enforced in the SQL), so a manager or technician cannot sign in
    // here even with correct credentials.
    if (input.portal === 'owner') {
      if (!this.repo.findOwnerForLogin) {
        return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
      }

      const found = await this.repo.findOwnerForLogin(id);
      if (!found) {
        // Constant-ish work so a nonexistent owner costs the same as a wrong password.
        await verifyPassword(password, DUMMY_HASH).catch(() => false);
        return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
      }

      const ok = found.user.passwordHash ? await verifyPassword(password, found.user.passwordHash) : false;
      if (!ok) {
        return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
      }
      if (found.user.status === 'invited') {
        found.user.status = 'active';
        if (this.repo.activateUser) {
          await this.repo.activateUser(found.user.userId).catch(() => undefined);
        }
      }

      // Owner Access Code — checked on the server when configured for the owner.
      const accessCodeHash = (found.user as { accessCodeHash?: string | null }).accessCodeHash;
      if (accessCodeHash) {
        if (!input.ownerAccessCode) {
          return { result: { outcome: 'INVALID_CREDENTIALS', message: 'Owner access code is required.' }, passwordValid: false, tenantId: null };
        }
        const codeOk = await verifyPassword(input.ownerAccessCode.trim(), accessCodeHash).catch(() => false);
        if (!codeOk) {
          return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
        }
      }

      // The salon the session OPENS at. Only ever one she actually owns and that is usable — never a default that
      // would put her somewhere she cannot be.
      const usable = found.salons.filter((sn) => decideLogin({
        tenantFound: true, tenantStatus: sn.tenantStatus, userFound: true, passwordValid: true,
        userStatus: found.user.status, subscriptionStatus: sn.subscriptionStatus ?? 'active',
        mfaRequired: false, mfaSatisfied: true, branchCount: 1,
      }).outcome === 'SUCCESS');

      if (!usable.length) {
        // Constitution 7 §19: no salon is fully usable — but one suspended for a cause that keeps owner billing access
        // opens a BILLING-ONLY session there (the same decision the staff path uses; SECURITY / FRAUD never do).
        for (const sn of found.salons) {
          const d = decideLogin({
            tenantFound: true, tenantStatus: sn.tenantStatus, userFound: true, passwordValid: true,
            userStatus: found.user.status, subscriptionStatus: sn.subscriptionStatus ?? 'active',
            ...(await this.mfaFacts(found.user, input.mfaCode, input.ip)), branchCount: 1,
            role: 'OWNER', suspensionReasonCode: sn.suspensionReasonCode ?? null,
          });
          if (d.outcome === 'SUCCESS' && d.restriction) {
            const u: LoginUserRecord = { ...found.user, tenantId: sn.tenantId, branchId: sn.branchId };
            return { result: await this.finish(d, u, sn.subscriptionStatus ?? 'active'), passwordValid: true, tenantId: sn.tenantId };
          }
          if (d.outcome === 'MFA_REQUIRED') break;   // the normal refusal below asks for the code
        }
        // Her password was right. Saying "incorrect" would send her round in circles retyping a correct password.
        const first = found.salons[0];
        const facts: LoginFacts = {
          tenantFound: !!first, tenantStatus: first?.tenantStatus ?? 'active',
          userFound: true, passwordValid: true, userStatus: found.user.status,
          subscriptionStatus: first?.subscriptionStatus ?? 'active',
          ...(await this.mfaFacts(found.user, input.mfaCode, input.ip)), branchCount: 1,
        };
        const d = decideLogin(facts);
        return {
          result: await this.finish(d, found.user, first?.subscriptionStatus ?? 'active'),
          passwordValid: true,
          tenantId: first?.tenantId ?? null,
        };
      }

      const home = usable[0];   // primary salon first (the SQL orders by is_primary_owner desc)
      const user: LoginUserRecord = { ...found.user, tenantId: home.tenantId, branchId: home.branchId };

      return {
        result: await this.finish(decideLogin({
          tenantFound: true, tenantStatus: home.tenantStatus, userFound: true, passwordValid: true,
          userStatus: found.user.status, subscriptionStatus: home.subscriptionStatus ?? 'active',
          ...(await this.mfaFacts(user, input.mfaCode, input.ip)), branchCount: 1,
        }), user, home.subscriptionStatus ?? 'active'),
        passwordValid: true,
        tenantId: home.tenantId,
      };
    }

    // ── CUSTOMER APP portal ──
    //
    // Only `role = 'CUSTOMER'` accounts are ever looked up (enforced in the SQL), so a manager, technician, owner
    // or Super Admin CANNOT sign in here even with correct credentials — there is simply nothing for the query to
    // find. That is spec §11, made structural rather than a convention someone can forget.
    //
    // No salon code: a customer does not have one. They are found by phone or email across salons.
    if (input.portal === 'customer') {
      // ── Global identity first ──
      //
      // One person, one password, many salons. A customer who visits two salons used to have TWO accounts and
      // possibly two different passwords — they'd change it at one and be baffled the other still wanted the old
      // one. The identity is the thing that has a password; the salons hang off it.
      //
      // Falls back to the old per-salon lookup when there is no identity row, so a customer who has not been
      // backfilled signs in exactly as before. That fallback is why this can ship without a flag day: if the
      // identity layer were wrong it degrades to today's behaviour rather than locking anyone out.
      if (this.repo.findCustomerIdentity) {
        const identity = await this.repo.findCustomerIdentity(id);
        if (identity) {
          const ok = identity.passwordHash ? await verifyPassword(password, identity.passwordHash) : false;
          if (!ok) {
            return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
          }
          if (identity.status !== 'active') {
            return { result: { outcome: 'USER_DISABLED', message: 'This account is not active. Please contact support.' }, passwordValid: true, tenantId: null };
          }

          // (a debug line here wrote the WHOLE identity — including its password hash — to the server log on every
          // customer sign-in; removed Oct 3 2026)

          // Only salons the account checks actually pass for. A suspended salon must not block the others.
          const usable = identity.salons.filter((sn) => decideLogin({
            tenantFound: true, tenantStatus: sn.tenantStatus, userFound: true, passwordValid: true,
            userStatus: 'active', subscriptionStatus: sn.subscriptionStatus ?? 'active',
            mfaRequired: false, mfaSatisfied: true, branchCount: 1,
          }).outcome === 'SUCCESS');

          if (!usable.length) {
            // Verified, but every salon is blocked. Do NOT fall through to the old path — the password was right;
            // reporting "incorrect" would send them round in circles.
            return {
              result: { outcome: 'TENANT_SUSPENDED', message: 'Your salon account is not currently active. Please contact your salon.' },
              passwordValid: true, tenantId: null,
            };
          }

          const chosen = pickDefaultSalon(usable);   // the customer's default salon account (Oct 3 2026)
          const user: LoginUserRecord = {
            userId: chosen.userId, tenantId: chosen.tenantId, branchId: null, role: 'CUSTOMER',
            status: 'active', passwordHash: null, mfaEnabled: false, fullName: null,
            email: null, normalizedPhone: null,
          } as any;

          return {
            result: await this.finish(decideLogin({
              tenantFound: true, tenantStatus: chosen.tenantStatus, userFound: true, passwordValid: true,
              userStatus: 'active', subscriptionStatus: chosen.subscriptionStatus ?? 'active',
              ...(await this.mfaFacts(user, input.mfaCode, input.ip)), branchCount: 1,
            }), user, chosen.subscriptionStatus ?? 'active'),
            passwordValid: true,
            tenantId: chosen.tenantId,
          };
        }
      }

      if (!this.repo.findCustomersForLogin) {
        return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
      }
      const candidates = await this.repo.findCustomersForLogin(id);

      // Verify the password against every candidate — a customer may have an account at more than one salon.
      // Always run at least one comparison so a nonexistent account costs the same time as a wrong password.
      const matched: typeof candidates = [];
      let anyPasswordValid = false;
      if (!candidates.length) {
        await verifyPassword(password, DUMMY_HASH).catch(() => false);   // constant-ish work; no user enumeration
      }
      for (const c of candidates) {
        const ok = c.user.passwordHash ? await verifyPassword(password, c.user.passwordHash) : false;
        if (ok) { anyPasswordValid = true; matched.push(c); }
      }

      if (!matched.length) {
        return { result: { outcome: 'INVALID_CREDENTIALS', message: INVALID_MSG }, passwordValid: false, tenantId: null };
      }

      // Password proven. Now the same account/tenant checks every other portal gets.
      const usable = matched.filter((c) => {
        const facts: LoginFacts = {
          tenantFound: true, tenantStatus: c.tenantStatus, userFound: true, passwordValid: true,
          userStatus: c.user.status, subscriptionStatus: c.subscriptionStatus ?? 'active',
          mfaRequired: false, mfaSatisfied: true, branchCount: 1,
        };
        return decideLogin(facts).outcome === 'SUCCESS';
      });

      if (!usable.length) {
        // Every matching account is blocked (disabled user, suspended salon…). Surface the FIRST real reason
        // rather than a generic credential error — the customer's password was right; the account is the problem.
        const c = matched[0];
        const facts: LoginFacts = {
          tenantFound: true, tenantStatus: c.tenantStatus, userFound: true, passwordValid: true,
          userStatus: c.user.status, subscriptionStatus: c.subscriptionStatus ?? 'active',
          ...(await this.mfaFacts(c.user, input.mfaCode, input.ip)), branchCount: 1,
        };
        const d = decideLogin(facts);
        return { result: await this.finish(d, c.user, c.subscriptionStatus ?? 'active'), passwordValid: true, tenantId: c.user.tenantId };
      }

      const chosen = pickDefaultSalon(usable);   // the customer's default salon account (Oct 3 2026)
      return {
        result: await this.finish(decideLogin({
          tenantFound: true, tenantStatus: chosen.tenantStatus, userFound: true, passwordValid: true,
          userStatus: chosen.user.status, subscriptionStatus: chosen.subscriptionStatus ?? 'active',
          ...(await this.mfaFacts(chosen.user, input.mfaCode, input.ip)), branchCount: 1,
        }), chosen.user, chosen.subscriptionStatus ?? 'active'),
        passwordValid: anyPasswordValid,
        tenantId: chosen.user.tenantId,
      };
    }

    if (input.portal === 'super-admin') {
      const { user } = await this.repo.findSuperAdminForLogin(id);
      const passwordValid = !!user?.passwordHash && (await verifyPassword(password, user.passwordHash));
      if (passwordValid && user && user.status === 'invited') {
        user.status = 'active';
        if (this.repo.activateUser) {
          await this.repo.activateUser(user.userId).catch(() => undefined);
        }
      }

      // MANDATORY second factor. SUPER_ADMIN is MFA-required, so a login is NEVER issued without it — not with
      // Remember Me, not with a trusted device. When the SMS OTP port is wired AND this Super Admin has a phone,
      // that factor is a backend-generated six-digit code delivered by SMS: issued+sent on the no-code step,
      // verified on the code step. Otherwise it falls back to the existing TOTP check. Either way mfaRequired stays
      // true, so decideLogin still gates the session on it.
      // Security Deep Scan C8: an ENROLLED authenticator always wins — SMS (the weaker factor, and a reset channel) is used
      // only for a Super Admin who has no confirmed TOTP factor yet. A recovery code still stands in for the authenticator.
      const phone = user ? (user as { phone?: string | null }).phone ?? null : null;
      const useSmsOtp = passwordValid && !!user && !!this.otp && !!phone && !user.totpSecret;
      let mfaSatisfied: boolean;
      let maskedPhone: string | undefined;
      if (useSmsOtp) {
        if (input.mfaCode) {
          // C4: the SMS code shares the account's one attempt budget (its own per-challenge cap still applies)
          mfaSatisfied = await this.budgetedFactor(user!, input.mfaCode, input.ip, () => this.otp!.verify(user!.userId, input.mfaCode!));
        } else {
          mfaSatisfied = false;
          // Issue + send a fresh code (rate-limited in the port). A send failure must not leak anything or wedge
          // the challenge — the user still gets MFA_REQUIRED and can retry or resend.
          try { maskedPhone = (await this.otp!.issueAndSend(user!.userId, phone!)).maskedPhone; } catch { /* swallow send errors */ }
        }
      } else {
        // C4: the Super Admin TOTP path was the one second factor with no budget at all
        mfaSatisfied = passwordValid && user ? await this.budgetedFactor(user, input.mfaCode, input.ip, () => this.checkMfa(user, input.mfaCode)) : false;
      }

      const facts: LoginFacts = {
        tenantFound: true, tenantStatus: 'active',
        userFound: !!user, passwordValid,
        userStatus: user?.status, subscriptionStatus: 'active',
        mfaRequired: user ? mfaRequiredForRole(user.role, { userMfaEnabled: user.mfaEnabled }) : false,
        mfaSatisfied, branchCount: 1,
      };
      const result: LoginResult = { ...(await this.finish(decideLogin(facts), user ?? null, 'active')), mfaVerified: facts.mfaRequired && facts.mfaSatisfied };
      if (result.outcome === 'MFA_REQUIRED' && maskedPhone) result.maskedPhone = maskedPhone;
      return { result, passwordValid, tenantId: null };
    }

    const lookup: LoginLookup = await this.repo.findTenantUserForLogin(input.salonCode || '', id);
    const user = lookup.user ?? null;
    const passwordValid = !!user?.passwordHash && (await verifyPassword(password, user.passwordHash));
    if (passwordValid && user && user.status === 'invited') {
      user.status = 'active';
      if (this.repo.activateUser) {
        await this.repo.activateUser(user.userId).catch(() => undefined);
      }
    }
    // Oct 12 2026 merge (workforce audit P0 #4): a TECHNICIAN whose GLOBAL account is paused/locked/suspended/
    // anonymized/merged cannot sign in at any salon, whatever the per-salon users.status says. Surfaces as USER_DISABLED
    // (the generic, non-enumerating message). A lookup error falls back to users.status, like the revocation and
    // authorization re-checks do — never a self-inflicted outage, never a widening.
    if (user && passwordValid && user.role === 'TECHNICIAN' && this.repo.technicianGlobalStatus) {
      const g = await this.repo.technicianGlobalStatus(user.userId, user.tenantId ?? null).catch(() => null);
      if (g && TECHNICIAN_GLOBAL_BLOCKED.has(String(g).toLowerCase())) user.status = 'suspended';
    }
    const forced = await this.policyForcesMfa(user);
    // Step 10b: an elevated sign-in (new device AND new network) needs the authenticator from anyone who has one
    const risk = passwordValid && user && this.risk ? await this.risk.assess(user.userId, input.deviceKey, input.ip) : undefined;
    const riskForces = risk?.level === 'elevated' && !!user?.totpSecret;
    const mfaRequired = user ? mfaRequiredForRole(user.role, { userMfaEnabled: user.mfaEnabled, tenantForce: (forced && !!user.totpSecret) || riskForces }) : false;
    // C4: a REQUIRED second factor on the staff path is budgeted like every other one (it called checkMfa directly). Only
    // after a correct password — a wrong password is the login throttle's business and must not lock the account's MFA.
    const mfaSatisfied = mfaRequired
      ? (user && passwordValid ? await this.budgetedFactor(user, input.mfaCode, input.ip, () => this.checkMfa(user, input.mfaCode)) : false)
      : await this.checkMfa(user, input.mfaCode);
    const facts: LoginFacts = {
      tenantFound: lookup.tenantFound, tenantStatus: lookup.tenantStatus,
      // Constitution 7 §19: the owner of a salon suspended for a billing-access cause may sign in to billing only
      role: user?.role, suspensionReasonCode: lookup.suspensionReasonCode ?? null,
      userFound: !!user, passwordValid,
      userStatus: user?.status, subscriptionStatus: lookup.subscriptionStatus,
      assignedBranchActive: lookup.assignedBranchActive,
      // Step 9: the salon's policy forces MFA for owners/managers who HAVE an authenticator…
      mfaRequired,
      mfaSatisfied, branchCount: lookup.branchCount,
    };
    const finished = await this.finish(decideLogin(facts), user, lookup.subscriptionStatus ?? 'active', lookup);
    // …and those without one get a session limited to setting it up (MfaEnrollmentGuard) — never a lock-out.
    if (forced && user && !user.totpSecret && finished.outcome === 'SUCCESS' && finished.principal && !finished.principal.restriction) finished.principal.restriction = MFA_ENROLLMENT_REQUIRED;
    return { result: { ...finished, mfaVerified: facts.mfaRequired && facts.mfaSatisfied, ...(risk ? { risk } : {}) }, passwordValid, tenantId: user?.tenantId ?? null };
  }

  /**
   * Constitution 12 §20/§22 (audit finding H4). The MFA facts for a login DECISION. Five decision branches used to
   * hard-code `mfaRequired: false, mfaSatisfied: true`, so an owner or employee who had enabled MFA was never asked
   * for it on the multi-salon and salon-selection paths. Every decision now goes through here; the three salon
   * USABILITY filters keep the literal (they choose a salon, they do not authenticate).
   */
  private async mfaFacts(user: LoginUserRecord | null, code: string | undefined, ip?: string): Promise<{ mfaRequired: boolean; mfaSatisfied: boolean }> {
    const forced = await this.policyForcesMfa(user);
    const mfaRequired = user ? mfaRequiredForRole(user.role, { userMfaEnabled: user.mfaEnabled, tenantForce: forced && !!user.totpSecret }) : false;
    if (!mfaRequired || !user) return { mfaRequired, mfaSatisfied: true };
    // §58 / C4: the ATTEMPT budget is checked before a guess is spent — a locked-out user is refused before their code is
    // even checked, so a correct code submitted while locked out still does not satisfy MFA. Only a FAILURE is kept
    // against the budget; a fast, correct typist is never limited by their own speed.
    return { mfaRequired, mfaSatisfied: await this.budgetedFactor(user, code, ip, () => this.checkMfa(user, code)) };
  }

  // Real TOTP verification when the user has a CONFIRMED factor; otherwise fall back to format validation so a
  // not-yet-enrolled MFA-required account (e.g. the bootstrap super-admin) can still sign in and then enroll.
  // Replay protection: the matched time-step is recorded atomically, so a valid code can't be reused (RFC 6238 §5.2).
  private async checkMfa(user: LoginUserRecord | null, code?: string): Promise<boolean> {
    if (user?.totpSecret) {
      // Constitution 3 §66–67: a recovery code stands in for the authenticator ONCE (it is spent on success).
      if (looksLikeRecoveryCode(code || '') && this.repo.consumeRecoveryCode) return this.repo.consumeRecoveryCode(user.userId, code || '');
      const step = matchedTotpStep(user.totpSecret, code || '', Date.now());
      if (step === null) return false;                       // no code within the ±window matched
      return this.repo.markTotpStepUsed(user.userId, step);  // false if this step was already consumed (replay)
    }
    // No confirmed TOTP factor for this user. In production (or MFA_REQUIRE_TOTP=1) we never accept a bare 6-digit
    // code — the user must enroll a real authenticator (operator bootstrap: scripts/enroll-mfa.ts). In dev/local the
    // permissive fallback keeps testing easy without an authenticator app.
    if (requireRealTotpEnrollment()) return false;
    return isValidMfaCode(code || '');
  }

  private async finish(decision: LoginDecision, user: LoginUserRecord | null, sub: SubStatus, lookup?: LoginLookup): Promise<LoginResult> {
    const authed = decision.outcome === 'SUCCESS' || decision.outcome === 'BRANCH_SELECTION_REQUIRED';
    if (!authed || !user) return { outcome: decision.outcome, message: decision.message };
    // BUILD_PLAN Phase 9: the versions are read BEFORE the permissions, so a change landing in between leaves the session
    // with the OLD version — the next request sees it stale and re-authorizes (never the other way round).
    const versions = this.repo.authorizationVersions ? await this.repo.authorizationVersions(user.userId, user.tenantId ?? null).catch(() => null) : null;
    let outcome = decision.outcome; let message = decision.message;
    let branchId: string | null = outcome === 'BRANCH_SELECTION_REQUIRED' ? null : (user.branchId || lookup?.singleBranchId || null);
    // Template scope at sign-in (Kevin's decision (1)): a BRANCH / SELECTED_BRANCHES person lands only in a branch they may
    // enter. One allowed branch → that one; several → the picker (which lists only those); none allowed here → the picker.
    if (branchId && user.tenantId && user.role !== 'SUPER_ADMIN' && user.role !== 'CUSTOMER' && this.repo.enterableBranchesFor) {
      const allowed = await this.repo.enterableBranchesFor(user.tenantId, user.userId, user.role).catch(() => null);
      if (allowed && !allowed.includes(branchId)) {
        if (allowed.length === 1) branchId = allowed[0];
        else { branchId = null; outcome = 'BRANCH_SELECTION_REQUIRED'; message = 'Select the branch you want to work in.'; }
      }
    }
    const needsBranchSelection = outcome === 'BRANCH_SELECTION_REQUIRED';
    return {
      outcome,
      message,
      principal: {
        userId: user.userId,
        tenantId: user.tenantId,
        branchId,
        role: user.role,
        ...(decision.restriction ? { restriction: decision.restriction } : {}),
        ...(await (async () => { const platformRole = await this.platformRoleAt(user); return { permissions: await this.permissionsAt(user, platformRole), ...(platformRole ? { platformRole } : {}) }; })()),
        subscriptionStatus: sub,
        needsBranchSelection,
        fullName: user.fullName,
        ...(versions ? { av: versions.av, tv: versions.tv } : {}),
      },
    };
  }
  /**
   * The permissions this principal actually carries in THIS salon.
   *
   * Role defaults for everyone, plus — for a TECHNICIAN — the salon's own overrides from
   * `technician_permissions` (migration 377). Until now the POS's permission screen accepted a manager's toggles,
   * returned 200, and stored nothing; even once stored, they would have changed nothing, because the session was
   * minted from `permissionsFor(role)` alone and never looked.
   *
   * FAIL-SAFE, and the direction matters: if the override lookup throws, the principal falls back to the ROLE
   * DEFAULTS. A database blip must never grant a technician more than their role, and must never lock one out of
   * the app either. It can only ever fail back to the behaviour that existed before this line was written.
   */
  /**
   * Constitution 7 §5 — a platform account's role. FAIL-SAFE the other way round from technicians: the role default for
   * SUPER_ADMIN is EVERYTHING, so a missing or unreadable platform role falls back to read-only (PLATFORM_AUDITOR),
   * never to the full set.
   */
  private async platformRoleAt(user: { role: Role; userId: string }): Promise<PlatformRole | undefined> {
    if (user.role !== 'SUPER_ADMIN') return undefined;
    try {
      const r = this.repo.platformRoleOf ? await this.repo.platformRoleOf(user.userId) : 'PLATFORM_SUPER_ADMIN';
      return isPlatformRole(r) ? r : PLATFORM_FALLBACK_ROLE;
    } catch {
      return PLATFORM_FALLBACK_ROLE;
    }
  }

  /**
   * What a STAFF or PLATFORM session may carry right now — asked on every token refresh (Oct 6 2026). A refresh used to
   * re-sign the expired token's claims as they were, so a demotion, a narrowed role template, a removed technician
   * permission or a suspended account only took effect when the session ended: 12 hours, or 30 days with "remember me".
   * Now: an account that is gone, no longer active, or moved to another role or salon ends the session (sign in again);
   * otherwise the permissions are recomputed exactly as at sign-in. Customers carry no staff permissions — unchanged.
   * Returns null when this repository cannot answer (the refresh then behaves as before).
   */
  /** BUILD_PLAN Phase 9: the versions to mint into a refreshed token (null when the repository cannot answer). */
  async authorizationVersions(claims: { userId: string; role: string; tenantId?: string | null }): Promise<{ av: number; tv: number | null } | null> {
    if (claims.role === 'CUSTOMER' || !this.repo.authorizationVersions) return null;
    return this.repo.authorizationVersions(claims.userId, claims.tenantId ?? null);
  }

  async currentAuthorization(claims: { userId: string; role: string; tenantId?: string | null; branchId?: string | null }):
    Promise<{ ok: true; permissions: string[] } | { ok: false; reason: 'account_gone' | 'account_inactive' | 'role_changed' | 'branch_access_changed' } | null> {
    if (claims.role === 'CUSTOMER' || !this.repo.userStateForRefresh) return null;
    const u = await this.repo.userStateForRefresh(claims.userId);
    if (!u) return { ok: false, reason: 'account_gone' };
    if (u.status !== 'active') return { ok: false, reason: 'account_inactive' };
    if (u.role !== claims.role || (u.tenantId ?? null) !== (claims.tenantId ?? null)) return { ok: false, reason: 'role_changed' };
    // BUILD_PLAN Phase 9: the session's branch must still be one this person may enter (template scope / branch access) —
    // otherwise a refresh would re-mint a session in a branch they were just taken out of.
    if (claims.branchId && u.tenantId && u.role !== 'SUPER_ADMIN' && this.repo.enterableBranchesFor) {
      const allowed = await this.repo.enterableBranchesFor(u.tenantId, claims.userId, u.role);
      if (allowed && !allowed.includes(claims.branchId)) return { ok: false, reason: 'branch_access_changed' };
    }
    const user = { role: u.role as Role, userId: claims.userId, tenantId: u.tenantId };
    return { ok: true, permissions: await this.permissionsAt(user, await this.platformRoleAt(user)) };
  }

  /**
   * BUILD_PLAN Phase 13 D (Constitution 6 §37): a biometric sign-in opens a NEW session from the scope captured at
   * enrolment — so it is authorized exactly like a token refresh: the account must still be active, in the same role and
   * salon, allowed in the branch; the permissions and authorization versions are what the account may do NOW. A customer
   * carries the CUSTOMER role defaults (as at password sign-in). Never trusts a permission list from storage.
   */
  async authorizeResume(claims: { userId: string; role: string; tenantId?: string | null; branchId?: string | null }):
    Promise<{ ok: true; permissions: string[]; av?: number; tv?: number | null } | { ok: false; reason: string }> {
    if (claims.role === 'SUPER_ADMIN') return { ok: false, reason: 'realm_not_allowed' };
    const user = { role: claims.role as Role, userId: claims.userId, tenantId: claims.tenantId ?? null };
    if (claims.role === 'CUSTOMER') return { ok: true, permissions: await this.permissionsAt(user) };
    const versions = await this.authorizationVersions(claims).catch(() => null);
    const now = await this.currentAuthorization(claims);
    if (now && !now.ok) return { ok: false, reason: now.reason };
    const permissions = now?.ok ? now.permissions : await this.permissionsAt(user);
    return { ok: true, permissions, ...(versions ? { av: versions.av, tv: versions.tv } : {}) };
  }

  private async permissionsAt(user: { role: Role; userId: string; tenantId: string | null }, platformRole?: PlatformRole): Promise<string[]> {
    if (user.role === 'SUPER_ADMIN' && platformRole) return platformPermissionsFor(platformRole);
    const base = permissionsFor(user.role);
    // Functional Decision 12: a staff member's ROLE TEMPLATE (Accountant, Inventory Manager, a salon's own roles, …) —
    // always a subset of the base role, and FAIL-SAFE: no template, an archived one, a base-role mismatch or any error
    // falls back to the base-role defaults exactly as before this line existed.
    if (user.role !== 'TECHNICIAN' && user.tenantId && this.repo.staffTemplatePermissions) {
      try {
        const t = await this.repo.staffTemplatePermissions(user.tenantId, user.userId, user.role);
        if (t) { const allowed = new Set<string>(base); return t.filter((p) => allowed.has(p)); }
      } catch { /* base-role defaults */ }
      return base;
    }
    if (user.role !== 'TECHNICIAN' || !user.tenantId || !this.repo.techPermissionOverrides) return base;
    try {
      const overrides = await this.repo.techPermissionOverrides(user.tenantId, user.userId);
      return effectiveTechPermissions(base, overrides);
    } catch {
      return base;
    }
  }

}
