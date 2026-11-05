// reminders.module.ts — appointment reminder job + tenant config. Reuses NotificationsService for sending
// (credits + opt-outs already enforced there).
import { PushModule } from '../push/push.module';
import { PushService } from '../push/push.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { Module } from '@nestjs/common';
import { ReminderJobController, PosRemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';
import { InMemoryRemindersRepository, type RemindersDataPort } from './reminders.repository';
import { KyselyRemindersRepository } from './reminders.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [NotificationsModule, PushModule],
  controllers: [ReminderJobController, PosRemindersController],
  providers: [
    { provide: 'RemindersDataPort', useFactory: (db: AppDatabase): RemindersDataPort => (db ? new KyselyRemindersRepository(db) : new InMemoryRemindersRepository()), inject: [DATABASE] },
    { provide: RemindersService, useFactory: (repo: RemindersDataPort, notifications: NotificationsService, push: PushService) => new RemindersService(repo, notifications, push), inject: ['RemindersDataPort', NotificationsService, PushService] },
  ],
  exports: [RemindersService],
})
export class RemindersModule {}
