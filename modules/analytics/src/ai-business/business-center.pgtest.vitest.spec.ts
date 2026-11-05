// business-center.pgtest — AI Business Reports + AI Business Alerts guides (Nov 3 2026; migration 781) on the REAL schema, with the
// real canonical Sales Report (KyselyReportsRepository + ReportsService) underneath.
// RP = reports (period + canonical snapshot stored, double tap, list / search / filters / pages, content window, regenerate, Verify
// Numbers matched → changed) · AL = alerts (evaluate recorded with the exact days, triggered → recovered, acknowledge once, history,
// small sample = not evaluated) · HL = system checks (the preset period agrees with explicit days; read-only; reused).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyReportsRepository, ReportsService } from '@aipowersalon/reports';
import { BusinessCenter, BusinessCenterError } from './business-center';
import { AiBusinessReportsService } from './ai-business-reports.service';
import { KyselyReportsJobRepository } from './ai-business-reports.kysely.repository';
import { AiBusinessAlertsService } from './ai-business-alerts.service';
import { KyselyAlertsRepository } from './ai-business-alerts.kysely.repository';
import { AiBusinessAlertEvaluator } from './ai-business-alerts-evaluator';
import { AiBusinessRevenueService } from './ai-business-revenue.service';
import { AiBusinessAppointmentsService } from './ai-business-appointments.service';

const id = (n: number) => `78100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), X = id(4), OWNER = id(10), C = id(20);
const PERMS = ['pos.ai_business.view', 'pos.reports.view', 'pos.reports.financial_view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: PERMS, ...o });
let pg: any; let db: any; let bc: BusinessCenter; let n = 0; let alertsSvc: AiBusinessAlertsService;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof BusinessCenterError ? e.code : (e?.apiCode ?? e?.code ?? e?.message); } }
async function paid(cents: number, daysAgo = 0) {
  const t = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, paid_at, created_at)
    values ($1,$2,$3,'paid',$4,$4,$5, now() - make_interval(days => $6), now() - make_interval(days => $6)) returning id`, [T, B, C, cents, String(81000 + ++n), daysAgo]))[0].id;
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at) values ($1,$2,$3,'card',$4,0,0,'approved', now() - make_interval(days => $5))`, [T, B, t, cents, daysAgo]);
}

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC'`);
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','bc-781','BC781','active'), ($2,'X','Other','bc-781x','BC781X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC')`, [B, T]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@bc.test','active','OWNER')`, [OWNER, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Jen','W','Jen W')`, [C, T, B]);
  await paid(5000); await paid(7000); await paid(9900, 3);   // two today, one 3 days ago
  const sales = new ReportsService(new KyselyReportsRepository(db));
  const revenue = new AiBusinessRevenueService(sales);
  const appointments = new AiBusinessAppointmentsService(sales as any);
  const reports = new AiBusinessReportsService(new KyselyReportsJobRepository(db), {
    getDailyBrief: async () => ({ ok: true }), getRevenueSummary: (c, p) => revenue.getRevenueSummary(c, p), getAppointmentMetrics: (c, p) => appointments.getAppointmentMetrics(c, p),
    getCustomerGrowth: async () => ({ newCustomers: 0 }), compareBranches: async () => ({ branches: [] }),
  });
  const alerts = new AiBusinessAlertsService(new KyselyAlertsRepository(db), new AiBusinessAlertEvaluator({
    getRevenueSummary: (c, p) => revenue.getRevenueSummary(c, p) as any, getAppointmentMetrics: (c, p) => appointments.getAppointmentMetrics(c, p) as any, getCustomerGrowth: async () => ({ retentionRatePercent: 0, activeCustomers: 0 }),
  }));
  alertsSvc = alerts;
  bc = new BusinessCenter(db, { reports, alerts, revenue, appointments, sales });
}, 180_000);

