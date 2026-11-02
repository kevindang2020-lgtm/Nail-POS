/**
 * auth.module.ts — wires the auth controller + login orchestrator. Uses the Kysely AuthUserRepository when a Postgres
 * handle exists (REPO_DRIVER=postgres), otherwise an in-memory repo seeded EMPTY — so with no database, login simply
 * authenticates no one (it never fakes a successful sign-in).
 */
import { KyselyLoginRisk } from './login-risk';
import { SecurityNotifications } from './security-notifications';
import { SecurityNotMeController } from './security-not-me.controller';
import { PlatformDeviceTrust } from './platform-device-trust';   // S-A13: trusted device for platform sign-in
import { PlatformDeviceApprovalController } from './platform-device-approval.controller';
import { emailFromEnv } from '../invitations/invitation-delivery.service';
import { KyselyTenantAuthPolicy } from './tenant-auth-policy';
import { MFA_ATTEMPT_LIMITER, type KeyedRateLimiter } from '@aipowersalon/security';
import { MFA_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { refreshDeviceGuardResolver } from './refresh-device-guard';
import { SecurityEvents } from '@aipowersalon/security-center';
import { PostgresAttemptBudget, attemptLockoutRecorder } from './auth-attempt-budget';
import { AuthController } from './auth.controller';
import { BiometricController } from './biometric.controller';   // BUILD_PLAN Phase 13 D: Face ID device credential
import { LoginService } from './auth-login.service';
import { makeLoginThrottle } from './login-throttle-redis';
import { KyselyLoginAttemptSink, InMemoryLoginAttemptSink } from './login-attempt-sink';
import { KyselySessionStore, InMemorySessionStore } from './session-store';
import { RefreshSessionService, KyselyRefreshRepository, InMemoryRefreshRepository } from './refresh-session';
import { KyselyAuthDevices } from './auth-devices';
import { KyselyAuthEvents } from './auth-events';
import { AuthDevicesController } from './auth-devices.controller';
import { AuthActivityController } from './auth-activity.controller';
import { InMemoryAuthUserRepository, type AuthUserRepository, type AuthSeed } from './auth-user.repository';
import { KyselyAuthUserRepository } from './auth-user.kysely.repository';
import { BranchSelectionService, InMemoryBranchAccessRepository, type BranchAccessPort } from './branch-access';
import { KyselyBranchAccessRepository } from './branch-access.kysely.repository';
import { SuperAdminOtpService } from './super-admin-login-otp';
import { KyselySuperAdminOtpStore } from './super-admin-login-otp.kysely';
import { type SmsSender, TENANT_MESSENGER, type TenantMessenger, platformSmsSender, smsSenderFromEnv } from '@aipowersalon/notifications';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AUTHZ_DENIAL_SINK } from '@aipowersalon/permissions/guards';
import { AUTHORIZATION_STATE, AuthorizationStateCache, KyselyAuthorizationStatePort } from './authorization-state';
import { KyselyAuthzDenialSink } from './authorization-denials';

const EMPTY_SEED: AuthSeed = { tenants: [], users: [], subscriptions: [], branches: [] };

// SMS goes through Twilio when the TWILIO_* env is set, otherwise a MockSmsSender (dev/test) — same rule the
// password-reset and system-reset modules use. When SMS is not configured, the super-admin second factor falls
// back to TOTP (the OTP service still exists; a MockSmsSender simply captures the send instead of dispatching it).
function smsFromEnv(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}

