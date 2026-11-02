/* owner.module.ts — wires the Owner App controller + service, binding the Kysely OwnerDataPort when a DB handle exists
 * (else the empty in-memory port, so a DB-less deployment reports no data rather than fabricating). */
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { AiCenterModule, AiCenterService } from '@aipowersalon/ai';
import { TechCashHandoffModule, PayrollModule, PayrollService } from '@aipowersalon/workforce';
import { Module } from '@nestjs/common';
import { OwnerController } from './owner.controller';
import { OwnerService } from './owner.service';
import { InMemoryOwnerRepository, type OwnerDataPort } from './owner.repository';
import { KyselyOwnerRepository } from './owner.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { CashDrawerModule } from '@aipowersalon/checkout';
import { MembershipsModule } from '@aipowersalon/memberships';

@Module({
  imports: [EventsCoreModule, TechCashHandoffModule, CashDrawerModule, PayrollModule, AiCenterModule, MembershipsModule],
  controllers: [OwnerController],   // the SSE endpoint lives in domain-streams/ (Constitution 13),
  providers: [
    { provide: 'OwnerDataPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): OwnerDataPort => (db ? new KyselyOwnerRepository(db, outbox) : new InMemoryOwnerRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: OwnerService, useFactory: (repo: OwnerDataPort, rt: RealtimeEmitter, payroll: PayrollService, aiCenter: AiCenterService) => new OwnerService(repo, rt, payroll, aiCenter), inject: ['OwnerDataPort', REALTIME, PayrollService, AiCenterService] },
  ],
  exports: [OwnerService],
})
export class OwnerModule {}
