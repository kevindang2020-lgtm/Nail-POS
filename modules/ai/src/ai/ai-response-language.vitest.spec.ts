// ai-response-language.vitest.spec — Vietnamese POS mandate §120: the reader's POS language reaches the prompt.
// A mock provider records the SYSTEM block it was sent: a Vietnamese request asks the model for Vietnamese, an English one
// renders exactly the prompt it rendered before; the language is in the result and in the idempotency (cache) key.
import { describe, it, expect, vi as vitest } from 'vitest';
import { AiPlatform, type AIRequest, type AiPlatformDeps } from './ai-platform';
import { assembleSnapshot } from './ai-access.kysely.repository';
import { InMemoryPromptStore, PROMPT_SEED, render, selectVersion } from './ai-prompt-registry';
import { ProviderCircuitBreakers } from './ai-provider-health';
import type { AiProvider } from './ai-gateway';
import { AiAssistantService } from './ai-assistant.service';
import { AiGatewayService } from './ai-gateway';
import { RESPONSE_LANGUAGE_DIRECTIVE, fixedResponseLanguage, promptTakesLanguage, withLanguageDirective, KyselyResponseLanguageResolver } from './ai-response-language';
import { moneyExplainAdapter, queueExplainAdapter } from './ai-platform.adapters';
import { platformExplainAdapter, explanationFacts } from '../ai-scheduling-optimizer/ai-scheduling-explanation';

const allowed = () => assembleSnapshot({ tenantStatus: 'active', role: 'OWNER', used: 1, subscription: { status: 'active', trial_ends_at: null, usage_limit: 100, overage_enabled: false } });

/** One recording provider answers every (provider, model) the router picks. */
function recording(reply: string) {
  const calls: Array<{ system: string; prompt: string }> = [];
  const p: AiProvider = { name: 'openai', model: 'gpt-4o-mini', async complete(req) { calls.push({ system: req.system, prompt: req.prompt }); return { text: reply, inputTokens: 10, outputTokens: 5, provider: 'openai', model: 'gpt-4o-mini' }; } };
  return { calls, p };
}
function platformWith(reply: string, over: Partial<AiPlatformDeps> = {}) {
  const rec = recording(reply);
  const deps: AiPlatformDeps = {
    accessRepo: { loadSnapshot: async () => allowed() },
    usage: { log: async () => undefined },
    prompts: new InMemoryPromptStore(),
    providers: () => rec.p,
    breakers: new ProviderCircuitBreakers(),
    env: { NODE_ENV: 'production' } as never,
    ...over,
  };
  return { platform: new AiPlatform(deps), calls: rec.calls };
}
const SCHED_REPLY = '{"explanation":"Dời lịch hẹn sang 15:00 để thợ Lan rảnh.","benefit":"Giảm 20 phút chờ","tradeoff":null}';
const MONEY_REPLY = '{"explanation":"Ba lần hoàn tiền trong một giờ.","first_check":"Xem lại các phiếu hoàn tiền"}';
const QUEUE_REPLY = '{"explanation":"Thợ này rảnh sớm nhất.","key_factor":"thời gian chờ"}';
const sched = (over: Partial<AIRequest> = {}): AIRequest => ({ taskKey: 'schedule.explain_suggestion', tenantId: 't1', userId: 'u1', variables: { suggestion_json: { type: 'move_appointment' } }, ...over });
const seed = (k: string) => PROMPT_SEED.filter((p) => p.promptKey === k && p.status === 'ACTIVE')[0];

