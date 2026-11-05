import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { TracingLifecycle } from './tracing-lifecycle';

// BUILD_PLAN Phase 11: GET /metrics (Prometheus scrape, METRICS_TOKEN) and the tracing lifecycle live beside the probes —
// infrastructure surfaces that hold no tenant data.
@Module({ controllers: [HealthController, MetricsController], providers: [TracingLifecycle] })
export class HealthModule {}
