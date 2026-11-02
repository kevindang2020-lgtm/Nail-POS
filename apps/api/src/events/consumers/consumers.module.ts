// consumers.module.ts — Constitution 8 §89: the consumer registry is populated in ONE place.
// Each consumer is constructed with whatever it needs (null-safe when the dependency is absent) and registered.
import { PushService, PushModule } from '@aipowersalon/communications';
import { Module, type OnModuleInit } from '@nestjs/common';
import { EventsModule } from '../events.module';
import { ConsumerRegistry } from '../event-transport';
import { RealtimeModule } from '../../realtime/realtime.module';
import { REALTIME } from '@aipowersalon/realtime-contracts';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { RealtimeProjectionConsumer } from './realtime-projection.consumer';
import { PushNotificationConsumer } from './push-notification.consumer';
import { LoyaltyPointsConsumer } from './loyalty-points.consumer';
import { GlobalRewardsConsumer } from './global-rewards.consumer';
import { PlatformLiveOpsConsumer, PlatformLiveOpsService } from '../../realtime/platform-live-ops';
import { AnalyticsRollupConsumer } from './analytics-rollup.consumer';
import { AiUsageConsumer } from './ai-usage.consumer';
import { DealsReleaseConsumer } from './deals-release.consumer';
import { InAppNotificationConsumer } from './in-app-notification.consumer';
import { KyselyQueueRepository } from '@aipowersalon/queue';
import { CheckoutModule, CheckoutService } from '@aipowersalon/checkout';
import { ReceiptDeliveryConsumer } from './receipt-delivery.consumer';
import { BookingConfirmationEmailConsumer } from './booking-confirmation-email.consumer';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';
import { MobilePayDeviceRevocationConsumer } from './mobile-pay-device-revocation.consumer';
import { RecipeUsageConsumer } from './recipe-usage.consumer';
import { ReferralQualificationConsumer } from './referral-qualification.consumer';
import { InventoryModule, InventoryService } from '@aipowersalon/inventory';

class ConsumerRegistration implements OnModuleInit {
  constructor(private readonly registry: ConsumerRegistry, private readonly consumers: any[]) {}
  onModuleInit() { for (const c of this.consumers) this.registry.register(c); }
}

@Module({
  imports: [EventsModule, RealtimeModule, PushModule, CheckoutModule, InventoryModule],   // B-14: PlatformLiveOpsService comes from RealtimeModule (no platform→domain back-edge)
  providers: [
    { provide: RealtimeProjectionConsumer, inject: [REALTIME], useFactory: (rt: any) => new RealtimeProjectionConsumer(rt ?? null) },
    { provide: PushNotificationConsumer, inject: [DATABASE, PushService],
      useFactory: (db: AppDatabase, push: PushService) => new PushNotificationConsumer((push as any) ?? null, db ? new KyselyQueueRepository(db) : null) },
    { provide: LoyaltyPointsConsumer, useFactory: () => new LoyaltyPointsConsumer() },
    // Global Loyalty & Rewards Network (LoyaltyTokens.pdf §6): funded earning on checkout.completed, reversal on payment.refunded
    { provide: GlobalRewardsConsumer, useFactory: () => new GlobalRewardsConsumer() },
    { provide: AnalyticsRollupConsumer, useFactory: () => new AnalyticsRollupConsumer() },
    { provide: AiUsageConsumer, useFactory: () => new AiUsageConsumer() },
    // BUILD_PLAN Phase 5, bug 12: cancel / no-show give a deal's place back
    { provide: DealsReleaseConsumer, useFactory: () => new DealsReleaseConsumer() },
    // developer merge (Oct 6 2026): the customer / technician / owner in-app feeds, written once per fact
    { provide: InAppNotificationConsumer, useFactory: () => new InAppNotificationConsumer() },
    // Constitution 9 Phase 20: counts only, feeding the Super Admin platform stream (§60)
    { provide: PlatformLiveOpsConsumer, inject: [PlatformLiveOpsService], useFactory: (ops: PlatformLiveOpsService) => new PlatformLiveOpsConsumer(ops.rates) },
    // Owner & Manager Payment App mandate §102 / §167: receipts delivered asynchronously with retries, through the ONE receipt system
    { provide: ReceiptDeliveryConsumer, inject: [{ token: CheckoutService, optional: true }], useFactory: (checkout?: CheckoutService | null) => new ReceiptDeliveryConsumer(checkout ?? null) },
    // Email guide §09 (Oct 31 2026): one booking confirmation email per appointment, through the ONE email path
    { provide: BookingConfirmationEmailConsumer, inject: [{ token: TENANT_MESSENGER, optional: true }], useFactory: (m?: TenantMessenger | null) => new BookingConfirmationEmailConsumer(m ?? null) },
    // mandate §140: a terminated staff member's payment phones lose authority with their sessions
    { provide: MobilePayDeviceRevocationConsumer, useFactory: () => new MobilePayDeviceRevocationConsumer() },
    // D4 (Oct 22 2026): a service's recipe leaves the shelf when the service is DONE — both Service Done write paths emit the event
    { provide: RecipeUsageConsumer, inject: [{ token: InventoryService, optional: true }], useFactory: (inv?: InventoryService | null) => new RecipeUsageConsumer(inv ?? null) },
    { provide: ReferralQualificationConsumer, useFactory: () => new ReferralQualificationConsumer() },
    { provide: ConsumerRegistration, inject: [ConsumerRegistry, RealtimeProjectionConsumer, PushNotificationConsumer, LoyaltyPointsConsumer, GlobalRewardsConsumer, AnalyticsRollupConsumer, AiUsageConsumer, PlatformLiveOpsConsumer, DealsReleaseConsumer, InAppNotificationConsumer, ReceiptDeliveryConsumer, MobilePayDeviceRevocationConsumer, RecipeUsageConsumer, BookingConfirmationEmailConsumer, ReferralQualificationConsumer],
      useFactory: (reg: ConsumerRegistry, a: any, b: any, c: any, gr: any, d: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any, bc: any, rq: any) => new ConsumerRegistration(reg, [a, b, c, gr, d, f, g, h, i, j, k, l, bc, rq]) },
  ],
})
export class ConsumersModule {}
