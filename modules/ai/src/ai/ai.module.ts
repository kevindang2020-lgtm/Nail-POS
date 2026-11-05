// ai.module.ts — wires the AI assistant backbone. Default-deny access repo + Mock provider until the Phase-2 Kysely
// access repo (reading real paid subscriptions + usage) and real provider adapters land. Boots safely offline: with no
// seeded subscription and no provider key, every AI call returns a clean 403 'not_subscribed' rather than running AI.
import { OutboxWriter, createDomainEvent, type DomainEventType } from '@aipowersalon/events';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { Module } from '@nestjs/common';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService, InMemoryAiAccessRepo, type AiAccessRepo } from './ai-assistant.service';
import { AiGatewayService, InMemoryAiUsageLogger, resolveAiProvider, type AiUsageLogger } from './ai-gateway';
import { KyselyAiAccessRepo, KyselyAiUsageLogger } from './ai-access.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AiGovernanceModule } from '../ai-governance/ai-governance.module';
import { AiGovernanceService } from '../ai-governance/ai-governance.service';
import { AiPlatform } from './ai-platform';
import { AiControlPlaneService, KyselyAiUsageRead, type AiUsageReadPort } from './ai-control-plane.service';
import { SuperAdminAiPlatformController, TenantAiDashboardController } from './ai-control-plane.controller';
import { KyselyAiSettingsStore, InMemoryAiSettingsStore, type AiSettingsStore } from './ai-settings-store';
import { KyselyPromptStore } from './ai-prompt-store.kysely';
import { InMemoryPromptStore, type PromptStore } from './ai-prompt-registry';
import { providerFor } from './ai-providers';
import { MockAiProvider } from './ai-gateway';
import { ProviderCircuitBreakers } from './ai-provider-health';

