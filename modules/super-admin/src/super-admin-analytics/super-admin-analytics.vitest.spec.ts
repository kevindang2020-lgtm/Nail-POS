import { describe, it, expect, vi } from 'vitest';
import { SuperAdminAnalyticsService } from './super-admin-analytics.service';

// Nest-free unit harness: stub the two reused services and assert the consolidated payload's
// composition, scope passthrough, cents-safe math, fail-soft behaviour, and honest gap flags.

function makePlatform(over: Partial<Record<string, any>> = {}) {
  const calls: Record<string, any[]> = {};
  const rec = (name: string, fn: (...a: any[]) => any) => (...a: any[]) => { (calls[name] ||= []).push(a); return fn(...a); };
  const svc: any = {
    __calls: calls,
    reports: rec('reports', async () => ({
      totals: { totalTenants: 2418, activeTenants: 2300, platformVolumeCents: 324_359_240, aiCallsUsed: 0, supportSessions30d: 3, gatewayErrorTenants: 2 },
      monthlyTenantGrowth: [{ month: '2026-04', count: 30 }, { month: '2026-05', count: 41 }],
      monthlyPaymentVolume: [{ month: '2026-04', amountCents: 1000 }],
      tenantsByState: [{ state: 'NJ', tenants: 12 }, { state: 'NY', tenants: 9 }],
      topTenantsByVolume: [{ tenantId: 't1', tenantName: 'Glamour Studio', amountCents: 31_258_400 }],
    })),
    platformPayments: rec('platformPayments', async (_q: any) => ({
      kpis: { processedVolumeCents: 324_359_240, successfulCount: 44_842, averageTicketCents: 7234 },
      monthly: [{ month: '2026-04', count: 11_000, cents: 280_000_000 }, { month: '2026-05', count: 12_746, cents: 324_359_240 }],
      byMethod: [{ method: 'card', count: 100, cents: 200_000 }, { method: 'cash', count: 20, cents: 40_000 }],
      byBranch: [{ branch: 'Downtown', volumeCents: 31_260_000, transactions: 900, successRate: 99 }],
      byHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, count: h, cents: h * 100 })),
      byStatus: [{ status: 'approved', count: 44_842 }],
    })),
    platformAppointments: rec('platformAppointments', async (_q: any) => ({ total: 12_746, byStatus: [{ status: 'completed', count: 9000 }], bySource: [{ source: 'walk_in', count: 5000 }, { source: 'online', count: 7000 }, { source: 'ai', count: 3000 }] })),
    platformCustomers: rec('platformCustomers', async (_q: any) => ({ kpis: { totalCustomers: 1_284_741, activeCustomers: 900_000, newThisMonth: 5000 } })),
    platformDevices: rec('platformDevices', async (_q: any) => ({ kpis: { totalDevices: 5642, online: 4812 }, byStatus: [{ status: 'online', count: 4812 }] })),
    branchesDashboard: rec('branchesDashboard', async (_s: any) => ({ directory: [{ name: 'Downtown', status: 'active', revenueMtdCents: 31_260_000 }, { name: 'Closed One', status: 'inactive', revenueMtdCents: 0 }] })),
    topPerformingTenants: rec('topPerformingTenants', async (_n: number) => ([{ tenantId: 't1', name: 'Glamour Studio', revenueCents: 31_258_400, bookings: 1248, growthPct: 24 }])),
    platformReminders: rec('platformReminders', async () => ({ kpis: { appointmentRemindersSent: 1200, remindersSentThisMonth: 300, delivered: 1150, failed: 50, deliveryRate: 95.8 } })),
    ...over,
  };
  return svc;
}
const membershipsOk = { getOverview: vi.fn(async () => ({ kpis: { revenueCents: 38_276_600 } })) };
const ctx = { userId: 'u1', email: 'admin@aps.test' };

