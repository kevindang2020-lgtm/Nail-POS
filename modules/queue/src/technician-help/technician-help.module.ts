// technician-help.module.ts — wires the Request-Help workflow. Binds the Kysely repo when a DB is present (in-memory
// fallback otherwise), an eligibility adapter that delegates to the canonical TechniciansService.isQualified gate
// (Phase 2), and a realtime adapter over the shared emitter. The controller reuses the tech module's TechDataPort to
// resolve the acting technician.
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { TechniciansModule, type TechniciansRepositoryPort } from '@aipowersalon/workforce';
import { Module } from '@nestjs/common';
import { TechnicianHelpController } from './technician-help.controller';
import { TechnicianHelpService, type HelpRepositoryPort, type HelpEligibilityPort } from './technician-help.service';
import { KyselyHelpRepository } from './technician-help.kysely.repository';
import { InMemoryHelpRepository } from './technician-help.repository';
import { TechModule } from '../tech/tech.module';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';

const techCtx = (tenantId: string, branchId: string | null) => ({ tenantId, branchId: branchId ?? '', userId: '', role: 'TECHNICIAN', permissions: [] as string[] });

@Module({
  imports: [EventsCoreModule, TechniciansModule, TechModule],
  controllers: [TechnicianHelpController],
  providers: [
    { provide: 'HelpRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): HelpRepositoryPort => (db ? new KyselyHelpRepository(db, outbox) : new InMemoryHelpRepository()), inject: [DATABASE, OutboxWriter] },
    {
      provide: 'HelpEligibilityPort',
      // Reuses the canonical technician_services eligibility mapping directly at the repo layer (perm-less: the help
      // controller already authorizes by technician identity). Same data the manager-permissioned TechniciansService gate uses.
      useFactory: (techRepo: TechniciansRepositoryPort): HelpEligibilityPort => ({
        isQualified: async (tenantId, branchId, technicianId, serviceId) => (await techRepo.listQualified(techCtx(tenantId, branchId), serviceId)).some((t) => t.technicianId === technicianId),
        listQualified: (tenantId, branchId, serviceId) => techRepo.listQualified(techCtx(tenantId, branchId), serviceId),
      }),
      inject: ['TechniciansRepositoryPort'],
    },
    {
      provide: TechnicianHelpService,
      useFactory: (repo: HelpRepositoryPort, elig: HelpEligibilityPort, rt: RealtimeEmitter): TechnicianHelpService =>
        new TechnicianHelpService(repo, elig, {
          // §343 exempt: a port adapter that only forwards — the pushes themselves are counted where the service makes them
          toTechnician: (id, ev, p) => rt.toTechnician(id, ev as any, p),
          // §343 exempt: a port adapter that only forwards — the pushes themselves are counted where the service makes them
          toTenant: (ctx, ev, p) => rt.toTenant(ctx as any, ev as any, p),
        }),
      inject: ['HelpRepositoryPort', 'HelpEligibilityPort', REALTIME],
    },
  ],
  exports: [TechnicianHelpService],
})
export class TechnicianHelpModule {}
