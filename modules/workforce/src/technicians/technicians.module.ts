// technicians.module.ts — POS Technicians controller + service + repository. Kysely-backed adapter when a Postgres
// handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { SuperAdminPlansModule, EntitlementsService } from '@aipowersalon/platform';
import { Module } from '@nestjs/common';
import { TechniciansController } from './technicians.controller';
import { TechniciansService } from './technicians.service';
import { InMemoryTechniciansRepository, type TechniciansRepositoryPort } from './technicians.repository';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';
import { KyselyTechniciansAuditSink, NoopTechniciansAuditSink, type TechniciansAuditSink } from './technicians-audit.kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TechProfileModule } from '../tech-profile/tech-profile.module';
import { GlobalTechIdentityService } from '../tech-profile/global-tech-identity.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import { TimeClockModule } from '../time-clock/time-clock.module';
import { TimeClockService } from '../time-clock/time-clock.service';

@Module({
  // TechProfileModule owns global_tech_profiles / tech_salon_memberships already — the identity service is
  // imported from there rather than rebuilt here. It does NOT import TechniciansModule, so there is no cycle.
  // TimeClockModule: the legacy PATCH /shifts route now clocks through the time clock (server time). It does not
  // import TechniciansModule, so there is no cycle. WorkforceStatusService is @Global (registered by TimeClockModule).
  imports: [SuperAdminPlansModule, TechProfileModule, TimeClockModule],
  controllers: [TechniciansController],
  providers: [
    { provide: 'TechniciansRepositoryPort', useFactory: (db: AppDatabase, wf?: WorkforceStatusService): TechniciansRepositoryPort => (db ? new KyselyTechniciansRepository(db, wf ?? null) : new InMemoryTechniciansRepository()), inject: [DATABASE, { token: WorkforceStatusService, optional: true }] },
    { provide: 'TechniciansAuditSink', useFactory: (db: AppDatabase): TechniciansAuditSink => (db ? new KyselyTechniciansAuditSink(db) : new NoopTechniciansAuditSink()), inject: [DATABASE] },
    { provide: TechniciansService, useFactory: (repo: TechniciansRepositoryPort, ent: EntitlementsService, identity: GlobalTechIdentityService, sink: TechniciansAuditSink, rt?: RealtimeEmitter, wf?: WorkforceStatusService, tc?: TimeClockService) => new TechniciansService(repo, ent, identity, sink, rt ?? null, wf ?? null, tc ?? null), inject: ['TechniciansRepositoryPort', EntitlementsService, GlobalTechIdentityService, 'TechniciansAuditSink', { token: REALTIME, optional: true }, { token: WorkforceStatusService, optional: true }, { token: TimeClockService, optional: true }] },
  ],
  exports: [TechniciansService, 'TechniciansRepositoryPort'],
})
export class TechniciansModule {}