describe('AI Business Reports', () => {
  it('RP-01 a daily brief for TODAY stores its exact days and the Sales Report figures for them (before: every preset read the last 7 days)', async () => {
    const r: any = await bc.reportGenerate(ctx(), { reportType: 'daily_brief', preset: 'today' });
    expect(r).toMatchObject({ status: 'completed', availability: 'viewable', duplicate: false });
    const today = new Date().toISOString().slice(0, 10);
    expect(r.period).toMatchObject({ preset: 'today', from: today, to: today, timeZone: 'UTC', partial: true });
    expect(r.headline.find((h: any) => h.key === 'net_sales').value).toBe(12000);         // 50 + 70, not the 3-day-old 99
    expect(r.headline.find((h: any) => h.key === 'paid_tickets').value).toBe(2);
  });
  it('RP-02 a second tap within seconds returns the same report; a period the type does not offer is refused', async () => {
    const a: any = await bc.reportGenerate(ctx(), { reportType: 'weekly_summary' });
    const b: any = await bc.reportGenerate(ctx(), { reportType: 'weekly_summary' });
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    expect(await code(bc.reportGenerate(ctx(), { reportType: 'daily_brief', preset: 'year' }))).toBe('BC_REPORT_PERIOD_INVALID');
    expect(await code(bc.reportGenerate(ctx(), { reportType: 'weekly_report' }))).toBe('BC_REPORT_TYPE_INVALID');
  });
  it('RP-03 history: newest first, search by type words, status incl. the 7-day content window, numbered pages', async () => {
    const [old] = await q(`insert into ai_business_report_jobs (tenant_id, branch_id, requested_by_user_id, report_type, preset, status, content, created_at, completed_at, expires_at)
      values ($1,$2,$3,'monthly_review','month','completed','{"x":1}'::jsonb, now() - interval '20 days', now() - interval '20 days', now() - interval '13 days') returning id`, [T, B, OWNER]);
    const all: any = await bc.reportList(ctx(), {});
    expect(all.items[all.items.length - 1].id).toBe(old.id);                                // oldest last
    expect(all.items.find((x: any) => x.id === old.id)).toMatchObject({ status: 'completed', availability: 'content_expired' });
    expect((await bc.reportList(ctx(), { status: 'content_expired' }) as any).total).toBe(1);
    expect((await bc.reportList(ctx(), { q: 'monthly' }) as any).items.map((x: any) => x.reportType)).toEqual(['monthly_review']);
    expect((await bc.reportList(ctx(), { preset: 'today' }) as any).items.every((x: any) => x.id !== old.id)).toBe(true);
    const p2: any = await bc.reportList(ctx(), { pageSize: 10, page: 2 });
    expect(p2).toMatchObject({ page: 1, totalPages: 1 });                                     // clamped
    const s: any = await bc.reportSummary(ctx());
    expect(s).toMatchObject({ contentExpired: 1, failed: 0, contentDays: 7 });
    const d: any = await bc.reportDetail(ctx(), old.id);
    expect(d.content).toBeNull();                                                            // kept, not shown after 7 days
    expect(await code(bc.reportDetail(ctx({ tenantId: X }), old.id))).toBe('BC_REPORT_NOT_FOUND');
  });
  it('RP-04 Verify Numbers: matched now; a sale added later for the same day → changed, with the difference; regenerate keeps the old report', async () => {
    const r: any = await bc.reportGenerate(ctx(), { reportType: 'daily_brief', preset: 'yesterday' });
    const v1: any = await bc.reportVerify(ctx(), r.id);
    expect(v1.status).toBe('matched');
    await paid(2500, 1);
    const v2: any = await bc.reportVerify(ctx(), r.id);
    expect(v2.status).toBe('changed');
    expect(v2.items.find((x: any) => x.metric === 'netSalesCents')).toMatchObject({ inReport: 0, salesReportNow: 2500, difference: 2500, matched: false });
    const again: any = await bc.reportRegenerate(ctx(), r.id);
    expect(again.id).not.toBe(r.id);
    expect(again.headline.find((h: any) => h.key === 'net_sales').value).toBe(2500);
    expect((await bc.reportDetail(ctx(), r.id) as any).headline.find((h: any) => h.key === 'net_sales').value).toBe(0);   // the old snapshot is untouched
    // without the Sales Report's money permission there is no snapshot to verify
    const nf: any = await bc.reportGenerate(ctx({ permissions: ['pos.ai_business.view', 'pos.reports.view'] }), { reportType: 'branch_comparison', preset: 'month' });
    expect((await bc.reportVerify(ctx(), nf.id) as any)).toMatchObject({ status: 'cannot_verify', reason: 'no_snapshot' });
  });
});

