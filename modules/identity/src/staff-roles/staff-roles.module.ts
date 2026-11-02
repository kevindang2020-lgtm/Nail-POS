// staff-roles.module.ts — Functional Decision 12: the salon's staff-roles endpoints. BUILD_PLAN Phase 9: the outbox
// (AUTHORIZATION_CHANGED with every change) and the shared authorization-state cache (dropped in-process on a change).
import { Module } from '@nestjs/common';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { StaffRolesController } from './staff-roles.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [EventsCoreModule, AuthModule], controllers: [StaffRolesController] })
export class StaffRolesModule {}