describe('§120 the response language in the prompt', () => {
  it('a Vietnamese request asks the model for Vietnamese (the SYSTEM block carries the Vietnamese line) and the result says vi', async () => {
    const { platform, calls } = platformWith(SCHED_REPLY);
    const r = await platform.execute(sched({ responseLanguage: 'vi' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
    expect(calls[0].system).toMatch(/Vietnamese \(Tiếng Việt\)/);
    expect(r.language).toBe('vi');
  });

  it('an English request renders EXACTLY the prompt it rendered before (no language line) and the result says en', async () => {
    const { platform, calls } = platformWith(SCHED_REPLY);
    const r = await platform.execute(sched({ responseLanguage: 'en' }));
    const before = render(seed('schedule.explain_suggestion'), { suggestion_json: { type: 'move_appointment' } });
    expect(calls[0].system).toBe(before.system);
    expect(calls[0].prompt).toBe(before.prompt);
    expect(calls[0].system).not.toMatch(/Vietnamese|Tiếng Việt/);
    expect(r.language).toBe('en');
  });

  it('left out, the language is the reader\'s (resolver: the user\'s POS language, else the salon default); no resolver → English', async () => {
    const vi = platformWith(SCHED_REPLY, { responseLanguage: fixedResponseLanguage('vi') });
    expect((await vi.platform.execute(sched())).language).toBe('vi');
    expect(vi.calls[0].system).toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
    const none = platformWith(SCHED_REPLY);
    expect((await none.platform.execute(sched())).language).toBe('en');
    expect(none.calls[0].system).not.toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
    // the resolver is asked about the request's own tenant, user and branch
    const seen: unknown[] = [];
    const spy = platformWith(SCHED_REPLY, { responseLanguage: { forUser: async (q) => { seen.push(q); return 'vi'; } } });
    await spy.platform.execute(sched({ branchId: 'b1' }));
    expect(seen).toEqual([{ tenantId: 't1', userId: 'u1', branchId: 'b1' }]);
  });

  it('an explicit language wins over the reader\'s', async () => {
    const { platform, calls } = platformWith(SCHED_REPLY, { responseLanguage: fixedResponseLanguage('vi') });
    expect((await platform.execute(sched({ responseLanguage: 'en' }))).language).toBe('en');
    expect(calls[0].system).not.toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
  });

  it('prompts that answer in English (OCR, reconciliation) or in the customer\'s language (match_input) never get a language line', async () => {
    expect(promptTakesLanguage(seed('reconciliation.explain_exception'))).toBe(false);
    expect(promptTakesLanguage(seed('ocr.receipt_extract'))).toBe(false);
    expect(promptTakesLanguage(seed('receptionist.reply_draft'))).toBe(false);
    expect(promptTakesLanguage(seed('review.response_draft'))).toBe(false);
    // marketing takes its own `language` variable — the module decides, not the reader
    expect(promptTakesLanguage(seed('marketing.content_draft'))).toBe(false);
    const { platform, calls } = platformWith('{"likely_causes":[{"cause":"x","check":"y"}],"summary":"s"}', { responseLanguage: fixedResponseLanguage('vi') });
    const r = await platform.execute({ taskKey: 'reconciliation.explain_exception', tenantId: 't1', userId: 'u1', variables: { exception_json: { a: 1 } } });
    expect(calls[0].system).not.toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
    expect(r.language).toBe('en');
  });

  it('the POS-visible explanations all take a language: scheduling, Money Protection, the AI queue (v2), forecasts, business narration, upsell', async () => {
    for (const k of ['schedule.explain_suggestion', 'money.explain_alert', 'queue.explain_recommendation', 'forecast.explain', 'business.report_narrate', 'checkout.upsell_suggest']) {
      expect(promptTakesLanguage(await selectVersion(new InMemoryPromptStore(), k, 't1')), k).toBe(true);
    }
    // the AI queue's v1 (English only) is kept as the record of what ran before
    expect(PROMPT_SEED.find((p) => p.promptKey === 'queue.explain_recommendation' && p.version === 1)?.status).toBe('DEPRECATED');
  });

  it('the idempotency (cache) key includes the language: an English answer is never served to a Vietnamese request', async () => {
    const store = new Map<string, any>();
    const idempotency = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, r: any) => { store.set(k, r); } };
    const { platform, calls } = platformWith(SCHED_REPLY, { idempotency });
    const en = await platform.execute(sched({ responseLanguage: 'en', idempotencyKey: 'rec-1' }));
    const enAgain = await platform.execute(sched({ responseLanguage: 'en', idempotencyKey: 'rec-1' }));
    expect(enAgain.requestId).toBe(en.requestId);           // served from the store
    expect(calls).toHaveLength(1);
    const vi = await platform.execute(sched({ responseLanguage: 'vi', idempotencyKey: 'rec-1' }));
    expect(calls).toHaveLength(2);                           // a fresh call, in Vietnamese
    expect(vi.language).toBe('vi');
    expect([...store.keys()].sort()).toEqual(['t1:schedule.explain_suggestion:en:rec-1', 't1:schedule.explain_suggestion:vi:rec-1']);
  });

  it('withLanguageDirective: English adds nothing; Vietnamese appends one static line', () => {
    expect(withLanguageDirective('SYS', 'en')).toBe('SYS');
    expect(withLanguageDirective('SYS', 'vi')).toBe(`SYS\n\n${RESPONSE_LANGUAGE_DIRECTIVE.vi}`);
    expect(RESPONSE_LANGUAGE_DIRECTIVE.vi).not.toMatch(/\{\{/);   // §27: static instructions
  });
});

describe('§120 the adapters carry the language to the screens', () => {
  it('Money Protection and the AI queue return the language the platform asked for', async () => {
    const m = platformWith(MONEY_REPLY, { responseLanguage: fixedResponseLanguage('vi') });
    expect(await moneyExplainAdapter(m.platform).explain({ tenantId: 't1', userId: 'u1', alertJson: { n: 3 } })).toEqual({ explanation: 'Ba lần hoàn tiền trong một giờ.', firstCheck: 'Xem lại các phiếu hoàn tiền', language: 'vi' });
    expect(m.calls[0].system).toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
    const q = platformWith(QUEUE_REPLY, { responseLanguage: fixedResponseLanguage('vi') });
    expect((await queueExplainAdapter(q.platform).explain({ tenantId: 't1', userId: 'u1', recommendation: { f: 1 } }))?.language).toBe('vi');
    expect(q.calls[0].system).toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
  });
  it('scheduling: Vietnamese prose is joined with Vietnamese labels; English keeps "Benefit:"', async () => {
    const rec: any = { type: 'move_appointment', currentState: null, proposedState: null, expectedBenefit: [], possibleDownside: [], confidence: 0.8, dataQuality: 'good', simulation: null, requiresCustomerApproval: false };
    const vi = platformWith(SCHED_REPLY, { responseLanguage: fixedResponseLanguage('vi') });
    const r = await platformExplainAdapter(vi.platform).explain({ tenantId: 't1', branchId: null, userId: 'u1', facts: explanationFacts(rec) });
    expect(r).toMatchObject({ language: 'vi', text: 'Dời lịch hẹn sang 15:00 để thợ Lan rảnh. Lợi ích: Giảm 20 phút chờ.' });
    const en = platformWith('{"explanation":"Move it to 3 PM.","benefit":"20 minutes less waiting","tradeoff":null}');
    expect(await platformExplainAdapter(en.platform).explain({ tenantId: 't1', branchId: null, userId: 'u1', facts: explanationFacts(rec) })).toMatchObject({ language: 'en', text: 'Move it to 3 PM. Benefit: 20 minutes less waiting.' });
  });
});

describe('§120 AiAssistantService (copilot chat, AI business answers)', () => {
  const access = { loadSnapshot: async () => allowed() };
  const gw = () => { const sent: string[] = []; const g = new AiGatewayService({ name: 'openai', model: 'gpt-4o-mini', async complete(req) { sent.push(req.system); return { text: 'ok', inputTokens: 1, outputTokens: 1, provider: 'openai', model: 'gpt-4o-mini' }; } } as AiProvider); return { g, sent }; };
  it("'user' → the reader's POS language; the system prompt asks for Vietnamese and the answer says vi", async () => {
    const { g, sent } = gw();
    const svc = new AiAssistantService(access, g, { log: async () => undefined }, undefined, fixedResponseLanguage('vi'));
    const r = await svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_reception_copilot', prompt: 'Ai rảnh lúc 3 giờ?', responseLanguage: 'user' });
    expect(r.language).toBe('vi');
    expect(sent[0]).toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
  });
  it('left out → English, the system prompt unchanged (customer-facing assistants are not switched by the reader)', async () => {
    const { g, sent } = gw();
    const svc = new AiAssistantService(access, g, { log: async () => undefined }, undefined, fixedResponseLanguage('vi'));
    const r = await svc.run({ tenantId: 't1', userId: 'u1', packageCode: 'ai_reception_copilot', prompt: 'hi' });
    expect(r.language).toBe('en');
    expect(sent[0]).not.toContain(RESPONSE_LANGUAGE_DIRECTIVE.vi);
  });
});

describe('check:silent-catch (Oct 27 2026): a failed language lookup is logged, and the AI call still answers in English', () => {
  it('the database being unavailable → English, with a warning naming the failure', async () => {
    const { Logger } = await import('@nestjs/common');
    const logged: string[] = [];
    const spy = vitest.spyOn(Logger.prototype, 'warn').mockImplementation((m: any) => { logged.push(String(m)); });
    try {
      const r = new KyselyResponseLanguageResolver({ getExecutor: () => { throw new Error('db down'); } } as any, () => true);
      expect(await r.forUser({ tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' })).toBe('en');
      expect(logged.some((m) => /response language lookup failed/.test(m) && /db down/.test(m))).toBe(true);
    } finally { spy.mockRestore(); }
  });
});

describe('Vietnamese only in the web POS (Kevin, Nov 9 2026)', () => {
  const ids = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' };
  it('a call that is not from the web POS (Owner / Tech / Customer app, a job) is English and never reads the POS choice', async () => {
    let read = false;
    const db = { getExecutor: () => { read = true; throw new Error('must not be read'); } } as any;
    expect(await new KyselyResponseLanguageResolver(db, () => false).forUser(ids)).toBe('en');
    expect(read).toBe(false);
  });
  it('the request context decides: only X-Client-Type pos counts as the POS', async () => {
    const { isFrontDeskPosRequest } = await import('./ai-response-language');
    expect(isFrontDeskPosRequest({ clientApp: 'pos' })).toBe(true);
    for (const app of ['owner', 'tech', 'customer', 'manager-pay', undefined]) expect(isFrontDeskPosRequest({ clientApp: app as any })).toBe(false);
    expect(isFrontDeskPosRequest(undefined)).toBe(false);
  });
});
