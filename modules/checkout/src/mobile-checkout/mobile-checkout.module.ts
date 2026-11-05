// mobile-checkout.module.ts — wires the Owner & Manager Payment App backend. Reuses the canonical PaymentGatewayResolver
// (same construction pattern as checkout/webhook modules) rather than introducing a second merchant lookup, the canonical
// checkout repository for the money (mobile-capture-recorder), the ONE realtime emitter, the ONE outbox, the ONE audit
// service, the Super Admin kill-switch rows and the session step-up stamp.
import { ServingService, ServingModule } from '@aipowersalon/queue';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
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
import { type TtpOnboardingStore, InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { KyselyTtpOnboardingStore } from './ttp-onboarding.kysely';
import { type MobilePayDeviceStore, InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { KyselyMobilePayDeviceStore } from './mobile-pay-device.kysely';
import { type TapToPaySessionPort } from './tap-to-pay-session';
import { FiservCommerceHubTtpAdapter } from './fiserv-commercehub-ttp.adapter';
import { type MobilePaymentAttemptPort, KyselyMobilePaymentAttemptRepository, InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import { KyselyTapToPayKillSwitch, InMemoryTapToPayKillSwitch, type TapToPayKillSwitchPort } from './ttp-kill-switch';
import { MobileAttemptRecoveryScheduler } from './mobile-attempt-recovery.scheduler';

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

@Module({
  imports: [ServingModule, CheckoutModule, CheckoutLockModule, EventsCoreModule, PushModule],
  controllers: [MobileCheckoutController, TtpOnboardingAdminController],
  providers: [
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: 'MobilePaymentAttemptPort', useFactory: (db: AppDatabase): MobilePaymentAttemptPort => (db ? new KyselyMobilePaymentAttemptRepository(db) : new InMemoryMobilePaymentAttemptRepository()), inject: [DATABASE] },
    { provide: 'TtpOnboardingStore', useFactory: (db: AppDatabase): TtpOnboardingStore => (db ? new KyselyTtpOnboardingStore(db) : new InMemoryTtpOnboardingStore()), inject: [DATABASE] },
    { provide: 'MobilePayDeviceStore', useFactory: (db: AppDatabase): MobilePayDeviceStore => (db ? new KyselyMobilePayDeviceStore(db) : new InMemoryMobilePayDeviceStore()), inject: [DATABASE] },
    { provide: 'TapToPaySessionPort', useFactory: (): TapToPaySessionPort => new FiservCommerceHubTtpAdapter(), inject: [] },
    { provide: 'TapToPayKillSwitchPort', useFactory: (db: AppDatabase): TapToPayKillSwitchPort => (db ? new KyselyTapToPayKillSwitch(db) : new InMemoryTapToPayKillSwitch()), inject: [DATABASE] },
    {
      provide: MobileCheckoutService,
      useFactory: (db: AppDatabase, gw: PaymentGatewayResolver, checkout: CheckoutService, locks: CheckoutLockService, attempts: MobilePaymentAttemptPort, onboarding: TtpOnboardingStore, devices: MobilePayDeviceStore, ttp: TapToPaySessionPort, serving: ServingService,
        repo: CheckoutRepositoryPort, realtime: RealtimeEmitter, outbox: OutboxWriter, killSwitch: TapToPayKillSwitchPort, audit?: AuditService | null, push?: PushService | null) =>
        new MobileCheckoutService(db, gw, checkout, locks, attempts, onboarding, devices, ttp, serving, {
          recorder: new MobileCaptureRecorder(repo, (db as any) ?? null),
          push: push ? { dispatchToUser: push.dispatchToUser.bind(push) as any } : undefined,   // pass-through; the one producer (and its typed category) is in mobile-checkout.service.ts
          realtime, outbox: db ? outbox : null, killSwitch,
          audit: audit ? { record: (who: any, ev: any) => { void audit.record(who, ev); } } : undefined,   // AuditService.record never throws
          stepUp: db ? new KyselyStepUpRead(db) : undefined,
        }),
      inject: [DATABASE, PaymentGatewayResolver, CheckoutService, CheckoutLockService, 'MobilePaymentAttemptPort', 'TtpOnboardingStore', 'MobilePayDeviceStore', 'TapToPaySessionPort', ServingService,
        'CheckoutRepositoryPort', REALTIME, OutboxWriter, 'TapToPayKillSwitchPort', { token: AuditService, optional: true }, { token: PushService, optional: true }],
    },
    MobileAttemptRecoveryScheduler,
    { provide: BRANCH_SWITCH_GUARD_TOKEN, useFactory: (svc: MobileCheckoutService) => ({ blockReason: (q: { tenantId: string; branchId: string; userId: string; deviceId: string | null }) => svc.branchSwitchBlock(q) }), inject: [MobileCheckoutService] },
  ],
  exports: [MobileCheckoutService],
})
export class MobileCheckoutModule {}
