// system-reset.module.ts — wires the admin/super-admin reset + temp-password controller + service. Kysely ports when a
// DB handle exists, else a DB-less stub. SMS via Twilio (TWILIO_*) or mock; Email via SendGrid (SENDGRID_*) or mock.
import { type SmsSender, TENANT_MESSENGER, type TenantMessenger, platformSmsSender, type EmailSender, smsSenderFromEnv, messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import { Module } from '@nestjs/common';
import { SystemResetController } from './system-reset.controller';
import { SystemPasswordResetService } from './system-password-reset.service';
import { makeKyselySystemResetPorts, makeNullSystemResetPorts } from './system-reset.ports.kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService, auditSinkFor } from '@aipowersalon/audit';
import { SecurityEvents } from '@aipowersalon/security-center';
import { attemptLockoutRecorder } from './auth-attempt-budget';

function smsFromEnv(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}
function emailFromEnv(): EmailSender {
  return messagingEmailSenderFromEnv();   // P-11: SendGrid when configured; never a mock in production (not configured there); default sender nailsalons@aipowersalon.com
}

@Module({
  controllers: [SystemResetController],
  providers: [
    // Security Deep Scan A2/C12: the audit port writes through the platform audit writer (AuditModule is @Global), and an
    // exhausted temporary-password budget is a HIGH security event.
    { provide: SystemPasswordResetService,
      useFactory: (db: AppDatabase, messenger?: TenantMessenger, audit?: AuditService | null, securityEvents?: SecurityEvents | null) => {
        const sms = platformSmsSender(messenger, smsFromEnv);
        const sink = audit ? auditSinkFor(audit) : null;
        return new SystemPasswordResetService(db
          ? makeKyselySystemResetPorts(db, sms, emailFromEnv(), { audit: sink, budget: { onLockout: attemptLockoutRecorder(securityEvents) } })
          : makeNullSystemResetPorts(sms, emailFromEnv(), sink));
      },
      inject: [DATABASE, { token: TENANT_MESSENGER, optional: true }, { token: AuditService, optional: true }, { token: SecurityEvents, optional: true }] },
  ],
  exports: [SystemPasswordResetService],
})
export class SystemResetModule {}
