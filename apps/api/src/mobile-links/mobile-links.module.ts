// mobile-links.module.ts — BUILD_PLAN Phase 13 D (Constitution 6 §64–65): the universal-link / App Link association files.
import { Module } from '@nestjs/common';
import { MobileLinksController } from './mobile-links.controller';
@Module({ controllers: [MobileLinksController] })
export class MobileLinksModule {}
