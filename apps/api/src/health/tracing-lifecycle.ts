// tracing-lifecycle.ts — BUILD_PLAN Phase 11: the process-level wiring of distributed tracing.
//
//   • at boot, the job queue learns where to read the ambient traceparent (it does not depend on the observability
//     kernel), so every enqueueJob() made inside a request/job stores the trace it should continue (and, Phase 14 A, the
//     correlation id it belongs to);
//   • on shutdown, queued spans are flushed to the collector (never throws, bounded by the exporter's 5 s timeout).
// Tracing itself is configured from OTEL_* on first use (@aipowersalon/observability tracing/span.ts).
import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { setJobCorrelationSource, setJobTraceparentSource } from '@aipowersalon/database';
import { currentTraceparent, getContext, shutdownTracing, tracingConfigFromEnv } from '@aipowersalon/observability';

@Injectable()
export class TracingLifecycle implements OnModuleInit, OnApplicationShutdown {
  onModuleInit(): void {
    setJobTraceparentSource(currentTraceparent);
    setJobCorrelationSource(() => getContext()?.correlationId);   // Phase 14 A: the job joins its request's correlation chain (C11 §292)
    const c = tracingConfigFromEnv();
    if (c.enabled) new Logger('Tracing').log(`[tracing] exporting spans over OTLP/HTTP as ${c.serviceName} (sample ratio ${c.sampleRatio})`);
  }
  async onApplicationShutdown(): Promise<void> { await shutdownTracing(); }
}
