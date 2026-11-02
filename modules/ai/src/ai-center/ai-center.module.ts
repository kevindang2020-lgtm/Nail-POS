// ai-center.module.ts — AI Center aggregate controller + service + repo. Kysely impl when a Postgres handle exists,
// else the in-memory impl (dev/offline/tests default), mirroring OverviewModule.
import { BookingModule, BookingService } from '@aipowersalon/booking';
import { NotificationsModule, NotificationsService } from '@aipowersalon/communications';
import { AuditModule, AuditService } from '@aipowersalon/audit';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Module, Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { AiCenterController } from './ai-center.controller';
import { AiCenterService } from './ai-center.service';
import { InMemoryAiCenterRepo, type AiCenterRepo } from './ai-center.repository';
import { KyselyAiCenterRepo } from './ai-center.kysely.repository';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { AiModule } from '../ai/ai.module';
import { CustomersModule } from '@aipowersalon/customers';
import { QueueModule } from '@aipowersalon/queue';
import { BookingConversionModule } from '@aipowersalon/reports';
import { ReceptionCopilotContextService } from './reception-copilot-context.service';
import { ReceptionCopilotAssistService } from './reception-copilot-assist.service';
import { ReceptionCopilotSessionService } from './reception-copilot-session.service';
import { ReceptionCopilotFeedbackService } from './reception-copilot-feedback.service';
import { ReceptionCopilotLearningService } from './reception-copilot-learning.service';
import { ReceptionCopilotLiveStateService } from './reception-copilot-live-state.service';
import { ReceptionCopilotTakeoverService } from './reception-copilot-takeover.service';
import { TelephonyCallTransfer } from './reception-copilot-call-transfer';
import { resolveTelephonyProvider } from '../voice-booking/provider-ports';
import { ServicesModule } from '@aipowersalon/catalog';
import { ReceptionCopilotActionService, InMemoryActionLedgerRepo, KyselyActionLedgerRepo, type ActionLedgerRepo } from './reception-copilot-action.service';
import { CopilotUsageService } from './copilot-usage.service';
import { CopilotSettingsService } from './copilot-settings.service';
import { SuperAdminCopilotController } from './super-admin-copilot.controller';
import { ReceptionCopilotCenterController } from './reception-copilot-center.controller';
import { ReceptionCopilotCenter, COPILOT_CENTER } from './reception-copilot-center';
import { AiCalendarCenterController } from './ai-calendar-center.controller';
import { AiCalendarCenter, AI_CALENDAR_CENTER } from './ai-calendar-center';
import { AiFollowUpCenter, AI_FOLLOW_UP_CENTER, escalateOverdueFollowUps, type FuTextPort } from './ai-follow-up-center';
import { AiFollowUpCenterController } from './ai-follow-up-center.controller';
import { KyselyAiAccessRepo } from '../ai/ai-access.kysely.repository';
import { RedisCache, makeCacheRedis } from '../cache/cache-redis';
import { makeIoredis } from '@aipowersalon/cache';
import type { CachePort } from '../cache/cache-port';

export const AI_CENTER_REPO = Symbol('AI_CENTER_REPO');

// Cross-instance Copilot settings cache: Redis-backed when REDIS_URL is set, else null → the service uses its
// per-process cache (unchanged single-node behaviour). Provided as a value so @Optional() injection resolves cleanly.
function makeCopilotCache(): CachePort | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try { return new RedisCache(makeCacheRedis(makeIoredis(url, 'ai') as any), { prefix: process.env.CACHE_PREFIX || 'aps:cache:' }); } catch { return null; }
}