describe('SuperAdminAnalyticsService', () => {
  it('composes 8 KPIs and reflects unscoped state', async () => {
    const platform = makePlatform();
    const svc = new SuperAdminAnalyticsService(platform, membershipsOk as any);
    const out = await svc.analytics(ctx, '30d', {});
    expect(out.ok).toBe(true);
    expect(out.kpis).toHaveLength(8);
    expect(out.scope).toEqual({ tenantId: null, scoped: false });
    const byKey = Object.fromEntries(out.kpis.map((k: any) => [k.key, k]));
    expect(byKey.revenue.valueCents).toBe(324_359_240);
    expect(byKey.appointments.value).toBe(12_746);
    expect(byKey.customers.value).toBe(1_284_741);
    expect(byKey.activeBranches.value).toBe(1); // only the 'active' branch counts
    expect(byKey.activeDevices.value).toBe(5642);
    expect(byKey.membershipRevenue.valueCents).toBe(38_276_600);
  });

  it('reuses the repo cents-safe average ticket and computes zero-guarded MoM growth', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any);
    const out = await svc.analytics(ctx, '30d', {});
    const byKey = Object.fromEntries(out.kpis.map((k: any) => [k.key, k]));
    expect(byKey.avgTicket.valueCents).toBe(7234);                 // integer cents, no float
    // revenue MoM: (324359240-280000000)/280000000 → ~15.8%
    expect(byKey.revenue.deltaPct).toBeCloseTo(15.8, 1);
  });

  it('returns null delta (not Infinity) when the prior period is zero', async () => {
    const platform = makePlatform({ platformPayments: async () => ({ kpis: { processedVolumeCents: 500, successfulCount: 5, averageTicketCents: 100 }, monthly: [{ month: '2026-05', count: 5, cents: 500 }], byMethod: [], byBranch: [], byHour: [], byStatus: [] }) });
    const svc = new SuperAdminAnalyticsService(platform, membershipsOk as any);
    const out = await svc.analytics(ctx, '30d', {});
    const revenue = out.kpis.find((k: any) => k.key === 'revenue');
    expect(revenue?.deltaPct).toBeNull(); // single month → no prior basis
  });

  it('passes the validated tenant scope through to every scoped source', async () => {
    const platform = makePlatform();
    const svc = new SuperAdminAnalyticsService(platform, membershipsOk as any);
    const out = await svc.analytics(ctx, '30d', { tenantId: 'tenant-9' });
    expect(out.scope).toEqual({ tenantId: 'tenant-9', scoped: true });
    expect(platform.__calls.platformPayments[0][0]).toEqual({ tenantId: 'tenant-9' });
    expect(platform.__calls.platformDevices[0][0]).toEqual({ tenantId: 'tenant-9' });
    expect(platform.__calls.branchesDashboard[0][0]).toEqual({ tenantId: 'tenant-9' });
  });

  it('exposes real payment-method mix and a reconciling device donut', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any);
    const m = (await svc.analytics(ctx, '30d', {})).modules as any;
    expect(m.paymentMethods.available).toBe(true);
    expect(m.paymentMethods.byMethod).toHaveLength(2);
    expect(m.deviceStatus.online + m.deviceStatus.offline).toBe(m.deviceStatus.total); // 4812 + 830 = 5642
    expect(m.deviceStatus.offline).toBe(830);
  });

  it('flags unbacked sections as honest gaps rather than fabricating numbers', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any);
    const m = (await svc.analytics(ctx, '30d', {})).modules as any;
    expect(m.serviceCategoryMix.available).toBe(false);
    expect(m.aiReceptionist.available).toBe(false);
    expect(m.tenantGrowth.churn.available).toBe(false);
    expect(m.customerRetention.newVsReturning.available).toBe(false);
    expect(m.systemHealth.metrics.available).toBe(false);
  });

  it('derives rule-based recommendations only from verified metrics', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any);
    const m = (await svc.analytics(ctx, '30d', {})).modules as any;
    const metrics = m.recommendations.items.map((r: any) => r.metric);
    expect(metrics).toContain('gateway_errors');   // 2 tenants in error
    expect(metrics).toContain('devices_offline');  // 5642-4812 offline
    expect(m.recommendations.items.every((r: any) => r.source === 'rule-based')).toBe(true);
  });

  it('is fail-soft: a throwing source does not blank the page', async () => {
    const platform = makePlatform({ reports: async () => { throw new Error('db down'); } });
    const svc = new SuperAdminAnalyticsService(platform, membershipsOk as any);
    const out = await svc.analytics(ctx, '30d', {});
    expect(out.ok).toBe(true);
    expect((out.modules as any).tenantGrowth.available).toBe(false); // reports failed → honest gap
    expect(out.kpis.find((k: any) => k.key === 'revenue')?.valueCents).toBe(324_359_240); // payments still resolved
  });
});

