// ai-business-assistant.service.ts — the natural-language layer that ties the six authorized tools to the model.
//
// Flow (spec §4 architecture): resolve a bounded intent → run ONE authorized tool with server-derived ctx → pass the
// STRUCTURED result (not raw tables, not SQL) to the shared AiAssistantService.run(), which applies the ai_business_
// assistant access gate + usage logging + control-mode + the evidence-grounded system prompt. The model only ever
// sees computed, tenant-filtered numbers and never selects a tenant/branch or issues a query (§5, §21).
//
// Honest degradation: the tool runs first and its structured result is ALWAYS returned when the caller is permitted
// for that data. The natural-language `answer` is present only when the AI package is subscribed/available; if the
// gate denies it, the caller still gets the real numbers (metrics-only mode, §56) plus the access decision.
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';
import { AI_BUSINESS_INTENTS, isIntent, resolveIntent, type AiBusinessIntent } from './ai-business-intents';
import { withCode } from '@aipowersalon/api-contracts';
import { validRange, growthAdvice, AssistantExtrasError, type ConversationHistory } from './ai-business-assistant-extras';

/** the few headline figures kept with a history row (never names, phones or ticket lines) */
function headlineOf(structured: unknown): Record<string, number> {
  const s = (structured ?? {}) as Record<string, any>;
  const out: Record<string, number> = {};
  for (const k of ['netSalesCents', 'ticketsCount', 'averageTicketCents', 'expensesCents', 'operatingResultCents', 'newCustomers', 'returningCustomers', 'retentionRatePercent']) if (typeof s[k] === 'number') out[k] = s[k];
  if (s.funnel && typeof s.funnel.totalBookings === 'number') { out.totalBookings = s.funnel.totalBookings; out.completed = s.funnel.completed; }
  if (s.kpis && typeof s.kpis.netSalesCents === 'number') out.netSalesCents = s.kpis.netSalesCents;
  return out;
}

