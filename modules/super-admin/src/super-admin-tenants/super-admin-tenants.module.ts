/**
 * super-admin-tenants.module.ts
 * ---------------------------------------------------------------------------
 * Wires the Super Admin Tenants controller + service + repository.
 *
 * The repository is provided via the `SUPER_ADMIN_TENANTS_REPO` token. When a DB
 * handle is present it binds to the Kysely (Postgres) implementation; otherwise it
 * falls back to the in-memory implementation so the module is runnable offline.
 *
 * Mount this module behind the same auth pipeline that populates req.ctx; the
 * controller additionally enforces the `super-admin` guard.
 */

import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { SmsPackagesModule, SmsTenantPlanService } from '@aipowersalon/communications';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { Module } from '@nestjs/common';
import { SuperAdminTenantsController } from './super-admin-tenants.controller';
import { SuperAdminTenantsService } from './super-admin-tenants.service';
import {
  InMemorySuperAdminTenantsRepo,
  type SuperAdminTenantsRepo,
} from './super-admin-tenants.repository';
import { KyselySuperAdminTenantsRepo } from './super-admin-tenants.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import type { RealtimeEmitter } from '@aipowersalon/realtime-contracts';   // the port; REALTIME supplies the API's emitter
import { REALTIME } from '@aipowersalon/realtime-contracts';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';
import { credentialDeliveryFor } from '../admin-credential-delivery';
import { TenantPosLanguageService } from './tenant-pos-language';

export const SUPER_ADMIN_TENANTS_REPO = Symbol('SUPER_ADMIN_TENANTS_REPO');

@Module({
  imports: [EventsCoreModule, SmsPackagesModule],
  controllers: [SuperAdminTenantsController],
  providers: [
    {
      provide: SUPER_ADMIN_TENANTS_REPO,
      useFactory: (db: AppDatabase, outbox: OutboxWriter): SuperAdminTenantsRepo => (db ? new KyselySuperAdminTenantsRepo(db, outbox) : new InMemorySuperAdminTenantsRepo()),
      inject: [DATABASE, OutboxWriter],
    },
    {
      provide: SuperAdminTenantsService,
      // C2: an owner reset reaches the owner only (credentialDeliveryFor: email / SMS, never the caller)
      useFactory: (repo: SuperAdminTenantsRepo, plans: SmsTenantPlanService, rt: RealtimeEmitter, db: AppDatabase, messenger?: TenantMessenger) => new SuperAdminTenantsService(repo, plans, rt, credentialDeliveryFor(db, messenger)),
      inject: [SUPER_ADMIN_TENANTS_REPO, SmsTenantPlanService, REALTIME, DATABASE, { token: TENANT_MESSENGER, optional: true }],
    },
    {
      provide: TenantPosLanguageService,   // Vietnamese POS mandate WP-A §93 (null without a database → the route answers 503)
      useFactory: (db: AppDatabase, rt: RealtimeEmitter) => (db ? new TenantPosLanguageService(db, rt) : null),
      inject: [DATABASE, REALTIME],
    },
    {
      provide: PaymentGatewayResolver,
      useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets),
      inject: [DATABASE, PAYMENT_SECRETS],
    },
  ],
  exports: [SuperAdminTenantsService],
})
export class SuperAdminTenantsModule {}