describe('SuperAdminAnalyticsService · compare + export', () => {
  // 13-month payment series so previous_month(1), previous_quarter(3), previous_year(12) all resolve.
  const longSeries = Array.from({ length: 13 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, count: 1000 + i * 100, cents: 100_000 + i * 10_000 }));
  const platformLong = () => makePlatform({ platformPayments: async () => ({ kpis: { processedVolumeCents: 220_000, successfulCount: 2200, averageTicketCents: 100 }, monthly: longSeries, byMethod: [{ method: 'card', count: 1, cents: 100 }], byBranch: [{ branch: 'B', volumeCents: 1, transactions: 1, successRate: 100 }], byHour: [], byStatus: [] }) });

  it('uses the comparison offset (month vs quarter vs year give different prior bases)', async () => {
    const svc = new SuperAdminAnalyticsService(platformLong(), membershipsOk as any);
    const rev = async (mode: any) => (await svc.analytics(ctx, '30d', {}, mode)).kpis.find((k: any) => k.key === 'revenue')!.deltaPct;
    const month = await rev('previous_month');   // last(220000) vs idx 11 (210000)
    const quarter = await rev('previous_quarter'); // vs idx 9 (190000)
    const year = await rev('previous_year');       // vs idx 0 (100000)
    expect(month).not.toBeNull(); expect(quarter).not.toBeNull(); expect(year).not.toBeNull();
    expect(year).toBeGreaterThan(quarter!); expect(quarter).toBeGreaterThan(month!);
  });

  it('records the comparison in metadata', async () => {
    const svc = new SuperAdminAnalyticsService(platformLong(), membershipsOk as any);
    const out = await svc.analytics(ctx, '30d', {}, 'previous_quarter');
    expect(out.metadata.compare).toEqual({ mode: 'previous_quarter', label: 'last quarter', offsetMonths: 3 });
  });

  it('exports CSV/XLSX/PDF with valid signatures and audits the export', async () => {
    const inserts: any[] = [];
    const fakeDb: any = { insertInto: (t: string) => ({ values: (v: any) => { inserts.push({ t, v }); return { execute: async () => {} }; } }) };
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any, fakeDb);

    const csv = await svc.exportData(ctx, 'csv', '30d', {});
    expect(csv.mimeType).toBe('text/csv');
    expect(Buffer.from(csv.base64, 'base64').toString('utf8')).toContain('Total Revenue');

    const xlsx = await svc.exportData(ctx, 'xlsx', '30d', {});
    expect(xlsx.mimeType).toContain('spreadsheetml');
    expect(Buffer.from(xlsx.base64, 'base64').subarray(0, 2).toString('latin1')).toBe('PK'); // ZIP magic

    const pdf = await svc.exportData(ctx, 'pdf', '30d', {});
    expect(pdf.mimeType).toBe('application/pdf');
    expect(Buffer.from(pdf.base64, 'base64').subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // every export is audited as analytics.export
    expect(inserts).toHaveLength(3);
    expect(inserts.every((i) => i.t === 'audit_logs' && i.v.action_type === 'analytics.export')).toBe(true);
  });

  it('export is resilient when no audit DB is wired', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any); // no db
    const csv = await svc.exportData(ctx, 'csv', '30d', {});
    expect(csv.filename).toMatch(/^analytics-30d-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('gap-filling queries (M1 daily, M9 matrix, M12 revenue-by-state)', () => {
  const gapRepo = {
    dailySeries: async () => [{ day: '2026-06-29', revenueCents: 100, transactions: 2 }, { day: '2026-06-30', revenueCents: 200, transactions: 3 }],
    revenueByState: async () => [{ state: 'NJ', revenueCents: 35000, transactions: 3 }, { state: 'NY', revenueCents: 100000, transactions: 1 }],
    demandMatrix: async () => [{ dow: 1, hour: 14, count: 5 }],
    categoryRevenue: async () => [{ category: 'Manicure', revenueCents: 10000, lines: 2 }, { category: 'Pedicure', revenueCents: 8000, lines: 1 }],
    newVsReturning: async () => ({ newCount: 12, returningCount: 30 }),
    tenantChurn: async () => ({ suspendedWindow: 3, activeNow: 97, windowDays: 30, churnRatePct: 3 }),
    requestHealth: async () => ({ total: 100, serverErrors: 2, apiSuccessPct: 96, p50LatencyMs: 40, p95LatencyMs: 220, windowMinutes: 60 }),
  };

  it('marks modules available with live data when a gap repo is present', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any, undefined, gapRepo as any);
    const out: any = await svc.analytics(ctx, '30d', {}, 'none');
    expect(out.modules.revenueTransactionsTrend.dailyAvailable).toBe(true);
    expect(out.modules.revenueTransactionsTrend.daily.length).toBe(2);
    expect(out.modules.peakHours.matrixAvailable).toBe(true);
    expect(out.modules.peakHours.matrix.length).toBe(1);
    expect(out.modules.regionalPerformance.revenueByRegion.available).toBe(true);
    expect(out.modules.regionalPerformance.revenueByRegion.byState).toHaveLength(2);
    expect(out.modules.serviceCategoryMix.available).toBe(true);
    expect(out.modules.serviceCategoryMix.byCategory).toHaveLength(2);
    expect(out.modules.customerRetention.newVsReturning.available).toBe(true);
    expect(out.modules.tenantGrowth.churn.available).toBe(true);
    expect(out.modules.appointmentActivity.sourceMix.length).toBeGreaterThan(0);
    expect(out.modules.aiReceptionist.available).toBe(false); // AI calls still honest gap
    expect(out.modules.aiReceptionist.reminders.available).toBe(true); // reminder delivery is real
    expect(out.modules.systemHealth.metrics.available).toBe(true);
    expect(out.modules.systemHealth.metrics.apiSuccessPct).toBe(96);
    expect(out.modules.aiReceptionist.bookings.available).toBe(true);
    expect(out.modules.aiReceptionist.bookings.automationRatePct).toBe(20); // 3000 ai / 15000 total
  });

  it('stays an honest gap when no gap repo is wired', async () => {
    const svc = new SuperAdminAnalyticsService(makePlatform(), membershipsOk as any); // no gap repo
    const out: any = await svc.analytics(ctx, '30d', {}, 'none');
    expect(out.modules.revenueTransactionsTrend.dailyAvailable).toBe(false);
    expect(out.modules.peakHours.matrixAvailable).toBe(false);
    expect(out.modules.regionalPerformance.revenueByRegion.available).not.toBe(true);
    expect(out.modules.serviceCategoryMix.available).not.toBe(true);
    expect(out.modules.customerRetention.newVsReturning.available).not.toBe(true);
    expect(out.modules.tenantGrowth.churn.available).not.toBe(true);
    expect(out.modules.systemHealth.metrics.available).not.toBe(true);
  });
});

