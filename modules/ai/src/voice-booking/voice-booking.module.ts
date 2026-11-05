// voice-booking.module.ts — wires the AI Voice Receptionist gateway (read side). REUSES CustomerBookingModule's
// exported CustomerBookingService (no duplicated booking logic). Key store uses the kysely repo when a DB handle exists,
// else the in-memory repo (dev/tests). All voice routes sit behind VoiceAuthGuard.
import { CustomerBookingModule, BookingModule } from '@aipowersalon/booking';
import { AuditModule, AuditService } from '@aipowersalon/audit';
import { DealsModule } from '@aipowersalon/deals';
import { Module } from '@nestjs/common';
import { AiReceptionistVerificationController } from './ai-receptionist-verification.controller';
import { CustomersModule } from '@aipowersalon/customers';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { VoiceBookingService } from './voice-booking.service';
import { VoiceBookingWriteService } from './voice-booking-write.service';
import { VoiceManageService } from './voice-manage.service';
import { VoiceBookingController } from './voice-booking.controller';
import { AiReceptionistGatewayController } from './ai-receptionist-gateway.controller';
import { VoiceIdempotencyService, InMemoryVoiceIdempotencyRepo, KyselyVoiceIdempotencyRepo, VoiceBranchInfoService, type VoiceIdempotencyRepo } from './voice-idempotency.service';
import { VoiceGatewayMetricsService } from './voice-gateway-metrics.service';
import { VoiceGatewayMetricsInterceptor } from './voice-gateway-metrics.interceptor';
import { TenantReceptionistController } from './tenant-receptionist.controller';
import { TenantReceptionistService } from './tenant-receptionist.service';
import { AiAgentService, InMemoryAgentRepo, KyselyAgentRepo, type AgentRepo } from './ai-agent.service';
import { AiFollowUpService, InMemoryFollowUpRepo, KyselyFollowUpRepo, type FollowUpRepo } from './ai-follow-up.service';
import { AiFaqService, InMemoryFaqRepo, KyselyFaqRepo, type FaqRepo } from './ai-faq.service';
import { AiSettingsService, InMemorySettingsRepo, KyselySettingsRepo, type SettingsRepo } from './ai-settings.service';
import { AiProvisioningService, InMemoryProvJobRepo, KyselyProvJobRepo, type ProvJobRepo, type AgentReader } from './ai-provisioning.service';
import { VoiceFleetService } from './voice-fleet.service';
import { ProvisioningMetricsService } from './provisioning-metrics.service';
import { resolveVoiceProvider } from './provider-ports';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceKeyService, InMemoryVoiceKeyRepo, type VoiceKeyRepo } from './voice-key.service';
import { KyselyVoiceKeyRepo } from './voice-key.kysely.repository';
import { VoiceCallOutcomeService, InMemoryCallOutcomeRepo, type CallOutcomeRepo } from './voice-call-outcome.service';
import { KyselyCallOutcomeRepo } from './voice-call-outcome.kysely.repository';
import { VoiceLearningService, InMemoryLearningRepo, type LearningRepo } from './voice-learning.service';
import { KyselyLearningRepo } from './voice-learning.kysely.repository';

