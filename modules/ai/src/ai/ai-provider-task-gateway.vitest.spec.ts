// ai-provider-task-gateway.vitest.spec.ts — §30 (Oct 27 2026): a non-LLM provider (receipt OCR / Textract) passes the same
// platform controls as every AI call — the task registry, entitlement / quota, the safety switches, the shared circuit
// breakers, the task timeout and the usage ledger.
import { describe, it, expect, vi } from 'vitest';
import { AiProviderTaskGateway } from './ai-provider-task-gateway';
import { InMemoryAiUsageLogger } from './ai-gateway';
import { ProviderCircuitBreakers } from './ai-provider-health';

const snap = (usage: { used: number; limit: number; overageEnabled: boolean } = { used: 3, limit: 500, overageEnabled: false }) => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage, hasPermission: true });
const access = (s: Record<string, unknown>) => ({ async loadSnapshot() { return s as any; } });
const req = { taskKey: 'ocr.receipt_extract', tenantId: 't1', userId: 'u1' };

describe('AiProviderTaskGateway', () => {
  it('an undeclared task is refused before anything else (§9)', async () => {
    const g = new AiProviderTaskGateway({ usage: new InMemoryAiUsageLogger() });
    await expect(g.admit({ ...req, taskKey: 'ocr.anything_goes' })).rejects.toThrow();
  });
  it('admits an entitled tenant; the call is ledgered once as ONE scan with the platform cost, on the task\'s package', async () => {
    const usage = new InMemoryAiUsageLogger();
    const g = new AiProviderTaskGateway({ usage, accessRepo: access(snap()) as any });
    const a = await g.admit(req);
    expect(a.packageCode).toBe('ai_ocr_receipt_scanner');
    const r = await g.call({ ...req, provider: 'aws-textract', model: 'textract-analyze-expense' }, a, async () => ({ pages: 2 }), (x) => ({ usageAmount: 1, costMicroUsd: x.pages * 15_000 }));
    expect(r).toEqual({ pages: 2 });
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]).toMatchObject({ tenantId: 't1', packageCode: 'ai_ocr_receipt_scanner', action: 'ocr.receipt_extract', modelProvider: 'aws-textract', status: 'success', usageAmount: 1, costMicroUsd: 30_000, inputTokens: 0, outputTokens: 0 });
  });
  it('quota: a tenant past its limit is refused BEFORE the provider and a blocked_limit row is written', async () => {
    const usage = new InMemoryAiUsageLogger();
    const g = new AiProviderTaskGateway({ usage, accessRepo: access(snap({ used: 500, limit: 500, overageEnabled: false })) as any });
    const e: any = await g.admit(req).catch((x) => x);
    expect(e?.decision?.allowed).toBe(false);
    expect(e.decision.limitExceeded).toBe(true);
    expect(usage.entries.map((x) => x.status)).toEqual(['blocked_limit']);
  });
  it('safety: a task the tenant switched off is refused (AI_TASK_DISABLED); the platform kill switch reader is consulted', async () => {
    let asked = 0;
    const g = new AiProviderTaskGateway({ usage: new InMemoryAiUsageLogger(), platformSafety: async () => { asked++; return { suspendedTasks: ['ocr.receipt_extract'] }; } });
    await expect(g.admit(req)).rejects.toMatchObject({ code: 'AI_TASK_DISABLED', status: 403 });
    expect(asked).toBe(1);
  });
  it('health: repeated provider failures open the shared circuit — the next call is refused without contacting the provider; each failure is ledgered as provider_error', async () => {
    const usage = new InMemoryAiUsageLogger();
    const breakers = new ProviderCircuitBreakers({ failureThreshold: 2, openMs: 60_000, latencySamples: 10 } as any);
    const g = new AiProviderTaskGateway({ usage, breakers });
    const a = await g.admit(req);
    let calls = 0;
    const boom = async () => { calls++; throw new Error('textract 503: unavailable'); };
    for (let i = 0; i < 2; i++) await expect(g.call({ ...req, provider: 'aws-textract' }, a, boom, () => ({ usageAmount: 1, costMicroUsd: 0 }))).rejects.toThrow(/503/);
    await expect(g.call({ ...req, provider: 'aws-textract' }, a, boom, () => ({ usageAmount: 1, costMicroUsd: 0 }))).rejects.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(calls).toBe(2);
    expect(usage.entries.map((x) => x.status)).toEqual(['provider_error', 'provider_error']);
  });
  it('an adapter that did nothing billable (usageOf → null) writes no ledger row', async () => {
    const usage = new InMemoryAiUsageLogger();
    const g = new AiProviderTaskGateway({ usage });
    await g.call({ ...req, provider: 'aws-textract' }, await g.admit(req), async () => ({ unavailable: true }), () => null);
    expect(usage.entries).toHaveLength(0);
  });
});

describe('check:silent-catch (Oct 27 2026): the best-effort steps are logged, never silent — and still never fail the call', () => {
  it('a usage-ledger write failure, a platform safety read failure and an event publish failure are each logged; the call succeeds', async () => {
    const { Logger } = await import('@nestjs/common');
    const logged: string[] = [];
    const spies = [vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: any) => { logged.push(String(m)); }), vi.spyOn(Logger.prototype, 'error').mockImplementation((m: any) => { logged.push(String(m)); })];
    try {
      const g = new AiProviderTaskGateway({ usage: { log: async () => { throw new Error('ledger down'); } } as any, platformSafety: async () => { throw new Error('switchboard down'); }, events: { publish: async () => { throw new Error('bus down'); } } as any });
      const a = await g.admit(req);
      expect(await g.call({ ...req, provider: 'aws-textract' }, a, async () => ({ ok: 1 }), () => ({ usageAmount: 1, costMicroUsd: 1 }))).toEqual({ ok: 1 });
      expect(logged.some((m) => /platform safety state unavailable/.test(m) && /switchboard down/.test(m))).toBe(true);
      expect(logged.some((m) => /usage ledger write failed/.test(m) && /ledger down/.test(m))).toBe(true);
      await (g as any).emit('ai.test_event', {});
      expect(logged.some((m) => /event ai.test_event not published/.test(m))).toBe(true);
    } finally { for (const s of spies) s.mockRestore(); }
  });
});

// N-4 / SD-23: receipt OCR (the non-LLM door) obeys the salon's "turn off all AI" switch too
describe('N-4 the gateway obeys the tenant\'s saved AI settings', () => {
  it('"turn off all AI" refuses the OCR task (AI_TASK_DISABLED) for the call\'s tenant + branch', async () => {
    const asked: Array<[string, string | null]> = [];
    const usage = new InMemoryAiUsageLogger();
    const g = new AiProviderTaskGateway({ usage, tenantSafety: async (t, b) => { asked.push([t, b]); return { killSwitch: true }; } });
    await expect(g.admit({ ...req, branchId: 'b1' })).rejects.toMatchObject({ code: 'AI_TASK_DISABLED', status: 403 });
    expect(asked).toEqual([['t1', 'b1']]);
    expect(usage.entries.map((x) => x.status)).toEqual(['blocked_permission']);
  });
  it('switch off → admitted as before', async () => {
    const g = new AiProviderTaskGateway({ usage: new InMemoryAiUsageLogger(), tenantSafety: async () => ({}) });
    await expect(g.admit(req)).resolves.toMatchObject({ packageCode: 'ai_ocr_receipt_scanner' });
  });
});