@Module({
  controllers: [AuthController, AuthDevicesController, AuthActivityController, SecurityNotMeController, PlatformDeviceApprovalController, BiometricController],
  providers: [
    { provide: 'AuthUserRepository', useFactory: (db: AppDatabase, mfa: ProviderSecrets): AuthUserRepository => (db ? new KyselyAuthUserRepository(db, mfa) : new InMemoryAuthUserRepository(EMPTY_SEED)), inject: [DATABASE, MFA_SECRETS] },
    { provide: LoginService,
      useFactory: (repo: AuthUserRepository, db: AppDatabase, mfaLimiter: KeyedRateLimiter, messenger?: TenantMessenger, securityEvents?: SecurityEvents) =>
        // The attempt sink writes to the existing `login_attempts` table, which the Super Admin Security screens
        // read. Before this it was never written to, so those metrics were always zero. The 4th arg is the
        // mandatory Super Admin SMS second factor — wired only with a real database (it persists the hashed code).
        new LoginService(repo, makeLoginThrottle(),
          db ? new KyselyLoginAttemptSink(db) : new InMemoryLoginAttemptSink(),
          db ? new SuperAdminOtpService(new KyselySuperAdminOtpStore(db), platformSmsSender(messenger, smsFromEnv)) : undefined,
          // Security Deep Scan C4: with a database the second-factor budget is the Postgres one (works without Redis, on
          // every replica); without one, the injected limiter as before.
          db ? new PostgresAttemptBudget(db, { onLockout: attemptLockoutRecorder(securityEvents) }) : mfaLimiter,
          db ? new KyselyTenantAuthPolicy(db) : undefined,
          db ? new KyselyLoginRisk(db) : undefined),   // Constitution 3 Step 10b: risk signals   // Constitution 3 Step 9: the salon's sign-in policy. Constitution 12 §58: TOTP guesses during login are budgeted per user (the limiter is the API's, injected)
      inject: ['AuthUserRepository', DATABASE, MFA_ATTEMPT_LIMITER, { token: TENANT_MESSENGER, optional: true }, { token: SecurityEvents, optional: true }] },
    { provide: 'SessionStore',
      // Oct 12 2026 (Kevin): the store idle-locks a salon's POS session after the salon's auto-lock minutes (default on, 60).
      useFactory: (db: AppDatabase) => {
        if (!db) return new InMemorySessionStore();
        const policy = new KyselyTenantAuthPolicy(db);
        return new KyselySessionStore(db, { idleLockPolicy: async (tenantId) => { const p = await policy.get(tenantId); return { enabled: p.autoLockEnabled, minutes: p.autoLockMinutes }; } });
      },
      inject: [DATABASE] },
    // Constitution 3 Step 2: refresh-token rotation on refresh_tokens; the session store is the family's revoker.
    // Secure Tap to Pay M6-6: a session opened on a payment phone is extended only while the phone is in good standing —
    // REFRESH_DEVICE_GUARD (provided by the module owning mobile_pay_devices) is looked up lazily; identity never imports it.
    { provide: RefreshSessionService,
      useFactory: (db: AppDatabase, sessions: any, moduleRef: ModuleRef) => new RefreshSessionService(db ? new KyselyRefreshRepository(db) : new InMemoryRefreshRepository(), sessions ?? null, undefined, refreshDeviceGuardResolver(moduleRef)),
      inject: [DATABASE, 'SessionStore', ModuleRef] },
    // Constitution 3 Step 4: the devices ledger (absent without a database — sign-in then simply records no device)
    { provide: KyselyAuthDevices, useFactory: (db: AppDatabase) => (db ? new KyselyAuthDevices(db) : null), inject: [DATABASE] },
    // Constitution 3 Step 5: the auth event log (absent without a database — events are then simply not recorded)
    { provide: KyselyAuthEvents, useFactory: (db: AppDatabase) => (db ? new KyselyAuthEvents(db) : null), inject: [DATABASE] },
    // Constitution 3 Step 9: the salon's sign-in policy, for devices / WebAuthn / PIN unlock
    // Constitution 3 Step 10a: new-device alerts + the "This wasn't me" link (email via SendGrid when configured)
    { provide: SecurityNotifications, useFactory: (db: AppDatabase) => (db ? new SecurityNotifications(db, emailFromEnv()) : null), inject: [DATABASE] },
    // S-A13 (Security Deep Scan §29 / §136): platform sign-in only from an approved device (absent without a database)
    { provide: PlatformDeviceTrust, useFactory: (db: AppDatabase) => (db ? new PlatformDeviceTrust(db, emailFromEnv()) : null), inject: [DATABASE] },
    { provide: KyselyTenantAuthPolicy, useFactory: (db: AppDatabase) => (db ? new KyselyTenantAuthPolicy(db) : null), inject: [DATABASE] },
    { provide: 'BranchAccessPort', useFactory: (db: AppDatabase): BranchAccessPort => (db ? new KyselyBranchAccessRepository(db) : new InMemoryBranchAccessRepository()), inject: [DATABASE] },
    { provide: BranchSelectionService, useFactory: (repo: BranchAccessPort) => new BranchSelectionService(repo), inject: ['BranchAccessPort'] },
    // BUILD_PLAN Phase 9: the request path's view of what a person may do NOW (versions, grants, overrides, branch access),
    // cached ≤ 30 s per user and dropped in-process by whoever changes it. Absent without a database (the middleware then
    // trusts the verified session exactly as before).
    { provide: AUTHORIZATION_STATE, useFactory: (db: AppDatabase) => (db ? new AuthorizationStateCache(new KyselyAuthorizationStatePort(db)) : null), inject: [DATABASE] },
    // BUILD_PLAN Phase 9: where the tenant permission guard records refusals (authorization_denials, sampled)
    { provide: AUTHZ_DENIAL_SINK, useFactory: (db: AppDatabase) => (db ? new KyselyAuthzDenialSink(db) : null), inject: [DATABASE] },
  ],
  exports: ['SessionStore', LoginService, RefreshSessionService, KyselyAuthDevices, PlatformDeviceTrust, KyselyAuthEvents, KyselyTenantAuthPolicy, AUTHORIZATION_STATE, AUTHZ_DENIAL_SINK],
})
export class AuthModule {}