@Module({
  imports: [CustomerBookingModule, BookingModule, CustomersModule, AuditModule, DealsModule],
  controllers: [AiReceptionistVerificationController, VoiceBookingController, AiReceptionistGatewayController, TenantReceptionistController],
  providers: [
    { provide: VoiceBookingService, useClass: VoiceBookingService },
    { provide: VoiceBookingWriteService, useClass: VoiceBookingWriteService },
    { provide: VoiceManageService, useClass: VoiceManageService },
    { provide: 'VoiceIdempotencyRepo', useFactory: (db: AppDatabase): VoiceIdempotencyRepo => (db ? new KyselyVoiceIdempotencyRepo(db as any) : new InMemoryVoiceIdempotencyRepo()), inject: [DATABASE] },
    { provide: VoiceIdempotencyService, useFactory: (repo: VoiceIdempotencyRepo) => new VoiceIdempotencyService(repo), inject: ['VoiceIdempotencyRepo'] },
    { provide: 'VOICE_HANDOFF_DB', useFactory: (db: AppDatabase) => db ?? null, inject: [DATABASE] },
    VoiceBranchInfoService,
    TenantReceptionistService,
    { provide: 'AgentRepo', useFactory: (db: AppDatabase): AgentRepo => (db ? new KyselyAgentRepo(db as any) : new InMemoryAgentRepo()), inject: [DATABASE] },
    { provide: AiAgentService, useFactory: (repo: AgentRepo) => new AiAgentService(repo), inject: ['AgentRepo'] },
    { provide: 'FollowUpRepo', useFactory: (db: AppDatabase): FollowUpRepo => (db ? new KyselyFollowUpRepo(db as any) : new InMemoryFollowUpRepo()), inject: [DATABASE] },
    { provide: AiFollowUpService, useFactory: (repo: FollowUpRepo) => new AiFollowUpService(repo), inject: ['FollowUpRepo'] },
    { provide: 'FaqRepo', useFactory: (db: AppDatabase): FaqRepo => (db ? new KyselyFaqRepo(db as any) : new InMemoryFaqRepo()), inject: [DATABASE] },
    { provide: AiFaqService, useFactory: (repo: FaqRepo) => new AiFaqService(repo), inject: ['FaqRepo'] },
    { provide: 'SettingsRepo', useFactory: (db: AppDatabase): SettingsRepo => (db ? new KyselySettingsRepo(db as any) : new InMemorySettingsRepo()), inject: [DATABASE] },
    { provide: AiSettingsService, useFactory: (repo: SettingsRepo) => new AiSettingsService(repo), inject: ['SettingsRepo'] },
    { provide: 'ProvJobRepo', useFactory: (db: AppDatabase): ProvJobRepo => (db ? new KyselyProvJobRepo(db as any) : new InMemoryProvJobRepo()), inject: [DATABASE] },
    { provide: 'ProvAgentReader', useFactory: (repo: AgentRepo): AgentReader => ({ get: (t, id) => repo.get(t, id), setProvisioned: (t, id, pid) => repo.setProvisioned(t, id, pid) }), inject: ['AgentRepo'] },
    { provide: 'VoiceProvider', useFactory: () => resolveVoiceProvider(process.env) },
    ProvisioningMetricsService,
    { provide: 'ProvisioningMetrics', useExisting: ProvisioningMetricsService },
    { provide: AiProvisioningService, useFactory: (jobs: ProvJobRepo, agents: AgentReader, voice: any, metrics: ProvisioningMetricsService) => new AiProvisioningService(jobs, agents, voice, metrics), inject: ['ProvJobRepo', 'ProvAgentReader', 'VoiceProvider', 'ProvisioningMetrics'] },
    VoiceFleetService,
    VoiceGatewayMetricsService,
    VoiceGatewayMetricsInterceptor,
    RetellVoiceAdapter,
    { provide: 'VoiceKeyRepo', useFactory: (db: AppDatabase): VoiceKeyRepo => (db ? new KyselyVoiceKeyRepo(db as any) : new InMemoryVoiceKeyRepo()), inject: [DATABASE] },
    { provide: VoiceKeyService, useFactory: (repo: VoiceKeyRepo) => new VoiceKeyService(repo), inject: ['VoiceKeyRepo'] },
    { provide: 'CallOutcomeRepo', useFactory: (db: AppDatabase): CallOutcomeRepo => (db ? new KyselyCallOutcomeRepo(db as any) : new InMemoryCallOutcomeRepo()), inject: [DATABASE] },
    { provide: VoiceCallOutcomeService, useFactory: (repo: CallOutcomeRepo) => new VoiceCallOutcomeService(repo), inject: ['CallOutcomeRepo'] },
    { provide: 'LearningRepo', useFactory: (db: AppDatabase): LearningRepo => (db ? new KyselyLearningRepo(db as any) : new InMemoryLearningRepo()), inject: [DATABASE] },
    { provide: VoiceLearningService, useFactory: (repo: LearningRepo) => new VoiceLearningService(repo), inject: ['LearningRepo'] },
    VoiceAuthGuard,
  ],
  exports: [VoiceKeyService, VoiceCallOutcomeService, VoiceLearningService, VoiceGatewayMetricsService, VoiceBranchInfoService, VoiceFleetService, ProvisioningMetricsService],
})
export class VoiceBookingModule {}