describe('AI Business Alerts', () => {
  let rule: string;
  it('AL-01 evaluate is recorded with the exact days; triggered → unchanged → recovered; small samples are "not evaluated"', async () => {
    rule = (await q(`insert into ai_business_alerts (tenant_id, branch_id, created_by_user_id, title, metric_id, operator, threshold, preset, min_sample_size, frequency, channel, active)
      values ($1,$2,$3,'Slow day','net_sales','lt',20000,'today',1,'daily','in_app',true) returning id`, [T, B, OWNER]))[0].id;
    const e1: any = await bc.alertEvaluate(ctx(), rule);
    expect(e1).toMatchObject({ triggered: true, stateChange: 'triggered', value: 12000 });
    expect(e1.period.from).toBe(new Date().toISOString().slice(0, 10));
    expect((await bc.alertEvaluate(ctx(), rule) as any).stateChange).toBe('unchanged');
    await paid(10000);
    expect((await bc.alertEvaluate(ctx(), rule) as any)).toMatchObject({ triggered: false, stateChange: 'recovered' });
    const big = (await q(`insert into ai_business_alerts (tenant_id, branch_id, created_by_user_id, title, metric_id, operator, threshold, preset, min_sample_size, frequency, channel, active)
      values ($1,$2,$3,'Needs 50','net_sales','lt',1,'today',50,'daily','sms',true) returning id`, [T, B, OWNER]))[0].id;
    expect((await bc.alertEvaluate(ctx(), big) as any).stateChange).toBe('not_evaluated');
    const s: any = await bc.alertSummary(ctx());
    expect(s).toMatchObject({ activeRules: 2, needsReview: 1, automaticEvaluation: false, notificationsSent: false });
  });
  it('AL-02 acknowledge a triggered event once; history filters by state and newest first; rules list by status', async () => {
    const h: any = await bc.alertHistory(ctx(), { alertId: rule });
    expect(h.items.map((x: any) => x.stateChange)).toEqual(['recovered', 'unchanged', 'triggered']);
    const trig = h.items[2];
    expect(await code(bc.alertAcknowledge(ctx(), h.items[0].id, {}))).toBe('BC_EVENT_NOT_ACKNOWLEDGEABLE');   // recovered: nothing to acknowledge
    expect((await bc.alertAcknowledge(ctx(), trig.id, { note: 'Rain day' }) as any).acknowledgedAt).toBeTruthy();
    expect(await code(bc.alertAcknowledge(ctx(), trig.id, {}))).toBe('BC_EVENT_NOT_ACKNOWLEDGEABLE');
    expect((await bc.alertHistory(ctx(), { state: 'triggered' }) as any).items[0]).toMatchObject({ ackNote: 'Rain day', acknowledgedBy: 'Owner Kim' });
    expect((await bc.alertRules(ctx(), { status: 'needs_review' }) as any).items.map((x: any) => x.title)).toEqual(['Needs 50']);
    expect((await bc.alertRules(ctx(), { q: 'slow' }) as any).items.map((x: any) => x.title)).toEqual(['Slow day']);
    expect(await code(bc.alertEvaluate(ctx({ tenantId: X }), rule))).toBe('BC_ALERT_NOT_FOUND');
  });
  it('AL-03 explain uses the measured price × volume bridge (read-only, causation not proven)', async () => {
    const h: any = await bc.alertHistory(ctx(), { alertId: rule });
    const x: any = await bc.alertExplain(ctx(), h.items[0].id);
    expect(x).toMatchObject({ kind: 'revenue_bridge', readOnly: true, causation: 'not_proven' });
    expect(x.explanation).toBeTruthy();
  });
  it('AL-05 (Nov 3 audit) a rule is evaluated for ITS branch; another branch cannot pause / delete it; delete keeps history; minimum sample ≥ 1', async () => {
    const B2 = id(3);
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Second','active','UTC') on conflict do nothing`, [B2, T]);
    const t2 = (await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,'paid',50000,50000,'B2-1',now(),now()) returning id`, [T, B2, C]))[0].id;
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status) values ($1,$2,$3,'card',50000,0,0,'approved')`, [T, B2, t2]);
    const asBranch: any = await bc.alertEvaluate(ctx(), rule);
    const asOwner: any = await bc.alertEvaluate(ctx({ branchId: '' }), rule);
    expect(asOwner.value).toBe(asBranch.value);                       // Branch 2's $500 sale is not this branch's result
    const other = ctx({ branchId: B2 });
    expect(await code(alertsSvc.update(other, rule, { active: false }))).not.toBe('ok');
    expect(await code(alertsSvc.remove(other, rule))).not.toBe('ok');
    expect((await q(`select active, archived_at from ai_business_alerts where id = $1`, [rule]))[0]).toMatchObject({ active: true, archived_at: null });
    const before = (await q(`select count(*)::int as n from ai_business_alert_events where alert_id = $1`, [rule]))[0].n;
    await alertsSvc.remove(ctx(), rule);
    expect((await q(`select count(*)::int as n from ai_business_alert_events where alert_id = $1`, [rule]))[0].n).toBe(before);
    expect((await q(`select archived_at from ai_business_alerts where id = $1`, [rule]))[0].archived_at).not.toBeNull();
    expect((await alertsSvc.list(ctx())).map((r) => r.id)).not.toContain(rule);
    const zero = await alertsSvc.create(ctx(), { title: 'Zero sample', metricId: 'net_sales', operator: 'lt', threshold: 1, preset: 'today', minSampleSize: 0 } as any);
    expect(zero.minSampleSize).toBe(1);
    await alertsSvc.remove(ctx(), zero.id);                           // never evaluated: really deleted
    expect((await q(`select count(*)::int as n from ai_business_alerts where id = $1`, [zero.id]))[0].n).toBe(0);
  });
  it('AL-06 (Business Alerts guide) edit is validated like create; an unreadable evaluation is RECORDED as failed; an archived rule leaves the rule list', async () => {
    const r = await alertsSvc.create(ctx(), { title: 'Quarter sales', metricId: 'net_sales', operator: 'lt', threshold: 1000, preset: 'quarter', minSampleSize: 1 } as any);
    expect(await code(alertsSvc.create(ctx(), { title: 'Bad', metricId: 'net_sales', operator: 'lt', threshold: 1, preset: 'fortnight' } as any))).toBe('VALIDATION_FAILED');
    expect((await alertsSvc.update(ctx(), r.id, { preset: 'year', minSampleSize: 3, title: '  Year sales ' })).preset).toBe('year');
    expect(await code(alertsSvc.update(ctx(), r.id, { minSampleSize: 0 }))).toBe('VALIDATION_FAILED');
    expect(await code(alertsSvc.update(ctx(), r.id, { title: '   ' }))).toBe('TITLE_REQUIRED');
    const broken = new BusinessCenter(db, { ...(bc as any).d, alerts: { ...(bc as any).d.alerts, evaluateNow: async () => { throw new Error('reports unavailable'); } } });
    const f: any = await broken.alertEvaluate(ctx(), r.id);
    expect(f).toMatchObject({ stateChange: 'failed', value: null, triggered: false });
    expect((await bc.alertHistory(ctx(), { alertId: r.id, state: 'failed' }) as any).items[0].reason).toMatch(/reports unavailable/);
    expect((await bc.alertSummary(ctx()) as any).failedEvaluations).toBeGreaterThanOrEqual(1);
    await alertsSvc.remove(ctx(), r.id);
    expect((await bc.alertRules(ctx(), { q: 'Year sales' }) as any).items).toHaveLength(0);
    expect(await code(bc.alertEvaluate(ctx(), r.id))).toBe('BC_ALERT_NOT_FOUND');
  });
  it('AL-04 anomaly: too few comparable weekdays → insufficient history, never a guess', async () => {
    const a: any = await bc.alertAnomaly(ctx());
    expect(a.items.every((x: any) => x.status === 'insufficient_history')).toBe(true);
  });
});

