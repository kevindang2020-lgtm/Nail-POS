// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the request-body schemas of the identity module's mutating routes,
// applied with @Body(ValidatedBody(SCHEMA)). Each was written from the handler (which fields it reads, how) AND from every
// client that calls the route today (pos-web, owner-web, admin-web, tech-web, customer-web, manager-pay-web, the legacy
// booking HTML apps, packages/api-client + mobile-sdk) — so every body sent today still passes. Unknown fields are
// stripped; tenantId / permissions / platformRole sent where undeclared are refused.
//
// Handlers here coerce with String(b?.x ?? ''), so a scalar field accepts a string, a number or null (what String()
// accepted before) — but never an object or an array, and never an unbounded length.
import { S, type BodySchema } from '@aipowersalon/permissions';

/** a scalar a handler String()-coerces: string | number | null, strings bounded */
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
/** a password / secret field: a string (or absent / null), bounded so a 1 MB "password" never reaches the hasher */
const secret = (max = 1024): BodySchema => ({ type: ['string', 'null'], maxLength: max });
const flag: BodySchema = { type: ['boolean', 'string', 'number', 'null'], maxLength: 10 };

/** POST /auth/login — every portal's sign-in screen + the native apps' device identity */
export const LOGIN_BODY: BodySchema = S.object({
  portal: scalar(32), salonCode: scalar(64), identifier: scalar(320), email: scalar(320), phone: scalar(32),
  password: secret(), mfaCode: scalar(32), ownerAccessCode: scalar(128), rememberMe: flag,
  device: S.nullable(S.object({ id: S.nullable(S.text(200)), name: S.nullable(S.text(200)), platform: S.nullable(S.text(32)) })),
});
/** POST /auth/refresh — {} on the web (cookie), { refreshToken } from the native apps (packages/api-client) */
export const REFRESH_BODY: BodySchema = S.object({ refreshToken: secret(4096) });
/** POST /auth/select-branch — { branchId } (pos / owner / tech / customer apps); the aliases the handler reads */
export const SELECT_BRANCH_BODY: BodySchema = S.object({ branchId: scalar(64), id: scalar(64), branch_id: scalar(64), selectedBranchId: scalar(64), deviceId: scalar(128) });   // deviceId: manager-pay §120 (the payment guard's lookup; never an authorization)
/** POST /auth/verify-pin and /auth/set-pin — { pin } (pos-web lock screen / security settings) */
/** POST /auth/verify-pin { pin } and /auth/set-pin { pin, currentPassword | currentPin } — re-authentication is required to set a PIN (Oct 12 2026 merge) */
export const PIN_BODY: BodySchema = S.object({ pin: scalar(32), currentPassword: secret(), currentPin: secret() });
/** POST /auth/change-password — pos / admin / tech settings */
export const CHANGE_PASSWORD_BODY: BodySchema = S.object({ currentPassword: secret(), newPassword: secret(), confirmPassword: secret(), mfaCode: scalar(32) });
/** POST /customer/me/security/password/create|change — customer-web Profile → Security */
export const CUSTOMER_PASSWORD_BODY: BodySchema = S.object({ currentPassword: secret(), newPassword: secret(), confirmPassword: secret() });
/** POST /auth/mfa/confirm and /auth/mfa/recovery-codes — { code } */
export const MFA_CODE_BODY: BodySchema = S.object({ code: scalar(32) });
/** POST /public/mfa-recovery/start — { token, password }; /confirm — { token, code } (admin-web) */
export const MFA_RECOVERY_START_BODY: BodySchema = S.object({ token: scalar(512), password: secret() });
export const MFA_RECOVERY_CONFIRM_BODY: BodySchema = S.object({ token: scalar(512), code: scalar(32) });
/** POST /public/security/not-me — { token } (pos-web link screen) */
export const TOKEN_BODY: BodySchema = S.object({ token: scalar(512) });
/** POST /auth/password-reset/request — { salonCode, phone } (owner / tech / manager-pay / customer) */
export const RESET_REQUEST_BODY: BodySchema = S.object({ salonCode: scalar(64), phone: scalar(32) });
/** POST /auth/password-reset/temp-login — { tenantCodeOrSlug | salonCode, emailOrPhone, password } */
export const RESET_TEMP_LOGIN_BODY: BodySchema = S.object({ tenantCodeOrSlug: scalar(64), salonCode: scalar(64), emailOrPhone: scalar(320), password: secret() });
/** POST /auth/password-reset/complete — { resetSessionToken, newPassword, confirmPassword } */
export const RESET_COMPLETE_BODY: BodySchema = S.object({ resetSessionToken: scalar(512), newPassword: secret(), confirmPassword: secret() });
/** POST /auth/super-admin/forgot-password — { emailOrPhone, deliveryMethod } */
export const SA_FORGOT_BODY: BodySchema = S.object({ emailOrPhone: scalar(320), deliveryMethod: scalar(16) });
/** POST /auth/admin/reset-user-password — { targetUserId, deliveryMethod, reason } */
export const ADMIN_RESET_BODY: BodySchema = S.object({ targetUserId: scalar(64), deliveryMethod: scalar(16), reason: scalar(1000) });
/** POST /auth/temp-password-login — { emailOrPhone, tenantCodeOrSlug | salonCode, password } */
export const TEMP_PASSWORD_LOGIN_BODY: BodySchema = S.object({ emailOrPhone: scalar(320), tenantCodeOrSlug: scalar(64), salonCode: scalar(64), password: secret() });
/** POST /auth/change-temporary-password — { changePasswordSessionId, newPassword, confirmPassword } */
export const CHANGE_TEMP_PASSWORD_BODY: BodySchema = S.object({ changePasswordSessionId: scalar(512), newPassword: secret(), confirmPassword: secret() });
/** POST /pos/staff-roles — pos-web Team → Roles: { name, baseRole, scope, permissions[] } (permissions IS the payload here) */
export const CREATE_STAFF_ROLE_BODY: BodySchema = S.object({
  name: scalar(80), baseRole: scalar(40), scope: scalar(40),
  permissions: S.nullable(S.array(S.text(120), { maxItems: 500 })),
});

