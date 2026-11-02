// team-staff.module.ts — Team Management round 2 (30 Oct 2026): all-role onboarding, optional birthdays, training &
// certification, and the nightly data-accuracy job. Raw SQL repositories; null (503) without a database.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TeamOnboardingController, TEAM_ONBOARDING } from './team-onboarding.controller';
import { TeamBirthdaysController, TEAM_BIRTHDAYS } from './team-birthdays.controller';
import { TeamTrainingController, TEAM_TRAINING } from './team-training.controller';
import { TeamOnboardingRepository } from './team-onboarding.repository';
import { TeamBirthdaysRepository } from './team-birthdays.repository';
import { TeamTrainingRepository } from './team-training.repository';
import { TeamDataNightlyScheduler } from './team-data-nightly';

@Module({
  controllers: [TeamOnboardingController, TeamBirthdaysController, TeamTrainingController],
  providers: [
    { provide: TEAM_ONBOARDING, useFactory: (db: AppDatabase) => (db ? new TeamOnboardingRepository(db) : null), inject: [DATABASE] },
    { provide: TEAM_BIRTHDAYS, useFactory: (db: AppDatabase) => (db ? new TeamBirthdaysRepository(db) : null), inject: [DATABASE] },
    { provide: TEAM_TRAINING, useFactory: (db: AppDatabase) => (db ? new TeamTrainingRepository(db) : null), inject: [DATABASE] },
    TeamDataNightlyScheduler,
  ],
})
export class TeamStaffModule {}
