/**
 * customer.module.ts — wires the customer-facing controller + service. Binds the Postgres (Kysely) CustomerDataPort
 * when a DB handle is present (resolving the customer via the customers.user_id link added in migration 030), and falls
 * back to the in-memory adapter (returns no data) for a DB-less deployment.
 */
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { type SmsSender, type EmailSender, TENANT_MESSENGER, type TenantMessenger, smsSenderFromEnv, messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { InMemoryCustomerRepository, type CustomerDataPort } from './customer.repository';
import { KyselyCustomerRepository } from './customer.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { MembershipEnrollModule } from '@aipowersalon/memberships';
import { CustomerPhoneModule } from '@aipowersalon/booking';
import { QueueModule } from '@aipowersalon/queue';

function smsFromEnv(): SmsSender {
  return smsSenderFromEnv();   // P-11: Twilio when configured; never a mock in production (not configured there)
}

function emailFromEnv(): EmailSender {
  return messagingEmailSenderFromEnv();   // P-11: SendGrid when configured; never a mock in production (not configured there); default sender nailsalons@aipowersalon.com
}

import { TechProfileModule } from '@aipowersalon/workforce';

@Module({
  imports: [EventsCoreModule, MembershipEnrollModule, TechProfileModule, CustomerPhoneModule, QueueModule],   // QueueModule: GET customer/queue's requested technician + alternates (BUILD_PLAN Phase 6)   // CustomerPhoneModule: the ONE phone path (Phase 3; /customer/profile/phone/*)   // TechProfileModule: the MEDIA_STORAGE port for avatar uploads (developer merge Sep 2026)
  controllers: [CustomerController],   // the SSE endpoint lives with the realtime transport (realtime/domain-streams.module.ts)
  providers: [
    { provide: 'CustomerDataPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): CustomerDataPort => (db ? new KyselyCustomerRepository(db, outbox) : new InMemoryCustomerRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: CustomerService, useFactory: (repo: CustomerDataPort, audit: AuditService, messenger?: TenantMessenger) => new CustomerService(repo, smsFromEnv(), audit, emailFromEnv(), messenger ?? undefined), inject: ['CustomerDataPort', AuditService, { token: TENANT_MESSENGER, optional: true }] },
  ],
  exports: [CustomerService, 'CustomerDataPort'],
})
export class CustomerModule {}
