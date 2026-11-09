// mobile-checkout.module.ts — wires the Owner & Manager Payment App backend. Reuses the canonical PaymentGatewayResolver
// (same construction pattern as checkout/webhook modules) rather than introducing a second merchant lookup, the canonical
// checkout repository for the money (mobile-capture-recorder), the ONE realtime emitter, the ONE outbox, the ONE audit
// service, the Super Admin kill-switch rows and the session step-up stamp.
import { ENTITLEMENT_SERVICE, type EntitlementService } from '@aipowersalon/permissions';
import { ServingService, ServingModule } from '@aipowersalon/queue';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { AuditService } from '@aipowersalon/audit';
import { PushModule, PushService } from '@aipowersalon/communications';
import { CheckoutModule } from '../checkout/checkout.module';
import { CheckoutService } from '../checkout/checkout.service';
import type { CheckoutRepositoryPort } from '../checkout/checkout.repository';
import { CheckoutLockModule } from '../checkout-lock/checkout-lock.module';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { MobileCheckoutController } from './mobile-checkout.controller';
import { MobileCheckoutService, type StepUpReadPort } from './mobile-checkout.service';
import { TtpOnboardingAdminController } from './ttp-onboarding.controller';
import { PaymentDeviceOversightController } from './payment-device-oversight';   // Secure Tap to Pay §51 (Oct 27): the platform panel
import { type TtpOnboardingStore, InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { KyselyTtpOnboardingStore } from './ttp-onboarding.kysely';
import { type MobilePayDeviceStore, InMemoryMobilePayDeviceStore, refreshBlockFor } from './mobile-pay-device';
import { KyselyMobilePayDeviceStore, type DeviceSessionRevoker } from './mobile-pay-device.kysely';
import { type TapToPaySessionPort } from './tap-to-pay-session';
import { FiservCommerceHubTtpAdapter } from './fiserv-commercehub-ttp.adapter';
import { type MobilePaymentAttemptPort, KyselyMobilePaymentAttemptRepository, InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { KyselyTapToPayKillSwitch, InMemoryTapToPayKillSwitch, type TapToPayKillSwitchPort } from './ttp-kill-switch';
import { MobileAttemptRecoveryScheduler } from './mobile-attempt-recovery.scheduler';
import { DeviceProofGuard } from './device-proof.guard';
import { KyselyDevicePairingStore, InMemoryDevicePairingStore } from './device-pairing';
import { DeviceSecuritySignals } from './device-security-signals';
import { SecurityEvents } from '@aipowersalon/security-center';
import { PaymentChannelsController, PAYMENT_CHANNELS_CENTER } from '../payment-channels/payment-channels.controller';   // Three Ways to Pay (Nov 9 2026)
import { PaymentChannelsCenter } from '../payment-channels/payment-channels-center';

/** §17 / §184: the session's step-up stamp — the same sessions row apps/api StepUpGuard reads. Fail closed. */
export class KyselyStepUpRead implements StepUpReadPort {
  constructor(private readonly db: any) {}
  async isFresh(sessionId: string | null | undefined, userId: string, maxAgeSeconds: number, tenantId: string): Promise<boolean> {
    if (!this.db || !sessionId || !userId || !tenantId) return false;
    const r: any = await sql`select (last_step_up_at is not null and last_step_up_at > now() - (${maxAgeSeconds} * interval '1 second')) as fresh
                               from sessions where tenant_id = ${tenantId} and id = ${sessionId} and user_id = ${userId} and revoked_at is null limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    return !!r?.rows?.[0]?.fresh;
  }
}

/** Mandate §120: the token the platform's ONE branch switch (POST /auth/select-branch, modules/identity
 *  auth/branch-switch-guard.ts BRANCH_SWITCH_GUARD) looks up through ModuleRef — a string token, so checkout does not import
 *  identity's internals and identity never imports checkout. The answer: "finish or cancel the active payment first". */
export const BRANCH_SWITCH_GUARD_TOKEN = 'BRANCH_SWITCH_GUARD';
/** Secure Tap to Pay M6-6: identity's refresh rotation (auth/refresh-device-guard.ts REFRESH_DEVICE_GUARD) asks this before
 *  it extends a session opened on a payment phone — revoked / compromised ends it, suspended refuses the refresh. A store
 *  error propagates: identity fails the refresh closed. */
export const REFRESH_DEVICE_GUARD_TOKEN = 'REFRESH_DEVICE_GUARD';

/** M6-5: identity's session store, by its string token (null — said once per revoke — in an app slice without AuthModule). */
function sessionStoreOf(moduleRef: ModuleRef): DeviceSessionRevoker | null {
  try { return moduleRef.get<DeviceSessionRevoker>('SessionStore', { strict: false }) ?? null; }
  catch (e) {
    console.warn('[device-revoke] no SessionStore in this app — a revoked phone\'s sessions end through their database rows only:', (e as Error)?.message);
    return null;
  }
}

@Module({
  imports: [ServingModule, CheckoutModule, CheckoutLockModule, EventsCoreModule, PushModule],
  controllers: [MobileCheckoutController, TtpOnboardingAdminController, PaymentDeviceOversightController, PaymentChannelsController],
  providers: [
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: 'MobilePaymentAttemptPort', useFactory: (db: AppDatabase): MobilePaymentAttemptPort => (db ? new KyselyMobilePaymentAttemptRepository(db) : new InMemoryMobilePaymentAttemptRepository()), inject: [DATABASE] },
    { provide: 'TtpOnboardingStore', useFactory: (db: AppDatabase): TtpOnboardingStore => (db ? new KyselyTtpOnboardingStore(db) : new InMemoryTtpOnboardingStore()), inject: [DATABASE] },
    // M6-5: a revoked phone's sessions end in the API's session store too (identity's 'SessionStore', looked up lazily by
    // its string token — checkout does not import identity's module; absent in a slice without AuthModule → DB only)
    { provide: 'MobilePayDeviceStore', useFactory: (db: AppDatabase, moduleRef: ModuleRef): MobilePayDeviceStore => (db ? new KyselyMobilePayDeviceStore(db, () => sessionStoreOf(moduleRef)) : new InMemoryMobilePayDeviceStore()), inject: [DATABASE, ModuleRef] },
    { provide: 'TapToPaySessionPort', useFactory: (): TapToPaySessionPort => new FiservCommerceHubTtpAdapter(), inject: [] },
    // Secure Tap to Pay §51: device counters + security events through the ONE recorder (SecurityEventsModule is @Global)
    { provide: 'DeviceSecuritySignals', useFactory: (events?: SecurityEvents | null) => new DeviceSecuritySignals(events ?? null), inject: [{ token: SecurityEvents, optional: true }] },
    { provide: 'TapToPayKillSwitchPort', useFactory: (db: AppDatabase): TapToPayKillSwitchPort => (db ? new KyselyTapToPayKillSwitch(db) : new InMemoryTapToPayKillSwitch()), inject: [DATABASE] },
    {
      provide: MobileCheckoutService,
      useFactory: (db: AppDatabase, gw: PaymentGatewayResolver, checkout: CheckoutService, locks: CheckoutLockService, attempts: MobilePaymentAttemptPort, onboarding: TtpOnboardingStore, devices: MobilePayDeviceStore, ttp: TapToPaySessionPort, serving: ServingService,
        repo: CheckoutRepositoryPort, realtime: RealtimeEmitter, outbox: OutboxWriter, killSwitch: TapToPayKillSwitchPort, signals: DeviceSecuritySignals, audit?: AuditService | null, push?: PushService | null, featureFlags?: EntitlementService | null) =>
        new MobileCheckoutService(db, gw, checkout, locks, attempts, onboarding, devices, ttp, serving, {
          recorder: new MobileCaptureRecorder(repo, (db as any) ?? null),
          push: push ? { dispatchToUser: push.dispatchToUser.bind(push) as any } : undefined,   // pass-through; the one producer (and its typed category) is in mobile-checkout.service.ts
          realtime, outbox: db ? outbox : null, killSwitch,
          featureFlags: featureFlags ?? null,   // §208: the mobile_tap_to_pay rollout flag (@Global ENTITLEMENT_SERVICE)
          audit: audit ? { record: (who: any, ev: any) => { void audit.record(who, ev); } } : undefined,   // AuditService.record never throws
          stepUp: db ? new KyselyStepUpRead(db) : undefined,
          pairing: db ? new KyselyDevicePairingStore(db) : new InMemoryDevicePairingStore(),   // Secure Tap to Pay §7
          signals,   // §51
        }),
      inject: [DATABASE, PaymentGatewayResolver, CheckoutService, CheckoutLockService, 'MobilePaymentAttemptPort', 'TtpOnboardingStore', 'MobilePayDeviceStore', 'TapToPaySessionPort', ServingService,
        'CheckoutRepositoryPort', REALTIME, OutboxWriter, 'TapToPayKillSwitchPort', 'DeviceSecuritySignals', { token: AuditService, optional: true }, { token: PushService, optional: true }, { token: ENTITLEMENT_SERVICE, optional: true }],
    },
    // Three Ways to Pay: the read-only channel view (the router + the Tap to Pay facts this module already owns)
    { provide: PAYMENT_CHANNELS_CENTER, useFactory: (db: AppDatabase, gw: PaymentGatewayResolver, svc: MobileCheckoutService) => (db ? new PaymentChannelsCenter(db, gw, svc) : null), inject: [DATABASE, PaymentGatewayResolver, MobileCheckoutService] },
    MobileAttemptRecoveryScheduler,
    DeviceProofGuard,
    { provide: REFRESH_DEVICE_GUARD_TOKEN, useFactory: (devices: MobilePayDeviceStore) => ({ refreshBlock: async (q: { tenantId: string; deviceId: string }) => refreshBlockFor(await devices.get(q.tenantId, q.deviceId)) }), inject: ['MobilePayDeviceStore'] },
    { provide: BRANCH_SWITCH_GUARD_TOKEN, useFactory: (svc: MobileCheckoutService) => ({ blockReason: (q: { tenantId: string; branchId: string; userId: string; deviceId: string | null; targetBranchId?: string | null; sessionId?: string | null }) => svc.branchSwitchBlock(q) }), inject: [MobileCheckoutService] },
  ],
  exports: [MobileCheckoutService],
})
export class MobileCheckoutModule {}
