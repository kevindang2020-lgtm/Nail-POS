import { Module } from '@nestjs/common';
import { AuditModule } from '@aipowersalon/audit';
import { TenantMessagingCredentialsService } from './tenant-messaging-credentials.service';
import { TenantNumberService } from './tenant-number.service';
import { TenantMessagingController } from './tenant-messaging.controller';
import { PlatformMessagingProvisioner } from './platform-messaging-provisioner';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { TenantMessagingSelfController } from './tenant-messaging.tenant.controller';
import { MessagingOffboardScheduler } from './messaging-offboard.scheduler';
import { TenantMessagingReadinessService } from './tenant-messaging-readiness.service';
import { TenantRegistrationSyncService, MessagingRegistrationSyncScheduler } from './registration-sync.service';
import { MessagingSetupController, MessagingHealthScheduler } from './messaging-setup-center.controller';

@Module({
  imports: [AuditModule],
  controllers: [TenantMessagingController, TenantMessagingSelfController, MessagingSetupController],   // + Text Messaging Setup guide §11–§16
  providers: [TenantMessagingCredentialsService, TenantNumberService, TenantMessagingReadinessService,   // Phone & Messaging guide: the shared readiness + health check
    TenantRegistrationSyncService, MessagingRegistrationSyncScheduler,   // PM-03/PM-04: provider registration sync (+ env-gated scheduled refresh, off by default)
    // B-16: a factory — the class's last two constructor parameters (a fake Twilio, an env) are for tests only
    { provide: PlatformMessagingProvisioner, inject: [DATABASE, AuditService, PROVIDER_SECRETS],
      useFactory: (db: AppDatabase | null, audit: AuditService, secrets: ProviderSecrets) => new PlatformMessagingProvisioner(db, audit, secrets) },
    MessagingOffboardScheduler,
    MessagingHealthScheduler],   // Text Messaging Setup §11: nightly read-only health run (env-gated, off by default)   // §149: cancelled salons' Twilio numbers released + subaccounts closed after the grace period
  exports: [TenantMessagingCredentialsService, TenantNumberService, TenantMessagingReadinessService, TenantRegistrationSyncService],
})
export class TenantMessagingModule {}
