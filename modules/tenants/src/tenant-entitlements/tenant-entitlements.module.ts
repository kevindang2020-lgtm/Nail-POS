import { Module } from '@nestjs/common';
import { SuperAdminPlansModule } from '@aipowersalon/platform';
import { TenantEntitlementsController } from './tenant-entitlements.controller';
@Module({ imports: [SuperAdminPlansModule], controllers: [TenantEntitlementsController] })
export class TenantEntitlementsModule {}
