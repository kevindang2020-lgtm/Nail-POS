// ai-scheduling.module.ts — wires the AI Scheduling Optimizer (BUILD_PLAN Phase 7). ONE Nest module holds both halves:
// the engine (AiSchedulingService + its store / reader / events — agent A) and the operations half spread in from
// ai-scheduling-ops.providers.ts (proposals, explanations, usage, platform switch, automation, insights, jobs — agent B).
// The engine reaches the ops ports LAZILY through ModuleRef so the ops half may inject AiSchedulingService back (the
// proposal service calls customerDecided, the automation runner applies) without a constructor cycle.
// Kysely store / outbox events / hold service with a database handle; in-memory adapters without one (dev / tests).
import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BookingService, BookingModule, type BookingRepositoryPort } from '@aipowersalon/booking';
import { schedHoldPort } from './ai-scheduling.hold-port';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService, auditSinkFor } from '@aipowersalon/audit';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { AiSchedulingController } from './ai-scheduling.controller';
import { AiSchedulingService, type ForecastPort, type AuditSink, type SchedHoldPort } from './ai-scheduling.service';
import type { BookingPort } from './ai-scheduling-application';
import { KyselySchedStore } from './ai-scheduling.kysely.repository';
import { InMemorySchedStore } from './ai-scheduling.memory.repository';
import type { SchedStore } from './ai-scheduling.store';
import { BookingServiceReadAdapter } from './ai-scheduling.booking-read.adapter';
import type { SchedDayReader } from './ai-scheduling.data-adapter';
import { OutboxSchedEvents, InMemorySchedEvents } from './ai-scheduling.events';
import {
  SCHED_EVENTS, SCHED_PROPOSAL_PORT, SCHED_EXPLANATION_PORT, SCHED_USAGE_PORT, SCHED_PLATFORM_SWITCH_PORT, SCHED_AUTOMATION_PORT,
  type SchedEventsPort, type SchedProposalPort, type SchedExplanationPort, type SchedUsagePort, type SchedPlatformSwitchPort, type SchedAutomationPort,
} from './ai-scheduling.ports';
import { SCHED_OPS_PROVIDERS, SCHED_OPS_IMPORTS } from './ai-scheduling-ops.providers';
// The operations half's controllers are listed HERE by name (not spread from a constant) so the no-orphaned-controllers
// guard can see them registered.
import { AiSchedulingOpsController } from './ai-scheduling-ops.controller';
import { OwnerAiSchedulingController } from './ai-scheduling-owner';
import { TechAiScheduleController } from './ai-scheduling-tech';
import { CustomerScheduleProposalsController } from './ai-scheduling-proposals.customer.controller';
import { AiAnalyticsForecastingModule } from '../ai-analytics-forecasting/ai-analytics-forecasting.module';
import { BusyPeriodService } from '../ai-analytics-forecasting/busy-period.service';

export const SCHED_STORE = 'SchedStore';
export const SCHED_READER = 'SchedDayReader';
const FORECAST = 'SchedForecastPort';
const AUDIT_SINK = 'SchedAuditSink';
const HOLDS = 'SchedHoldPort';

/** ForecastPort over the canonical Busy & Slow Periods domain (ai-analytics-forecasting). Advisory only: any error or
 *  insufficient history resolves to { available: false } — the optimizer lowers confidence, it never blocks or fabricates.
 *  Read with the caller's own permissions (a role without reports.view gets "unavailable" — no silent escalation). */
class BusyPeriodForecastAdapter implements ForecastPort {
  constructor(private readonly busy: BusyPeriodService) {}
  async getBusyHours(ctx: Parameters<ForecastPort['getBusyHours']>[0], scope: { branchId: string | null; date: string }) {
    try {
      const branchId = scope.branchId ?? ctx.branchId ?? '';
      if (!branchId) return { available: false, version: null };
      const res: any = await this.busy.getBusyPeriods({ tenantId: ctx.tenantId, branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions });
      if (!res || res.confidence === 'insufficient_data') return { available: false, version: null };
      const dow = new Date(String(scope.date).slice(0, 10) + 'T00:00:00Z').getUTCDay();
      const demandMinutes = Math.round((res.cells ?? []).filter((c: any) => c.dow === dow).reduce((n: number, c: any) => n + Number(c.avg || 0) * 60, 0));
      return { available: true, version: res.generatedAt ?? null, demandMinutes };
    } catch { return { available: false, version: null }; }
  }
}

/** Resolve an ops-half port on first use (never at construction — breaks the engine ↔ ops injection cycle). */
function lazy<T extends object>(ref: ModuleRef, token: string): T {
  let inst: T | null = null;
  const get = (): T => (inst ??= ref.get<T>(token, { strict: false }));
  return new Proxy({} as T, { get: (_t, prop) => { const v = (get() as any)[prop]; return typeof v === 'function' ? v.bind(get()) : v; } });
}

