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

export interface AskParams { question?: string; intent?: string; preset?: string; comparePreset?: string }

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
}

const PACKAGE = 'ai_business_assistant';
const SUGGESTIONS = [
  'Summarize today', 'Why did revenue change?', 'Compare my branches this month',
  'Show appointment trends', 'Review customer growth', 'Review technician performance',
];
const TOOL_FOR: Record<AiBusinessIntent, string> = {
  daily_summary: 'get_daily_operations_summary', revenue_summary: 'get_revenue_summary',
  explain_revenue: 'explain_revenue_change', appointments: 'get_appointment_metrics',
  compare_branches: 'compare_branches', customer_growth: 'get_customer_growth',
  technician_performance: 'get_technician_performance',
};

export class AiBusinessAssistantService {
  constructor(private readonly tools: BusinessToolset, private readonly assistant: AssistantRunner) {}

  private async runTool(intent: AiBusinessIntent, ctx: AiBusinessContext, p: AskParams): Promise<unknown> {
    switch (intent) {
      case 'daily_summary': return this.tools.getDailyBrief(ctx, p.preset);
      case 'revenue_summary': return this.tools.getRevenueSummary(ctx, p.preset);
      case 'explain_revenue': return this.tools.explainRevenueChange(ctx, p.preset, p.comparePreset);
      case 'appointments': return this.tools.getAppointmentMetrics(ctx, p.preset);
      case 'compare_branches': return this.tools.compareBranches(ctx, p.preset);
      case 'customer_growth': return this.tools.getCustomerGrowth(ctx, p.preset);
      case 'technician_performance': return this.tools.getTechnicianPerformance(ctx, p.preset);
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

  async ask(ctx: AiBusinessContext, params: AskParams): Promise<AskResult> {
    if (!ctx?.tenantId || !ctx?.userId) throw new AiBusinessForbiddenError('Not authenticated');

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

    // 3) Run the single authorized tool (server-derived ctx). Permission errors propagate to a 403.
    const structured = await this.runTool(intent, ctx, params);

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
