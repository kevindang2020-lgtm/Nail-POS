/**
 * tech.module.ts — wires the Technician-mobile controller + service. Binds the TechDataPort: the Kysely (Postgres)
 * adapter when a database handle exists, else the empty in-memory port (so a DB-less deployment reports no data rather
 * than fabricating). The Kysely adapter is STAGED — type-checked but not yet run against a live DB (see
 * INTEGRATION_RUNBOOK §8); its status mappings and transition side-effects must be reconciled against real data.
 */
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { ServingModule } from '../serving/serving.module';
import { ServingService } from '../serving/serving.service';
import { Module } from '@nestjs/common';
import { TechController } from './tech.controller';
import { TechSelfServiceController } from './tech-self-service.controller';
import { TechCertificationsController, PosTechnicianCertificationsController } from './technician-certifications.controller';
import { TechnicianCertificationsService } from './technician-certifications';
import { CertificationExpiryScheduler } from './certification-expiry.scheduler';
import { TechService } from './tech.service';
import { MembershipEnrollModule } from '@aipowersalon/memberships';
import { InMemoryTechRepository, type TechDataPort } from './tech.repository';
import { KyselyTechRepository } from './tech.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { CompensationSnapshotRepository, PayrollSelfService, TimeClockModule, TimeClockService, TechnicianEligibilityModule, TechnicianEligibilityService } from '@aipowersalon/workforce';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';

@Module({
  // Oct 12 2026 merge: TechnicianEligibilityModule (@Global) — THE eligibility function on the technician's own accept/start.
  imports: [EventsCoreModule, ServingModule, MembershipEnrollModule, TimeClockModule, TechnicianEligibilityModule],
  controllers: [TechController, TechSelfServiceController, TechCertificationsController, PosTechnicianCertificationsController],   // the SSE endpoint lives with the realtime transport (realtime/domain-streams.module.ts)
  providers: [
    { provide: 'TechDataPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): TechDataPort => (db ? new KyselyTechRepository(db, outbox) : new InMemoryTechRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: TechService, useFactory: (repo: TechDataPort, rt: RealtimeEmitter, serving: ServingService, db: AppDatabase, clock: TimeClockService, eligibility: TechnicianEligibilityService | null) => new TechService(repo, rt, serving, db ? new CompensationSnapshotRepository(db) : undefined, clock, eligibility ?? null, db ? new PayrollSelfService(db as any) : null), inject: ['TechDataPort', REALTIME, ServingService, DATABASE, TimeClockService, { token: TechnicianEligibilityService, optional: true }] },
    // Certifications (migration 584) + the 30/14/7-day expiry sweep (off unless CERT_EXPIRY_REMINDER_ENABLED).
    { provide: TechnicianCertificationsService, useFactory: (db: AppDatabase, repo: TechDataPort) => new TechnicianCertificationsService(db ? (db as any) : null, repo), inject: [DATABASE, 'TechDataPort'] },
    { provide: CertificationExpiryScheduler, useFactory: (certs: TechnicianCertificationsService, db: AppDatabase) => new CertificationExpiryScheduler(certs, db ? (db as any) : null), inject: [TechnicianCertificationsService, DATABASE] },
  ],
  exports: [TechService, 'TechDataPort'],
})
export class TechModule {}
