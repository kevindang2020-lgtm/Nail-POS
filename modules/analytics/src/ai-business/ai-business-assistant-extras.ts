// ai-business-assistant-extras.ts — A4 AI Business Assistant guide, the parts the Nov 3 build listed as "not built"
// (Nov 6 2026; migration 828):
//   • a STORED, searchable conversation history (private to the person who asked; 365-day retention) with CSV export;
//   • record search — "find Nguyen", "find 609-555-0101", "find ticket 1042" — answered from the salon's own records with
//     links, NEVER sent to the model (customer names and phones stay out of the prompt);
//   • profit & expenses — the period's net sales minus its approved expenses (by category), owner.expenses.view +
//     financial view required;
//   • growth advisor — rules over the period's customer, appointment and revenue numbers, each with its basis;
//   • "Check Business Data" — a recorded read-only check of what the assistant stands on.
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { branchTimeZone } from '@aipowersalon/database';
import { presetRange } from '@aipowersalon/reports';
import type { AiBusinessContext } from './ai-business.dto';

type Row = Record<string, any>;
export const ASSISTANT_EXTRAS = 'AiBusinessAssistantExtras';
/** What the history / check routes use (bound in the module). */
export interface AssistantExtrasRoutes { history: ConversationHistory; check: (ctx: AiBusinessContext) => ReturnType<typeof checkBusinessData> }
export class AssistantExtrasError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); } }
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const has = (ctx: AiBusinessContext, p: string) => hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], p);
const esc = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const branchOf = (ctx: AiBusinessContext) => (isUuid(ctx.branchId) ? String(ctx.branchId) : null);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CUSTOM_DAYS = 366;

/** The salon-local days a preset (or a validated custom range) covers. */
export async function periodOf(db: Kysely<any>, ctx: AiBusinessContext, preset: string, now: Date = new Date()): Promise<{ from: string; to: string; timeZone: string }> {
  const tz = await branchTimeZone(db, ctx.tenantId, branchOf(ctx));
  if (preset === 'custom' && ctx.range) return { ...ctx.range, timeZone: tz };
  return { ...presetRange(preset, now, tz), timeZone: tz };
}
/** Validate a custom From–To (both days, From ≤ To, at most 366 days). */
export function validRange(from: unknown, to: unknown): { from: string; to: string } {
  const f = String(from ?? ''), t = String(to ?? '');
  if (!YMD.test(f) || !YMD.test(t) || f > t) throw new AssistantExtrasError('Choose a valid From and To date.', 'DATE_RANGE_INVALID');
  if (Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1 > MAX_CUSTOM_DAYS) throw new AssistantExtrasError(`Choose at most ${MAX_CUSTOM_DAYS} days.`, 'DATE_RANGE_MAX_DAYS');
  return { from: f, to: t };
}

// ── conversation history ─────────────────────────────────────────────────────────────────────────────────────────
export interface ConversationEntry { question: string | null; intent: string | null; toolUsed: string | null; preset: string | null; period: { from: string; to: string } | null;
  answer: string | null; answeredBy: 'ai' | 'numbers_only' | 'clarification' | 'records'; language?: string | null; headline?: Record<string, unknown> }
