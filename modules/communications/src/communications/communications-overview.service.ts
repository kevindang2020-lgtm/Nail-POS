// communications-overview.service.ts — assembles the Communications oversight dashboard from REAL messaging data
// (notification_delivery_logs + opt-outs + templates + tenants). Fields not tracked yet (per-message cost, plan
// messaging limits, provider usage %, comms system-alerts) are surfaced HONESTLY as available:false — never faked.
// Read-only; tenant-scoped; audited when scoped.
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { CommunicationsOverviewRepository, type Range } from './communications-overview.kysely.repository';
import {
  CHANNELS, CHANNEL_LABEL, channelBucket, providerHealth, deliveryRate, distribution, pct, trendDelta, kpiTrendSemantic,
  type Semantic,
} from './communications-overview-core';

export interface AdminCtx { userId?: string; email?: string; ip?: string; tenantId?: string | null }
const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export class CommunicationsOverviewService {
  constructor(private readonly repo: CommunicationsOverviewRepository) {}

  private ranges(q: any): { current: Range; prior: Range; days: number } {
    const days = Math.max(1, Math.min(90, Math.round(Number(q?.days)) || 30));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    const prior = { start: new Date(start.getTime() - days * 86400000), end: start };
    return { current: { start, end }, prior, days };
  }

  async getOverview(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const { current, prior, days } = this.ranges(q);

    const [cur, pri, optOut, channels, byDay, providers, tenantUsage, tenantOptOuts, failures, topActivity, templates, activeTenants, today] = await Promise.all([
      this.repo.kpiCounts(scope, current),
      this.repo.kpiCounts(scope, prior),
      this.repo.optOutCount(scope, current),
      this.repo.channelCounts(scope, current),
      this.repo.statusByDay(scope, current),
      this.repo.providerAgg(scope, current),
      this.repo.tenantUsage(scope, current),
      this.repo.tenantOptOuts(scope),
      this.repo.recentFailures(scope),
      this.repo.topActivity(scope, current),
      this.repo.templateCount(scope),
      this.repo.activeTenantsMessaging(scope, current),
      this.repo.todayByChannel(scope, startOfToday()),
    ]);

    const sent = num(cur.sent), delivered = num(cur.delivered), failed = num(cur.failed), suppressed = num(cur.suppressed);
    const kpi = (key: string, label: string, value: number, prior: number, opts: { available?: boolean; display?: string; href?: string } = {}) => {
      const t = trendDelta(value, prior);
      return { key, label, value, display: opts.available === false ? '—' : (opts.display ?? value.toLocaleString()), available: opts.available !== false, deltaPct: t.deltaPct, direction: t.direction, semantic: kpiTrendSemantic(key, t.direction) as Semantic, href: opts.href ?? null };
    };

    const overallRate = deliveryRate(delivered, delivered + failed);
    const provHealth = providerHealth(delivered, failed);

    const kpis = [
      kpi('messages_sent', 'Messages Sent', sent, num(pri.sent)),
      kpi('delivered', 'Delivered Messages', delivered, num(pri.delivered)),
      kpi('failed', 'Failed Messages', failed, num(pri.failed)),
      kpi('suppressed', 'Suppressed Messages', suppressed, num(pri.suppressed)),
      kpi('opt_outs', 'Opt-Outs', num(optOut.window), 0, { href: '/communications' }),
      // Provider usage % (of a capacity/quota) is not tracked → honest.
      kpi('provider_usage', 'Provider Usage', 0, 0, { available: false }),
      // Per-message cost is not tracked in any table → honest.
      kpi('sms_cost', 'SMS Cost', 0, 0, { available: false }),
      kpi('email_cost', 'Email Cost', 0, 0, { available: false }),
      // Plan messaging limits are not joined yet → honest (later unit).
      kpi('messaging_limits', 'Messaging Limits', 0, 0, { available: false }),
      kpi('tenant_usage', 'Active Tenants', num(activeTenants.c), 0),
      { key: 'provider_status', label: 'Delivery-Provider Status', value: overallRate, display: `${overallRate}% ${provHealth.label}`, available: (delivered + failed) > 0, deltaPct: 0, direction: 'flat' as const, semantic: provHealth.semantic, href: null },
      // A comms-specific system-alerts source is not modelled → honest.
      kpi('system_alerts', 'System Alerts', 0, 0, { available: false }),
    ];

    // Communication Mix by Type (donut) + per-type cards.
    const chanAgg: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const c of channels) { const b = channelBucket(c.channel); (chanAgg[b] ||= { sent: 0, delivered: 0, failed: 0 }); chanAgg[b].sent += num(c.sent); chanAgg[b].delivered += num(c.delivered); chanAgg[b].failed += num(c.failed); }
    const mixSegments = distribution(CHANNELS.map((k) => ({ key: k, label: CHANNEL_LABEL[k], count: chanAgg[k]?.sent || 0 })).filter((r) => r.count > 0), sent);
    const communicationMix = { total: sent, segments: mixSegments };
    const communicationTypes = CHANNELS.map((k) => ({ key: k, label: CHANNEL_LABEL[k], sent: chanAgg[k]?.sent || 0, delivered: chanAgg[k]?.delivered || 0, deliveryRate: deliveryRate(chanAgg[k]?.delivered || 0, (chanAgg[k]?.delivered || 0) + (chanAgg[k]?.failed || 0)) }));

    // Provider Status (donut) — group providers by derived health.
    const provRows = providers.map((p) => ({ provider: p.provider_id || '(unknown)', ...providerHealth(num(p.delivered), num(p.failed)), delivered: num(p.delivered), failed: num(p.failed) }));
    const health = { healthy: 0, degraded: 0, down: 0 };
    for (const p of provRows) health[p.key as 'healthy' | 'degraded' | 'down']++;
    const providerStatus = { total: provRows.length, segments: distribution([
      { key: 'healthy', label: 'Healthy', count: health.healthy }, { key: 'degraded', label: 'Degraded', count: health.degraded }, { key: 'down', label: 'Down', count: health.down },
    ], provRows.length), providers: provRows.slice(0, 12) };

    // Volume trend + delivery performance (by day).
    const volumeTrend = byDay.map((d) => ({ day: d.day, sent: num(d.sent), delivered: num(d.delivered), failed: num(d.failed), suppressed: num(d.suppressed) }));

    // Tenant usage overview — join opt-out counts.
    const optByTenant: Record<string, number> = {};
    for (const o of tenantOptOuts) optByTenant[o.tenant_id] = num(o.opt_outs);
    const tenantUsageRows = tenantUsage.map((t) => { const s = num(t.sent); return { tenantId: t.tenant_id, tenant: t.tenant_name || '—', sent: s, delivered: num(t.delivered), failed: num(t.failed), deliveryRate: deliveryRate(num(t.delivered), num(t.delivered) + num(t.failed)), optOuts: optByTenant[t.tenant_id] || 0, optOutRate: pct(optByTenant[t.tenant_id] || 0, s) }; });

    const deliveryFailures = failures.map((f) => ({ tenant: f.tenant_name || '—', channel: CHANNEL_LABEL[channelBucket(f.channel)], template: f.template || '(ad hoc)', reason: f.error_message || 'Unknown error', provider: f.provider_id || '—', time: f.created_at }));

    // At-a-Glance (Today).
    const todayAgg: Record<string, { sent: number; delivered: number }> = {};
    let todaySent = 0, todayDelivered = 0;
    for (const c of today) { const b = channelBucket(c.channel); (todayAgg[b] ||= { sent: 0, delivered: 0 }); todayAgg[b].sent += num(c.sent); todayAgg[b].delivered += num(c.delivered); todaySent += num(c.sent); todayDelivered += num(c.delivered); }
    const atAGlance = {
      sms: todayAgg.sms?.sent || 0, email: todayAgg.email?.sent || 0, push: todayAgg.push?.sent || 0, inApp: todayAgg.in_app?.sent || 0,
      avgDeliveryRate: deliveryRate(todayDelivered, todaySent), providerIncidents: { available: false as const },
    };

    if (scope.tenantId) await this.repo.writeAudit(ctx, 'overview_viewed', scope, 'Viewed Communications overview', { days });

    return {
      ok: true,
      metadata: { generatedAt: new Date().toISOString(), windowDays: days },
      scope: { tenantId: scope.tenantId ?? null, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' },
      kpis,
      communicationMix,
      communicationTypes,
      providerStatus,
      volumeTrend,
      deliveryPerformance: volumeTrend, // same daily series (delivered/failed/suppressed) drives both charts
      tenantUsage: tenantUsageRows,
      deliveryFailures,
      topActivity: topActivity.map((a) => ({ template: a.template || '(ad hoc)', channel: CHANNEL_LABEL[channelBucket(a.channel)], sent: num(a.sent), delivered: num(a.delivered), tenants: num(a.tenants) })),
      templates: { total: num(templates.c) },
      atAGlance,
    };
  }
}
