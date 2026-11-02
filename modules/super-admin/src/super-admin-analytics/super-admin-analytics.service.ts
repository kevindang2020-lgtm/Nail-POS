// super-admin-analytics.service.ts — S03 Super Admin › Analytics consolidated read model.
//
// One platform-level business-intelligence payload composed by REUSING the existing platform
// aggregation services (no new cross-tenant SQL, no duplicated queries). Every value is either
// derived from a real source or flagged `{ available: false, reason }` — never fabricated.
//
// Honesty contract (matches the project rule + the Analytics spec §22/§23/§31):
//  - Money is integer cents end-to-end; ratios are zero-guarded.
//  - Sources that have no event backing yet (churn, daily new-vs-returning, AI receptionist
//    call/booking/reminder/automation rates, platform uptime % / API success % / response time)
//    return `available: false` so the UI renders `—` / NotConnected instead of inventing numbers.
//  - Tenant scope is the server-validated `OverviewScope` from `parseScope` — never a raw client id.

import type { AnalyticsPayload, AnalyticsKpi } from '@aipowersalon/api-contracts/platform';
import { SuperAdminPlatformService } from '../super-admin-platform/super-admin-platform.service';
import { SuperAdminMembershipsService } from '../super-admin-memberships/super-admin-memberships.service';
import { type OverviewScope, type AppDatabase } from '@aipowersalon/database';
import type { AnalyticsRange, CompareMode, ExportFormat, Gap } from '@aipowersalon/api-contracts/platform';
export type { AnalyticsRange, CompareMode, ExportFormat, Gap };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { toCsv, toXlsx, toPdf, type ExportRow } from './analytics-export';
import type { AnalyticsGapRepo } from './super-admin-analytics.kysely.repository';

export interface AnalyticsCtx { userId?: string; email?: string; ip?: string }

// Monthly-series offset for each comparison mode (the consolidated series is monthly).
const COMPARE_OFFSET: Record<CompareMode, number> = { none: 1, previous_period: 1, previous_month: 1, previous_quarter: 3, previous_year: 12 };
const COMPARE_LABEL: Record<CompareMode, string> = { none: 'prior period', previous_period: 'previous period', previous_month: 'last month', previous_quarter: 'last quarter', previous_year: 'last year' };

const gap = (reason: string): Gap => ({ available: false, reason });

