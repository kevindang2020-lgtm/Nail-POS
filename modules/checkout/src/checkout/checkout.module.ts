// checkout.module.ts — POS Checkout & Payment controllers + service + repository. Kysely-backed adapter when a Postgres
// handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { AiReviewReputationModule, ReviewRequestService, CheckoutReviewRequestHook, KyselySettings } from '@aipowersalon/ai';
import { processorFromEnv, PaymentGatewayResolver } from '@aipowersalon/payments';
import { SalonPromotionsModule, DealsModule, DealsCheckoutService } from '@aipowersalon/deals';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { CompensationService, KyselyCompensationPorts, WorkforceStatusService } from '@aipowersalon/workforce';
import { type SmsSender, type EmailSender, TENANT_MESSENGER, type TenantMessenger, smsSenderFromEnv, messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import { MembershipCompService, KyselyMembershipCompRepository, InMemoryMembershipCompRepository } from '@aipowersalon/memberships';
import { OutboxWriter } from '@aipowersalon/events';
import { PushModule, PushService } from '@aipowersalon/communications';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { CheckoutController, POSCustomerDisplayController } from './checkout.controller';
import { PosPaymentGatewayController } from './pos-payment-gateway.controller';
import { CheckoutService } from './checkout.service';
import { TENANT_APPROVALS_TOKEN, type RefundApprovalsPort } from './refund-approval';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { InMemoryCheckoutRepository, type CheckoutRepositoryPort } from './checkout.repository';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { InMemoryGiftCardLookupThrottle } from './gift-card-lookup-throttle';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { CheckoutLockModule } from '../checkout-lock/checkout-lock.module';
import { CheckoutLockService } from '../checkout-lock/checkout-lock.service';
import { PaymentAttemptSweepScheduler } from './payment-attempt-sweep.scheduler';

// Receipt delivery: SMS through the tenant messenger (Phase 2) wherever MessengerModule is loaded (the API); the env
// sender below is only the fallback for a module test without it. Email: real providers when their env is set, otherwise Mock senders (a clearly-marked SIMULATED delivery —
// the receipt is still recorded). Mirrors the auth password-reset wiring.
function smsFromEnv(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}
function emailFromEnv(): EmailSender {
  return messagingEmailSenderFromEnv();   // P-11: SendGrid when configured; never a mock in production (not configured there); default sender nailsalons@aipowersalon.com
}

// One process-wide throttle instance so failed-lookup counts persist across requests (NestJS builds the service once).
const giftCardLookupThrottle = new InMemoryGiftCardLookupThrottle();

@Module({
  imports: [EventsCoreModule, CheckoutLockModule, SalonPromotionsModule, AiReviewReputationModule, DealsModule, PushModule],
  controllers: [CheckoutController, POSCustomerDisplayController, PosPaymentGatewayController],
  providers: [
    // merge Oct 12 2026: Ready Technicians read the ONE workforce state (@Global WorkforceStatusModule) when bound
    { provide: 'CheckoutRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter, wf?: WorkforceStatusService | null): CheckoutRepositoryPort => (db ? new KyselyCheckoutRepository(db, outbox, wf ?? null) : new InMemoryCheckoutRepository()), inject: [DATABASE, OutboxWriter, { token: WorkforceStatusService, optional: true }] },
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: CompensationService, useFactory: (db: AppDatabase) => (db ? new CompensationService(new KyselyCompensationPorts(db)) : undefined), inject: [DATABASE] },
    { provide: MembershipCompService, useFactory: (db: AppDatabase) => new MembershipCompService(db ? new KyselyMembershipCompRepository(db as any) : new InMemoryMembershipCompRepository()), inject: [DATABASE] },
    { provide: 'ReviewRequestHook', useFactory: (requests: ReviewRequestService, db: AppDatabase) => new CheckoutReviewRequestHook(requests, db ? new KyselySettings(db) : { async load() { return []; }, async save() {}, async tenantContextInput(c: any, cfg: any) { return { tenantId: c.tenantId, brandName: '', config: cfg }; } } as any), inject: [ReviewRequestService, DATABASE] },
    { provide: CheckoutService, useFactory: (repo: CheckoutRepositoryPort, gateway: PaymentGatewayResolver, realtime: RealtimeEmitter, compensation: CompensationService | undefined, membershipComp: MembershipCompService, locks: CheckoutLockService, reviewHook: CheckoutReviewRequestHook, deals: DealsCheckoutService | null, messenger?: TenantMessenger, approvals?: RefundApprovalsPort | null, push?: PushService | null) => new CheckoutService(repo, smsFromEnv(), emailFromEnv(), processorFromEnv(), gateway, realtime, compensation, membershipComp, locks, reviewHook, giftCardLookupThrottle, messenger ?? undefined).useDeals(deals as any).usePush(push ?? null)   // BUILD_PLAN Phase 5: deals + coupons on tickets
        .useApprovals(approvals ?? null)   // BUILD_PLAN Phase 9: refunds past the salon's limit go to the salon approvals engine (@Global token; absent → the old 403)
        .usePush(push ?? null),   // developer merge (Oct 6 2026): "Receipt saved" to the customer's devices
      inject: ['CheckoutRepositoryPort', PaymentGatewayResolver, REALTIME, CompensationService, MembershipCompService, CheckoutLockService, 'ReviewRequestHook', { token: DealsCheckoutService, optional: true }, { token: TENANT_MESSENGER, optional: true }, { token: TENANT_APPROVALS_TOKEN, optional: true }, { token: PushService, optional: true }] },
    PaymentAttemptSweepScheduler,   // BUILD_PLAN Phase 11 (Constitution 4 §116): stranded card attempts → the processor's answer, or review + alert
  ],
  exports: [CheckoutService, 'CheckoutRepositoryPort'],   // the repository port: the mobile checkout records its tenders through the SAME writer (mobile-capture-recorder)
})
export class CheckoutModule {}
