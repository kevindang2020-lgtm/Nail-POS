// mobile-config.module.ts — BUILD_PLAN Phase 13 B (Constitution 6 §52–57, §150, §219–220): app versions, /app-config,
// the UPDATE_REQUIRED gate and the Super Admin version dashboard.
import { Module } from '@nestjs/common';
import { MaintenanceModule } from '@aipowersalon/super-admin';
import { DATABASE } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { PlatformFlagsModule } from '../common/platform-flags';
import { MobileVersionsService } from './mobile-versions.service';
import { AppConfigService } from './app-config.service';
import { AppConfigController, MobileVersionsController } from './app-config.controller';
import { UpdateRequiredMiddleware } from './update-required.middleware';

@Module({
  imports: [MaintenanceModule, PlatformFlagsModule],
  controllers: [AppConfigController, MobileVersionsController],
  providers: [
    // a factory: the service's third constructor argument is a clock for tests, not something Nest should inject
    { provide: MobileVersionsService, useFactory: (db: any, audit?: AuditService) => new MobileVersionsService(db ?? null, audit), inject: [{ token: DATABASE, optional: true }, { token: AuditService, optional: true }] },
    AppConfigService, UpdateRequiredMiddleware,
  ],
  exports: [MobileVersionsService, UpdateRequiredMiddleware],
})
export class MobileConfigModule {}
