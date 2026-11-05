// platform-staff.module.ts — Constitution 7 §24–§26.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PlatformStaffController } from './platform-staff.controller';
import { KyselyPlatformStaffRepository } from './platform-staff.repository';

@Module({
  controllers: [PlatformStaffController],
  providers: [{ provide: KyselyPlatformStaffRepository, useFactory: (db: AppDatabase) => (db ? new KyselyPlatformStaffRepository(db as any) : null), inject: [DATABASE] }],
})
export class SuperAdminPlatformStaffModule {}
