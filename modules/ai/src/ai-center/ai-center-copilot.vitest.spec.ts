// ai-center-copilot.vitest.spec.ts — the Reception Copilot endpoint delegates to the EXISTING AiAssistantService with
// server-derived tenant scope (never the client), and honestly flags the degraded (mock provider) case.
import { describe, it, expect, vi } from 'vitest';
import { AiCenterController } from './ai-center.controller';

function ctrl(runImpl: any) {
  const assistant = { run: vi.fn(runImpl) };
  const c = new AiCenterController({} as any, assistant as any);
  return { c, assistant };
}
const req = { ctx: { tenantId: 'ten_1', branchId: 'br_1', userId: 'user_1', role: 'RECEPTION', permissions: ['ai.use'] } };

describe('AI Reception Copilot endpoint', () => {
  it('runs the ai_reception_copilot package scoped to the caller\u2019s tenant (server-derived)', async () => {
    const { c, assistant } = ctrl(async () => ({ ok: true, text: 'Next up: Ann for a gel mani at 10:00.', decision: { label: 'ok' }, usage: { provider: 'openai', model: 'gpt', inputTokens: 5, outputTokens: 8 } }));
    const out: any = await c.copilot(req, { prompt: 'who is next?' });
    expect(assistant.run).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', userId: 'user_1', packageCode: 'ai_reception_copilot', prompt: 'who is next?' }));
    expect(out).toMatchObject({ ok: true, degraded: false });
    expect(out.text).toContain('Ann');
  });

  it('flags degraded when the mock provider answered (no real AI configured)', async () => {
    const { c } = ctrl(async () => ({ ok: true, text: '[mock:mock-1] who is next?', decision: { label: 'ok' }, usage: { provider: 'mock', model: 'mock-1', inputTokens: 1, outputTokens: 1 } }));
    const out: any = await c.copilot(req, { prompt: 'who is next?' });
    expect(out.degraded).toBe(true);
  });

  it('passes through an access-denied decision without a provider call', async () => {
    const { c } = ctrl(async () => ({ ok: false, decision: { label: 'Not subscribed', reason: 'unpaid' } }));
    const out: any = await c.copilot(req, { prompt: 'hi' });
    expect(out.ok).toBe(false);
    expect(out.decision).toMatchObject({ reason: 'unpaid' });
  });

  it('never reads tenant from the request body (ignores a spoofed tenantId)', async () => {
    const { c, assistant } = ctrl(async () => ({ ok: true, text: 'ok', decision: { label: 'ok' } }));
    await c.copilot(req, { prompt: 'x', tenantId: 'attacker_tenant' });
    expect(assistant.run).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' })); // server ctx wins
  });
});