@Module({
  imports: [AiGovernanceModule],
  controllers: [AiAssistantController, SuperAdminAiPlatformController, TenantAiDashboardController],
  providers: [
    { provide: 'AiAccessRepo', useFactory: (db: AppDatabase): AiAccessRepo => (db ? new KyselyAiAccessRepo(db as any) : new InMemoryAiAccessRepo()), inject: [DATABASE] },
    { provide: AiGatewayService, useFactory: () => new AiGatewayService(resolveAiProvider()) },
    // Constitution 10 §6: THE ONE ENTRY POINT. Every AI module injects AiPlatform; nothing injects AiGatewayService
    // outside this file any more (check:ai-platform makes that fatal). Prompts come from ai_prompt_versions when a
    // database is wired and from the in-code seed otherwise; providers from the adapter file's providerFor(), with the
    // Mock only outside production (the router refuses it in production regardless).
    { provide: 'AiPromptStore', useFactory: (db: AppDatabase): PromptStore => (db ? new KyselyPromptStore(db as any) : new InMemoryPromptStore()), inject: [DATABASE] },
    { provide: ProviderCircuitBreakers, useFactory: () => new ProviderCircuitBreakers() },
    // §171-§176 + §166. An empty read port when there is no database, so the pages render "nothing measured"
    // rather than failing — which is also exactly what the read models are built to say honestly.
    {
      provide: 'AiUsageReadPort',
      useFactory: (db: AppDatabase): AiUsageReadPort => db ? new KyselyAiUsageRead(db as never) : {
        usageSince: async () => [], runningJobs: async () => 0, safetyEventCount: async () => 0,
        pendingApprovals: async () => [], budgetFor: async () => null, enabledPackages: async () => [], feedbackFor: async () => [],
      },
      inject: [DATABASE],
    },
    // §52/§53: over the EXISTING tenant_settings table (migration 016), category 'ai-platform'. Not a new table.
    { provide: 'AiSettingsStore', useFactory: (db: AppDatabase, rt: RealtimeEmitter): AiSettingsStore => db ? new KyselyAiSettingsStore(db as never, rt) : new InMemoryAiSettingsStore(), inject: [DATABASE, REALTIME] },
    {
      provide: AiControlPlaneService,
      useFactory: (read: AiUsageReadPort, breakers: ProviderCircuitBreakers) => new AiControlPlaneService(read, breakers),
      inject: ['AiUsageReadPort', ProviderCircuitBreakers],
    },
    {
      provide: AiPlatform,
      useFactory: (accessRepo: AiAccessRepo, usage: AiUsageLogger, prompts: PromptStore, breakers: ProviderCircuitBreakers, db: AppDatabase) =>
        new AiPlatform({
          accessRepo, usage, prompts, breakers,
          // Constitution 7 §34: the platform auto-action kill switch, from platform_settings (30 s cache)
          platformSafety: db ? platformAiKillSwitchReader(db) : undefined,
          providers: (provider, model) => provider === 'mock' && process.env.NODE_ENV !== 'production' ? new MockAiProvider() : providerFor(provider, model),
          // §161: AI lifecycle events through the EXISTING outbox (Constitution 8), not a second transport.
          // The platform has no transaction of its own, so each event is written in its own — these are facts
          // ABOUT AI work, not part of a domain write, so there is nothing to be atomic with.
          // The AI REQUEST is the aggregate these facts belong to, so requestId is the aggregateId and the
          // correlation id — every event of one execution shares it, which is what makes a flow traceable
          // (§11). actorType 'ai' is the value §190 provides for exactly this producer.
          events: db ? {
            publish: async (eventType, payload) => {
              const requestId = String(payload.requestId ?? '');
              const event = createDomainEvent({
                eventType: eventType as DomainEventType,
                tenantId: payload.tenantId ? String(payload.tenantId) : undefined,
                branchId: payload.branchId ? String(payload.branchId) : undefined,
                aggregateType: 'ai_request',
                aggregateId: requestId,
                correlationId: requestId,
                actorType: 'ai',
                actorId: payload.actorUserId ? String(payload.actorUserId) : undefined,
                requestId,
                payload,
              });
              await (db as any).transaction().execute(async (trx: unknown) => new OutboxWriter().write(trx as never, event));
            },
          } : undefined,
        }),
      inject: ['AiAccessRepo', 'AiUsageLogger', 'AiPromptStore', ProviderCircuitBreakers, DATABASE],
    },
    { provide: 'AiUsageLogger', useFactory: (db: AppDatabase): AiUsageLogger => (db ? new KyselyAiUsageLogger(db as any) : new InMemoryAiUsageLogger()), inject: [DATABASE] },
    {
      provide: AiAssistantService,
      useFactory: (repo: AiAccessRepo, gateway: AiGatewayService, logger: AiUsageLogger, gov: AiGovernanceService) =>
        new AiAssistantService(repo, gateway, logger, (t, k) => gov.list(t).then((rows) => rows.find((a) => a.assistantKey === k)?.mode ?? null)),
      inject: ['AiAccessRepo', AiGatewayService, 'AiUsageLogger', AiGovernanceService],
    },
  ],
  exports: [AiAssistantService, AiPlatform, ProviderCircuitBreakers],
})
export class AiModule {}

import { sql } from 'kysely';
/** platform_settings 'ai.auto_actions_disabled' → PlatformSafetyState, cached 30 s; a read failure keeps the last value. */
export function platformAiKillSwitchReader(db: any, ttlMs = 30_000, now: () => number = Date.now) {
  let cached: { at: number; value: { autoActionsDisabled: boolean } } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    try {
      const r: any = await sql`select value from platform_settings where setting_key = 'ai.auto_actions_disabled' limit 1`.execute(db);
      const v = r.rows[0]?.value;
      cached = { at: now(), value: { autoActionsDisabled: v === true || v === 'true' } };
    } catch { if (!cached) cached = { at: now(), value: { autoActionsDisabled: false } }; }
    return cached.value;
  };
}
