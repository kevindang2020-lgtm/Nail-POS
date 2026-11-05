// system-reset.module.ts — wires the admin/super-admin reset + temp-password controller + service. Kysely ports when a
// DB handle exists, else a DB-less stub. SMS via Twilio (TWILIO_*) or mock; Email via SendGrid (SENDGRID_*) or mock.
import { type SmsSender, TENANT_MESSENGER, type TenantMessenger, platformSmsSender, type EmailSender, smsSenderFromEnv, messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import { Module } from '@nestjs/common';
import { SystemResetController } from './system-reset.controller';
import { SystemPasswordResetService } from './system-password-reset.service';
import { makeKyselySystemResetPorts, makeNullSystemResetPorts } from './system-reset.ports.kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

function smsFromEnv(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}
function emailFromEnv(): EmailSender {
  return messagingEmailSenderFromEnv();   // P-11: SendGrid when configured; never a mock in production (not configured there); default sender nailsalons@aipowersalon.com
}

@Module({
  controllers: [SystemResetController],
  providers: [
    { provide: SystemPasswordResetService, useFactory: (db: AppDatabase, messenger?: TenantMessenger) => { const sms = platformSmsSender(messenger, smsFromEnv); return new SystemPasswordResetService(db ? makeKyselySystemResetPorts(db, sms, emailFromEnv()) : makeNullSystemResetPorts(sms, emailFromEnv())); }, inject: [DATABASE, { token: TENANT_MESSENGER, optional: true }] },
  ],
  exports: [SystemPasswordResetService],
})
export class SystemResetModule {}