// ── Phase 12 round 2: Face ID (WebAuthn) ceremonies (packages/mobile-sdk webauthn.ts) and customer self-registration
// (customer-web RegisterScreen) ─────────────────────────────────────────────────────────────────────────────────────
/** a base64url WebAuthn blob (attestation objects can run to a few KB) */
const blob = (max = 16384): BodySchema => ({ type: ['string', 'null'], maxLength: max });
export const WEBAUTHN_REGISTER_FINISH_BODY: BodySchema = S.object({
  handle: scalar(512), credentialId: scalar(1024), publicKey: blob(), clientDataJSON: blob(), attestationObject: blob(), transports: scalar(200), deviceLabel: scalar(200),
});
export const WEBAUTHN_AUTH_BEGIN_BODY: BodySchema = S.object({ tenantCodeOrSlug: scalar(128), emailOrPhone: scalar(320) });
export const WEBAUTHN_AUTH_FINISH_BODY: BodySchema = S.object({ handle: scalar(512), credentialId: scalar(1024), clientDataJSON: blob(), authenticatorData: blob(), signature: blob() });
export const CUSTOMER_REGISTER_BODY: BodySchema = S.object({ salonCode: scalar(64), salonId: scalar(64), firstName: scalar(100), lastName: scalar(100), email: scalar(320), phone: scalar(40), password: secret(), referralCode: scalar(64) });

// BUILD_PLAN Phase 13 D (Constitution 6 §37–39): the biometric device credential (biometric.controller.ts)
export const BIOMETRIC_ENROLL_BODY: BodySchema = S.object({ deviceId: scalar(128), deviceName: scalar(80), platform: scalar(16) });
export const BIOMETRIC_LOGIN_BODY: BodySchema = S.object({ credentialId: scalar(64), deviceId: scalar(128), secret: secret(256) });
export const BIOMETRIC_REVOKE_BODY: BodySchema = S.object({ deviceId: scalar(128) });
