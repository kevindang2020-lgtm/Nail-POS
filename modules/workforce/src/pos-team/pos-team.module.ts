// pos-team.module.ts — read-only tenant user roster for the Users & Roles screen.
import { Module } from '@nestjs/common';
import { PosTeamController } from './pos-team.controller';
import { PosTeamService } from './pos-team.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [PosTeamController],
  providers: [
    { provide: PosTeamService, useFactory: (db: AppDatabase) => new PosTeamService(db), inject: [DATABASE] },
  ],
  exports: [PosTeamService],
})
export class PosTeamModule {}
