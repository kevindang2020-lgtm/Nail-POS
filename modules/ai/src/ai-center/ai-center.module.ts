// ai-center.module.ts — AI Center aggregate controller + service + repo. Kysely impl when a Postgres handle exists,
// else the in-memory impl (dev/offline/tests default), mirroring OverviewModule.
import { BookingModule, BookingService } from '@aipowersalon/booking';
import { NotificationsModule, NotificationsService } from '@aipowersalon/communications';
import { AuditModule, AuditService } from '@aipowersalon/audit';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Module } from '@nestjs/common';
import { AiCenterController } from './ai-center.controller';
import { AiCenterService } from './ai-center.service';
import { InMemoryAiCenterRepo, type AiCenterRepo } from './ai-center.repository';
import { KyselyAiCenterRepo } from './ai-center.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
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
import { TwilioCallTransfer, NoopCallTransfer } from './reception-copilot-call-transfer';
import { ServicesModule } from '@aipowersalon/catalog';
import { ReceptionCopilotActionService, InMemoryActionLedgerRepo, KyselyActionLedgerRepo, type ActionLedgerRepo } from './reception-copilot-action.service';
import { CopilotUsageService } from './copilot-usage.service';
import { CopilotSettingsService } from './copilot-settings.service';
import { SuperAdminCopilotController } from './super-admin-copilot.controller';
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

@Module({
  imports: [AiModule, CustomersModule, QueueModule, BookingModule, AuditModule, NotificationsModule, BookingConversionModule, ServicesModule],
  controllers: [AiCenterController, SuperAdminCopilotController],
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
    { provide: 'COPILOT_CALL_TRANSFER', useFactory: () => (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ? new TwilioCallTransfer() : new NoopCallTransfer() },
    CopilotUsageService,
    { provide: 'COPILOT_CACHE', useFactory: makeCopilotCache },
    { provide: CopilotSettingsService, useFactory: (db: AppDatabase, audit: AuditService, cache: CachePort | null, rt: RealtimeEmitter) => new CopilotSettingsService(db, audit, cache ?? undefined, rt), inject: [DATABASE, AuditService, 'COPILOT_CACHE', REALTIME] },
    { provide: 'CopilotActionLedger', useFactory: (db: AppDatabase): ActionLedgerRepo => (db ? new KyselyActionLedgerRepo(db as any) : new InMemoryActionLedgerRepo()), inject: [DATABASE] },
    { provide: ReceptionCopilotActionService, useFactory: (booking: any, audit: any, ledger: ActionLedgerRepo, notifications: NotificationsService, settings: CopilotSettingsService) => new ReceptionCopilotActionService(booking, audit, ledger, notifications, settings), inject: [BookingService, AuditService, 'CopilotActionLedger', NotificationsService, CopilotSettingsService] },
  ],
  exports: [AiCenterService, ReceptionCopilotContextService, ReceptionCopilotAssistService, ReceptionCopilotSessionService, ReceptionCopilotFeedbackService, ReceptionCopilotLearningService, ReceptionCopilotLiveStateService, ReceptionCopilotTakeoverService, 'CopilotActionLedger'],
})
export class AiCenterModule {}
