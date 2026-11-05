// realtime-telemetry.ts — Constitution 11 §50–51, §112: the realtime gateway's counters, in the registry.
//
// Constitution 9 already counts everything §50 asks for (connections, reconnects, resyncs, auth failures, slow
// clients, publish failures, delivery latency p50/p95/p99). It kept them on the gateway instance, readable only by
// the Super Admin live-ops screen. This bridges them into the registry as gauges refreshed on collect — the same
// numbers, one more reader, no second counter. Event-loop lag (§50) is measured here because nothing measured it.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { registry } from './metrics';

export interface RealtimeSnapshot {
  connectionsOpened: number; connectionsClosed: number; reconnects: number; reconnectsPerMinute: number;
  authFailuresPerMinute: number; eventsDelivered: number; eventsDropped: number; eventsPerMinute: number;
  latencyP50Ms: number | null; latencyP95Ms: number | null; latencyP99Ms: number | null;
  resyncsRequired: number; slowClientDrops: number; slowClientDisconnects: number; backbonePublishFailures: number;
}
export interface RealtimeSource { snapshot(): RealtimeSnapshot; activeConnections(): number }

export const rtConnections = registry.gauge('aipowersalon_realtime_connections', 'Open realtime connections', []);
export const rtReconnectsPerMin = registry.gauge('aipowersalon_realtime_reconnects_per_minute', 'Reconnects in the last minute', []);
export const rtAuthFailuresPerMin = registry.gauge('aipowersalon_realtime_auth_failures_per_minute', 'Origin/rate-limit/authz rejections in the last minute', []);
export const rtEventsPerMin = registry.gauge('aipowersalon_realtime_events_per_minute', 'Events delivered in the last minute', []);
export const rtEventsDropped = registry.gauge('aipowersalon_realtime_events_dropped_total', 'Ephemeral events dropped (cumulative)', []);
export const rtResyncs = registry.gauge('aipowersalon_realtime_resyncs_total', 'Clients told to resync (cumulative)', []);
export const rtSlowClients = registry.gauge('aipowersalon_realtime_slow_client_disconnects_total', 'Slow clients disconnected (cumulative)', []);
export const rtBackboneFailures = registry.gauge('aipowersalon_realtime_backbone_publish_failures_total', 'Redis backbone publish failures (cumulative)', []);
export const rtDeliveryLatency = registry.gauge('aipowersalon_realtime_delivery_latency_seconds', 'Domain event → client emit latency', ['quantile']);
export const eventLoopLag = registry.gauge('aipowersalon_nodejs_event_loop_lag_seconds', 'Event-loop delay', ['quantile']);

let loop: ReturnType<typeof monitorEventLoopDelay> | null = null;

/** Called once by the realtime module with the gateway. Idempotent per source. */
export function attachRealtimeTelemetry(source: RealtimeSource): void {
  if (!loop) { loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable(); }
  registry.onCollect(() => {
    const s = source.snapshot();
    rtConnections.set(source.activeConnections());
    rtReconnectsPerMin.set(s.reconnectsPerMinute); rtAuthFailuresPerMin.set(s.authFailuresPerMinute);
    rtEventsPerMin.set(s.eventsPerMinute); rtEventsDropped.set(s.eventsDropped); rtResyncs.set(s.resyncsRequired);
    rtSlowClients.set(s.slowClientDisconnects); rtBackboneFailures.set(s.backbonePublishFailures);
    for (const [q, v] of [['0.5', s.latencyP50Ms], ['0.95', s.latencyP95Ms], ['0.99', s.latencyP99Ms]] as const) {
      if (v !== null) rtDeliveryLatency.set(v / 1000, { quantile: q });
    }
    if (loop) {
      for (const [q, v] of [['0.5', loop.percentile(50)], ['0.95', loop.percentile(95)], ['0.99', loop.percentile(99)]] as const) {
        eventLoopLag.set(v / 1e9, { quantile: q });   // histogram is in nanoseconds
      }
      loop.reset();
    }
  });
}
