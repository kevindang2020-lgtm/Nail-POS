// backup-center.module.ts — G9 Enterprise Backup & Disaster Recovery (Nov 5 2026).
import { Module } from '@nestjs/common';
import { BackupCenterController, BackupCatalogIngestController } from './backup-center.controller';
import { BackupCenterService } from './backup-center.service';

@Module({ controllers: [BackupCenterController, BackupCatalogIngestController], providers: [BackupCenterService], exports: [BackupCenterService] })
export class BackupCenterModule {}
