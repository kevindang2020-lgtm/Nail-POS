// reminders.module.ts — appointment reminder job + tenant config. Reuses NotificationsService for sending
// (credits + opt-outs already enforced there).
import { PushModule } from '../push/push.module';
import { PushService } from '../push/push.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { Module } from '@nestjs/common';
import { ReminderLadderScheduler } from './reminder-ladder.scheduler';
import { ReminderJobController, PosRemindersController } from './reminders.controller';
import { ReminderCenterController } from './reminder-center.controller';
import { RemindersService } from './reminders.service';
import { InMemoryRemindersRepository, type RemindersDataPort } from './reminders.repository';
import { KyselyRemindersRepository } from './reminders.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { resolveBoundTemplate, recordTemplateUsage, appointmentValues } from '../templates/message-templates';
import { renderTemplate } from '../templates/template-variables';
import type { ReminderTemplatePort } from './reminders.service';

@Module({
  imports: [NotificationsModule, PushModule],
  controllers: [ReminderJobController, PosRemindersController, ReminderCenterController],
  providers: [
    { provide: 'RemindersDataPort', useFactory: (db: AppDatabase): RemindersDataPort => (db ? new KyselyRemindersRepository(db) : new InMemoryRemindersRepository()), inject: [DATABASE] },
    { provide: RemindersService, useFactory: (repo: RemindersDataPort, notifications: NotificationsService, push: PushService, db: AppDatabase) => new RemindersService(repo, notifications, push, db ? reminderTemplates(db) : undefined), inject: ['RemindersDataPort', NotificationsService, PushService, DATABASE] },
    ReminderLadderScheduler,   // Oct 21 2026: in-process every 5 min (REMINDER_CRON_ENABLED=1); the /jobs route stays for an outside cron
  ],
  exports: [RemindersService],
})
export class RemindersModule {}

/** Message Templates (740): Appointment Reminders reads its active template binding (Automation Connection Center) */
export function reminderTemplates(db: NonNullable<AppDatabase>): ReminderTemplatePort {
  return {
    resolve: (tenantId, branchId, channel) => resolveBoundTemplate(db, tenantId, branchId, 'appointment_reminder', channel),
    record: (u) => recordTemplateUsage(db, { ...u, workflow: 'appointment_reminder' }),
    render: (t, values) => { const r = renderTemplate(t, values, { ensureStop: t.channel === 'sms' }); return { text: r.text, subject: r.subject, missing: r.missing, unknown: r.unknown }; },
    values: (d) => appointmentValues(d.apptDate ?? null, d.startTime ?? null, d.tz, d.services, d.technicianName ?? null, d.appointmentId),
  };
}
