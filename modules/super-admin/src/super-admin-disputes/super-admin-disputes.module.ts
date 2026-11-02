// super-admin-disputes.module.ts — Super Admin Chargebacks & Disputes. Kysely repo when DATABASE is present, else an
// in-memory stub (honest empty). Mirrors the super-admin-catalog module wiring.
import { Module } from '@nestjs/common';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { InMemoryDisputesRepo, type DisputesRepo } from './disputes.repository';
import { KyselyDisputesRepo } from './disputes.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [DisputesController],
  providers: [
    { provide: 'DisputesRepo', useFactory: (db: AppDatabase): DisputesRepo => (db ? new KyselyDisputesRepo(db) : new InMemoryDisputesRepo()), inject: [DATABASE] },
    { provide: DisputesService, useFactory: (repo: DisputesRepo) => new DisputesService(repo), inject: ['DisputesRepo'] },
  ],
  exports: [DisputesService],
})
export class SuperAdminDisputesModule {}
