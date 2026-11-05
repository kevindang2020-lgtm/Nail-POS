// team-screens.module.ts — the read models behind the rebuilt Team screens (Oct 30 2026). Raw SQL repositories over the
// canonical tables; null (503 SERVICE_UNAVAILABLE) without a database — nothing is ever served from memory.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { ShiftOverrideController, SHIFT_OVERRIDES } from './shift-override.controller';
import { ShiftOverrideRepository } from './shift-override.repository';
import { TechniciansScreenController, TECHNICIANS_SCREEN } from './technicians-screen.controller';
import { TechniciansScreenRepository } from './technicians-screen.repository';
import { TechAppointmentsScreenController, TECH_APPOINTMENTS_SCREEN } from './tech-appointments-screen.controller';
import { TechAppointmentsScreenRepository } from './tech-appointments-screen.repository';
import { LiveScheduleScreenController, LIVE_SCHEDULE_SCREEN } from './live-schedule-screen.controller';
import { LiveScheduleScreenRepository } from './live-schedule-screen.repository';
import { TechQueueScreenController, TECH_QUEUE_SCREEN } from './tech-queue-screen.controller';
import { TechQueueScreenRepository } from './tech-queue-screen.repository';
import { CommissionScreenController, COMMISSION_SCREEN } from './commission-screen.controller';
import { CommissionScreenRepository } from './commission-screen.repository';
import { TeamPerformanceScreenController, TEAM_PERFORMANCE_SCREEN } from './team-performance-screen.controller';
import { TeamPerformanceScreenRepository } from './team-performance-screen.repository';
import { CommissionReviewController, COMMISSION_REVIEW } from './commission-review.controller';
import { CommissionReviewRepository } from './commission-review.repository';
import { TeamMembersScreenController, TEAM_MEMBERS_SCREEN } from './team-members-screen.controller';
import { TeamMembersScreenRepository } from './team-members-screen.repository';
import { TeamMembersLookupController, TEAM_MEMBERS_LOOKUP } from './team-members-lookup.controller';
import { TeamMembersLookupRepository } from './team-members-lookup.repository';
import { TeamDataAlertsController, TEAM_DATA_ALERTS } from './team-data-alerts.controller';
import { TeamDataAlertsRepository } from './team-data-alerts.repository';
import { WeeklyDaysOffController, SkillsCatalogController, WEEKLY_DAYS_OFF, SKILLS_CATALOG } from './weekly-off-skills.controller';
import { WeeklyDaysOffRepository } from './weekly-days-off.repository';
import { SkillsCatalogRepository } from './skills-catalog.repository';

@Module({
  imports: [EventsCoreModule],
  controllers: [ShiftOverrideController, TechniciansScreenController, TechAppointmentsScreenController, LiveScheduleScreenController, TechQueueScreenController, CommissionScreenController, TeamPerformanceScreenController, CommissionReviewController, TeamMembersScreenController, TeamDataAlertsController, TeamMembersLookupController, WeeklyDaysOffController, SkillsCatalogController],
  providers: [
    // Team Management (30 Oct 2026): the /tenant/team/members read model and its Data Accuracy Alerts (migration 722)
    { provide: TEAM_MEMBERS_SCREEN, useFactory: (db: AppDatabase) => (db ? new TeamMembersScreenRepository(db) : null), inject: [DATABASE] },
    { provide: TEAM_MEMBERS_LOOKUP, useFactory: (db: AppDatabase) => (db ? new TeamMembersLookupRepository(db) : null), inject: [DATABASE] },
    { provide: TEAM_DATA_ALERTS, useFactory: (db: AppDatabase) => (db ? new TeamDataAlertsRepository(db) : null), inject: [DATABASE] },
    // Technician Profile guide (Nov 5 2026, G3, migration 816): repeating weekly days off + the Skills Catalog
    { provide: WEEKLY_DAYS_OFF, useFactory: (db: AppDatabase, outbox: OutboxWriter) => (db ? new WeeklyDaysOffRepository(db, outbox) : null), inject: [DATABASE, OutboxWriter] },
    { provide: SKILLS_CATALOG, useFactory: (db: AppDatabase) => (db ? new SkillsCatalogRepository(db) : null), inject: [DATABASE] },
    { provide: SHIFT_OVERRIDES, useFactory: (db: AppDatabase, outbox: OutboxWriter) => (db ? new ShiftOverrideRepository(db, outbox) : null), inject: [DATABASE, OutboxWriter] },
    { provide: COMMISSION_REVIEW, useFactory: (db: AppDatabase, rt: RealtimeEmitter) => (db ? new CommissionReviewRepository(db, rt) : null), inject: [DATABASE, REALTIME] },
    { provide: TEAM_PERFORMANCE_SCREEN, useFactory: (db: AppDatabase) => (db ? new TeamPerformanceScreenRepository(db) : null), inject: [DATABASE] },
    { provide: COMMISSION_SCREEN, useFactory: (db: AppDatabase) => (db ? new CommissionScreenRepository(db) : null), inject: [DATABASE] },
    { provide: TECH_QUEUE_SCREEN, useFactory: (db: AppDatabase) => (db ? new TechQueueScreenRepository(db) : null), inject: [DATABASE] },
    { provide: LIVE_SCHEDULE_SCREEN, useFactory: (db: AppDatabase) => (db ? new LiveScheduleScreenRepository(db) : null), inject: [DATABASE] },
    { provide: TECH_APPOINTMENTS_SCREEN, useFactory: (db: AppDatabase) => (db ? new TechAppointmentsScreenRepository(db) : null), inject: [DATABASE] },
    { provide: TECHNICIANS_SCREEN, useFactory: (db: AppDatabase) => (db ? new TechniciansScreenRepository(db) : null), inject: [DATABASE] },
  ],
})
export class TeamScreensModule {}
