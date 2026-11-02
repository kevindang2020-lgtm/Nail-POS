// tenant-safety-community.module.ts — mounts the Safety Community. The service binds to the real database
// (migrations 360-363, 529) via KyselyCommunityRepo, or an in-memory fake when no DB is present (dev/tests). Tenant
// endpoints are guarded by TenantAuthGuard + RolePermissionGuard; the moderation endpoints by SuperAdminGuard.
import { NotificationsModule } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { CommunityController } from './community.controller';
import { CommunityModerationController } from './community-moderation.controller';
import { CommunityInteractionsController } from './community-interactions.controller';
import { COMMUNITY_MODERATION_PROVIDERS, COMMUNITY_MODERATION_IMPORTS } from './community-moderation.providers';
import { COMMUNITY_INTERACTIONS_PROVIDERS, COMMUNITY_INTERACTIONS_IMPORTS } from './community-interactions.providers';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { OutboxWriter } from '@aipowersalon/events';
import { COMMUNITY_CORE, COMMUNITY_EVENTS, COMMUNITY_FANOUT, COMMUNITY_RESTRICTIONS, type CommunityEventsPort, type CommunityFanoutPort, type CommunityRestrictionsPort } from './community.ports';
import { OutboxCommunityEvents, InMemoryCommunityEvents } from './community-events';
import { RiskMatchingService } from './community-risk-matching';
import { CommunityService } from './community.service';
import { KyselyCommunityRepo, InMemoryCommunityRepo } from './community.repository';
import { KyselyCommunityAuditSink, InMemoryCommunityAuditSink } from './community-audit';

const COMMUNITY_CORE_BINDING = 'CommunityCoreBinding';

@Module({
  // BUILD_PLAN Phase 8: three halves in one injector — the core (agent A), moderation (agent B), interactions (agent C).
  // Controllers are listed by name (the no-orphaned-controllers guard reads this list).
  imports: [NotificationsModule, EventsCoreModule, ...COMMUNITY_MODERATION_IMPORTS, ...COMMUNITY_INTERACTIONS_IMPORTS],
  controllers: [CommunityController, CommunityModerationController, CommunityInteractionsController],
  providers: [
    { provide: COMMUNITY_EVENTS, useFactory: (db: AppDatabase | null, outbox: OutboxWriter): CommunityEventsPort => (db ? new OutboxCommunityEvents(db as any, outbox) : new InMemoryCommunityEvents()), inject: [DATABASE, OutboxWriter] },
    ...COMMUNITY_MODERATION_PROVIDERS,
    ...COMMUNITY_INTERACTIONS_PROVIDERS,
    // ── the core (agent A): settings, roles → capabilities, visibility, the posting workflow, the safe response shape.
    //    Evidence moved to the interactions half (agent C), alerts to COMMUNITY_FANOUT (C), moderation to agent B.
    {
      provide: CommunityService,
      useFactory: (db: AppDatabase | null, events: CommunityEventsPort) => new CommunityService(
        db ? new KyselyCommunityRepo(db) : new InMemoryCommunityRepo(),
        { audit: db ? new KyselyCommunityAuditSink(db) : new InMemoryCommunityAuditSink(), events,
          // AI writing help stays an honest 503 ai_not_configured: wiring it means registering a community task + prompt
          // with the AI platform (AiPlatform, modules/ai) — see the Phase 8 report.
          ai: null },
      ),
      inject: [{ token: DATABASE, optional: true }, COMMUNITY_EVENTS],
    },
    // Fanout (C) and restrictions (B) may themselves inject COMMUNITY_CORE, so they are bound AFTER the core exists —
    // never a constructor cycle. Nest instantiates every provider at boot, so this runs before the first request.
    {
      provide: COMMUNITY_CORE_BINDING,
      useFactory: (svc: CommunityService, fanout: CommunityFanoutPort | null, restrictions: CommunityRestrictionsPort | null, risk: RiskMatchingService | null) => { svc.bind({ fanout: fanout ?? null, restrictions: restrictions ?? null, risk: risk ?? null }); return true; },
      inject: [CommunityService, { token: COMMUNITY_FANOUT, optional: true }, { token: COMMUNITY_RESTRICTIONS, optional: true }, { token: RiskMatchingService, optional: true }],
    },
    { provide: COMMUNITY_CORE, useExisting: CommunityService },
  ],
  exports: [CommunityService, COMMUNITY_CORE],
})
export class TenantSafetyCommunityModule {}
