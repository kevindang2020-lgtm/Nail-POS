import { Module } from '@nestjs/common';
import { AuditModule } from '@aipowersalon/audit';
import { TenantMessagingCredentialsService } from './tenant-messaging-credentials.service';
import { TenantNumberService } from './tenant-number.service';
import { TenantMessagingController } from './tenant-messaging.controller';
import { TenantMessagingSelfController } from './tenant-messaging.tenant.controller';

@Module({
  imports: [AuditModule],
  controllers: [TenantMessagingController, TenantMessagingSelfController],
  providers: [TenantMessagingCredentialsService, TenantNumberService],
  exports: [TenantMessagingCredentialsService, TenantNumberService],
})
export class TenantMessagingModule {}
