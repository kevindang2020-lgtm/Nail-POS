// ai-voice-transcription.module.ts — wires the transcription layer. Repo + entitlement resolve to Postgres when a
// DB is present, else in-memory (dev/test). Imports VoiceBookingModule so the webhook controller can reuse the
// existing VoiceKeyService (integration-key → tenant/branch) via VoiceAuthGuard — no parallel key system.
import { AiModule } from '../ai/ai.module';
import { type AiUsageLogger } from '../ai/ai-gateway';
import { AiPlatform } from '../ai/ai-platform';
import { voiceSummarizeAdapter } from '../ai/ai-platform.adapters';
import { KyselyAiUsageLogger } from '../ai/ai-access.kysely.repository';
import { VoiceBookingModule } from '../voice-booking/voice-booking.module';
import { VoiceAuthGuard } from '../voice-booking/voice-auth.guard';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { VoiceTranscriptionController, VoiceTranscriptionWebhookController, VoiceTranscriptionSuperAdminController } from './ai-voice-transcription.controller';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { VoiceRetentionSweepScheduler } from './ai-voice-transcription-retention.scheduler';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceTranscriptionRepository, type VoiceTranscriptionRepositoryPort } from './ai-voice-transcription.repository';
import { KyselyVoiceTranscriptionRepository } from './ai-voice-transcription.kysely.repository';
import { InMemoryVoiceEntitlement, KyselyVoiceEntitlement, type VoiceEntitlementPort } from './ai-voice-transcription-entitlement';
import { resolveTranscriptionProvider, type TranscriptionProviderPort } from './ai-voice-transcription.provider';

@Module({
  imports: [AiModule, VoiceBookingModule],
  controllers: [VoiceTranscriptionController, VoiceTranscriptionWebhookController, VoiceTranscriptionSuperAdminController],
  providers: [
    VoiceAuthGuard,
    SuperAdminGuard,
    VoiceRetentionSweepScheduler,
    {
      provide: 'VoiceTranscriptionUsageLogger',
      useFactory: (db: AppDatabase): AiUsageLogger => db ? new KyselyAiUsageLogger(db as any) : ({ async log() {} } as AiUsageLogger),
      inject: [DATABASE],
    },
    {
      provide: 'VoiceTranscriptionRepositoryPort',
      useFactory: (db: AppDatabase): VoiceTranscriptionRepositoryPort =>
        db ? new KyselyVoiceTranscriptionRepository(db as any) : new InMemoryVoiceTranscriptionRepository(),
      inject: [DATABASE],
    },
    {
      provide: 'VoiceTranscriptionEntitlementPort',
      useFactory: (db: AppDatabase): VoiceEntitlementPort =>
        db ? new KyselyVoiceEntitlement(db as any) : new InMemoryVoiceEntitlement(),
      inject: [DATABASE],
    },
    { provide: 'TranscriptionProviderPort', useFactory: (): TranscriptionProviderPort => resolveTranscriptionProvider() },
    {
      provide: VoiceTranscriptionService,
      // Constitution 10 §6: summarization through the platform. `usage` stays — it meters transcribed MINUTES,
      // a different unit from the platform's per-call token usage.
      useFactory: (repo: VoiceTranscriptionRepositoryPort, provider: TranscriptionProviderPort, ent: VoiceEntitlementPort, usage: AiUsageLogger, platform: AiPlatform) =>
        new VoiceTranscriptionService(repo, provider, ent, undefined, undefined, voiceSummarizeAdapter(platform), undefined, usage),
      inject: ['VoiceTranscriptionRepositoryPort', 'TranscriptionProviderPort', 'VoiceTranscriptionEntitlementPort', 'VoiceTranscriptionUsageLogger', AiPlatform],
    },
  ],
  exports: [VoiceTranscriptionService],
})
export class VoiceTranscriptionModule {}
