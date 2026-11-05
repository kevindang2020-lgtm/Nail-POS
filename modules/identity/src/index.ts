// modules/identity — the identity domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { AuthModule } from './auth/auth.module';
export { MfaModule } from './auth/mfa.module';
export { PasswordResetModule } from './auth/password-reset.module';
export { SystemResetModule } from './auth/system-reset.module';
export { WebAuthnModule } from './auth/webauthn.controller';
export * from './auth/password-reset.dto';
export * from './auth/webauthn.dto';
export { signSession, verifySession, audienceFor } from './auth/auth-session-token';   // used by the API today
export { KyselyAuthUserRepository } from './auth/auth-user.kysely.repository';   // used by the API today
export { loginResponse, selectBranchResponse } from './auth/auth.http';   // used by the API today
export { BranchSelectionService } from './auth/branch-access';   // used by the API today
export { nativeOrigins, shouldReturnToken } from './auth/native-client';   // used by the API today
export { makeKyselyResetPorts } from './auth/password-reset.ports.kysely';   // used by the API today
export { PasswordResetService } from './auth/password-reset.service';   // used by the API today
export { existingTechnicianPasswordHash, propagateTechnicianPassword, technicianPasswordPeers } from './auth/password-scope';   // used by the API today
export { SESSION_COOKIE, REALM_COOKIE, ALL_REALM_COOKIES, cookieNameFor, realmForPath, readSessionToken, sessionFromRequest } from './auth/session-from-request';   // used by the API today
export { InMemorySessionStore, SessionStore, SESSION_LOCK_MAX_MS } from './auth/session-store';   // used by the API today (SESSION_LOCK_MAX_MS: Decision 35)
export { SuperAdminOtpService } from './auth/super-admin-login-otp';   // used by the API today
export { KyselySuperAdminOtpStore } from './auth/super-admin-login-otp.kysely';   // used by the API today
export { matchedTotpStep } from './auth/totp';   // used by the API today
export { isNativeClient } from './auth/native-client';   // used by the API's CORS guard
// Invitations (token minting, notifier rules, delivery): moved from the Super Admin control plane — identity owns them, and
// the technician domain needs them without depending on the control plane (Constitution 13: that closed a module cycle).
export * from './invitations/invitation-token-core';
export * from './invitations/invitation-notifier-core';
export * from './invitations/invitation-delivery.service';
// joined by --into (customer-registration, customer-security):
export { CustomerRegistrationModule } from './customer-registration/customer-registration.module';
export { CustomerSecurityModule } from './customer-security/customer-security.module';
export * from './customer-registration/customer-registration.dto';
export { verifyTotp, totpCode, generateSecret } from './auth/totp';   // Constitution 7 §8: the API's step-up re-verifies a TOTP code (totpCode/generateSecret: tests)
export { decideLogin, ownerBillingAllowed } from './auth/auth-flow';   // Constitution 7 §19 — the API's billing-only session test
export { StaffRolesService, KyselyStaffRolesStore, InMemoryStaffRolesStore, StaffRoleError, LAST_OWNER, lastOwnerError, isOwnerBase, assertNotLastOwner, type RoleChange, type AuthorizationRecorder, type StaffRolesStore, type RoleView, type StaffActor, type CustomRoleRow, type StaffRolesAudit } from './staff-roles/staff-roles';   // Functional Decision 12 — staff role templates
export { StaffRolesModule } from './staff-roles/staff-roles.module';   // Functional Decision 12 — POS staff-roles endpoints
export { KyselyAuthEvents, InMemoryAuthEvents, scrubAuthMetadata, maskIdentifier, AUTH_EVENT_TYPES, type AuthEvent, type AuthEventType, type AuthEventSink } from './auth/auth-events';   // Constitution 3 Step 5
export { AUTHORIZATION_STATE, AuthorizationStateCache, KyselyAuthorizationStatePort, authorizeSession, isStale, narrowByBranchRole, grantFor, currentAuthorizationVersions, enterableBranchesForUser, type AuthorizationState, type AuthorizationStatePort, type SessionAuthorization, type SessionAuthzClaims } from './auth/authorization-state';   // BUILD_PLAN Phase 9: authorization versions on the request path
export { KyselyAuthzDenialSink } from './auth/authorization-denials';   // BUILD_PLAN Phase 9: denial metrics
export { recordAuthorizationChange, type AuthorizationChange, type AuthorizationAction } from './auth/authorization-audit';   // BUILD_PLAN Phase 9: authorization audit + AUTHORIZATION_CHANGED
export { SESSION, USER_ACCOUNT } from './auth/identity-lifecycles';   // Phase 12 (#27): booking, super-admin, workforce, apps/api
