// membership-comms.module.ts — member comms controller + service + repository. Kysely-backed when Postgres is present,
// else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { MembershipCommsController } from './membership-comms.controller';
import { MembershipCommsService } from './membership-comms.service';
import { InMemoryMembershipCommsRepository, type MembershipCommsRepositoryPort } from './membership-comms.repository';
import { KyselyMembershipCommsRepository } from './membership-comms.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [MembershipCommsController],
  providers: [
    { provide: 'MembershipCommsRepositoryPort', useFactory: (db: AppDatabase): MembershipCommsRepositoryPort => (db ? new KyselyMembershipCommsRepository(db as any) : new InMemoryMembershipCommsRepository()), inject: [DATABASE] },
    { provide: MembershipCommsService, useFactory: (repo: MembershipCommsRepositoryPort) => new MembershipCommsService(repo), inject: ['MembershipCommsRepositoryPort'] },
  ],
  exports: [MembershipCommsService],
})
export class MembershipCommsModule {}
