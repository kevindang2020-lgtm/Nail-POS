// email.module.ts — Communications → Email (748, Email Complete Build Guide). The center reads the ledger and sends ONLY
// through NotificationsService (the one email path) or the 741 protected resend; the public controller takes the
// provider's signed events and one-click unsubscribes.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import type { EmailSender } from '@aipowersalon/notifications';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { CustomerNotificationsModule } from '../notifications/customer-notifications.module';
import { CUSTOMER_NOTIFICATIONS_CENTER } from '../notifications/customer-notifications.controller';
import type { CustomerNotificationsCenter } from '../notifications/customer-notifications';
import { EmailCenterController, EMAIL_CENTER } from './email-center.controller';
import { EmailPublicController } from './email-public.controller';
import { EmailCenter } from './email-center';
import { KyselyEmailPolicy } from './email-policy';

@Module({
  imports: [NotificationsModule, CustomerNotificationsModule],
  controllers: [EmailCenterController, EmailPublicController],
  providers: [
    { provide: EMAIL_CENTER, inject: [DATABASE, CUSTOMER_NOTIFICATIONS_CENTER, NotificationsService, 'NotifEmail'],
      useFactory: (db: AppDatabase, cn: CustomerNotificationsCenter, messenger: NotificationsService, sender: EmailSender) =>
        (db && cn ? new EmailCenter(db, cn, messenger, sender, new KyselyEmailPolicy(db)) : null) },
  ],
})
export class EmailCenterModule {}
