// observability.module.ts — Constitution 11 Phase 13: hosts the Platform Health Aggregator.
//
// Imports the two modules whose state the aggregator reads but does not own: AI (the provider circuit breakers,
// Constitution 10) and Events (the outbox health, Constitution 8). Everything else it reads from the process-wide
// metrics registry, which needs no wiring.
import { Module } from '@nestjs/common';
import { AiModule } from '@aipowersalon/ai';
import { EventsModule } from '../events/events.module';
import { HealthAggregator } from './health-aggregator';
import { ClientErrorsController } from './client-errors.controller';
import { ClientEventsController, MobileTelemetryController } from './client-events.controller';   // BUILD_PLAN Phase 13 (C6 §116–119)
import { TelemetryRetention } from './telemetry-retention';
import { SyntheticProbes } from './synthetic-probes';
import { BackupReportsController, BackupReportsService } from './backup-reports';
import { AlertNotifier } from './alert-notifier';
import { CrossTenantSignal } from './cross-tenant-signal';
import { IntegrityChecks } from './integrity-checks';
import { SyncReconciliation } from './sync-reconciliation';
import { TenantHealthController, TenantHealthListController, TenantHealthService, TenantHealthSnapshots } from './tenant-health';
import { SystemOperationsController, SystemOperationsService } from './system-operations';
import { CapacityOpsController, CapacityOpsService, NoisyNeighbourWatch } from './capacity-ops';
import { QuotaModule } from '../common/tenant-quotas';
import { RuntimeSafetyController, RuntimeSafetyService } from './runtime-safety';   // BUILD_PLAN Phase 11: schema version, break-glass, limiter, stranded payments
import { QueueMetrics } from './queue-metrics';   // BUILD_PLAN Phase 14 B: queue gauges (jobs / outbox / dead letters)
import { ProcessHeartbeat } from './process-heartbeat';   // BUILD_PLAN Phase 14 B: per-boot heartbeat (deployments + fleet dashboards)
import { BranchHealthService, BranchHealthSnapshots, BranchHealthListController, OwnerBranchHealthController } from './branch-health';   // BUILD_PLAN Phase 14 B: §345
import { OpsDashboardsController, OpsDashboardsService } from './ops-dashboards';   // BUILD_PLAN Phase 14 B: §145, §149–155 dashboards
import { TelemetrySearchController, TelemetrySearchService, TelemetryStoreLifecycle, TelemetryStoreRetention } from './telemetry-store';   // BUILD_PLAN Phase 14 A: the log + trace store and its search (C11 §181, §291–292)
import { AlertEscalation } from './alert-escalation';   // BUILD_PLAN Phase 14 C: on-call chain (§262–265)
import { OnCallController, OnCallService, AlertAckPublicController } from './oncall';
import { SloValidationJob } from './slo-validation';   // §80
import { SecuritySignals, SecuritySignalsMiddleware } from './security-signals';   // D8

@Module({
  imports: [AiModule, EventsModule, QuotaModule],
  controllers: [BranchHealthListController, OwnerBranchHealthController, OpsDashboardsController, ClientErrorsController, ClientEventsController, MobileTelemetryController, SystemOperationsController, CapacityOpsController, RuntimeSafetyController, BackupReportsController, TenantHealthController, TenantHealthListController, OnCallController, AlertAckPublicController, TelemetrySearchController],
  providers: [QueueMetrics, ProcessHeartbeat, BranchHealthService, BranchHealthSnapshots, OpsDashboardsService, HealthAggregator, TelemetryRetention, SystemOperationsService, RuntimeSafetyService, SyntheticProbes, BackupReportsService, AlertNotifier, CrossTenantSignal, IntegrityChecks, SyncReconciliation, TenantHealthService, TenantHealthSnapshots, CapacityOpsService, NoisyNeighbourWatch, AlertEscalation, OnCallService, SloValidationJob, SecuritySignals, SecuritySignalsMiddleware, TelemetrySearchService, TelemetryStoreLifecycle, TelemetryStoreRetention],
  // CrossTenantSignal is exported so AppModule-scoped TenantContextMiddleware can inject it.
  exports: [HealthAggregator, CrossTenantSignal, SecuritySignals, SecuritySignalsMiddleware],
})
export class ObservabilityModule {}
