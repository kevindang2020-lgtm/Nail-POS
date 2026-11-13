// checkout.module.ts — POS Checkout & Payment controllers + service + repository. Kysely-backed adapter when a Postgres
// handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { assertCustomerTipsConfirmed, customerTipSelection } from './technician-tips-guard';
import { AiReviewReputationModule, ReviewRequestService, CheckoutReviewRequestHook, KyselySettings } from '@aipowersalon/ai';
import { processorFromEnv, PaymentGatewayResolver } from '@aipowersalon/payments';
import { SalonPromotionsModule, DealsModule, DealsCheckoutService } from '@aipowersalon/deals';
import { InventoryModule, InventoryService } from '@aipowersalon/inventory';   // B-17: retail units come back on void / refund
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
import { CheckoutPricePreviewController, CHECKOUT_PRICE_PREVIEW } from './checkout-price-preview.controller';
import { CheckoutPricePreview } from './checkout-price-preview';
import { CheckoutService, type BookingDepositCheckoutPort, type GlobalRewardsCheckoutPort } from './checkout.service';
import { CommerceHubTapToPayRefunds } from '../mobile-checkout/ttp-refund-processor';
import { TENANT_APPROVALS_TOKEN, type RefundApprovalsPort } from './refund-approval';
import { DATABASE, type AppDatabase, branchTimeZone } from '@aipowersalon/database';
import type { Kysely } from 'kysely';
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
  imports: [EventsCoreModule, CheckoutLockModule, SalonPromotionsModule, AiReviewReputationModule, DealsModule, PushModule, InventoryModule],   // InventoryModule: not @Global — without it the optional InventoryService never resolves (same lesson as serving.module)
  controllers: [CheckoutController, POSCustomerDisplayController, PosPaymentGatewayController, CheckoutPricePreviewController],
  providers: [
    // merge Oct 12 2026: Ready Technicians read the ONE workforce state (@Global WorkforceStatusModule) when bound
    { provide: 'CheckoutRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter, wf?: WorkforceStatusService | null): CheckoutRepositoryPort => (db ? new KyselyCheckoutRepository(db, outbox, wf ?? null) : new InMemoryCheckoutRepository()), inject: [DATABASE, OutboxWriter, { token: WorkforceStatusService, optional: true }] },
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: CompensationService, useFactory: (db: AppDatabase) => (db ? new CompensationService(new KyselyCompensationPorts(db)) : undefined), inject: [DATABASE] },
    { provide: MembershipCompService, useFactory: (db: AppDatabase) => new MembershipCompService(db ? new KyselyMembershipCompRepository(db) : new InMemoryMembershipCompRepository()), inject: [DATABASE] },
    { provide: 'ReviewRequestHook', useFactory: (requests: ReviewRequestService, db: AppDatabase) => new CheckoutReviewRequestHook(requests, db ? new KyselySettings(db) : { async load() { return []; }, async tenantContextInput(c: any, cfg: any) { return { tenantId: c.tenantId, brandName: '', config: cfg }; } }, db ? (t: string, b: string | null) => branchTimeZone(db, t, b) : undefined), inject: [ReviewRequestService, DATABASE] },
    // SERVICE PRICING 08: the live price preview (read only) — the deals engine's hypothetical-ticket pricing + Checkout's own tax totals
    { provide: CHECKOUT_PRICE_PREVIEW, useFactory: (db?: AppDatabase, deals?: DealsCheckoutService | null) => (db ? new CheckoutPricePreview(db as unknown as Kysely<any>, deals ?? null) : null), inject: [{ token: DATABASE, optional: true }, { token: DealsCheckoutService, optional: true }] },
    { provide: CheckoutService, useFactory: (repo: CheckoutRepositoryPort, gateway: PaymentGatewayResolver, realtime: RealtimeEmitter, compensation: CompensationService | undefined, membershipComp: MembershipCompService, locks: CheckoutLockService, reviewHook: CheckoutReviewRequestHook, deals: DealsCheckoutService | null, messenger?: TenantMessenger, approvals?: RefundApprovalsPort | null, push?: PushService | null, stock?: InventoryService | null, deposits?: BookingDepositCheckoutPort | null, rewards?: GlobalRewardsCheckoutPort | null, db?: AppDatabase) => new CheckoutService(repo, smsFromEnv(), emailFromEnv(), processorFromEnv(), gateway, realtime, compensation, membershipComp, locks, reviewHook, giftCardLookupThrottle, messenger ?? undefined).useDeals(deals).usePush(push ?? null).useStock(stock ?? null)   // BUILD_PLAN Phase 5: deals + coupons on tickets
        .useTapToPayRefunds(gateway ? new CommerceHubTapToPayRefunds(gateway) : null)   // Oct 28 2026: Tap to Pay refunds / voids go back to the location's CommerceHub merchant
        .useApprovals(approvals ?? null)   // BUILD_PLAN Phase 9: refunds past the salon's limit go to the salon approvals engine (@Global token; absent → the old 403)
        .usePush(push ?? null)   // developer merge (Oct 6 2026): "Receipt saved" to the customer's devices
        .useGlobalRewards(rewards ?? null)   // Global Loyalty (Oct 30 2026): cross-salon reward holds ('GLOBAL_REWARDS_CHECKOUT' from modules/loyalty; absent → no rewards tender)
        .useTipGuard(db ? (c, ticketId, staff) => assertCustomerTipsConfirmed(db as unknown as Kysely<any>, { tenantId: c.tenantId, ticketId, userId: c.userId ?? null, staffConfirmation: staff }) : null)   // G4 follow-up (Nov 5 2026): front-desk tenders need the customer's tip confirmation (or an attributed staff entry)
        .useTipSelectionReader(db ? (c, ticketId) => customerTipSelection(db as unknown as Kysely<any>, c.tenantId, ticketId) : null)   // G4: the POS shows the customer's per-technician tips live
        .useDeposits(deposits ?? null),   // D11 (Oct 21 2026): the booking deposit comes off the ticket (@Global token 'BOOKING_DEPOSITS' from modules/booking; absent → no deposits)
      inject: ['CheckoutRepositoryPort', PaymentGatewayResolver, REALTIME, CompensationService, MembershipCompService, CheckoutLockService, 'ReviewRequestHook', { token: DealsCheckoutService, optional: true }, { token: TENANT_MESSENGER, optional: true }, { token: TENANT_APPROVALS_TOKEN, optional: true }, { token: PushService, optional: true }, { token: InventoryService, optional: true }, { token: 'BOOKING_DEPOSITS', optional: true }, { token: 'GLOBAL_REWARDS_CHECKOUT', optional: true }, DATABASE] },
    PaymentAttemptSweepScheduler,   // BUILD_PLAN Phase 11 (Constitution 4 §116): stranded card attempts → the processor's answer, or review + alert
  ],
  exports: [CheckoutService, 'CheckoutRepositoryPort'],   // the repository port: the mobile checkout records its tenders through the SAME writer (mobile-capture-recorder)
})
export class CheckoutModule {}
