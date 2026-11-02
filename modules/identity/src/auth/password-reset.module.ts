// password-reset.module.ts — wires the tenant password-reset controller + service. Uses Postgres (Kysely) ports when a
// DB handle exists, else a DB-less stub. SMS goes through Twilio when TWILIO_* env is set, otherwise a MockSmsSender
// (captures messages; safe for dev/pilot without a Twilio account).
import { Module } from '@nestjs/common';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { makeKyselyResetPorts, makeNullResetPorts } from './password-reset.ports.kysely';
import { type SmsSender, TENANT_MESSENGER, type TenantMessenger, platformSmsSender, smsSenderFromEnv } from '@aipowersalon/notifications';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

function smsFromEnv(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}

@Module({
  controllers: [PasswordResetController],
  providers: [
    { provide: PasswordResetService, useFactory: (db: AppDatabase, messenger?: TenantMessenger) => { const sms = platformSmsSender(messenger, smsFromEnv); return new PasswordResetService(db ? makeKyselyResetPorts(db, sms) : makeNullResetPorts(sms)); }, inject: [DATABASE, { token: TENANT_MESSENGER, optional: true }] },
  ],
  exports: [PasswordResetService],
})
export class PasswordResetModule {}
