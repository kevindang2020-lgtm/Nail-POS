// membership-enroll.module.ts — enrollment/reservation/redemption controller + service + repository. Kysely-backed when
// Postgres is present, else in-memory (dev/offline/tests).
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { MembershipEnrollController } from './membership-enroll.controller';
import { MembershipEnrollService } from './membership-enroll.service';
import { InMemoryMembershipEnrollRepository, type MembershipEnrollRepositoryPort } from './membership-enroll.repository';
import { KyselyMembershipEnrollRepository } from './membership-enroll.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MembershipCommsModule } from './membership-comms.module';
import { MembershipCommsService } from './membership-comms.service';

@Module({
  controllers: [MembershipEnrollController],
  imports: [EventsCoreModule, MembershipCommsModule],
  providers: [
    { provide: 'MembershipEnrollRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): MembershipEnrollRepositoryPort => (db ? new KyselyMembershipEnrollRepository(db as any, outbox) : new InMemoryMembershipEnrollRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: MembershipEnrollService, useFactory: (repo: MembershipEnrollRepositoryPort, comms: MembershipCommsService) => new MembershipEnrollService(repo, comms), inject: ['MembershipEnrollRepositoryPort', MembershipCommsService] },
  ],
  exports: [MembershipEnrollService],
})
export class MembershipEnrollModule {}
