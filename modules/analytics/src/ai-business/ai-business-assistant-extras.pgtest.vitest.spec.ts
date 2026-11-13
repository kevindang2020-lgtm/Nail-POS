// ai-business-assistant-extras.pgtest — A4 AI Business Assistant "not built" parts (Nov 6 2026; migration 828) on the REAL
// schema: stored + searchable history (private, CSV), record search never sent to the model, profit & expenses, growth
// advice, custom From–To, Check Business Data.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConversationHistory, searchRecords, profitAndExpenses, periodOf, growthAdvice, checkBusinessData, recordQuery, validRange, AssistantExtrasError, answerTrust, EVENT_LAG_STALE_SECONDS } from './ai-business-assistant-extras';
import { AiBusinessAssistantService, type BusinessToolset } from './ai-business-assistant.service';

const id = (n: number) => `82800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), OWNER = id(10), MGR = id(11), C1 = id(20), C2 = id(21);
const ALL = ['pos.ai_business.view', 'pos.customers.view', 'pos.checkout.view', 'owner.expenses.view', 'pos.reports.financial_view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: '', userId: OWNER, role: 'OWNER', permissions: ALL, ...o });
let pg: any; let db: any; let history: ConversationHistory;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e instanceof AssistantExtrasError ? e.code : (e?.apiCode ?? e?.code ?? e?.message); } }
let prompts: string[] = [];
const runner = { async run(r: any) { prompts.push(r.prompt); return { ok: true, text: 'answer from the model', decision: { allowed: true, reason: 'ok', label: 'ok' }, language: 'en' as const }; } };
const seen: any[] = [];
const tools: BusinessToolset = {
  getDailyBrief: async () => ({}), explainRevenueChange: async () => ({}), compareBranches: async () => ({}), getTechnicianPerformance: async () => ({}),
  getRevenueSummary: async (c, p) => { seen.push({ tool: 'revenue', preset: p, range: (c as any).range ?? null }); return { netSalesCents: 1_000_000, ticketsCount: 40, productSalesCents: 0 }; },
  getAppointmentMetrics: async () => ({ funnel: { totalBookings: 50, completed: 40, completedPercent: 80, cancelled: 4, cancelledPercent: 8, noShow: 6, noShowPercent: 12, walkIns: 3 } }),
  getCustomerGrowth: async () => ({ newCustomers: 5, newCustomersTrendPercent: -30, returningCustomers: 8, retentionRatePercent: 35, activeCustomers: 13, limitedData: false }),
};
let assistant: AiBusinessAssistantService;

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Lux','ab-828','AB828','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC')`, [B, T]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Owner','o@ab.test','active','OWNER'), ($2,$3,'Mgr','m@ab.test','active','MANAGER')`, [OWNER, MGR, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$3,$4,'Lan','Nguyễn','Lan Nguyễn','+16095550101'), ($2,$3,$4,'Amy','Ward','Amy Ward','+16095550102')`, [C1, C2, T, B]);
  await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,'paid',5000,5000,'1042', now(), now())`, [T, B, C1]);
  const ex = (cat: string, cents: number, status: string, day = '2026-11-03') => q(`insert into expenses (tenant_id, branch_id, category, amount_cents, incurred_on, status, kind, created_by) values ($1,$2,$3,$4,$5::date,$6,'expense',$7)`, [T, B, cat, cents, day, status, OWNER]);
  await ex('supplies', 120000, 'approved'); await ex('rent', 300000, 'approved'); await ex('supplies', 30000, 'approved'); await ex('utilities', 9900, 'pending_review'); await ex('rent', 999999, 'voided');
  await ex('rent', 300000, 'approved', '2026-10-01');   // outside the range
  history = new ConversationHistory(db);
  assistant = new AiBusinessAssistantService(tools, runner, { history, searchRecords: (c, qq) => searchRecords(db, c, qq), profitAndExpenses: (c, p, n) => profitAndExpenses(db, c, p, n), periodOf: (c, p) => periodOf(db, c, p) });
}, 180_000);
beforeEach(() => { prompts = []; seen.length = 0; });

describe('A4 — record search (never sent to the model)', () => {
  it('AX-01 a name (accents and all), a phone and a ticket number are found in this salon; nothing goes to the model', async () => {
    expect(recordQuery('find Nguyen')).toEqual({ kind: 'name', term: 'Nguyen' });
    expect(recordQuery('find 609-555-0101')).toEqual({ kind: 'phone', term: '6095550101' });
    expect(recordQuery('ticket #1042')).toEqual({ kind: 'ticket', term: '1042' });
    const r: any = await assistant.ask(ctx(), { question: 'find 609-555-0101' });
    expect(r).toMatchObject({ intent: 'find_record', answer: null, records: { customers: 1, tickets: 0 } });
    expect(r.structured.customers[0]).toMatchObject({ name: 'Lan Nguyễn', route: expect.stringContaining('customerId=' + C1) });
    const t: any = await assistant.ask(ctx(), { question: 'find ticket 1042' });
    expect(t.structured.tickets[0]).toMatchObject({ number: '1042', route: expect.stringMatching(/^\/checkout\?ticket=/) });
    expect(prompts).toHaveLength(0);
    const hidden: any = await searchRecords(db, ctx({ permissions: ['pos.ai_business.view'] }), 'find Amy');
    expect(hidden).toMatchObject({ customers: [], hidden: ['customers', 'tickets'] });
  });
});

describe('A4 — profit & expenses, growth advice, custom range', () => {
  it('AX-02 net sales − APPROVED expenses dated in the period (voided / pending / other days excluded); by category; needs expense permission', async () => {
    const p: any = await assistant.ask(ctx(), { question: 'What was my profit after expenses?', from: '2026-11-01', to: '2026-11-06' });
    expect(p.intent).toBe('profit_expenses');
    expect(p.structured).toMatchObject({ netSalesCents: 1_000_000, expensesCents: 450000, operatingResultCents: 550000, marginPercent: 55, notYetApproved: { count: 1, cents: 9900 } });
    expect(p.structured.byCategory).toEqual([{ category: 'rent', cents: 300000, count: 1 }, { category: 'supplies', cents: 150000, count: 2 }]);
    expect(seen[0]).toMatchObject({ preset: 'custom', range: { from: '2026-11-01', to: '2026-11-06' } });
    expect(await code(assistant.ask(ctx({ permissions: ['pos.ai_business.view', 'pos.reports.financial_view'] }), { intent: 'profit_expenses', preset: 'month' }))).toBe('PERMISSION_DENIED');
  });
  it('AX-03 growth advice: rules over the period numbers, each with its basis; no invented numbers', () => {
    const tips = growthAdvice({ customers: { newCustomers: 5, newCustomersTrendPercent: -30, retentionRatePercent: 35, activeCustomers: 13, limitedData: false },
      appointments: { funnel: { totalBookings: 50, noShowPercent: 12, cancelledPercent: 8 } }, revenue: { ticketsCount: 40, productSalesCents: 0 } });
    expect(tips.map((t) => t.kind)).toEqual(['no_shows', 'retention', 'new_customers', 'retail']);
    expect(tips[0].message).toBe('12% of 50 bookings were no-shows. Reminder texts and a confirmation call the day before usually cut this.');
    expect(growthAdvice({ customers: { limitedData: true, retentionRatePercent: 5 } })).toEqual([]);
  });
  it('AX-04 a custom range is validated (order, at most 366 days); explaining a change needs a named period', async () => {
    expect(() => validRange('2026-11-06', '2026-11-01')).toThrow();
    expect(() => validRange('2025-01-01', '2026-11-06')).toThrow(/at most 366/);
    expect(await code(assistant.ask(ctx(), { intent: 'revenue_summary', from: '2026-11-06', to: '2026-11-01' }))).toBe('DATE_RANGE_INVALID');
    expect(await code(assistant.ask(ctx(), { intent: 'explain_revenue', from: '2026-11-01', to: '2026-11-06' }))).toBe('DATE_RANGE_UNSUPPORTED');
  });
});

describe('A4 — stored history', () => {
  it('AX-05 every question is stored for the person who asked; searchable; another user cannot see or delete it; CSV is formula-safe', async () => {
    await q(`delete from ai_business_conversations where tenant_id = $1`, [T]);
    await assistant.ask(ctx(), { question: 'How can we grow?', preset: 'month' });
    await assistant.ask(ctx(), { question: '=HYPERLINK("x") hello' });                       // not understood → clarification, still stored
    await assistant.ask(ctx({ userId: MGR, role: 'MANAGER' }), { question: 'How can we grow?', preset: 'week' });
    const mine: any = await history.list(ctx(), {});
    expect(mine.total).toBe(2);
    expect(mine.items.map((i: any) => i.answeredBy).sort()).toEqual(['ai', 'clarification']);
    const grow = mine.items.find((i: any) => i.answeredBy === 'ai');
    expect(grow).toMatchObject({ intent: 'growth_advice', preset: 'month', answer: 'answer from the model', period: { from: expect.stringMatching(/-01$/) } });
    expect((await history.list(ctx(), { q: 'grow' })).total).toBe(1);
    expect((await history.list(ctx({ userId: MGR }), {})).total).toBe(1);
    expect(await code(history.remove(ctx({ userId: MGR }), grow.id))).toBe('NOT_FOUND');
    const csv = await history.csv(ctx(), {});
    expect(csv.split('\r\n')[0]).toBe('Asked at,Question,Topic,Period,From,To,Answered by,Answer');
    expect(csv).toContain(`"'=HYPERLINK(""x"") hello"`);
    await history.remove(ctx(), grow.id);
    expect((await history.list(ctx(), {})).total).toBe(1);
    const row = (await q(`select headline from ai_business_conversations where user_id = $1`, [MGR]))[0];
    expect(row.headline).toEqual({});                                                          // growth advice keeps no customer data
  });
  it('AX-06 Check Business Data: recorded, reused within 30 s, warns on an expense waiting more than 14 days, read-only', async () => {
    await q(`insert into expenses (tenant_id, branch_id, category, amount_cents, incurred_on, status, kind, created_by, created_at) values ($1,$2,'supplies',100,'2026-10-01','pending_review','expense',$3, now() - interval '20 days')`, [T, B, OWNER]);
    const probe = { access: async () => ({ allowed: true, reason: 'ok' }), sales: async () => ({}) };
    const h: any = await checkBusinessData(db, ctx(), probe);
    const by = Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
    expect(by).toMatchObject({ ai_package: { state: 'PASSED' }, sales_report: { state: 'PASSED' }, expenses_waiting: { state: 'WARNING', count: 1 }, no_side_effects: { state: 'PASSED' } });
    expect(h.overall).toBe('WARNING');
    expect((await checkBusinessData(db, ctx(), probe)).reused).toBe(true);
    const failing: any = await checkBusinessData(db, ctx({ branchId: B }), { access: async () => ({ allowed: false, reason: 'not_subscribed' }), sales: async () => { throw new Error('down'); } });
    expect(failing.overall).toBe('FAILED');
    expect(await code(checkBusinessData(db, ctx({ permissions: [] }), probe))).toBe('PERMISSION_DENIED');
  });
});

describe('round 10 — Answer Trust Bar + History Provenance (AI Business Assistant 01 · 07 · 11 · 13)', () => {
  it('AX-07 trust is computed from real rows: last check, open tickets + expenses waiting in the period, event lag; read-only', async () => {
    await q(`delete from ai_business_health_runs where tenant_id = $1`, [T]);
    await q(`delete from outbox_events where tenant_id = $1`, [T]);
    const now = new Date('2026-11-05T15:00:00Z');
    // no check yet, no events, the expenses seeded on 2026-11-03 (one pending_review)
    await q(`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, ticket_number, created_at) values ($1,$2,$3,'open',2000,2000,'2001','2026-11-04T12:00:00Z')`, [T, B, C1]);
    const t0: any = await answerTrust(db, ctx({ range: { from: '2026-11-01', to: '2026-11-06' } }), 'profit_expenses', 'custom', { netSalesCents: 1, expensesCents: 2 }, now);
    expect(t0).toMatchObject({ lastCheck: null, stale: false, changesAnything: false, period: { from: '2026-11-01', to: '2026-11-06', timeZone: expect.any(String) },
      pending: { openTickets: 1, expensesWaiting: 1, eventsWaiting: 0, oldestEventLagSeconds: null } });
    expect(t0.sources).toEqual([{ key: 'sales', included: true, reason: 'included' }, { key: 'expenses', included: true, reason: 'included' }]);
    // without the expense permission the source is named as not included and the waiting count is not shown (null, not 0)
    const t1: any = await answerTrust(db, ctx({ permissions: ['pos.ai_business.view'], range: { from: '2026-11-01', to: '2026-11-06' } }), 'profit_expenses', 'custom', { netSalesCents: 1 }, now);
    expect(t1.sources[1]).toEqual({ key: 'expenses', included: false, reason: 'no_permission' });
    expect(t1.pending.expensesWaiting).toBeNull();
    // an undelivered event older than the lag limit + a FAILED check → stale with both reasons
    await q(`insert into outbox_events (id, event_type, tenant_id, aggregate_type, aggregate_id, correlation_id, payload_json, occurred_at, publish_status) values (gen_random_uuid(),'ticket.paid',$1,'ticket','x','c','{}'::jsonb,$2,'failed')`, [T, new Date(now.getTime() - (EVENT_LAG_STALE_SECONDS + 60) * 1000)]);
    await q(`insert into ai_business_health_runs (tenant_id, branch_id, area, overall, checks) values ($1, null, 'assistant', 'FAILED', '[{"key":"sales_report","state":"FAILED"},{"key":"ai_package","state":"PASSED"}]'::jsonb)`, [T]);
    const before = (await q(`select count(*)::int n from ai_business_health_runs where tenant_id = $1`, [T]))[0].n;
    const t2: any = await answerTrust(db, ctx(), 'revenue_summary', 'today', { netSalesCents: 1 }, now);
    expect(t2).toMatchObject({ stale: true, staleReasons: ['event_lag', 'check_failed'], lastCheck: { overall: 'FAILED', warnings: ['sales_report'] }, pending: { eventsWaiting: 1, oldestEventLagSeconds: EVENT_LAG_STALE_SECONDS + 60 } });
    expect((await q(`select count(*)::int n from ai_business_health_runs where tenant_id = $1`, [T]))[0].n).toBe(before);   // wrote nothing
    // an empty tool result is a missing source, never green
    const t3: any = await answerTrust(db, ctx(), 'customer_growth', 'today', {}, now);
    expect(t3.sources).toEqual([{ key: 'customers', included: false, reason: 'no_data' }]);
    expect(t3.staleReasons).toContain('source_missing');
  });
  it('AX-08 ask() attaches the trust block (not for clarifications); history entries carry provenance and are not editable', async () => {
    const svc = new AiBusinessAssistantService(tools, runner, { history, periodOf: (c, p) => periodOf(db, c, p), trust: (c, i, p, st) => answerTrust(db, c, i, p, st) });
    const r: any = await svc.ask(ctx(), { intent: 'revenue_summary', preset: 'today' });
    expect(r.trust).toMatchObject({ changesAnything: false, sources: [{ key: 'sales', included: true }] });
    const c: any = await svc.ask(ctx(), { question: 'zzz qqq' });
    expect(c.needsClarification).toBe(true); expect(c.trust).toBeUndefined();
    const h: any = await history.list(ctx(), {});
    const row = h.items.find((i: any) => i.id === r.conversationId);
    expect(row.provenance).toMatchObject({ recordId: r.conversationId, toolUsed: 'get_revenue_summary', sources: ['sales'], visibleTo: 'asker_only', editable: false, headline: { netSalesCents: 1_000_000, ticketsCount: 40 } });
  });
});