describe('analytics-export grid serializers (CSV/XLSX/PDF tabular)', () => {
  it('toCsvGrid emits a header row + guards formula injection', async () => {
    const { toCsvGrid } = await import('./analytics-export');
    const csv = toCsvGrid(['Name', 'Amount'], [['=cmd', 1523045], ['Fiserv', '8953.07']]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"Name","Amount"');
    expect(lines[1]).toContain(`"'=cmd"`); // leading = neutralised
    expect(lines[2]).toBe('"Fiserv","8953.07"');
  });

  it('toXlsxGrid produces a real OOXML zip (PK magic) with the header row', async () => {
    const { toXlsxGrid } = await import('./analytics-export');
    const buf = toXlsxGrid(['Agreement', 'Amount'], [['AGR-1', '100.00']], 'records');
    expect(buf[0]).toBe(0x50); expect(buf[1]).toBe(0x4b); // "PK"
    expect(buf.length).toBeGreaterThan(400);
  });

  it('toPdfGrid produces a real multi-page-capable PDF (%PDF … %%EOF)', async () => {
    const { toPdfGrid } = await import('./analytics-export');
    const rows = Array.from({ length: 120 }, (_, i) => [`AGR-${i}`, 'Fiserv', '100.00']);
    const buf = toPdfGrid('Revenue Records', ['Agreement', 'Partner', 'Amount'], rows);
    const s = buf.toString('latin1');
    expect(s.startsWith('%PDF-')).toBe(true);
    expect(s.endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Count 3'); // 120 rows @ 46/page → 3 pages
  });
});
