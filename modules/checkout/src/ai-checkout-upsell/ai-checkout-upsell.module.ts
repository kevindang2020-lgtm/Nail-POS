// ai-checkout-upsell.module.ts — wires the AI Checkout Upsell Assistant. REUSES the authoritative domain services
// (Serving/Services/Checkout/MembershipEnroll) via their modules, so tenant/branch scoping, pricing, totals, and audit
// are inherited — this module never touches the DB for cart/pricing. The confirmed money path (recommend add-ons →
// confirm → add as a ticket line via techAddService → recalculate) is fully wired. Recommendation categories whose read
// path isn't yet traced (products/membership/loyalty/gift-card/next-appointment) are dormant (empty), never fabricated;
// they light up as each read adapter is added. Settings/dismissals/idempotency are DB-backed when DATABASE is present.
import { CheckoutModule } from '../checkout/checkout.module';
import { CheckoutService } from '../checkout/checkout.service';
import { ServingModule, ServingService } from '@aipowersalon/queue';
import { ServicesModule, ServicesService } from '@aipowersalon/catalog';
import { MembershipEnrollModule, MembershipsModule, MembershipsService, MembershipEnrollService } from '@aipowersalon/memberships';
import { Module } from '@nestjs/common';
import { AiCheckoutUpsellController } from './ai-checkout-upsell.controller';
import {
  AiCheckoutUpsellService, DefaultUpsellSettings, DefaultDismissals, type MutationDeps,
  type ProductRecoPort, type LoyaltyRecoPort, type GiftCardRecoPort, type NextAppointmentPort,
} from './ai-checkout-upsell.service';
import {
  ServingCheckoutReadAdapter, ServicesAddOnCatalogAdapter, ServingAddOnMutationAdapter, MembershipMutationAdapter,
  CheckoutRecalcAdapter, CheckoutPromotionMutationAdapter, UnavailableLoyaltyMutationAdapter, UnavailableBookingMutationAdapter, MembershipRecoAdapter,
  LoyaltyProgramRecoAdapter, LoyaltyProgramMutationAdapter,
} from './ai-checkout-upsell.adapters';
import { LoyaltyProgramRepository } from '@aipowersalon/customers';
import { KyselyUpsellSettings, KyselyDismissals, KyselyIdempotencyStore, KyselyRecords, KyselyTechnicianSchedule, KyselyRequestedServices } from './ai-checkout-upsell.kysely';
import { InMemoryIdempotencyStore } from './ai-checkout-upsell.idempotency';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { RedisCache, makeCacheRedis } from '@aipowersalon/ai';
import { makeIoredis } from '@aipowersalon/cache';
import { KyselyAiAccessRepo, evaluateAiAccess } from '@aipowersalon/ai';
import { hasPermission } from '@aipowersalon/permissions';
import { UpsellCenter, type UcCategory } from './upsell-center';
import { UpsellCenterController, UPSELL_CENTER } from './upsell-center.controller';

/** Checkout Upsell Settings guide (Nov 2026): which category switches have a REAL read path in this build. A dormant
 *  adapter below answers nothing, so its switch can never produce a card — the settings page and the health check say so. */
export const UPSELL_WIRED: Record<UcCategory, boolean> = {
  addOnsEnabled: true, membershipEnabled: true,
  // Checkout Upsell Assistant Settings 05: redemption reads the loyalty module's redeem picker and writes through its ONE
  // redemption transaction + checkout's reward-code path (LoyaltyProgramRecoAdapter / LoyaltyProgramMutationAdapter)
  loyaltyRedeemEnabled: true,
  productsEnabled: false, loyaltyEnrollEnabled: false, giftCardEnabled: false, rebookingEnabled: false,
};

// Dormant read adapters — return nothing until their real read path is wired (honest: no fabricated cards).
const emptyProducts: ProductRecoPort = { async candidates() { return []; } };
const dormantLoyaltyReco: LoyaltyRecoPort = { async state() { return { enroll: { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: '' }, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } }; } };
const emptyGiftCard: GiftCardRecoPort = { async options() { return { enabled: false, allowedAmountsCents: [] }; } };
const emptyNextAppt: NextAppointmentPort = { async context() { return null; } };

