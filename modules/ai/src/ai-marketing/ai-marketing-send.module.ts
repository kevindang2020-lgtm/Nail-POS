// ai-marketing-send.module.ts — assembles the LIVE send path by reusing existing modules:
//   CampaignsModule (system lifecycle) · NotificationsModule (dispatch + opt-out) · CommunicationsModule (limits).
// The sweep scheduler is OFF unless AI_MARKETING_SEND_SWEEP_ENABLED=1 — a background sender never arms silently.
//
// ⚠️ This is cross-module DI I could not run/di-check here. Verify with `node scripts/di-check.mjs` and the
// two-tenant live smoke in the slice-5c wiring recipe before arming the sweep.
import { CampaignsModule, CampaignsService, NotificationsModule, NotificationsService, CommunicationsModule, CommunicationsLimitsService } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AiMarketingSendService } from './ai-marketing-send.service';
import { AiMarketingSendSweep, AiMarketingSendSweepScheduler, KyselyDueCampaignSource } from './ai-marketing-send-sweep';
import {
  KyselySendLedger,
  KyselyPlanStore,
  KyselyRecipientSource,
  CommunicationsLimitAdapter,
  NotificationsDispatcher,
  SystemCampaignLifecycle,
  StaticQuietHours,
  KyselyOccasionGuard,
} from './ai-marketing-send.adapters';

@Module({
  imports: [CampaignsModule, NotificationsModule, CommunicationsModule],
  providers: [
    // DB-backed adapters (writes → primary DATABASE handle).
    { provide: 'AiMktSendLedger', useFactory: (db: AppDatabase) => new KyselySendLedger(db as any), inject: [DATABASE] },
    { provide: 'AiMktPlanStore', useFactory: (db: AppDatabase) => new KyselyPlanStore(db as any), inject: [DATABASE] },
    { provide: 'AiMktRecipients', useFactory: (db: AppDatabase, plan: any) => new KyselyRecipientSource(db as any, plan), inject: [DATABASE, 'AiMktPlanStore'] },
    { provide: 'AiMktDueSource', useFactory: (db: AppDatabase) => new KyselyDueCampaignSource(db as any), inject: [DATABASE] },
    // Reused services wrapped as ports.
    { provide: 'AiMktLifecycle', useFactory: (c: CampaignsService) => new SystemCampaignLifecycle(c), inject: [CampaignsService] },
    { provide: 'AiMktLimits', useFactory: (l: CommunicationsLimitsService) => new CommunicationsLimitAdapter(l), inject: [CommunicationsLimitsService] },
    { provide: 'AiMktDispatcher', useFactory: (n: NotificationsService) => new NotificationsDispatcher(n, ''), inject: [NotificationsService] },
    { provide: 'AiMktQuietHours', useClass: StaticQuietHours },
    // Executor: reuses opt-out suppression from NotificationsModule ('NotifOptOutPort').
    {
      provide: AiMarketingSendService,
      useFactory: (lifecycle: any, recipients: any, ledger: any, limits: any, suppression: any, quiet: any, dispatcher: any, db: any) =>
        new AiMarketingSendService(lifecycle, recipients, ledger, limits, suppression, quiet, dispatcher, db ? new KyselyOccasionGuard(db) : null),
      inject: ['AiMktLifecycle', 'AiMktRecipients', 'AiMktSendLedger', 'AiMktLimits', 'NotifOptOutPort', 'AiMktQuietHours', 'AiMktDispatcher', DATABASE],
    },
    // Sweep + scheduler (scheduler is env-gated OFF by default).
    {
      provide: AiMarketingSendSweep,
      useFactory: (due: any, plan: any, exec: AiMarketingSendService) => new AiMarketingSendSweep(due, plan, exec),
      inject: ['AiMktDueSource', 'AiMktPlanStore', AiMarketingSendService],
    },
    AiMarketingSendSweepScheduler,
  ],
  exports: [AiMarketingSendService],
})
export class AiMarketingSendModule {}
