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
  type ProductRecoPort, type MembershipRecoPort, type LoyaltyRecoPort, type GiftCardRecoPort, type NextAppointmentPort,
} from './ai-checkout-upsell.service';
import {
  ServingCheckoutReadAdapter, ServicesAddOnCatalogAdapter, ServingAddOnMutationAdapter, MembershipMutationAdapter,
  CheckoutRecalcAdapter, CheckoutPromotionMutationAdapter, UnavailableLoyaltyMutationAdapter, UnavailableBookingMutationAdapter, MembershipRecoAdapter,
} from './ai-checkout-upsell.adapters';
import { KyselyUpsellSettings, KyselyDismissals, KyselyIdempotencyStore, KyselyRecords, KyselyTechnicianSchedule } from './ai-checkout-upsell.kysely';
import { InMemoryIdempotencyStore } from './ai-checkout-upsell.idempotency';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { RedisCache, makeCacheRedis } from '@aipowersalon/ai';
import { makeIoredis } from '@aipowersalon/cache';

// Dormant read adapters — return nothing until their real read path is wired (honest: no fabricated cards).
const emptyProducts: ProductRecoPort = { async candidates() { return []; } };
const emptyMembershipReco: MembershipRecoPort = { async candidates() { return []; } };
const dormantLoyaltyReco: LoyaltyRecoPort = { async state() { return { enroll: { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: '' }, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } }; } };
const emptyGiftCard: GiftCardRecoPort = { async options() { return { enabled: false, allowedAmountsCents: [] }; } };
const emptyNextAppt: NextAppointmentPort = { async context() { return null; } };

@Module({
  imports: [ServingModule, ServicesModule, CheckoutModule, MembershipEnrollModule, MembershipsModule],
  controllers: [AiCheckoutUpsellController],
  providers: [
    {
      provide: AiCheckoutUpsellService,
      useFactory: (serving: ServingService, services: ServicesService, checkout: CheckoutService, enroll: MembershipEnrollService, memberships: MembershipsService, db: AppDatabase, audit: AuditService) => {
        const read = new ServingCheckoutReadAdapter(serving);
        const settings = db ? new KyselyUpsellSettings(db) : new DefaultUpsellSettings();
        const dismissals = db ? new KyselyDismissals(db) : new DefaultDismissals();
        const cache = (() => { const url = process.env.REDIS_URL; if (!url) return null; try { return new RedisCache(makeCacheRedis(makeIoredis(url, 'ai') as any), { prefix: process.env.CACHE_PREFIX || 'aps:cache:' }); } catch { return null; } })();
        const auditPort = { record: (who: any, ev: any) => { void audit?.record(who, ev); } };   // AuditService.record never throws
        const mut: MutationDeps = {
          idem: db ? new KyselyIdempotencyStore(db) : new InMemoryIdempotencyStore(),
          addOn: new ServingAddOnMutationAdapter(serving, read),
          membership: new MembershipMutationAdapter(enroll),
          loyalty: new UnavailableLoyaltyMutationAdapter(),
          promotion: new CheckoutPromotionMutationAdapter(checkout),
          booking: new UnavailableBookingMutationAdapter(),
          recalc: new CheckoutRecalcAdapter(checkout),
        };
        return new AiCheckoutUpsellService(
          read, new ServicesAddOnCatalogAdapter(services), emptyProducts, new MembershipRecoAdapter(memberships, enroll), dormantLoyaltyReco, emptyGiftCard, emptyNextAppt,
          settings, dismissals, cache, auditPort, mut, db ? new KyselyRecords(db) : undefined,
          db ? new KyselyTechnicianSchedule(db) : undefined,   // Decision 27: add-ons never run into the next appointment
        );
      },
      inject: [ServingService, ServicesService, CheckoutService, MembershipEnrollService, MembershipsService, DATABASE, AuditService],
    },
  ],
})
export class AiCheckoutUpsellModule {}