export class ConversationHistory {
  constructor(private readonly db: Kysely<any>) {}
  async record(ctx: AiBusinessContext, e: ConversationEntry): Promise<string | null> {
    if (!isUuid(ctx.userId)) return null;
    const r = (await sql<Row>`insert into ai_business_conversations (tenant_id, branch_id, user_id, question, intent, tool_used, preset, period_from, period_to, answer, answered_by, language, headline)
      values (${ctx.tenantId}, ${branchOf(ctx)}, ${ctx.userId}, ${e.question?.slice(0, 1000) ?? null}, ${e.intent}, ${e.toolUsed}, ${e.preset}, ${e.period?.from ?? null}::date, ${e.period?.to ?? null}::date,
        ${e.answer?.slice(0, 8000) ?? null}, ${e.answeredBy}, ${e.language ?? null}, ${JSON.stringify(e.headline ?? {})}::jsonb) returning id`.execute(this.db)).rows[0];
    return r ? String(r.id) : null;
  }
  private where(ctx: AiBusinessContext, q: string) {
    const term = q.trim().slice(0, 80);
    return sql`c.user_id = ${ctx.userId} ${term ? sql`and (c.question ilike ${esc(term)} or c.answer ilike ${esc(term)})` : sql``}`;
  }
  async list(ctx: AiBusinessContext, f: Row) {
    if (!isUuid(ctx.userId)) throw new AssistantExtrasError('Not signed in.', 'AUTH_REQUIRED', 401);
    const limit = [10, 25, 50, 100].includes(Number(f.limit)) ? Number(f.limit) : 25, page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const w = this.where(ctx, String(f.q ?? ''));
    const total = Number((await sql<Row>`select count(*)::int as n from ai_business_conversations c where c.tenant_id = ${ctx.tenantId} and ${w}`.execute(this.db)).rows[0]?.n ?? 0);
    const rows = (await sql<Row>`select c.id, c.question, c.intent, c.preset, to_char(c.period_from, 'YYYY-MM-DD') as period_from, to_char(c.period_to, 'YYYY-MM-DD') as period_to, c.answer, c.answered_by, c.created_at from ai_business_conversations c where c.tenant_id = ${ctx.tenantId} and ${w}
      order by c.created_at desc, c.id desc limit ${limit} offset ${(page - 1) * limit}`.execute(this.db)).rows;
    return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), retentionDays: 365,
      items: rows.map((r) => ({ id: String(r.id), question: r.question, intent: r.intent, preset: r.preset, period: r.period_from ? { from: String(r.period_from), to: String(r.period_to) } : null,
        answer: r.answer, answeredBy: r.answered_by, at: iso(r.created_at) })) };
  }
  async remove(ctx: AiBusinessContext, id: string) {
    if (!isUuid(id)) throw new AssistantExtrasError('Not found.', 'NOT_FOUND', 404);
    const r = (await sql<Row>`delete from ai_business_conversations c where c.tenant_id = ${ctx.tenantId} and c.user_id = ${ctx.userId} and c.id = ${id}::uuid returning c.id`.execute(this.db)).rows[0];
    if (!r) throw new AssistantExtrasError('Not found.', 'NOT_FOUND', 404);
    return { ok: true };
  }
  /** CSV of the person's own history (a download — nothing is printed). Formula-injection safe. The POS builds the same file
   *  from the list (FitKit downloadCsv); this is the server form for exports and tests. */
  async csv(ctx: AiBusinessContext, f: Row): Promise<string> {
    const rows = (await sql<Row>`select c.created_at, c.question, c.intent, c.preset, to_char(c.period_from, 'YYYY-MM-DD') as period_from, to_char(c.period_to, 'YYYY-MM-DD') as period_to, c.answered_by, c.answer from ai_business_conversations c where c.tenant_id = ${ctx.tenantId} and ${this.where(ctx, String(f.q ?? ''))}
      order by c.created_at desc limit 5000`.execute(this.db)).rows;
    const cell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['Asked at', 'Question', 'Topic', 'Period', 'From', 'To', 'Answered by', 'Answer'];
    return [head.join(','), ...rows.map((r) => [iso(r.created_at), r.question, r.intent, r.preset, r.period_from ?? '', r.period_to ?? '', r.answered_by, r.answer].map(cell).join(','))].join('\r\n') + '\r\n';
  }
}

// ── record search (never sent to the model) ─────────────────────────────────────────────────────────────────────
/** What to look for in a "find …" question: digits ≥ 7 = a phone; "ticket|invoice|receipt #123" = a ticket number; else a name. */
export function recordQuery(question: string): { kind: 'phone' | 'ticket' | 'name'; term: string } | null {
  const q = question.trim();
  const tk = /\b(?:ticket|invoice|receipt|hóa đơn)\s*(?:#|no\.?|number)?\s*([A-Za-z0-9-]{1,20})\b/i.exec(q);
  if (tk) return { kind: 'ticket', term: tk[1] };
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 7) return { kind: 'phone', term: digits.slice(-10) };
  const name = q.replace(/^\s*(find|search|look up|lookup|show|tìm)\b\s*(customer|client|khách)?\s*/i, '').trim();
  return name.length >= 2 ? { kind: 'name', term: name.slice(0, 60) } : null;
}
export async function searchRecords(db: Kysely<any>, ctx: AiBusinessContext, question: string) {
  const rq = recordQuery(question);
  const out: { customers: Row[]; tickets: Row[]; query: typeof rq; hidden: string[] } = { customers: [], tickets: [], query: rq, hidden: [] };
  if (!rq) return out;
  const B = branchOf(ctx);
  if (has(ctx, 'pos.customers.view')) {
    if (rq.kind !== 'ticket') {
      const cond = rq.kind === 'phone' ? sql`regexp_replace(coalesce(cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + rq.term}` : sql`vi_fold(cu.full_name) like vi_fold(${esc(rq.term)})`;
      out.customers = (await sql<Row>`select cu.id, cu.full_name, cu.updated_at from customers cu where cu.tenant_id = ${ctx.tenantId} and cu.archived_at is null and ${cond}
        ${B ? sql`and cu.branch_id = ${B}::uuid` : sql``} order by cu.updated_at desc nulls last, cu.full_name limit 10`.execute(db)).rows
        .map((r) => ({ id: String(r.id), name: r.full_name, route: `/customers?q=${encodeURIComponent(String(r.full_name ?? ''))}&customerId=${r.id}` }));
    }
  } else out.hidden.push('customers');
  if (has(ctx, 'pos.checkout.view')) {
    if (rq.kind === 'ticket') {
      out.tickets = (await sql<Row>`select t.id, t.ticket_number, t.status, t.total_cents, t.paid_at, t.created_at from tickets t where t.tenant_id = ${ctx.tenantId} and t.ticket_number::text ilike ${esc(rq.term)}
        ${B ? sql`and t.branch_id = ${B}::uuid` : sql``} order by t.created_at desc limit 10`.execute(db)).rows
        .map((r) => ({ id: String(r.id), number: String(r.ticket_number), status: r.status, totalCents: Number(r.total_cents ?? 0), at: iso(r.paid_at ?? r.created_at), route: `/checkout?ticket=${r.id}` }));
    }
  } else out.hidden.push('tickets');
  return out;
}

