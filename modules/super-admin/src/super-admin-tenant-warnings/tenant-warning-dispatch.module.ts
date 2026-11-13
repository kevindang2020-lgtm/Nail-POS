// tenant-warning-dispatch.module.ts — wires the tenant-warning dispatch worker. Senders are real-or-null: a provider is
// only constructed when its full credential set is present, so without creds the job honestly records 'skipped' (never a
// faked 'sent' via a Mock). Kysely repo when a DB handle exists, else the in-memory adapter (empty, never fabricated).
import { type EmailSender, TwilioSmsSender, type SmsSender , emailSenderFromEnv as sharedEmailSender } from '@aipowersalon/notifications';
import { Logger, Module } from '@nestjs/common';
import { TenantWarningDispatchJob, InMemoryTenantWarningDispatchRepo, type TenantWarningDispatchRepo, type OwnerPrefsPort } from './tenant-warning-dispatch.job';
import { staffSendDecision } from '@aipowersalon/communications';
import { KyselyTenantWarningDispatchRepo } from './tenant-warning-dispatch.kysely.repository';
import { TenantWarningDispatchScheduler } from './tenant-warning-dispatch.scheduler';
import { TenantWarningDispatchCronController } from './tenant-warning-dispatch.cron.controller';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

const prefsLog = new Logger('TenantWarningDispatch');
function makeEmail(): EmailSender | null {
  return sharedEmailSender();   // one factory (packages/notifications) — default sender nailsalons@aipowersalon.com
}
function makeSms(): SmsSender | null {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = process.env;
  return TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM
    ? new TwilioSmsSender({ accountSid: TWILIO_ACCOUNT_SID, authToken: TWILIO_AUTH_TOKEN, from: TWILIO_FROM }) : null;
}

@Module({
  controllers: [TenantWarningDispatchCronController],
  providers: [
    {
      provide: TenantWarningDispatchJob,
      useFactory: (db: AppDatabase) => {
        const repo: TenantWarningDispatchRepo = db ? new KyselyTenantWarningDispatchRepo(db) : new InMemoryTenantWarningDispatchRepo();
        const ownerPrefs: OwnerPrefsPort | null = db ? async (tenantId, userId, channel, category) =>
          (await staffSendDecision(db, tenantId, userId, channel, category, (m) => prefsLog.warn(m))).allowed : null;
        return new TenantWarningDispatchJob(repo, makeEmail(), makeSms(), ownerPrefs);
      },
      inject: [DATABASE],
    },
    { provide: TenantWarningDispatchScheduler, useFactory: (job: TenantWarningDispatchJob) => new TenantWarningDispatchScheduler(job), inject: [TenantWarningDispatchJob] },
  ],
})
export class TenantWarningDispatchModule {}