describe('AI Business — system checks', () => {
  it('HL-01 reports: the preset period agrees with explicit days; failures first; read-only; repeated taps reuse the run', async () => {
    const before = (await q(`select count(*)::int as n from ai_business_report_jobs where tenant_id = $1`, [T]))[0].n;
    const h: any = await bc.check(ctx(), 'reports');
    const by = Object.fromEntries(h.checks.map((x: any) => [x.key, x]));
    expect(by.period_matches.state).toBe('PASSED');
    expect(by.content_window).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.scheduled_reports.state).toBe('UNAVAILABLE');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(h.changesAnything).toBe(false);
    expect((await bc.check(ctx(), 'reports') as any)).toMatchObject({ reused: true, id: h.id });
    expect((await q(`select count(*)::int as n from ai_business_report_jobs where tenant_id = $1`, [T]))[0].n).toBe(before);
  });
  it('HL-02 alerts: automatic evaluation (A2, Nov 5) and SMS / email rules without delivery are reported', async () => {
    const h: any = await bc.check(ctx(), 'alerts');
    const by = Object.fromEntries(h.checks.map((x: any) => [x.key, x]));
    expect(['PASSED', 'WARNING']).toContain(by.automatic_evaluation.state);   // a real state now: overdue active rules → WARNING
    expect(by.automatic_evaluation.detail).toHaveProperty('lastAutomaticAt');
    expect(by.delivery_channels).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.rules_evaluated.state).toBe('PASSED');
    expect(await code(bc.check(ctx({ permissions: [] }), 'alerts'))).toBe('PERMISSION_DENIED');
  });
});

