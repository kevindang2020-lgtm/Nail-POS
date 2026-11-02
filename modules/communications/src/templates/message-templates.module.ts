// message-templates.module.ts — Message Templates & Automation Center (740). The service needs the database (no in-memory
// fallback: the old in-memory template Map was the bug that lost templates on restart) and the ONE sending path
// (NotificationsService) for the confirmed Test Send only.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { MessageTemplatesController, MESSAGE_TEMPLATES_CENTER } from './message-templates.controller';
import { MessageTemplatesCenter, type TemplateSender } from './message-templates';

@Module({
  imports: [NotificationsModule],
  controllers: [MessageTemplatesController],
  providers: [
    { provide: MESSAGE_TEMPLATES_CENTER, useFactory: (db: AppDatabase, n: NotificationsService) => (db ? new MessageTemplatesCenter(db, n as unknown as TemplateSender) : null), inject: [DATABASE, NotificationsService] },
  ],
  exports: [MESSAGE_TEMPLATES_CENTER],
})
export class MessageTemplatesModule {}