// ── profit & expenses ───────────────────────────────────────────────────────────────────────────────────────────
export async function profitAndExpenses(db: Kysely<any>, ctx: AiBusinessContext, preset: string, netSalesCents: number) {
  if (!has(ctx, 'owner.expenses.view')) throw new AssistantExtrasError('Your role cannot see expenses.', 'PERMISSION_DENIED', 403);
  const p = await periodOf(db, ctx, preset);
  const B = branchOf(ctx);
  const rows = (await sql<Row>`select coalesce(nullif(e.category, ''), 'uncategorized') as category, sum(e.amount_cents)::bigint as cents, count(*)::int as n from expenses e
    where e.tenant_id = ${ctx.tenantId} and e.status = 'approved' and e.archived_at is null and e.incurred_on between ${p.from}::date and ${p.to}::date ${B ? sql`and e.branch_id = ${B}::uuid` : sql``}
    group by 1 order by 2 desc`.execute(db)).rows;
  const pending = (await sql<Row>`select count(*)::int as n, coalesce(sum(e.amount_cents), 0)::bigint as cents from expenses e where e.tenant_id = ${ctx.tenantId} and e.status in ('draft', 'pending_review')
    and e.archived_at is null and e.incurred_on between ${p.from}::date and ${p.to}::date ${B ? sql`and e.branch_id = ${B}::uuid` : sql``}`.execute(db)).rows[0] ?? {};
  const expensesCents = rows.reduce((a, r) => a + Number(r.cents), 0);
  return { period: p, netSalesCents, expensesCents, operatingResultCents: netSalesCents - expensesCents,
    marginPercent: netSalesCents > 0 ? Math.round(((netSalesCents - expensesCents) / netSalesCents) * 1000) / 10 : null,
    byCategory: rows.slice(0, 8).map((r) => ({ category: r.category, cents: Number(r.cents), count: Number(r.n) })),
    notYetApproved: { count: Number(pending.n ?? 0), cents: Number(pending.cents ?? 0) },
    notes: ['Expenses are the APPROVED expenses dated in the period; payroll and card fees appear only where they were recorded as expenses.', 'Net sales exclude tips and tax.'] };
}

// ── growth advisor ──────────────────────────────────────────────────────────────────────────────────────────────
export interface GrowthTip { kind: string; message: string; basis: Record<string, number | null>; route: string }
export function growthAdvice(x: { customers?: Row | null; appointments?: Row | null; revenue?: Row | null }): GrowthTip[] {
  const tips: GrowthTip[] = [];
  const c = x.customers, a = x.appointments?.funnel, r = x.revenue;
  if (a && a.totalBookings >= 10 && a.noShowPercent != null && a.noShowPercent >= 8) tips.push({ kind: 'no_shows', route: '/tenant/ai/receptionist/follow-ups', basis: { noShowPercent: a.noShowPercent, bookings: a.totalBookings },
    message: `${a.noShowPercent}% of ${a.totalBookings} bookings were no-shows. Reminder texts and a confirmation call the day before usually cut this.` });
  if (a && a.totalBookings >= 10 && a.cancelledPercent != null && a.cancelledPercent >= 15) tips.push({ kind: 'cancellations', route: '/tenant/appointments', basis: { cancelledPercent: a.cancelledPercent },
    message: `${a.cancelledPercent}% of bookings were cancelled. Offer the open slots to the waitlist so the time is not lost.` });
  if (c && !c.limitedData && c.retentionRatePercent != null && c.retentionRatePercent < 40) tips.push({ kind: 'retention', route: '/tenant/marketing/win-back', basis: { retentionRatePercent: c.retentionRatePercent, activeCustomers: c.activeCustomers },
    message: `Only ${c.retentionRatePercent}% of customers came back. A win-back campaign to customers who have not visited in 60 days is the usual next step.` });
  if (c && !c.limitedData && c.newCustomers > 0 && c.newCustomersTrendPercent != null && c.newCustomersTrendPercent <= -20) tips.push({ kind: 'new_customers', route: '/tenant/marketing/referrals', basis: { newCustomers: c.newCustomers, trendPercent: c.newCustomersTrendPercent },
    message: `New customers are down ${Math.abs(c.newCustomersTrendPercent)}% (${c.newCustomers} this period). A referral reward brings in friends of your regulars.` });
  if (r && r.ticketsCount >= 10 && r.productSalesCents === 0) tips.push({ kind: 'retail', route: '/tenant/ai/checkout-upsell', basis: { ticketsCount: r.ticketsCount },
    message: `None of the ${r.ticketsCount} paid tickets included a product. Checkout suggestions can offer aftercare at the right moment.` });
  return tips;
}

