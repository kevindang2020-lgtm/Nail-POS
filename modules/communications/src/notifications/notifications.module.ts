// notifications.module.ts — tenant-facing notifications. Reuses the auth SMS/Email senders (Twilio/SendGrid when
// env creds are set, Mock otherwise). MERGE NOTE: Project B wired its standalone UsageLimitsService as the credit
// meter. In this merged tree, usage-limit data lives in Project A's canonical tenant_usage_limits table, so we
// meter through TenantUsageLimitsMeter (raw SQL against that table) — preserving B's credit enforcement without
// re-introducing B's duplicate usage-limits module/routes.
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { type SmsSender, type EmailSender, smsSenderFromEnv, messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import { Global, Module } from "@nestjs/common";
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { OutboxWriter } from '@aipowersalon/events';
import { TENANT_MESSENGER } from '@aipowersalon/notifications';
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { InMemoryNotificationsRepository, type NotificationsRepositoryPort } from "./notifications.repository";
import { KyselyNotificationsRepository } from "./notifications.kysely.repository";
import { InMemoryOptOutRepository, type OptOutPort } from "./notifications.optout.repository";
import { KyselyOptOutRepository } from "./notifications.optout.kysely.repository";
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TenantUsageLimitsMeter } from "./notifications.credit-meter";
import { KyselySenderNumberResolver, NullSenderNumberResolver, type SenderNumberResolver } from "./notifications.sender-numbers";
import { KyselyTenantSmsSenderResolver, NullTenantSmsSenderResolver, type TenantSmsSenderResolver } from "./notifications.tenant-sender";
import type { NotificationMeter } from "./notifications.service";
import { KyselyEmailPolicy, type EmailPolicyPort } from "../email/email-policy";

function makeSmsSender(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}
function makeEmailSender(): EmailSender {
  return messagingEmailSenderFromEnv();   // P-11: SendGrid when configured; never a mock in production (not configured there); default sender nailsalons@aipowersalon.com
}

@Module({
  imports: [EventsCoreModule],   // Phase 2: every SMS ledger row commits with its communication.* event
  controllers: [NotificationsController],
  providers: [
    { provide: "NotificationsRepositoryPort", useFactory: (db: AppDatabase, outbox: OutboxWriter): NotificationsRepositoryPort => (db ? new KyselyNotificationsRepository(db, outbox) : new InMemoryNotificationsRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: "NotifOptOutPort", useFactory: (db: AppDatabase): OptOutPort => (db ? new KyselyOptOutRepository(db) : new InMemoryOptOutRepository()), inject: [DATABASE] },
    { provide: "NotifSms", useFactory: makeSmsSender },
    { provide: "NotifEmail", useFactory: makeEmailSender },
    { provide: "NotifMeter", useFactory: (db: AppDatabase): NotificationMeter | undefined => (db ? new TenantUsageLimitsMeter(db) : undefined), inject: [DATABASE] },
    { provide: "NotifSenderNumbers", useFactory: (db: AppDatabase): SenderNumberResolver => (db ? new KyselySenderNumberResolver(db as any) : new NullSenderNumberResolver()), inject: [DATABASE] },
    { provide: "NotifTenantSender", useFactory: (db: AppDatabase, secrets: ProviderSecrets): TenantSmsSenderResolver => (db ? new KyselyTenantSmsSenderResolver(db as any, secrets) : new NullTenantSmsSenderResolver()), inject: [DATABASE, PROVIDER_SECRETS] },
    { provide: "NotifEmailPolicy", useFactory: (db: AppDatabase): EmailPolicyPort | undefined => (db ? new KyselyEmailPolicy(db) : undefined), inject: [DATABASE] },
    { provide: NotificationsService, useFactory: (repo: NotificationsRepositoryPort, sms: SmsSender, email: EmailSender, meter: NotificationMeter | undefined, optOut: OptOutPort, senderNumbers: SenderNumberResolver, tenantSender: TenantSmsSenderResolver, emailPolicy: EmailPolicyPort | undefined) => new NotificationsService(repo, sms, email, meter, optOut, senderNumbers, tenantSender, emailPolicy), inject: ["NotificationsRepositoryPort", "NotifSms", "NotifEmail", "NotifMeter", "NotifOptOutPort", "NotifSenderNumbers", "NotifTenantSender", "NotifEmailPolicy"] },
    { provide: TENANT_MESSENGER, useExisting: NotificationsService },   // Phase 2: the one send path, by token
  ],
  exports: [NotificationsService, "NotifOptOutPort", "NotifEmail", TENANT_MESSENGER],
})
export class NotificationsModule {}

/** Makes TENANT_MESSENGER injectable everywhere (receipts in checkout, activation codes, reminders) without each module
 *  importing communications. Imported once, by the API's AppModule. */
@Global()
@Module({ imports: [NotificationsModule], exports: [NotificationsModule] })
export class MessengerModule {}
