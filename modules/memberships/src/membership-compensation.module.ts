// membership-compensation.module.ts — booking controller + service + repository. Kysely-backed when Postgres is present,
// else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { MembershipCompController } from './membership-compensation.controller';
import { MembershipCompService } from './membership-compensation.service';
import { InMemoryMembershipCompRepository, type MembershipCompRepositoryPort } from './membership-compensation.repository';
import { KyselyMembershipCompRepository } from './membership-compensation.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [MembershipCompController],
  providers: [
    { provide: 'MembershipCompRepositoryPort', useFactory: (db: AppDatabase): MembershipCompRepositoryPort => (db ? new KyselyMembershipCompRepository(db as any) : new InMemoryMembershipCompRepository()), inject: [DATABASE] },
    { provide: MembershipCompService, useFactory: (repo: MembershipCompRepositoryPort) => new MembershipCompService(repo), inject: ['MembershipCompRepositoryPort'] },
  ],
  exports: [MembershipCompService],
})
export class MembershipCompModule {}
