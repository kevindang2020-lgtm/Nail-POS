// pos-project-status.module.ts — registers the POS project-status surface.
import { Module } from '@nestjs/common';
import { PosProjectStatusController } from './pos-project-status.controller';
import { PosProjectStatusService } from './pos-project-status.service';

@Module({ controllers: [PosProjectStatusController], providers: [PosProjectStatusService], exports: [PosProjectStatusService] })
export class PosProjectStatusModule {}
