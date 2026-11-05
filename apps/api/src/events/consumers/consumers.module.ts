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
import { PlatformLiveOpsConsumer, PlatformLiveOpsService } from '../../realtime/platform-live-ops';
import { SuperAdminSystemStatusModule } from '../../super-admin-system-status/super-admin-system-status.module';
import { AnalyticsRollupConsumer } from './analytics-rollup.consumer';
import { AiUsageConsumer } from './ai-usage.consumer';
import { DealsReleaseConsumer } from './deals-release.consumer';
import { InAppNotificationConsumer } from './in-app-notification.consumer';
import { KyselyQueueRepository } from '@aipowersalon/queue';
import { CheckoutModule, CheckoutService } from '@aipowersalon/checkout';
import { ReceiptDeliveryConsumer } from './receipt-delivery.consumer';
import { MobilePayDeviceRevocationConsumer } from './mobile-pay-device-revocation.consumer';

class ConsumerRegistration implements OnModuleInit {
  constructor(private readonly registry: ConsumerRegistry, private readonly consumers: any[]) {}
  onModuleInit() { for (const c of this.consumers) this.registry.register(c); }
}

@Module({
  imports: [EventsModule, RealtimeModule, PushModule, SuperAdminSystemStatusModule, CheckoutModule],
  providers: [
    { provide: RealtimeProjectionConsumer, inject: [REALTIME], useFactory: (rt: any) => new RealtimeProjectionConsumer(rt ?? null) },
    { provide: PushNotificationConsumer, inject: [DATABASE, PushService],
      useFactory: (db: AppDatabase, push: PushService) => new PushNotificationConsumer((push as any) ?? null, db ? new KyselyQueueRepository(db) : null) },
    { provide: LoyaltyPointsConsumer, useFactory: () => new LoyaltyPointsConsumer() },
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
    // mandate §140: a terminated staff member's payment phones lose authority with their sessions
    { provide: MobilePayDeviceRevocationConsumer, useFactory: () => new MobilePayDeviceRevocationConsumer() },
    { provide: ConsumerRegistration, inject: [ConsumerRegistry, RealtimeProjectionConsumer, PushNotificationConsumer, LoyaltyPointsConsumer, AnalyticsRollupConsumer, AiUsageConsumer, PlatformLiveOpsConsumer, DealsReleaseConsumer, InAppNotificationConsumer, ReceiptDeliveryConsumer, MobilePayDeviceRevocationConsumer],
      useFactory: (reg: ConsumerRegistry, a: any, b: any, c: any, d: any, f: any, g: any, h: any, i: any, j: any, k: any) => new ConsumerRegistration(reg, [a, b, c, d, f, g, h, i, j, k]) },
  ],
})
export class ConsumersModule {}
