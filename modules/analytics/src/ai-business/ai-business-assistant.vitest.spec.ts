// ai-business-assistant.vitest.spec.ts — slice 8: the natural-language assistant layer (§19, §26, §46).
import { describe, it, expect } from 'vitest';
import { AiBusinessAssistantService, type BusinessToolset, type AssistantRunner } from './ai-business-assistant.service';
import { resolveIntent, isIntent } from './ai-business-intents';
import { AiBusinessError, AiBusinessErrorCode, AiBusinessForbiddenError, type AiBusinessContext } from './ai-business.dto';

// Toolset fake: records which tool ran + the ctx it saw, returns a tagged structured result.
class FakeToolset implements BusinessToolset {
  calls: { tool: string; tenantId: string; preset?: string }[] = [];
  private rec(tool: string, ctx: AiBusinessContext, preset?: string) { this.calls.push({ tool, tenantId: ctx.tenantId, preset }); return { tool, tenantId: ctx.tenantId }; }
  async getDailyBrief(ctx: AiBusinessContext, preset?: string) { return this.rec('daily', ctx, preset); }
  async getRevenueSummary(ctx: AiBusinessContext, preset?: string) { return this.rec('revenue', ctx, preset); }
  async explainRevenueChange(ctx: AiBusinessContext, preset?: string) { return this.rec('explain', ctx, preset); }
  async getAppointmentMetrics(ctx: AiBusinessContext, preset?: string) { return this.rec('appts', ctx, preset); }
  async compareBranches(ctx: AiBusinessContext, preset?: string) { return this.rec('branches', ctx, preset); }
  async getCustomerGrowth(ctx: AiBusinessContext, preset?: string) { return this.rec('customers', ctx, preset); }
  async getTechnicianPerformance(ctx: AiBusinessContext, preset?: string) { return this.rec('techs', ctx, preset); }
}
// Runner fake: captures the prompt; returns ok text, or a denied decision to simulate an unsubscribed package.
class FakeRunner implements AssistantRunner {
  lastPrompt = '';
  constructor(private mode: 'ok' | 'denied' = 'ok') {}
  async run(req: { tenantId: string; userId: string | null; packageCode: string; action?: string; prompt: string }) {
    this.lastPrompt = req.prompt;
    if (this.mode === 'denied') return { ok: false, decision: { allowed: false, reason: 'not_subscribed', label: 'Not subscribed' } };
    return { ok: true, text: 'Revenue rose 9% driven by more completed appointments.', decision: { allowed: true, reason: 'ok', label: 'OK' }, usage: { provider: 'mock', model: 'm', inputTokens: 10, outputTokens: 8 } };
  }
}
const CTX = (o: Partial<AiBusinessContext> = {}): AiBusinessContext => ({ tenantId: 'tA', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['ai.use', 'pos.reports.view'], ...o });

describe('intent resolution', () => {
  it('maps free-text questions to a single intent', () => {
    expect(resolveIntent('Why is revenue down this week?')).toBe('explain_revenue');
    expect(resolveIntent('Compare my branches this month')).toBe('compare_branches');
    expect(resolveIntent('How did we do today?')).toBe('daily_summary');
    expect(resolveIntent('Are customers coming back?')).toBe('customer_growth');
    expect(resolveIntent('Which technicians are busiest?')).toBe('technician_performance');
    expect(resolveIntent('How many cancellations did we have?')).toBe('appointments');
    expect(resolveIntent('what is our average ticket')).toBe('revenue_summary');
  });
  it('returns null for ambiguous questions', () => {
    expect(resolveIntent('hello there')).toBeNull();
    expect(resolveIntent('')).toBeNull();
  });
  it('validates explicit intents', () => {
    expect(isIntent('revenue_summary')).toBe(true);
    expect(isIntent('launch_rockets')).toBe(false);
  });
});

describe('ask — routing + orchestration', () => {
  it('explicit intent runs exactly that tool and asks the model to explain the structured result', async () => {
    const tools = new FakeToolset(); const runner = new FakeRunner('ok');
    const svc = new AiBusinessAssistantService(tools, runner);
    const r = await svc.ask(CTX(), { intent: 'explain_revenue', preset: 'week', question: 'why down?' });
    expect(r.toolUsed).toBe('explain_revenue_change');
    expect(tools.calls).toEqual([{ tool: 'explain', tenantId: 'tA', preset: 'week' }]);
    expect(r.answer).toMatch(/Revenue rose/);
    expect(r.structured).toBeTruthy();
    expect(r.access?.allowed).toBe(true);
  });

  it('free-text question is keyword-routed', async () => {
    const tools = new FakeToolset();
    const svc = new AiBusinessAssistantService(tools, new FakeRunner('ok'));
    const r = await svc.ask(CTX(), { question: 'compare my branches' });
    expect(r.intent).toBe('compare_branches');
    expect(tools.calls[0].tool).toBe('branches');
  });

  it('embeds the structured data as delimited DATA, not as instructions (injection-safe)', async () => {
    const runner = new FakeRunner('ok');
    await new AiBusinessAssistantService(new FakeToolset(), runner).ask(CTX(), { intent: 'revenue_summary' });
    expect(runner.lastPrompt).toContain('<<<DATA');
    expect(runner.lastPrompt).toContain('DATA>>>');
    expect(runner.lastPrompt).toMatch(/explain only from this/i);
  });

  it('ambiguous question asks for clarification — no tool call, no model call', async () => {
    const tools = new FakeToolset(); const runner = new FakeRunner('ok');
    const r = await new AiBusinessAssistantService(tools, runner).ask(CTX(), { question: 'hi' });
    expect(r.needsClarification).toBe(true);
    expect(r.suggestions?.length).toBeGreaterThan(0);
    expect(tools.calls).toHaveLength(0);
    expect(runner.lastPrompt).toBe('');
  });

  it('unknown explicit intent is rejected', async () => {
    try { await new AiBusinessAssistantService(new FakeToolset(), new FakeRunner()).ask(CTX(), { intent: 'nonsense' }); expect.fail('should throw'); }
    catch (e) { expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND); }
  });
});

describe('ask — honest degradation + safety', () => {
  it('returns the real numbers even when the AI package is unavailable (metrics-only)', async () => {
    const r = await new AiBusinessAssistantService(new FakeToolset(), new FakeRunner('denied')).ask(CTX(), { intent: 'revenue_summary' });
    expect(r.ok).toBe(false);
    expect(r.answer).toBeNull();             // no model explanation
    expect(r.structured).toBeTruthy();       // but the computed data is still returned
    expect(r.access?.reason).toBe('not_subscribed');
  });

  it('passes the trusted tenant id through to the tool (never widened)', async () => {
    const tools = new FakeToolset();
    await new AiBusinessAssistantService(tools, new FakeRunner('ok')).ask(CTX({ tenantId: 'tSecret' }), { intent: 'daily_summary' });
    expect(tools.calls[0].tenantId).toBe('tSecret');
  });

  it('rejects an unauthenticated context', async () => {
    try { await new AiBusinessAssistantService(new FakeToolset(), new FakeRunner()).ask({ tenantId: '', branchId: '', userId: '', role: '', permissions: [] }, { intent: 'daily_summary' }); expect.fail('should throw'); }
    catch (e) { expect(e).toBeInstanceOf(AiBusinessForbiddenError); }
  });
});