/** audit_events.actor_user_id is a uuid: a job / automation / Super Admin context carries a 'system:…' ref instead, which
 *  goes into the metadata (actorRef) rather than failing the write and losing the audit row. */
export function schedAuditUserId(userId: string | null | undefined): string | null {
  return userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ? userId : null;
}
/** The audited thing, from the action's prefix (settings.updated → scheduling_settings), not always "recommendation". */
export function schedAuditResourceType(action: string): string {
  const p = String(action || '').split('.')[0];
  return ({ settings: 'scheduling_settings', run: 'schedule_optimization_run', automation: 'schedule_optimization_run', hold: 'booking_hold', lock: 'appointment_schedule_lock', time_off: 'technician_time_off', service_profile: 'service_scheduling_profile' } as Record<string, string>)[p] ?? 'scheduling_recommendation';
}

@Module({
  // EventsCoreModule provides OutboxWriter (non-optional injection — the Phase 6 outbox-wiring guard).
  imports: [EventsCoreModule, BookingModule, AiAnalyticsForecastingModule, ...SCHED_OPS_IMPORTS],
  controllers: [AiSchedulingController, AiSchedulingOpsController, OwnerAiSchedulingController, TechAiScheduleController, CustomerScheduleProposalsController],
  providers: [
    ...SCHED_OPS_PROVIDERS,
    { provide: SCHED_STORE, useFactory: (db: AppDatabase): SchedStore => (db ? new KyselySchedStore(db) : new InMemorySchedStore()), inject: [DATABASE] },
    { provide: SCHED_READER, useFactory: (repo: BookingRepositoryPort, db: AppDatabase): SchedDayReader => new BookingServiceReadAdapter(repo, db ?? null), inject: ['BookingRepositoryPort', DATABASE] },
    { provide: SCHED_EVENTS, useFactory: (db: AppDatabase, outbox: OutboxWriter): SchedEventsPort => (db ? new OutboxSchedEvents(db, outbox) : new InMemorySchedEvents()), inject: [DATABASE, OutboxWriter] },
    { provide: FORECAST, useFactory: (busy: BusyPeriodService): ForecastPort => new BusyPeriodForecastAdapter(busy), inject: [BusyPeriodService] },
    // Round 3 H2: findOptions {hold} acquires under the booking engine's hold lock and re-checks appointments there
    // (SlotHoldService.acquireLocked), so a hold and a booking of the same slot racing cannot both win.
    { provide: HOLDS, useFactory: (db: AppDatabase): SchedHoldPort | null => db ? schedHoldPort(db) : null, inject: [DATABASE] },
    { provide: AUDIT_SINK, useFactory: (audit: AuditService): AuditSink => {
      const sink = auditSinkFor(audit);
      return { async record(ctx, action, id, meta) { await sink.record({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: schedAuditUserId(ctx.userId), role: ctx.role ?? null, module: 'ai_scheduling_optimizer', action, resourceType: schedAuditResourceType(action), resourceId: id ?? null, metadata: { ...((meta ?? {}) as Record<string, unknown>), ...(ctx.actor && ctx.actor !== 'user' ? { actor: ctx.actor, actorRef: ctx.userId ?? null } : {}) } }); } };
    }, inject: [AuditService] },
    {
      provide: AiSchedulingService,
      useFactory: (store: SchedStore, reader: SchedDayReader, forecast: ForecastPort, booking: BookingService, holds: SchedHoldPort | null, audit: AuditSink, events: SchedEventsPort, ref: ModuleRef) => new AiSchedulingService({
        store, reader, forecast, booking: booking as unknown as BookingPort, holds, audit, events,
        proposals: lazy<SchedProposalPort>(ref, SCHED_PROPOSAL_PORT), explanations: lazy<SchedExplanationPort>(ref, SCHED_EXPLANATION_PORT),
        usage: lazy<SchedUsagePort>(ref, SCHED_USAGE_PORT), platform: lazy<SchedPlatformSwitchPort>(ref, SCHED_PLATFORM_SWITCH_PORT),
        automation: lazy<SchedAutomationPort>(ref, SCHED_AUTOMATION_PORT),
      }),
      inject: [SCHED_STORE, SCHED_READER, FORECAST, BookingService, HOLDS, AUDIT_SINK, SCHED_EVENTS, ModuleRef],
    },
  ],
  exports: [AiSchedulingService, SCHED_EVENTS, SCHED_STORE, SCHED_READER],
})
export class AiSchedulingModule {}
