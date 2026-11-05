// super-admin-memberships.module.ts — wires the read-only platform Membership Overview over the platform DB.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminMembershipsService } from './super-admin-memberships.service';
import { SuperAdminMembershipsKyselyRepository } from './super-admin-memberships.kysely.repository';
import { SuperAdminMembershipsController } from './super-admin-memberships.controller';

@Module({
  controllers: [SuperAdminMembershipsController],
  providers: [
    {
      provide: SuperAdminMembershipsService,
      useFactory: (db: AppDatabase) => new SuperAdminMembershipsService(new SuperAdminMembershipsKyselyRepository(db as any)),
      inject: [DATABASE],
    },
  ],
  exports: [SuperAdminMembershipsService],
})
export class SuperAdminMembershipsModule {}
