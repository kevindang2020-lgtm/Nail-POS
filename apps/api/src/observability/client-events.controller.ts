// client-events.controller.ts — Constitution 6 §116–119 (BUILD_PLAN Phase 13, E): the mobile apps' analytics events and
// performance marks land here, and Super Admin sees them counted.
//
// PUBLIC BY NECESSITY, like POST /client-telemetry/errors beside it: launch timing and the login screen's events happen
// before any session exists. So nothing here trusts the body. The batch goes through the SAME allowlist the apps apply
// before sending (@aipowersalon/api-contracts client-telemetry): an event not on the list, a prop not listed for that
// event, a value outside its closed set — dropped. What survives is only ever enum values, route templates, booleans and
// small counts, so a metric label or a log field can never carry a name, a phone, an email, a card or a free-text note.
// Stores NOTHING in the database, reads no tenant data, always answers 204; per-IP and per-instance rate limits.
//
// WHERE IT LANDS: process metrics (Prometheus — `aipowersalon_client_events_total{app,platform,event}`,
// `aipowersalon_client_perf_ms{app,platform,metric}`), which the existing scrape aggregates across instances, and the
// Super Admin count view below (this instance's counters — Phase 14 builds the persisted mobile dashboard).
import { registry, quantile, type HistogramValue } from '@aipowersalon/observability';
import { clientIp } from '@aipowersalon/security';
import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { sanitizeTelemetryBatch, ANALYTICS_EVENTS, PERF_METRICS, type ClientTelemetryBatch, type MobileTelemetryRow, type MobileTelemetryView } from '@aipowersalon/api-contracts';
import { CLIENT_EVENTS_BODY } from './request-schemas';
import { WindowLimiter, clientErrors } from './client-errors.controller';

export const EVENT_LIMITS = { perIpPerMinute: 60, perInstancePerMinute: 3000 } as const;
const PERF_BUCKETS_MS = [50, 100, 250, 500, 1000, 2000, 4000, 8000, 15000, 30000, 60000] as const;

export const clientEvents = registry.counter('aipowersalon_client_events_total', 'Allow-listed product events from the mobile / web apps (C6 §116)', ['app', 'platform', 'event']);
export const clientPerf = registry.histogram('aipowersalon_client_perf_ms', 'Client performance marks in ms (C6 §119)', ['app', 'platform', 'metric'], PERF_BUCKETS_MS);
export const clientEventsDropped = registry.counter('aipowersalon_client_events_dropped_total', 'Telemetry batches refused (invalid or rate-limited)', ['reason']);

@Controller('client-telemetry')
export class ClientEventsController {
  readonly limiter = new WindowLimiter(EVENT_LIMITS.perIpPerMinute, EVENT_LIMITS.perInstancePerMinute);

  @Post('events')
  @HttpCode(204)
  ingest(@Req() req: any, @Body(ValidatedBody(CLIENT_EVENTS_BODY, { strict: true })) body: Partial<ClientTelemetryBatch>): void {   // untrusted: re-sanitized below
    try {
      const ip = clientIp(req) ?? 'unknown';
      if (!this.limiter.allow(ip)) { clientEventsDropped.inc({ reason: 'rate_limited' }); return; }
      const b = sanitizeTelemetryBatch(body);
      if (!b) { clientEventsDropped.inc({ reason: 'invalid' }); return; }
      for (const e of b.events) clientEvents.inc({ app: b.app, platform: b.platform, event: e.name });
      for (const m of b.perf) clientPerf.observe(m.ms, { app: b.app, platform: b.platform, metric: m.metric });
    } catch { /* telemetry intake never errors */ }
  }
}


/** This instance's counters, grouped by app + platform. Only allow-listed names can be present (they are the labels). */
export function mobileTelemetryCounts(): MobileTelemetryRow[] {
  const rows = new Map<string, MobileTelemetryRow>();
  const row = (app: string, platform: string) => {
    const k = `${app}|${platform}`;
    let r = rows.get(k);
    if (!r) { r = { app, platform, events: {}, errors: 0, perf: {} }; rows.set(k, r); }
    return r;
  };
  for (const s of clientEvents.snapshot()) {
    if (!Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, s.labels.event)) continue;
    const r = row(s.labels.app, s.labels.platform);
    r.events[s.labels.event] = (r.events[s.labels.event] ?? 0) + (s.value as number);
  }
  for (const s of clientPerf.snapshot()) {
    if (!Object.prototype.hasOwnProperty.call(PERF_METRICS, s.labels.metric)) continue;
    const h = s.value as HistogramValue;
    row(s.labels.app, s.labels.platform).perf[s.labels.metric] = { count: h.count, p50Ms: quantile(h, 0.5), p95Ms: quantile(h, 0.95) };
  }
  for (const s of clientErrors.snapshot()) {
    if (!s.labels.platform) continue;
    row(s.labels.app, s.labels.platform).errors += s.value as number;
  }
  return [...rows.values()].sort((a, b) => (a.app + a.platform).localeCompare(b.app + b.platform));
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/system')
export class MobileTelemetryController {
  @Get('mobile-telemetry') @RequirePermission('super_admin.system_operations.view')
  view(): MobileTelemetryView {
    return { scope: 'instance', generatedAt: new Date().toISOString(), apps: mobileTelemetryCounts() };
  }
}
