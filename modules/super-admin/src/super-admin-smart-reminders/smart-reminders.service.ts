// smart-reminders.service.ts — assembles the Smart Reminders oversight dashboard from REAL reminder data
// (appointment_reminder_attempts + reminder_settings + tenants). Fields the schema does not model — scheduled-today
// jobs, fallback executions, open/engagement rates, upcoming jobs, per-type counts — are surfaced HONESTLY as
// available:false, never fabricated. Read-only; tenant-scoped; audited when scoped.
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { SmartRemindersRepository, type Range } from './smart-reminders.kysely.repository';
import { REMINDER_TYPES, CHANNELS, CHANNEL_LABEL, channelBucket, deliveryRate, distribution, trendDelta, kpiTrendSemantic, type Semantic } from './smart-reminders-core';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const num = (v: string | null | undefined) => Number(v ?? 0) || 0;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export class SmartRemindersService {
  constructor(private readonly repo: SmartRemindersRepository) {}

  private ranges(q: any): { current: Range; prior: Range; days: number } {
    const days = Math.max(1, Math.min(90, Math.round(Number(q?.days)) || 30));
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    return { current: { start, end }, prior: { start: new Date(start.getTime() - days * 86400000), end: start }, days };
  }

  async getOverview(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const { current, prior, days } = this.ranges(q);

    const [cur, pri, channels, byDay, tenantUsage, recent, failures, problematic, settings, tenantsUsing, today] = await Promise.all([
      this.repo.attemptCounts(scope, current),
      this.repo.attemptCounts(scope, prior),
      this.repo.channelCounts(scope, current),
      this.repo.statusByDay(scope, current),
      this.repo.tenantUsage(scope, current),
      this.repo.recentActivity(scope),
      this.repo.failures(scope),
      this.repo.problematicTenants(scope, current),
      this.repo.settingsAgg(scope),
      this.repo.tenantsUsing(scope, current),
      this.repo.todayByChannel(scope, startOfToday()),
    ]);

    const total = num(cur.total), delivered = num(cur.delivered), failed = num(cur.failed), blocked = num(cur.blocked);
    const rate = deliveryRate(delivered, delivered + failed);
    const chan: Record<string, { total: number; delivered: number }> = {};
    for (const c of channels) { const b = channelBucket(c.channel); (chan[b] ||= { total: 0, delivered: 0 }); chan[b].total += num(c.total); chan[b].delivered += num(c.delivered); }

    const kpi = (key: string, label: string, value: number, priorVal: number, opts: { available?: boolean; display?: string } = {}) => {
      const t = trendDelta(value, priorVal);
      return { key, label, value, display: opts.available === false ? '—' : (opts.display ?? value.toLocaleString()), available: opts.available !== false, deltaPct: t.deltaPct, direction: t.direction, semantic: kpiTrendSemantic(key, t.direction) as Semantic };
    };

    const kpis = [
      kpi('active_flows', 'Active Reminder Flows', num(settings.enabled), 0),
      // No scheduled-jobs table → honest.
      kpi('scheduled_today', 'Scheduled Reminders Today', 0, 0, { available: false }),
      kpi('delivered', 'Delivered Reminders', delivered, num(pri.delivered)),
      kpi('failed', 'Failed Reminders', failed, num(pri.failed)),
      // Fallback executions are not modelled → honest.
      kpi('fallback', 'Fallback Executions', 0, 0, { available: false }),
      { key: 'delivery_rate', label: 'Delivery Rate', value: rate, display: `${rate}%`, available: (delivered + failed) > 0, deltaPct: 0, direction: 'flat' as const, semantic: (rate >= 95 ? 'good' : rate >= 85 ? 'warn' : 'bad') as Semantic },
      kpi('sms', 'SMS Reminders', chan.sms?.total || 0, 0),
      kpi('email', 'Email Reminders', chan.email?.total || 0, 0),
      kpi('push', 'Push Reminders', chan.push?.total || 0, 0),
      kpi('customizations', 'Tenant Customizations Enabled', num(settings.total), 0),
      kpi('problematic', 'Problematic Reminder Flows', num(problematic.c), 0),
      // Open/engagement is not tracked on reminder attempts → honest.
      kpi('engagement', 'Avg Reminder Engagement', 0, 0, { available: false }),
    ];

    const channelMix = { total, segments: distribution(CHANNELS.map((k) => ({ key: k, label: CHANNEL_LABEL[k], count: chan[k]?.total || 0 })).filter((r) => r.count > 0), total) };
    const deliveryStatus = {
      total, segments: distribution([
        { key: 'delivered', label: 'Delivered', count: delivered },
        { key: 'failed', label: 'Failed', count: failed },
        { key: 'blocked', label: 'Blocked', count: blocked },
      ].filter((s) => s.count > 0), total),
      // Pending + fallback states are not modelled.
      pendingAvailable: false as const, fallbackAvailable: false as const,
    };
    const deliveryTrend = byDay.map((d) => ({ day: d.day, total: num(d.total), delivered: num(d.delivered), failed: num(d.failed), blocked: num(d.blocked) }));

    // Reminder types = the supported catalog; per-type counts are not tracked → honest.
    const reminderTypes = REMINDER_TYPES.map((t) => ({ key: t.key, label: t.label, countAvailable: false as const }));

    const tenantUsageRows = tenantUsage.map((t) => ({ tenantId: t.tenant_id, tenant: t.tenant_name || '—', total: num(t.total), delivered: num(t.delivered), failed: num(t.failed), sms: num(t.sms), email: num(t.email), push: num(t.push), deliveryRate: deliveryRate(num(t.delivered), num(t.delivered) + num(t.failed)) }));
    const performanceByTenant = tenantUsageRows.slice(0, 5).map((t) => ({ tenant: t.tenant, delivered: t.delivered, deliveryRate: t.deliveryRate, openRateAvailable: false as const, engagementAvailable: false as const }));

    let todayTotal = 0, todayDelivered = 0, todayFailed = 0;
    const todayChan: Record<string, number> = {};
    for (const c of today) { const b = channelBucket(c.channel); todayChan[b] = (todayChan[b] || 0) + num(c.total); todayTotal += num(c.total); todayDelivered += num(c.delivered); todayFailed += num(c.failed); }

    if (scope.tenantId) await this.repo.writeAudit(ctx, 'overview_viewed', scope, 'Viewed Smart Reminders overview', { days });

    return {
      ok: true,
      metadata: { generatedAt: new Date().toISOString(), windowDays: days },
      scope: { tenantId: scope.tenantId ?? null, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' },
      kpis,
      reminderTypes,
      channelMix,
      deliveryStatus,
      deliveryTrend,
      // Scheduled vs delivered vs failed: delivered/failed are real; "scheduled" is not tracked (no scheduled-jobs table).
      scheduledVsDelivered: { days: deliveryTrend.map((d) => ({ day: d.day, delivered: d.delivered, failed: d.failed })), scheduledAvailable: false as const },
      tenantUsage: tenantUsageRows,
      deliveryFailures: failures.map((f) => ({ tenant: f.tenant_name || '—', channel: CHANNEL_LABEL[channelBucket(f.channel)] || '—', reason: f.error || (f.status === 'blocked' ? 'Blocked' : 'Unknown error'), status: f.status, time: f.created_at })),
      recentActivity: recent.map((a) => ({ tenant: a.tenant_name || '—', channel: CHANNEL_LABEL[channelBucket(a.channel)] || '—', status: a.status, time: a.created_at })),
      // No scheduled-jobs table → honestly empty rather than fabricated future jobs.
      upcomingJobs: { available: false as const, jobs: [] as unknown[] },
      performanceByTenant,
      settings: { enabledFlows: num(settings.enabled), customizations: num(settings.total), avgLeadMinutes: settings.avg_lead != null ? num(settings.avg_lead) : null, tenantsUsing: num(tenantsUsing.c) },
      atAGlance: {
        sentToday: todayTotal, successfulToday: todayDelivered, failedToday: todayFailed,
        fallbackToday: { available: false as const }, avgOpenRate: { available: false as const }, tenantsUsingReminders: num(tenantsUsing.c),
      },
    };
  }
}
