// ai-gated-completion.vitest.spec.ts — the gate + meter for modules with their own system prompt.
//
// Why this exists: AiAssistantService.run() gates and meters every model call it makes, but it takes a single
// `prompt` — there is nowhere to put a module's own SYSTEM prompt. So ai-marketing's draft generator could not
// use it and was bound straight to AiGatewayService, which calls the model with **no subscription check and no
// usage row**. A tenant whose $59/mo Marketing package had been cancelled could keep generating drafts,
// indefinitely, for free, and it appeared on no usage screen.
//
// The tests below are almost entirely about what must NOT happen: a model call for a tenant who is not
// entitled to one.
import { describe, it, expect } from 'vitest';
import { GatedAiCompletion, AiAccessDeniedError } from './ai-gated-completion';
import type { AiAccessSnapshot } from './ai-access-gate';

const snap = (over: Partial<AiAccessSnapshot> = {}): AiAccessSnapshot => ({
  tenantStatus: 'active', supportMode: false, packageEnabled: true,
  subscription: { status: 'active', trialEndsAt: null },
  usage: { used: 5, limit: 500, overageEnabled: false },
  hasPermission: true, pastDuePolicy: 'block',
  ...over,
} as AiAccessSnapshot);

function build(s: AiAccessSnapshot, opts: { throws?: boolean } = {}) {
  const logged: any[] = [];
  let modelCalls = 0;
  const repo = { async loadSnapshot() { return s; } };
  const gateway: any = {
    providerName: 'openai', modelName: 'gpt-x',
    async complete() {
      modelCalls++;
      if (opts.throws) throw new Error('provider exploded');
      return { text: 'draft copy', inputTokens: 120, outputTokens: 40, provider: 'openai', model: 'gpt-x' };
    },
  };
  const logger: any = { async log(e: any) { logged.push(e); } };
  const gc = new GatedAiCompletion(repo as any, gateway, logger, 'ai_marketing_assistant');
  return { gc, logged, calls: () => modelCalls };
}

const REQ = { tenantId: 't1', userId: 'u1', system: 'You write marketing copy.', prompt: 'Draft an SMS', action: 'generate_draft' };

describe('GatedAiCompletion — allowed', () => {
  it('runs the model and returns its text', async () => {
    const { gc, calls } = build(snap());
    const r = await gc.complete(REQ);
    expect(r.text).toBe('draft copy');
    expect(calls()).toBe(1);
  });

  it('meters ONE successful call in the unit the CATALOG sells', async () => {
    const { gc, logged } = build(snap());
    await gc.complete(REQ);
    expect(logged).toHaveLength(1);
    expect(logged[0].packageCode).toBe('ai_marketing_assistant');
    expect(logged[0].action).toBe('generate_draft');
    expect(logged[0].status).toBe('success');
    expect(logged[0].usageAmount).toBe(1);
    expect(logged[0].usageUnit).toBe('generations');   // ai-catalog.ts sells this package in `generations`
    expect(logged[0].inputTokens).toBe(120);
  });

  it('carries the module\u2019s own SYSTEM prompt through — the reason this exists at all', async () => {
    let seen: any;
    const repo = { async loadSnapshot() { return snap(); } };
    const gateway: any = { providerName: 'p', modelName: 'm', async complete(req: any) { seen = req; return { text: '', inputTokens: 0, outputTokens: 0, provider: 'p', model: 'm' }; } };
    const gc = new GatedAiCompletion(repo as any, gateway, { async log() {} } as any, 'ai_marketing_assistant');
    await gc.complete(REQ);
    expect(seen.system).toBe('You write marketing copy.');
    expect(seen.prompt).toBe('Draft an SMS');
  });
});

describe('GatedAiCompletion — denied (the whole point)', () => {
  const denials: [string, AiAccessSnapshot][] = [
    ['no subscription', snap({ subscription: null } as any)],
    ['cancelled package', snap({ subscription: { status: 'cancelled', trialEndsAt: null } } as any)],
    ['expired package', snap({ subscription: { status: 'expired', trialEndsAt: null } } as any)],
    ['suspended tenant', snap({ tenantStatus: 'suspended' } as any)],
    ['package disabled by super admin', snap({ packageEnabled: false } as any)],
  ];

  for (const [name, s] of denials) {
    it(`refuses to call the model — ${name}`, async () => {
      const { gc, calls } = build(s);
      await expect(gc.complete(REQ)).rejects.toBeInstanceOf(AiAccessDeniedError);
      expect(calls(), 'the model must NOT have been called').toBe(0);
    });
  }

  it('a tenant at their usage limit is refused, with 429 rather than a flat 403', async () => {
    // Different problem, different remedy: 429 says "buy overage / wait for the period to roll", 403 says "fix
    // your subscription". Collapsing them tells the tenant nothing actionable.
    const { gc, calls } = build(snap({ usage: { used: 500, limit: 500, overageEnabled: false } } as any));
    await expect(gc.complete(REQ)).rejects.toMatchObject({ status: 429 });
    expect(calls()).toBe(0);
  });

  it('an unpaid/cancelled tenant gets 403, not 429', async () => {
    const { gc } = build(snap({ subscription: null } as any));
    await expect(gc.complete(REQ)).rejects.toMatchObject({ status: 403 });
  });

  it('records the blocked attempt but consumes NO allowance', async () => {
    const { gc, logged } = build(snap({ subscription: null } as any));
    await expect(gc.complete(REQ)).rejects.toBeInstanceOf(AiAccessDeniedError);
    expect(logged).toHaveLength(1);
    expect(logged[0].status).toBe('blocked_unpaid');
    expect(logged[0].usageAmount).toBe(0);
  });

  it('over-limit is recorded as blocked_limit, not blocked_unpaid', async () => {
    const { gc, logged } = build(snap({ usage: { used: 500, limit: 500, overageEnabled: false } } as any));
    await expect(gc.complete(REQ)).rejects.toMatchObject({ status: 429 });
    expect(logged[0].status).toBe('blocked_limit');
  });
});

describe('GatedAiCompletion — provider failure', () => {
  it('records the failed call (it may still have been billed) but does not consume the allowance', async () => {
    const { gc, logged } = build(snap(), { throws: true });
    await expect(gc.complete(REQ)).rejects.toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0].status).toBe('provider_error');
    expect(logged[0].usageAmount).toBe(0);      // the tenant got nothing; it must not eat their allowance
  });

  it('a broken usage logger cannot fail a call that already succeeded', async () => {
    const repo = { async loadSnapshot() { return snap(); } };
    const gateway: any = { providerName: 'p', modelName: 'm', async complete() { return { text: 'ok', inputTokens: 1, outputTokens: 1, provider: 'p', model: 'm' }; } };
    const gc = new GatedAiCompletion(repo as any, gateway, { async log() { throw new Error('usage table down'); } } as any, 'ai_marketing_assistant');
    expect((await gc.complete(REQ)).text).toBe('ok');
  });
});
