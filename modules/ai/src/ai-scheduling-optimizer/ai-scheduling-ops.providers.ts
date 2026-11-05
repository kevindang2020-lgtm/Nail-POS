// ai-scheduling-ops.providers.ts — BUILD_PLAN Phase 7 (agent B): the operations half of the AI Scheduling Optimizer —
// customer proposals, explanations, usage metering, the platform switch, the automation runner, insights, background
// jobs, exports, the owner / technician / customer routes and the bridge the AI receptionist + Reception Copilot use.
// Spread into AiSchedulingModule's providers / controllers / imports (agent A's module) so both halves share ONE injector:
// the engine injects the ports below by token; the ops services reach the engine back through LazySchedEngine (ModuleRef,
// resolved on first use — no provider cycle).
import type { Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PushModule, PushService } from '@aipowersalon/communications';
import { AiModule } from '../ai/ai.module';
import { AiPlatform } from '../ai/ai-platform';
import { SCHED_PROPOSAL_PORT, SCHED_EXPLANATION_PORT, SCHED_USAGE_PORT, SCHED_PLATFORM_SWITCH_PORT, SCHED_AUTOMATION_PORT, SCHED_EVENTS, type SchedEventsPort } from './ai-scheduling.ports';
import { AiSchedulingService } from './ai-scheduling.service';
import { LazySchedEngine, SCHED_ENGINE, type SchedEngine } from './ai-scheduling-ops.common';
import { SchedPlatformSwitch, KyselyPlatformFlagsReader } from './ai-scheduling-ops.platform-switch';
import { SchedUsageService, KyselyUsageStore, InMemoryUsageStore } from './ai-scheduling-usage';
import { SchedExplanationService, platformExplainAdapter } from './ai-scheduling-explanation';
import { ScheduleProposalService, KyselyProposalStore, InMemoryProposalStore, KyselyProposalStaffNotifier, type ProposalMessenger } from './ai-scheduling-proposals';
import { SchedAutomationRunner, KyselyAutomationApplier } from './ai-scheduling-automation';
import { SchedInsightService, KyselyInsightStore, type InsightStore } from './ai-scheduling-insights';
import { SchedOpsScheduler, JobInsightRefreshQueue } from './ai-scheduling-jobs';
import { SchedExportService, KyselyExportRead } from './ai-scheduling-export';
import { SchedOwnerService, KyselyOwnerSummaryRead } from './ai-scheduling-owner';
import { SchedTechService, KyselyTechChangeRead } from './ai-scheduling-tech';
import { SchedOptionsBridgeModule, SCHED_OPTIONS_FINDER, type SchedOptionsBridge } from './ai-scheduling-ops.bridge';

/** packages/notifications TENANT_MESSENGER (the salon's one send path), by its string token — the ai module does not
 *  depend on the notifications package for one interface (see ProposalMessenger). */
const TENANT_MESSENGER = 'TENANT_MESSENGER';

/** No database (dev / some unit harnesses): every read is honestly empty, every write refused by the services' gates. */
const emptyInsightStore: InsightStore = {
  list: async () => [], get: async () => null, decide: async () => null, supersedeApprovedDuration: async () => undefined, durationSamples: async () => [],
  currentDurations: async () => ({ catalog: {}, approved: [] }), replaceStats: async () => undefined, upsertDuration: async () => null, branches: async () => [],
  dayInputs: async () => ({ capacityMin: 0, confirmedMin: 0, historyDailyMin: [], unscheduledTechnicianIds: [] }), upsertStaffing: async () => null, upsertAvailability: async () => null,
};