/** Structural facade over the six tool services (each method delegates to the real service in the module wiring). */
export interface BusinessToolset {
  getDailyBrief(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  getRevenueSummary(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  explainRevenueChange(ctx: AiBusinessContext, preset?: string, comparePreset?: string): Promise<unknown>;
  getAppointmentMetrics(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  compareBranches(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  getCustomerGrowth(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
  getTechnicianPerformance(ctx: AiBusinessContext, preset?: string): Promise<unknown>;
}

/** Structural view of AiAssistantService.run (which satisfies it) — the shared access-gated model path. */
export interface AssistantRunner {
  run(req: { tenantId: string; userId: string | null; packageCode: string; action?: string; prompt: string; responseLanguage?: 'en' | 'vi' | 'user'; branchId?: string | null }): Promise<{
    ok: boolean; text?: string; decision: { allowed: boolean; reason: string; label: string }; usage?: unknown; language?: 'en' | 'vi';
  }>;
}

export interface AskParams { question?: string; intent?: string; preset?: string; comparePreset?: string; from?: string; to?: string }

export interface AskResult {
  ok: boolean;
  needsClarification: boolean;
  intent: AiBusinessIntent | null;
  toolUsed: string | null;
  answer: string | null;            // model explanation; null when the AI package is unavailable or clarification
  structured: unknown | null;       // the authoritative tool result (always present once a tool ran)
  access: { allowed: boolean; reason: string; label: string } | null;
  suggestions?: string[];           // supported questions, offered when clarification is needed
  usage?: unknown;
  language?: 'en' | 'vi';           // Vietnamese POS §120: the language `answer` was asked in (the reader's POS language)
  conversationId?: string | null;   // A4 (Nov 6 2026): the stored history row
  trust?: unknown;                  // round 10: Answer Trust Bar (answerTrust) — real checks only, read-only
  records?: { customers: number; tickets: number };   // A4: a record search's counts (the rows are in `structured`)
}

/** A4 (Nov 6 2026): what the assistant needs beyond the six tools (all optional — the in-memory wiring has none). */
export interface AssistantExtras {
  history?: Pick<ConversationHistory, 'record'> | null;
  searchRecords?: (ctx: AiBusinessContext, question: string) => Promise<unknown>;
  profitAndExpenses?: (ctx: AiBusinessContext, preset: string, netSalesCents: number) => Promise<unknown>;
  periodOf?: (ctx: AiBusinessContext, preset: string) => Promise<{ from: string; to: string }>;
  /** round 10 — Answer Trust Bar: last check, source coverage, pending reconciliation, event lag (ai-business-assistant-extras answerTrust) */
  trust?: (ctx: AiBusinessContext, intent: string | null, preset: string, structured: unknown) => Promise<unknown>;
}

const PACKAGE = 'ai_business_assistant';
const SUGGESTIONS = [
  'Summarize today', 'Why did revenue change?', 'Compare my branches this month',
  'Show appointment trends', 'Review customer growth', 'Review technician performance',
  'What was my profit after expenses?', 'How can we grow?', 'Find a customer or ticket',
];
const TOOL_FOR: Record<AiBusinessIntent, string> = {
  daily_summary: 'get_daily_operations_summary', revenue_summary: 'get_revenue_summary',
  explain_revenue: 'explain_revenue_change', appointments: 'get_appointment_metrics',
  compare_branches: 'compare_branches', customer_growth: 'get_customer_growth',
  technician_performance: 'get_technician_performance',
  find_record: 'find_record', profit_expenses: 'get_profit_and_expenses', growth_advice: 'get_growth_advice',
};

export class AiBusinessAssistantService {
  constructor(private readonly tools: BusinessToolset, private readonly assistant: AssistantRunner, private readonly extras: AssistantExtras = {}) {}

  private async runTool(intent: AiBusinessIntent, ctx: AiBusinessContext, p: AskParams): Promise<unknown> {
    switch (intent) {
      case 'daily_summary': return this.tools.getDailyBrief(ctx, p.preset);
      case 'revenue_summary': return this.tools.getRevenueSummary(ctx, p.preset);
      case 'explain_revenue': return this.tools.explainRevenueChange(ctx, p.preset, p.comparePreset);
      case 'appointments': return this.tools.getAppointmentMetrics(ctx, p.preset);
      case 'compare_branches': return this.tools.compareBranches(ctx, p.preset);
      case 'customer_growth': return this.tools.getCustomerGrowth(ctx, p.preset);
      case 'technician_performance': return this.tools.getTechnicianPerformance(ctx, p.preset);
      case 'find_record': {
        if (!this.extras.searchRecords) throw withCode(new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Record search is not available here.'), 'SERVICE_UNAVAILABLE');
        return this.extras.searchRecords(ctx, p.question ?? '');
      }
      case 'profit_expenses': {
        if (!this.extras.profitAndExpenses) throw withCode(new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Profit and expenses are not available here.'), 'SERVICE_UNAVAILABLE');
        const rev = await this.tools.getRevenueSummary(ctx, p.preset) as { netSalesCents?: number };
        return this.extras.profitAndExpenses(ctx, p.preset ?? 'today', Number(rev?.netSalesCents ?? 0));
      }
      case 'growth_advice': {
        const soft = async <T>(f: () => Promise<T>) => { try { return await f(); } catch (e) { if (e instanceof AiBusinessForbiddenError) return null; throw e; } };
        const [customers, appointments, revenue] = await Promise.all([soft(() => this.tools.getCustomerGrowth(ctx, p.preset)), soft(() => this.tools.getAppointmentMetrics(ctx, p.preset)), soft(() => this.tools.getRevenueSummary(ctx, p.preset))]);
        return { tips: growthAdvice({ customers: customers as Record<string, any>, appointments: appointments as Record<string, any>, revenue: revenue as Record<string, any> }), basedOn: { customers: !!customers, appointments: !!appointments, revenue: !!revenue } };
      }
    }
  }

  /** Build the model prompt. The structured tool result is embedded as clearly-delimited DATA (not instructions),
   *  so a value inside it cannot act as a directive (§46). Only computed numbers + the user's question are sent. */
  private buildPrompt(question: string, intent: AiBusinessIntent, structured: unknown): string {
    return [
      `User question: ${question || '(none — summarize the data)'}`,
      `Intent: ${intent}`,
      'Structured data (authoritative; explain only from this — do not invent anything beyond it):',
      '<<<DATA',
      JSON.stringify(structured),
      'DATA>>>',
    ].join('\n');
  }

  async ask(ctx0: AiBusinessContext, params0: AskParams): Promise<AskResult> {
    if (!ctx0?.tenantId || !ctx0?.userId) throw new AiBusinessForbiddenError('Not authenticated');
    // A4 (Nov 6 2026): a custom From–To runs every tool on exactly those days
    let ctx = ctx0, params = params0;
    if (params0.from != null || params0.to != null) {
      let range: { from: string; to: string };
      try { range = validRange(params0.from, params0.to); } catch (e) { throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, (e as Error).message), (e as AssistantExtrasError).code === 'DATE_RANGE_MAX_DAYS' ? 'DATE_RANGE_MAX_DAYS' : 'DATE_RANGE_INVALID'); }
      ctx = { ...ctx0, range }; params = { ...params0, preset: 'custom' };
    }
    const out = await this.answer(ctx, params);
    if (this.extras.trust && !out.needsClarification) out.trust = await this.extras.trust(ctx, out.intent, params.preset ?? 'today', out.structured);
    if (this.extras.history) {
      const period = out.needsClarification ? null : params.preset === 'custom' && ctx.range ? ctx.range : this.extras.periodOf ? await this.extras.periodOf(ctx, params.preset ?? 'today') : null;
      out.conversationId = await this.extras.history.record(ctx, { question: params.question ?? null, intent: out.intent, toolUsed: out.toolUsed, preset: params.preset ?? null, period,
        answer: out.answer, answeredBy: out.needsClarification ? 'clarification' : out.intent === 'find_record' ? 'records' : out.answer ? 'ai' : 'numbers_only', language: out.language ?? null,
        headline: headlineOf(out.structured) });
    }
    return out;
  }

  private async answer(ctx: AiBusinessContext, params: AskParams): Promise<AskResult> {

    // 1) Resolve a bounded intent. Explicit (button) wins; else keyword-match the free-text question.
    let intent: AiBusinessIntent | null = null;
    if (params.intent != null) {
      if (!isIntent(params.intent)) throw new AiBusinessError(AiBusinessErrorCode.METRIC_NOT_FOUND, 'Unknown assistant intent');
      intent = params.intent;
    } else if (params.question) {
      intent = resolveIntent(params.question);
    }

    // 2) Ambiguous → ask for clarification. No tool call, no model call, no charge.
    if (!intent) {
      return { ok: true, needsClarification: true, intent: null, toolUsed: null, answer: null, structured: null, access: null, suggestions: SUGGESTIONS };
    }

    if (params.preset === 'custom' && (intent === 'explain_revenue')) throw withCode(new AiBusinessError(AiBusinessErrorCode.INVALID_DATE_RANGE, 'Explaining a change needs a named period (this week, this month …) to compare with the one before.'), 'DATE_RANGE_UNSUPPORTED');
    // 3) Run the single authorized tool (server-derived ctx). Permission errors propagate to a 403.
    const structured = await this.runTool(intent, ctx, params);

    // A4: record search is answered from the salon's records only — names and phones are never sent to the model
    if (intent === 'find_record') {
      const r = structured as { customers?: unknown[]; tickets?: unknown[] };
      return { ok: true, needsClarification: false, intent, toolUsed: TOOL_FOR[intent], answer: null, structured, access: null,
        records: { customers: r?.customers?.length ?? 0, tickets: r?.tickets?.length ?? 0 } };
    }

    // 4) Hand the structured result to the shared, access-gated model path.
    const prompt = this.buildPrompt(params.question ?? '', intent, structured);
    // §120: the owner / manager reads the answer in their POS language
    const resp = await this.assistant.run({ tenantId: ctx.tenantId, userId: ctx.userId, branchId: (ctx as { branchId?: string | null }).branchId ?? null, packageCode: PACKAGE, action: intent, prompt, responseLanguage: 'user' });

    return {
      ok: resp.ok,
      needsClarification: false,
      intent,
      toolUsed: TOOL_FOR[intent],
      answer: resp.ok ? (resp.text ?? null) : null, // metrics-only when the AI package is unavailable
      structured,
      access: resp.decision,
      usage: resp.usage,
      language: resp.ok ? (resp.language ?? 'en') : undefined,
    };
  }
}
