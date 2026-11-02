// memberships.module.ts — Memberships controller + service + repository. The repository is the Kysely-backed adapter
// when a Postgres handle exists, else the in-memory adapter (dev/offline/tests) — identical wiring to the Bundles module.
import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { InMemoryMembershipsRepository, type MembershipsRepositoryPort } from './memberships.repository';
import { KyselyMembershipsRepository } from './memberships.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MembershipListsController, MembershipListsRepository, MEMBERSHIP_LISTS } from './membership-lists';

@Module({
  controllers: [MembershipsController, MembershipListsController],   // + Membership Overview mandate (Oct 29 2026): View All lists, plan performance, discounts
  providers: [
    { provide: 'MembershipsRepositoryPort', useFactory: (db: AppDatabase): MembershipsRepositoryPort => (db ? new KyselyMembershipsRepository(db as any) : new InMemoryMembershipsRepository()), inject: [DATABASE] },
    { provide: MEMBERSHIP_LISTS, useFactory: (db: AppDatabase) => (db ? new MembershipListsRepository(db) : null), inject: [DATABASE] },
    { provide: MembershipsService, useFactory: (repo: MembershipsRepositoryPort) => new MembershipsService(repo), inject: ['MembershipsRepositoryPort'] },
  ],
  exports: [MembershipsService],
})
export class MembershipsModule {}