/** overdue follow-ups → one owner alert per task (reconciliation job class, every 5 minutes, single owner across instances) */
@Injectable()
export class AiFollowUpEscalationJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}
  onModuleInit() {
    if (!runsBackgroundJob('reconciliation')) return;
    if (!this.db || process.env.AI_FOLLOW_UP_ESCALATION === 'off') return;
    const every = 5 * 60_000;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'ai.follow_up_escalation', jobClass: 'reconciliation', everyMs: every },
        () => runAsSingleOwner(this.db as unknown as Kysely<any>, 'ai.follow_up_escalation', () => escalateOverdueFollowUps(this.db as unknown as Kysely<any>)))
        .catch((e) => logException(e, { where: 'ai-follow-up.escalation.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({
  imports: [AiModule, CustomersModule, QueueModule, BookingModule, AuditModule, NotificationsModule, BookingConversionModule, ServicesModule],
  controllers: [AiCenterController, SuperAdminCopilotController, ReceptionCopilotCenterController, AiCalendarCenterController, AiFollowUpCenterController],
  providers: [
    { provide: AI_CENTER_REPO, useFactory: (db: AppDatabase): AiCenterRepo => (db ? new KyselyAiCenterRepo(db) : new InMemoryAiCenterRepo()), inject: [DATABASE] },
    { provide: AiCenterService, useFactory: (repo: AiCenterRepo) => new AiCenterService(repo), inject: [AI_CENTER_REPO] },
    ReceptionCopilotContextService,
    ReceptionCopilotAssistService,
    ReceptionCopilotSessionService,
    ReceptionCopilotFeedbackService,
    ReceptionCopilotLearningService,
    ReceptionCopilotLiveStateService,
    ReceptionCopilotTakeoverService,
    { provide: 'COPILOT_CALL_TRANSFER', useFactory: () => new TelephonyCallTransfer(resolveTelephonyProvider()) },   // B-14: the one telephony adapter decides "configured"
    CopilotUsageService,
    { provide: 'COPILOT_CACHE', useFactory: makeCopilotCache },
    { provide: CopilotSettingsService, useFactory: (db: AppDatabase, audit: AuditService, cache: CachePort | null, rt: RealtimeEmitter) => new CopilotSettingsService(db, audit, cache ?? undefined, rt), inject: [DATABASE, AuditService, 'COPILOT_CACHE', REALTIME] },
    { provide: 'CopilotActionLedger', useFactory: (db: AppDatabase): ActionLedgerRepo => (db ? new KyselyActionLedgerRepo(db as any) : new InMemoryActionLedgerRepo()), inject: [DATABASE] },
    { provide: ReceptionCopilotActionService, useFactory: (booking: any, audit: any, ledger: ActionLedgerRepo, notifications: NotificationsService, settings: CopilotSettingsService) => new ReceptionCopilotActionService(booking, audit, ledger, notifications, settings), inject: [BookingService, AuditService, 'CopilotActionLedger', NotificationsService, CopilotSettingsService] },
    // Reception Copilot guide: prepare/confirm, activity, search, health, priorities, overlay — null without a database
    { provide: COPILOT_CENTER, useFactory: (db: AppDatabase, actions: ReceptionCopilotActionService, ctxSvc: ReceptionCopilotContextService, settings: CopilotSettingsService) => (db
        ? new ReceptionCopilotCenter(db, actions, { queueSummary: (c) => ctxSvc.queueSummary(c) }, { get: (c) => settings.get(c) },
          new KyselyAiAccessRepo(db as unknown as ConstructorParameters<typeof KyselyAiAccessRepo>[0]))
        : null), inject: [DATABASE, ReceptionCopilotActionService, ReceptionCopilotContextService, CopilotSettingsService] },
    // AI Calendar guide: a read layer over canonical Booking (BookingService + pos_tech_appointments) — null without a database
    { provide: AI_CALENDAR_CENTER, useFactory: (db: AppDatabase, booking: BookingService) => (db ? new AiCalendarCenter(db, booking) : null), inject: [DATABASE, BookingService] },
    // AI Follow-Ups guide: the task center over ai_receptionist_follow_ups; texts go through the Copilot center's prepare → confirm
    { provide: AI_FOLLOW_UP_CENTER, useFactory: (db: AppDatabase, cc: ReceptionCopilotCenter | null) => (db ? new AiFollowUpCenter(db as unknown as Kysely<any>, cc as unknown as FuTextPort | null) : null), inject: [DATABASE, COPILOT_CENTER] },
    AiFollowUpEscalationJob,
  ],
  exports: [AiCenterService, ReceptionCopilotContextService, ReceptionCopilotAssistService, ReceptionCopilotSessionService, ReceptionCopilotFeedbackService, ReceptionCopilotLearningService, ReceptionCopilotLiveStateService, ReceptionCopilotTakeoverService, 'CopilotActionLedger'],
})
export class AiCenterModule {}

