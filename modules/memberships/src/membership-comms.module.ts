// membership-comms.module.ts — member comms controller + service + repository. Kysely-backed when Postgres is present,
// else in-memory (dev/offline/tests).
import { Module } from '@nestjs/common';
import { MembershipCommsController } from './membership-comms.controller';
import { MembershipCommsService } from './membership-comms.service';
import { InMemoryMembershipCommsRepository, type MembershipCommsRepositoryPort } from './membership-comms.repository';
import { KyselyMembershipCommsRepository } from './membership-comms.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TENANT_MESSENGER, type TenantMessenger } from '@aipowersalon/notifications';

@Module({
  controllers: [MembershipCommsController],
  providers: [
    { provide: 'MembershipCommsRepositoryPort', useFactory: (db: AppDatabase): MembershipCommsRepositoryPort => (db ? new KyselyMembershipCommsRepository(db as any) : new InMemoryMembershipCommsRepository()), inject: [DATABASE] },
    // §151 (Oct 28 2026): reminders are also texted through the salon messenger when it is wired (optional — absent = in-app only)
    { provide: MembershipCommsService, useFactory: (repo: MembershipCommsRepositoryPort, messenger?: TenantMessenger | null) => new MembershipCommsService(repo, messenger ?? null), inject: ['MembershipCommsRepositoryPort', { token: TENANT_MESSENGER, optional: true }] },
  ],
  exports: [MembershipCommsService],
})
export class MembershipCommsModule {}
