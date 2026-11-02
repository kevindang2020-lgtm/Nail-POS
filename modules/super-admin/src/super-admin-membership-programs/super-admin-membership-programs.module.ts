// super-admin-membership-programs.module.ts — canonical Membership Programs oversight module.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MembershipProgramsController } from './membership-programs.controller';
import { MembershipProgramsRepository } from './membership-programs.repository';

@Module({
  controllers: [MembershipProgramsController],
  providers: [
    { provide: MembershipProgramsRepository, useFactory: (db: AppDatabase) => new MembershipProgramsRepository(db), inject: [DATABASE] },
  ],
  exports: [MembershipProgramsRepository],
})
export class SuperAdminMembershipProgramsModule {}
