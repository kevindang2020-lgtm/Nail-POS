// deals.module.ts — Deals Marketplace domain (Phase 2). Kysely-backed when Postgres is present, else in-memory
// (dev/offline/tests). Reuses the canonical discount/geo/booking primitives in later phases.
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';
import { DealsOwnerController } from './deals.owner.controller';
import { DealsTechController } from './deals.tech.controller';
import { DealsCustomerController } from './deals.customer.controller';
import { DealsSuperAdminController } from './deals.super-admin.controller';
import { DealsService, DEAL_APPROVALS_TOKEN, type DealApprovalsPort } from './deals.service';
import { InMemoryDealsRepository, type DealsRepositoryPort } from './deals.repository';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { DealsLifecycleScheduler } from '../engine/deals-lifecycle.scheduler';
import { CouponCenter, CouponCenterController, COUPON_CENTER } from '../salon-promotions/coupon-center';
import { DiscountsScreenRepository } from '../salon-promotions/discounts-screen';
import { DealsCenter, DealsCenterController, DEALS_CENTER } from './deals-center';
import { PromotionsCenter, PromotionsCenterController, PROMOTIONS_CENTER } from '../salon-promotions/promotions-center';

@Module({
  imports: [EventsCoreModule],   // the outbox writer deal redemptions are recorded through
  controllers: [DealsController, DealsTechController, DealsCustomerController, DealsSuperAdminController, DealsOwnerController, CouponCenterController, DealsCenterController, PromotionsCenterController],
  providers: [
    { provide: 'DealsRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): DealsRepositoryPort => (db ? new KyselyDealsRepository(db, outbox) : new InMemoryDealsRepository()), inject: [DATABASE, OutboxWriter] },
    // BUILD_PLAN Phase 9: deal approvals ride the salon approvals engine when the process has it (@Global token, optional)
    { provide: DealsService, useFactory: (repo: DealsRepositoryPort, approvals?: DealApprovalsPort | null) => new DealsService(repo).useApprovals(approvals ?? null), inject: ['DealsRepositoryPort', { token: DEAL_APPROVALS_TOKEN, optional: true }] },
    // BUILD_PLAN Phase 5: deals on POS tickets (null without a database — checkout then offers no deals, honestly)
    { provide: DealsCheckoutService, useFactory: (svc: DealsService, repo: DealsRepositoryPort) => (repo.ledger ? new DealsCheckoutService(svc, repo.ledger) : null), inject: [DealsService, 'DealsRepositoryPort'] },
    DealsLifecycleScheduler,
    // Coupons & Promotions guide (Oct 30 2026): checker / health / assistant over the same engine (null without a database)
    { provide: COUPON_CENTER, useFactory: (db: AppDatabase, svc: DealsService, co: DealsCheckoutService | null) => (db ? new CouponCenter(db, svc, co) : null), inject: [DATABASE, DealsService, DealsCheckoutService] },
    // Deals & Offers guide (Oct 30 2026): the same screen / checker / health / assistant with scope 'all' (null without a database)
    { provide: DEALS_CENTER, useFactory: (db: AppDatabase, svc: DealsService, co: DealsCheckoutService | null) => (db ? new DealsCenter(db, new DiscountsScreenRepository(db, 'all'), new CouponCenter(db, svc, co, 'all'), svc) : null), inject: [DATABASE, DealsService, DealsCheckoutService] },
    // Promotions guide (Oct 30 2026): Marketing → Promotions — the coupon records again (a salon promotion IS a coupon) plus the
    // logged eligibility checks, trends, assistant safety flags and the activity tab (null without a database)
    { provide: PROMOTIONS_CENTER, useFactory: (db: AppDatabase, center: CouponCenter | null) => (db && center ? new PromotionsCenter(db, center, new DiscountsScreenRepository(db)) : null), inject: [DATABASE, COUPON_CENTER] },
  ],
  exports: [DealsService, DealsCheckoutService],
})
export class DealsModule {}