export const SCHED_OPS_PROVIDERS: Provider[] = [
  { provide: SCHED_ENGINE, useFactory: (moduleRef: ModuleRef): SchedEngine => new LazySchedEngine(moduleRef, AiSchedulingService), inject: [ModuleRef] },
  { provide: SchedPlatformSwitch, useFactory: (db: AppDatabase | null) => new SchedPlatformSwitch(db ? new KyselyPlatformFlagsReader(db as any) : null), inject: [{ token: DATABASE, optional: true }] },
  { provide: SCHED_PLATFORM_SWITCH_PORT, useExisting: SchedPlatformSwitch },
  { provide: SchedUsageService, useFactory: (db: AppDatabase | null) => new SchedUsageService(db ? new KyselyUsageStore(db as any) : new InMemoryUsageStore()), inject: [{ token: DATABASE, optional: true }] },
  { provide: SCHED_USAGE_PORT, useExisting: SchedUsageService },
  {
    provide: SCHED_EXPLANATION_PORT,
    // Constitution 10 §6: the words come through the platform (package check, safety switches, registered prompt, cost log)
    useFactory: (platform: AiPlatform | null, usage: SchedUsageService, sw: SchedPlatformSwitch) => new SchedExplanationService(platform ? platformExplainAdapter(platform) : null, usage, sw),
    inject: [{ token: AiPlatform, optional: true }, SchedUsageService, SchedPlatformSwitch],
  },
  {
    provide: ScheduleProposalService,
    useFactory: (db: AppDatabase | null, engine: SchedEngine, messenger: ProposalMessenger | null, push: PushService | null) =>
      new ScheduleProposalService(db ? new KyselyProposalStore(db as any) : new InMemoryProposalStore(), engine, messenger ?? null, db ? new KyselyProposalStaffNotifier(db as any, push ?? null) : null),
    inject: [{ token: DATABASE, optional: true }, SCHED_ENGINE, { token: TENANT_MESSENGER, optional: true }, { token: PushService, optional: true }],
  },
  { provide: SCHED_PROPOSAL_PORT, useExisting: ScheduleProposalService },
  {
    provide: SCHED_AUTOMATION_PORT,
    useFactory: (db: AppDatabase | null, engine: SchedEngine, sw: SchedPlatformSwitch, events: SchedEventsPort | null) =>
      new SchedAutomationRunner(engine, db ? new KyselyAutomationApplier(db as any) : { markAutomated: async () => false }, sw, events ?? null),
    inject: [{ token: DATABASE, optional: true }, SCHED_ENGINE, SchedPlatformSwitch, { token: SCHED_EVENTS, optional: true }],
  },
  {
    provide: SchedInsightService,
    useFactory: (db: AppDatabase | null, events: SchedEventsPort | null) => new SchedInsightService(db ? new KyselyInsightStore(db as any) : emptyInsightStore, events ?? null, db ? new JobInsightRefreshQueue(db as any) : null),
    inject: [{ token: DATABASE, optional: true }, { token: SCHED_EVENTS, optional: true }],
  },
  { provide: SchedExportService, useFactory: (db: AppDatabase | null) => new SchedExportService(db ? new KyselyExportRead(db as any) : { rows: async () => ({ header: [], rows: [] }) }), inject: [{ token: DATABASE, optional: true }] },
  { provide: SchedOwnerService, useFactory: (db: AppDatabase | null) => new SchedOwnerService(db ? new KyselyOwnerSummaryRead(db as any) : { branches: async () => [] }), inject: [{ token: DATABASE, optional: true }] },
  { provide: SchedTechService, useFactory: (db: AppDatabase | null) => new SchedTechService(db ? new KyselyTechChangeRead(db as any) : { technicianFor: async () => null, branchTz: async () => 'America/New_York', changes: async () => [] }), inject: [{ token: DATABASE, optional: true }] },
  SchedOpsScheduler,
  // binds the engine into the global options bridge the AI receptionist + Reception Copilot inject (SCHED_OPTIONS_FINDER)
  { provide: 'SchedOptionsBridgeBinder', useFactory: (bridge: SchedOptionsBridge, engine: SchedEngine) => { bridge.bind(engine); return true; }, inject: [SCHED_OPTIONS_FINDER, SCHED_ENGINE] },
];

// The four controllers (AiSchedulingOpsController, OwnerAiSchedulingController, TechAiScheduleController,
// CustomerScheduleProposalsController) are listed by name in AiSchedulingModule's `controllers` — the orphan guard reads it.

/** Extra Nest modules the ops half needs: AiPlatform (explanations), push (manager notifications), the options bridge. */
export const SCHED_OPS_IMPORTS: any[] = [AiModule, PushModule, SchedOptionsBridgeModule];