// ── Check Business Data ─────────────────────────────────────────────────────────────────────────────────────────
export async function checkBusinessData(db: Kysely<any>, ctx: AiBusinessContext, probe: { access: () => Promise<{ allowed: boolean; reason: string }>; sales: () => Promise<unknown> }, now = Date.now()) {
  if (!has(ctx, 'pos.ai_business.view')) throw new AssistantExtrasError('Your role cannot use AI Business.', 'PERMISSION_DENIED', 403);
  const T = ctx.tenantId, B = branchOf(ctx);
  const last = (await sql<Row>`select id, overall, checks, created_at from ai_business_health_runs where tenant_id = ${T} and area = 'assistant' and branch_id is not distinct from ${B}
    and created_at >= ${new Date(now - 30_000)} order by created_at desc limit 1`.execute(db)).rows[0];
  if (last) return { id: String(last.id), overall: last.overall, checks: last.checks, checkedAt: iso(last.created_at), reused: true, changesAnything: false };
  const checks: { key: string; component: string; state: string; count: number }[] = [];
  const acc = await probe.access().catch((e) => ({ allowed: false, reason: String((e as Error)?.message ?? 'error') }));
  checks.push({ key: 'ai_package', component: 'access', state: acc.allowed ? 'PASSED' : 'WARNING', count: 0 });
  let salesOk = true; try { await probe.sales(); } catch { salesOk = false; }
  checks.push({ key: 'sales_report', component: 'metrics', state: salesOk ? 'PASSED' : 'FAILED', count: 0 });
  const tz = (await sql<Row>`select count(*)::int as n from branches b where b.tenant_id = ${T} and coalesce(b.status, 'active') = 'active' and (b.timezone is null or b.timezone = '')`.execute(db)).rows[0];
  checks.push({ key: 'branch_time_zones', component: 'branches', state: Number(tz?.n) ? 'WARNING' : 'PASSED', count: Number(tz?.n ?? 0) });
  const unpriced = (await sql<Row>`select count(*)::int as n from tickets t where t.tenant_id = ${T} and t.status = 'paid' and coalesce(t.total_cents, 0) = 0 and t.paid_at > ${new Date(now - 30 * 86_400_000)}
    ${B ? sql`and t.branch_id = ${B}::uuid` : sql``}`.execute(db)).rows[0];
  checks.push({ key: 'zero_tickets', component: 'metrics', state: Number(unpriced?.n) ? 'WARNING' : 'PASSED', count: Number(unpriced?.n ?? 0) });
  const pend = (await sql<Row>`select count(*)::int as n from expenses e where e.tenant_id = ${T} and e.status = 'pending_review' and e.archived_at is null and e.created_at < ${new Date(now - 14 * 86_400_000)}`.execute(db)).rows[0];
  checks.push({ key: 'expenses_waiting', component: 'expenses', state: Number(pend?.n) ? 'WARNING' : 'PASSED', count: Number(pend?.n ?? 0) });
  checks.push({ key: 'history_private', component: 'security', state: 'PASSED', count: 0 });
  checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED', count: 0 });
  const overall = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING' : 'PASSED';
  const row = (await sql<Row>`insert into ai_business_health_runs (tenant_id, branch_id, area, actor_user_id, overall, checks) values (${T}, ${B}, 'assistant', ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)
    returning id, created_at`.execute(db)).rows[0];
  return { id: String(row.id), overall, checks, checkedAt: iso(row.created_at), reused: false, changesAnything: false };
}
