import { Module } from '@nestjs/common';
import { SuperAdminBillingModule } from '../super-admin-billing/super-admin-billing.module';
import { TenantBillingController } from './tenant-billing.controller';
@Module({ imports: [SuperAdminBillingModule], controllers: [TenantBillingController] })
export class TenantBillingModule {}