// Fail-soft per source: a single source throwing must not blank the whole page (spec §34).
async function settle<T>(p: Promise<T> | T): Promise<T | null> {
  try { return await p; } catch { return null; }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// Period-over-period growth as a percent, zero-guarded. Returns null when there is no prior
// basis so the UI can show "New" / "No prior data" rather than a misleading ∞ (spec §31).
function growthPct(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior <= 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

@Injectable()
export class SuperAdminAnalyticsService {
  constructor(
    private readonly platform: SuperAdminPlatformService,
    private readonly memberships: SuperAdminMembershipsService,
    private readonly db?: AppDatabase,
    private readonly gapRepo?: AnalyticsGapRepo,
  ) {}

  // Audit writer (export is a controlled cross-tenant read → audited). Mirrors the platform service's
  // pattern; auditing must never break the request.
  private async audit(ctx: AnalyticsCtx, action: string, meta?: Record<string, unknown>) {
    if (!this.db) return;
    await this.db.insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: ctx.userId || null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'analytics', entity_id: 'platform', metadata_json: JSON.stringify(meta || {}),
    }).execute().catch(() => { /* surfaces in health checks, never breaks the export */ });
  }

  async analytics(ctx: AnalyticsCtx, range: AnalyticsRange, scope?: OverviewScope, compareTo: CompareMode = 'previous_period'): Promise<AnalyticsPayload> {   // the wire contract admin-web reads (Constitution 13 §15)
    const sid = scope?.tenantId ?? undefined;

    // Compose every section in parallel, fail-soft. All reuse existing services.
    const [reports, payments, appts, customers, devices, branches, membership, topTenants, reminders] = await Promise.all([
      settle(this.platform.reports()),
      settle(this.platform.platformPayments({ tenantId: sid })),
      settle(this.platform.platformAppointments({ tenantId: sid })),
      settle(this.platform.platformCustomers({})), // NOTE: platformCustomers has no tenant filter yet → platform-wide even when scoped (flagged below).
      settle(this.platform.platformDevices({ tenantId: sid })),
      settle(this.platform.branchesDashboard(scope)),
      settle(this.memberships.getOverview(ctx, { scope })),
      settle(this.platform.topPerformingTenants(5)),
      settle(this.platform.platformReminders({})), // real reminder delivery metrics (platform-wide) for M11
    ]);

    // Gap-filling queries (real sources: payments, payments⋈branches, ticket_service_lines⋈categories, tickets). Absent repo → [] → honest gap.
    const g = this.gapRepo;
    const [dailySeries, revByState, demandMatrix, catRevenue, newReturning, churnRow, healthRow] = await Promise.all([
      settle(g?.dailySeries ? g.dailySeries(sid, 7) : Promise.resolve([])),
      settle(g?.revenueByState ? g.revenueByState(sid) : Promise.resolve([])),
      settle(g?.demandMatrix ? g.demandMatrix(sid) : Promise.resolve([])),
      settle(g?.categoryRevenue ? g.categoryRevenue(sid) : Promise.resolve([])),
      settle(g?.newVsReturning ? g.newVsReturning(sid, 30) : Promise.resolve(null)),
      settle(g?.tenantChurn ? g.tenantChurn(30) : Promise.resolve(null)),
      settle(g?.requestHealth ? g.requestHealth(60) : Promise.resolve(null)),
    ]);
    const daily: any[] = Array.isArray(dailySeries) ? dailySeries : [];
    const states: any[] = Array.isArray(revByState) ? revByState : [];
    const matrix: any[] = Array.isArray(demandMatrix) ? demandMatrix : [];
    const categories: any[] = Array.isArray(catRevenue) ? catRevenue : [];
    const nvr: any = newReturning && typeof newReturning === 'object' ? newReturning : null;
    const churn: any = churnRow && typeof churnRow === 'object' ? churnRow : null;
    const health: any = healthRow && typeof healthRow === 'object' ? healthRow : null;
    // M11 AI bookings + automation rate — derived from the already-fetched appointment source mix (source='ai' is real).
    const apptSrc: any[] = appts?.bySource ?? [];
    const totalBookings = apptSrc.reduce((a, s) => a + num(s.count ?? s.n), 0);
    const aiBookings = num(apptSrc.find((s) => String(s.source ?? s.label) === 'ai')?.count ?? apptSrc.find((s) => String(s.source ?? s.label) === 'ai')?.n);
    const aiBookingsBlock = totalBookings > 0
      ? { available: true as const, aiBookings, totalBookings, automationRatePct: Math.round((aiBookings / totalBookings) * 1000) / 10 }
      : gap('No appointment source data yet.');

    const pk = payments?.kpis ?? {};
    const ck = customers?.kpis ?? {};
    const totals = reports?.totals ?? {};
    const mk = (membership as any)?.kpis ?? {};

    // ---- Reconciled totals (single documented source each, spec §32) ----
    const revenueCents = num(pk.processedVolumeCents);            // payments.kpis.processedVolumeCents
    const deviceTotal = num((devices as any)?.kpis?.totalDevices);
    const deviceOnline = num((devices as any)?.kpis?.online);
    const branchDir: any[] = (branches as any)?.directory ?? [];
    const activeBranches = branchDir.filter((b) => String(b.status || '').toLowerCase() === 'active').length;
    const membershipRevenueCents = num(mk.revenueCents);

    // ---- 8 KPI cards. MoM delta is only emitted where a real prior basis exists. ----
    const monthlyVol: any[] = (payments as any)?.monthly ?? [];   // [{month,count,cents}]
    const cmpOff = COMPARE_OFFSET[compareTo] ?? 1;
    const N = monthlyVol.length;
    const lastVol = monthlyVol[N - 1]?.cents, prevVol = monthlyVol[N - 1 - cmpOff]?.cents;
    const lastTxn = monthlyVol[N - 1]?.count, prevTxn = monthlyVol[N - 1 - cmpOff]?.count;

    const kpis: AnalyticsKpi[] = [
      { key: 'revenue', label: 'Total Revenue', valueCents: revenueCents, format: 'money', deltaPct: growthPct(num(lastVol), num(prevVol)), to: '/platform-reports' },
      { key: 'appointments', label: 'Total Appointments', value: num(appts?.total), format: 'count', deltaPct: null, to: '/appointment-oversight' },
      { key: 'customers', label: 'Total Customers', value: num(ck.totalCustomers), format: 'count', deltaPct: null, to: '/customer-data-oversight', scopedApprox: !!sid },
      { key: 'activeTenants', label: 'Active Tenants', value: num(totals.activeTenants), format: 'count', deltaPct: null, to: '/tenants?status=active' },
      { key: 'activeBranches', label: 'Active Branches', value: activeBranches, format: 'count', deltaPct: null, to: '/branches?status=active' },
      { key: 'activeDevices', label: 'Active POS Devices', value: deviceTotal, format: 'count', deltaPct: null, to: '/devices-management' },
      { key: 'avgTicket', label: 'Average Ticket Size', valueCents: num(pk.averageTicketCents), format: 'money', deltaPct: growthPct(num(lastTxn) ? num(lastVol) / num(lastTxn) : 0, num(prevTxn) ? num(prevVol) / num(prevTxn) : 0), to: '/platform-reports', lowerIsBetter: false },
      { key: 'membershipRevenue', label: 'Membership Revenue', valueCents: membershipRevenueCents, format: 'money', deltaPct: null, to: '/memberships' },
    ];

    // ---- 14 modules: real where a source exists, honest gap otherwise ----
    const modules = {
      // 1 — monthly revenue + transactions are real (payments.monthly); daily 7-day series is a pending extension.
      revenueTransactionsTrend: monthlyVol.length
        ? { available: true as const, granularity: 'monthly' as const, dailyAvailable: daily.length > 0, series: monthlyVol.map((m) => ({ label: String(m.month), revenueCents: num(m.cents), transactions: num(m.count) })), daily: daily.map((d) => ({ label: d.day, revenueCents: num(d.revenueCents), transactions: num(d.transactions) })) }
        : gap('No platform payment history yet.'),

      // 2 — real status mix; the daily appointments/walk-ins/check-ins split is a pending extension.
      appointmentActivity: appts
        ? { available: true as const, dailySeriesAvailable: false, total: num((appts as any).total), statusMix: (appts as any)?.statusMix ?? (appts as any)?.byStatus ?? [], sourceMix: ((appts as any)?.bySource ?? []).map((s: any) => ({ source: String(s.source ?? s.label ?? '—'), count: num(s.count ?? s.n) })), note: 'Daily appointments/walk-ins/check-ins series pending dedicated query.' }
        : gap('Appointment aggregation unavailable.'),

      // 3 — new tenants + total are real; churn has no approved business definition/source yet.
      tenantGrowth: reports
        ? { available: true as const, newByMonth: reports.monthlyTenantGrowth ?? [], totalTenants: num(totals.totalTenants), churn: churn ? { available: true as const, windowDays: num(churn.windowDays), suspendedWindow: num(churn.suspendedWindow), activeNow: num(churn.activeNow), churnRatePct: Number(churn.churnRatePct) || 0 } : gap('Tenant churn definition/source not implemented yet.') }
        : gap('Tenant reports unavailable.'),

      // 4 — REAL payment-method mix.
      paymentMethods: payments
        ? { available: true as const, totalCents: revenueCents, byMethod: payments.byMethod ?? [] }
        : gap('Payment aggregation unavailable.'),

      // 5 — REAL top tenants by volume.
      topTenants: Array.isArray(topTenants) && topTenants.length
        ? { available: true as const, rows: topTenants }
        : (reports ? { available: true as const, rows: reports.topTenantsByVolume ?? [] } : gap('Tenant ranking unavailable.')),

      // 6 — REAL per-branch revenue comparison.
      branchComparison: payments && payments.byBranch?.length
        ? { available: true as const, metric: 'revenue' as const, rows: payments.byBranch }
        : (branchDir.length ? { available: true as const, metric: 'revenue' as const, rows: branchDir.map((b) => ({ branch: b.name, volumeCents: num(b.revenueMtdCents) })).sort((a, b) => b.volumeCents - a.volumeCents) } : gap('No branch revenue yet.')),

      // 7 — category list is real; per-category revenue is a pending extension (no revenue join yet).
      serviceCategoryMix: categories.length
        ? { available: true as const, totalCents: categories.reduce((a, c) => a + num(c.revenueCents), 0), byCategory: categories.map((c) => ({ category: c.category, revenueCents: num(c.revenueCents), lines: num(c.lines) })) }
        : gap('Per-category revenue aggregation not implemented yet (service_categories ⋈ revenue pending).'),

      // 8 — new/active/total customers are real; the daily new-vs-returning stacked split is pending.
      customerRetention: customers
        ? { available: true as const, dailyAvailable: false, totalCustomers: num(ck.totalCustomers), activeCustomers: num(ck.activeCustomers), newThisMonth: num(ck.newThisMonth), newVsReturning: nvr && (nvr.newCount + nvr.returningCount) > 0 ? { available: true as const, windowDays: 30, newCount: num(nvr.newCount), returningCount: num(nvr.returningCount) } : gap('Daily new-vs-returning split pending dedicated query.') }
        : gap('Customer aggregation unavailable.'),

      // 9 — real hour-of-day demand (payments.byHour); the day×hour matrix is now live (payments dow×hour) when present.
      peakHours: payments && payments.byHour?.length
        ? { available: true as const, matrixAvailable: matrix.length > 0, byHour: payments.byHour, matrix: matrix.map((c) => ({ dow: num(c.dow), hour: num(c.hour), count: num(c.count) })) }
        : gap('No hourly demand data yet.'),

      // 10 — REAL device status (reconciles with the Active POS Devices KPI and Device Management).
      deviceStatus: devices
        ? { available: true as const, total: deviceTotal, online: deviceOnline, offline: Math.max(0, deviceTotal - deviceOnline), byStatus: devices?.byStatus ?? [] }
        : gap('Device fleet unavailable.'),

      // 11 — AI receptionist call/booking/reminder/automation metrics have no event source; only raw AI call usage is real.
      aiReceptionist: { available: false as const, reason: 'AI call volume (voice) not instrumented yet.', aiCallsUsed: num(totals.aiCallsUsed), bookings: aiBookingsBlock, reminders: reminders ? { available: true as const, sent: num(reminders?.kpis?.appointmentRemindersSent), sentThisMonth: num(reminders?.kpis?.remindersSentThisMonth), delivered: num(reminders?.kpis?.delivered), failed: num(reminders?.kpis?.failed), deliveryRatePct: Number(reminders?.kpis?.deliveryRate) || 0 } : gap('No reminder delivery logs yet.') },

      // 12 — real tenant distribution by US state; revenue-by-region join is pending.
      regionalPerformance: reports
        ? { available: true as const, model: 'us-state' as const, byState: reports.tenantsByState ?? [], revenueByRegion: states.length ? { available: true as const, byState: states.map((s) => ({ state: s.state, revenueCents: num(s.revenueCents), transactions: num(s.transactions) })) } : gap('No branch-state revenue yet.') }
        : gap('Regional distribution unavailable.'),

      // 13 — rule-based recommendations derived ONLY from verified metrics (clearly tagged, no AI fabrication).
      recommendations: this.buildRecommendations({ totals, deviceTotal, deviceOnline, revenueGrowth: growthPct(num(lastVol), num(prevVol)), membershipRevenueCents }),

      // 14 — alerts derived from real signals; uptime/API/response-time need a monitoring store.
      systemHealth: {
        available: true as const,
        metrics: health ? { available: true as const, windowMinutes: num(health.windowMinutes), sampleCount: num(health.total), apiSuccessPct: Number(health.apiSuccessPct) || 0, serverErrors: num(health.serverErrors), p50LatencyMs: num(health.p50LatencyMs), p95LatencyMs: num(health.p95LatencyMs) } : gap('Platform uptime %, API success %, and response time require a monitoring/metrics store (not yet wired).'),
        alerts: {
          critical: num(totals.gatewayErrorTenants),
          warning: Math.max(0, deviceTotal - deviceOnline) > 0 ? 1 : 0,
          info: num(totals.supportSessions30d) > 0 ? 1 : 0,
          source: 'rule-based' as const,
        },
      },
    };

    return {
      ok: true as const,
      metadata: { generatedAt: new Date().toISOString(), range, by: ctx.email ?? null, compare: { mode: compareTo, label: COMPARE_LABEL[compareTo], offsetMonths: cmpOff } },
      scope: { tenantId: sid ?? null, scoped: !!sid },
      kpis,
      modules,
    };
  }

  // Server-side, audited export of the current scope/range/compare. No card/PII/secret fields exist in the
  // analytics payload; CSV cells are formula-injection-guarded in the serializer.
  async exportData(ctx: AnalyticsCtx, format: ExportFormat, range: AnalyticsRange, scope?: OverviewScope, compareTo: CompareMode = 'previous_period'): Promise<{ filename: string; mimeType: string; base64: string }> {
    const data = await this.analytics(ctx, range, scope, compareTo);
    const usd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows: ExportRow[] = [
      ['AIPowerSalon Platform Analytics', ''],
      ['Generated', data.metadata.generatedAt], ['Range', data.metadata.range], ['Compare', data.metadata.compare.label],
      ['Scope', data.scope.scoped ? `tenant ${data.scope.tenantId}` : 'All branches (platform)'], ['', ''], ['KPI', 'Value'],
    ];
    for (const k of data.kpis) rows.push([k.label, k.format === 'money' ? usd(k.valueCents ?? 0) : String(k.value ?? 0)]);
    const m = data.modules;
    if (m.paymentMethods?.available) { rows.push(['', ''], ['Payment Method', 'Volume']); for (const s of m.paymentMethods.byMethod) rows.push([s.method, usd(s.cents)]); }
    if (m.branchComparison?.available) { rows.push(['', ''], ['Branch', 'Revenue']); for (const b of m.branchComparison.rows) rows.push([b.branch, usd(b.volumeCents)]); }
    if (m.topTenants?.available) { rows.push(['', ''], ['Top Tenant', 'Revenue']); for (const t of m.topTenants.rows) rows.push([t.tenantName ?? t.name ?? t.tenantId ?? '-', usd(t.amountCents ?? t.revenueCents ?? 0)]); }

    const stamp = data.metadata.generatedAt.slice(0, 10);
    await this.audit(ctx, 'analytics.export', { format, range, compareTo, scoped: data.scope.scoped, tenantId: data.scope.tenantId, rowCount: rows.length });
    if (format === 'csv') return { filename: `analytics-${range}-${stamp}.csv`, mimeType: 'text/csv', base64: Buffer.from(toCsv(rows), 'utf8').toString('base64') };
    if (format === 'xlsx') return { filename: `analytics-${range}-${stamp}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: toXlsx(rows).toString('base64') };
    const lines = rows.slice(1).filter((r) => r[0] || r[1]).map((r) => (r[1] ? `${r[0]}: ${r[1]}` : r[0]));
    return { filename: `analytics-${range}-${stamp}.pdf`, mimeType: 'application/pdf', base64: toPdf('AIPowerSalon - Platform Analytics', lines.slice(0, 46)).toString('base64') };
  }

  // Transparent, verifiable rule-based insights (spec §22/§33): each carries its metric, scope, and source.
  private buildRecommendations(i: { totals: any; deviceTotal: number; deviceOnline: number; revenueGrowth: number | null; membershipRevenueCents: number }) {
    const out: Array<{ type: string; severity: 'info' | 'warning' | 'critical'; metric: string; message: string; action: string; to: string; source: 'rule-based'; generatedAt: string }> = [];
    const now = new Date().toISOString();
    const offline = Math.max(0, i.deviceTotal - i.deviceOnline);
    if (i.revenueGrowth != null && i.revenueGrowth > 0) out.push({ type: 'growth', severity: 'info', metric: 'revenue_mom', message: `Platform revenue is up ${i.revenueGrowth}% month over month.`, action: 'Open revenue reporting', to: '/platform-reports', source: 'rule-based', generatedAt: now });
    if (i.revenueGrowth != null && i.revenueGrowth < 0) out.push({ type: 'decline', severity: 'warning', metric: 'revenue_mom', message: `Platform revenue is down ${Math.abs(i.revenueGrowth)}% month over month.`, action: 'Review revenue reporting', to: '/platform-reports', source: 'rule-based', generatedAt: now });
    if (offline > 0) out.push({ type: 'device', severity: 'warning', metric: 'devices_offline', message: `${offline} device${offline === 1 ? '' : 's'} are currently offline.`, action: 'Check device health', to: '/devices-management', source: 'rule-based', generatedAt: now });
    if (num(i.totals.gatewayErrorTenants) > 0) out.push({ type: 'payments', severity: 'critical', metric: 'gateway_errors', message: `${num(i.totals.gatewayErrorTenants)} tenant payment gateway(s) are in an error state.`, action: 'Open payment gateways', to: '/payment-gateways', source: 'rule-based', generatedAt: now });
    return { available: true as const, items: out };
  }
}