@Module({
  imports: [ServingModule, ServicesModule, CheckoutModule, MembershipEnrollModule, MembershipsModule],
  controllers: [AiCheckoutUpsellController, UpsellCenterController],
  providers: [
    {
      provide: AiCheckoutUpsellService,
      useFactory: (serving: ServingService, services: ServicesService, checkout: CheckoutService, enroll: MembershipEnrollService, memberships: MembershipsService, db: AppDatabase, audit: AuditService) => {
        const read = new ServingCheckoutReadAdapter(serving);
        const settings = db ? new KyselyUpsellSettings(db) : new DefaultUpsellSettings();
        const dismissals = db ? new KyselyDismissals(db) : new DefaultDismissals();
        const cache = (() => { const url = process.env.REDIS_URL; if (!url) return null; try { return new RedisCache(makeCacheRedis(makeIoredis(url, 'ai') as any), { prefix: process.env.CACHE_PREFIX || 'aps:cache:' }); } catch { return null; } })();
        const auditPort = { record: (who: any, ev: any) => { void audit?.record(who, ev); } };   // AuditService.record never throws
        const loyaltyRepo = db ? new LoyaltyProgramRepository(db, audit) : null;
        const mut: MutationDeps = {
          idem: db ? new KyselyIdempotencyStore(db) : new InMemoryIdempotencyStore(),
          addOn: new ServingAddOnMutationAdapter(serving, read),
          membership: new MembershipMutationAdapter(enroll),
          loyalty: loyaltyRepo ? new LoyaltyProgramMutationAdapter(loyaltyRepo, checkout) : new UnavailableLoyaltyMutationAdapter(),
          promotion: new CheckoutPromotionMutationAdapter(checkout),
          booking: new UnavailableBookingMutationAdapter(),
          recalc: new CheckoutRecalcAdapter(checkout),
        };
        return new AiCheckoutUpsellService(
          read, new ServicesAddOnCatalogAdapter(services), emptyProducts, new MembershipRecoAdapter(memberships, enroll), db && loyaltyRepo ? new LoyaltyProgramRecoAdapter(loyaltyRepo, db) : dormantLoyaltyReco, emptyGiftCard, emptyNextAppt,
          settings, dismissals, cache, auditPort, mut, db ? new KyselyRecords(db) : undefined,
          db ? new KyselyTechnicianSchedule(db) : undefined,   // Decision 27: add-ons never run into the next appointment
          db ? new KyselyRequestedServices(db) : undefined,    // Checkout Upsell 09: requested-but-not-on-ticket record checks
        );
      },
      inject: [ServingService, ServicesService, CheckoutService, MembershipEnrollService, MembershipsService, DATABASE, AuditService],
    },
    { provide: UPSELL_CENTER, useFactory: (db: AppDatabase, svc: AiCheckoutUpsellService) => {
        if (!db) return null;
        const access = new KyselyAiAccessRepo(db as never);
        return new UpsellCenter(db as never, {
          settings: (c) => svc.getEffectiveSettings({ tenantId: c.tenantId, branchId: c.branchId ?? '', userId: String(c.userId ?? ''), role: c.role ?? '', permissions: c.permissions ?? [], deviceId: null } as never) as never,
          entitlement: async (c) => { const d = evaluateAiAccess(await access.loadSnapshot(c.tenantId, 'ai_checkout_upsell_assistant', c.userId ?? null, { branchId: c.branchId || null }));
            return { allowed: d.allowed, reason: d.reason, subscriptionStatus: String(d.subscriptionStatus) }; },
          wired: UPSELL_WIRED,
          canSeeCustomers: (c) => hasPermission(c as never, 'customers.view'),
        });
      }, inject: [DATABASE, AiCheckoutUpsellService] },
  ],
})
export class AiCheckoutUpsellModule {}
