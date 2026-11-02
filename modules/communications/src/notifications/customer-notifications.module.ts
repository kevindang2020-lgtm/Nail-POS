// customer-notifications.module.ts — Customer Notifications Complete Build Guide (741). The center reads the ledger and the
// existing readiness / opt-out / inbox / booking records; it sends ONLY through NotificationsService (the one send path), and
// "Check health" is the existing Phone & Messaging readiness check. The incident job evaluates the failure-alert rules every
// 5 minutes for salons that sent something in the last day (one owner across API instances; off with
// CUSTOMER_NOTIFICATION_ALERTS=off).
import { Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import { TenantMessagingModule } from '../tenant-messaging/tenant-messaging.module';
import { TenantMessagingReadinessService } from '../tenant-messaging/tenant-messaging-readiness.service';
import { CustomerNotificationsController, CUSTOMER_NOTIFICATIONS_CENTER } from './customer-notifications.controller';
import { CustomerNotificationsCenter, evaluateMessagingIncidents, type CnSender, type CnReadiness } from './customer-notifications';

/** every salon with sends in the last 24 h, evaluated one by one (a failing salon never stops the others) */
export async function evaluateAllMessagingIncidents(db: Kysely<any>, readiness: CnReadiness | null): Promise<{ tenants: number; opened: number }> {
  const tenants = (await sql<{ tenant_id: string }>`select distinct tenant_id from notifications where created_at >= now() - interval '24 hours' limit 5000`.execute(db)).rows;
  let opened = 0;
  for (const t of tenants) {
    try { opened += (await evaluateMessagingIncidents(db, String(t.tenant_id), { readiness })).opened; }
    catch (e) { logException(e, { where: 'customer-notifications.incidents.tenant' }); }
  }
  return { tenants: tenants.length, opened };
}

@Injectable()
export class MessagingIncidentsJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Inject(DATABASE) private readonly db: AppDatabase, private readonly readiness: TenantMessagingReadinessService) {}
  onModuleInit() {
    if (!runsBackgroundJob('reconciliation')) return;
    if (!this.db || process.env.CUSTOMER_NOTIFICATION_ALERTS === 'off') return;
    const every = 5 * 60_000;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'communications.messaging_incidents', jobClass: 'reconciliation', everyMs: every },
        () => runAsSingleOwner(this.db as Kysely<any>, 'communications.messaging_incidents', () => evaluateAllMessagingIncidents(this.db as Kysely<any>, this.readiness as unknown as CnReadiness)))
        .catch((e) => logException(e, { where: 'customer-notifications.incidents.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({
  imports: [NotificationsModule, TenantMessagingModule],
  controllers: [CustomerNotificationsController],
  providers: [
    { provide: CUSTOMER_NOTIFICATIONS_CENTER, inject: [DATABASE, NotificationsService, TenantMessagingReadinessService],
      useFactory: (db: AppDatabase, n: NotificationsService, r: TenantMessagingReadinessService) => (db ? new CustomerNotificationsCenter(db as Kysely<any>, n as unknown as CnSender, r as unknown as CnReadiness) : null) },
    MessagingIncidentsJob,
  ],
  exports: [CUSTOMER_NOTIFICATIONS_CENTER],
})
export class CustomerNotificationsModule {}