// A2 (Nov 5 2026): the background evaluator — due rules run as their creator, recorded 'scheduled', once per their period
describe('scheduled evaluation', () => {
  it('evaluates due rules as their creator (scheduled), skips rules checked within their period, records a departed owner as failed', async () => {
    await q(`update ai_business_alerts set last_checked_at = now() where tenant_id = $1`, [T]);   // everything just checked
    const r = await alertsSvc.create(ctx(), { title: 'Hourly sales', metricId: 'net_sales', operator: 'lt', threshold: 1000, preset: 'today', minSampleSize: 1, frequency: 'hourly' } as any);
    const perms = (role: string) => (role === 'OWNER' ? PERMS : []);
    const s1 = await bc.scheduledSweep(perms);
    expect(s1).toEqual({ evaluated: 1, failed: 0 });
    const ev = await q(`select source, state_change from ai_business_alert_events where alert_id = $1 order by evaluated_at desc limit 1`, [r.id]);
    expect(ev[0].source).toBe('scheduled');
    expect(await bc.scheduledSweep(perms)).toEqual({ evaluated: 0, failed: 0 });   // checked within the hour
    await q(`update ai_business_alerts set last_checked_at = now() - interval '2 hours' where id = $1`, [r.id]);
    await q(`update users set status = 'inactive' where id = $1`, [OWNER]);
    try {
      expect(await bc.scheduledSweep(perms)).toEqual({ evaluated: 0, failed: 1 });
      const f = await q(`select source, state_change, reason from ai_business_alert_events where alert_id = $1 order by evaluated_at desc limit 1`, [r.id]);
      expect(f[0]).toMatchObject({ source: 'scheduled', state_change: 'failed' }); expect(f[0].reason).toMatch(/no longer works here/);
    } finally { await q(`update users set status = 'active' where id = $1`, [OWNER]); }
  });
});
