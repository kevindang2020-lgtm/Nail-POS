// ai-business-alerts.vitest.spec.ts — slice 11: business alerts CRUD + evaluation (§34, §17).
import { describe, it, expect } from 'vitest';
import { AiBusinessAlertsService } from './ai-business-alerts.service';
import { InMemoryAlertsRepository } from './ai-business-alerts.repository';
import { AiBusinessAlertEvaluator, type AlertMetricSource } from './ai-business-alerts-evaluator';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view'], ...o });

// A metric source with tunable numbers for the evaluator.
const source = (o: Partial<{ net: number; avg: number; tickets: number; completed: number; cancelPct: number; noShowPct: number; bookings: number; retention: number; active: number }> = {}): AlertMetricSource => ({
  async getRevenueSummary() { return { netSalesCents: o.net ?? 0, averageTicketCents: o.avg ?? 0, ticketsCount: o.tickets ?? 0 }; },
  async getAppointmentMetrics() { return { funnel: { completed: o.completed ?? 0, cancelledPercent: o.cancelPct ?? 0, noShowPercent: o.noShowPct ?? 0, totalBookings: o.bookings ?? 0 } }; },
  async getCustomerGrowth() { return { retentionRatePercent: o.retention ?? 0, activeCustomers: o.active ?? 0 }; },
});
const mk = (src: AlertMetricSource = source()) => new AiBusinessAlertsService(new InMemoryAlertsRepository(), new AiBusinessAlertEvaluator(src));

describe('alerts CRUD + validation', () => {
  it('creates and lists an alert', async () => {
    const svc = mk();
    const a = await svc.create(CTX(), { title: 'Low revenue', metricId: 'net_sales', operator: 'lt', threshold: 500000, preset: 'today' });
    expect(a.metricId).toBe('net_sales');
    expect(a.active).toBe(true);
    expect((await svc.list(CTX())).map((x) => x.id)).toContain(a.id);
  });
  it('rejects an unsupported metric', async () => {
    try { await mk().create(CTX(), { title: 'x', metricId: 'moon_phase', operator: 'lt', threshold: 1 }); expect.fail('throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
  });
  it('rejects a bad operator and a negative threshold', async () => {
    try { await mk().create(CTX(), { title: 'x', metricId: 'net_sales', operator: 'eq', threshold: 1 }); expect.fail('throw'); } catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
    try { await mk().create(CTX(), { title: 'x', metricId: 'net_sales', operator: 'lt', threshold: -5 }); expect.fail('throw'); } catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INVALID_DATE_RANGE); }
  });
  it('updates threshold/active and deletes', async () => {
    const svc = mk();
    const a = await svc.create(CTX(), { title: 't', metricId: 'no_show_rate', operator: 'gt', threshold: 15 });
    const u = await svc.update(CTX(), a.id, { active: false, threshold: 20 });
    expect(u.active).toBe(false); expect(u.threshold).toBe(20);
    expect(await svc.remove(CTX(), a.id)).toEqual({ deleted: true });
  });
});

describe('tenant isolation', () => {
  it('a tenant never sees another tenant\u2019s alerts', async () => {
    const repo = new InMemoryAlertsRepository();
    const svc = new AiBusinessAlertsService(repo, new AiBusinessAlertEvaluator(source()));
    await svc.create(CTX({ tenantId: 'tA' }), { title: 'A', metricId: 'net_sales', operator: 'lt', threshold: 1 });
    expect(await svc.list(CTX({ tenantId: 'tB' }))).toHaveLength(0);
  });
});

describe('evaluation logic', () => {
  it('triggers when net sales fall below threshold with enough sample', async () => {
    const svc = mk(source({ net: 400000, tickets: 30 }));
    const a = await svc.create(CTX(), { title: 'low', metricId: 'net_sales', operator: 'lt', threshold: 500000, minSampleSize: 5 });
    const ev = await svc.evaluateNow(CTX(), a.id);
    expect(ev.value).toBe(400000);
    expect(ev.sampleOk).toBe(true);
    expect(ev.triggered).toBe(true);
  });
  it('does NOT trigger when the sample is below the minimum, even if the condition holds', async () => {
    const svc = mk(source({ noShowPct: 80, bookings: 2 }));
    const a = await svc.create(CTX(), { title: 'ns', metricId: 'no_show_rate', operator: 'gt', threshold: 15, minSampleSize: 5 });
    const ev = await svc.evaluateNow(CTX(), a.id);
    expect(ev.sampleOk).toBe(false);
    expect(ev.triggered).toBe(false);
    expect(ev.reason).toMatch(/below the minimum/i);
  });
  it('does not trigger when within threshold', async () => {
    const svc = mk(source({ net: 600000, tickets: 40 }));
    const a = await svc.create(CTX(), { title: 'ok', metricId: 'net_sales', operator: 'lt', threshold: 500000, minSampleSize: 5 });
    const ev = await svc.evaluateNow(CTX(), a.id);
    expect(ev.triggered).toBe(false);
  });
  it('stamps last_checked_at and last_triggered_at appropriately', async () => {
    const svc = mk(source({ cancelPct: 30, bookings: 50 }));
    const a = await svc.create(CTX(), { title: 'cx', metricId: 'cancellation_rate', operator: 'gt', threshold: 20, minSampleSize: 5 });
    await svc.evaluateNow(CTX(), a.id);
    const after = (await svc.list(CTX())).find((x) => x.id === a.id)!;
    expect(after.lastCheckedAt).not.toBeNull();
    expect(after.lastTriggeredAt).not.toBeNull(); // it triggered (30 > 20)
  });
  it('evaluating a missing alert is a stable not-found', async () => {
    try { await mk().evaluateNow(CTX(), 'nope'); expect.fail('throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
  });
});
