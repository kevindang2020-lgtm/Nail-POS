// ai-model-router.vitest.spec — Constitution 10 §12–§16, §77–§80.
import { describe, it, expect } from 'vitest';
import { AI_TASKS, type TaskDefinition } from './ai-task-registry';
import { AI_MODELS, INTEGRATED_PROVIDERS, modelsFor, ROUTABLE_STATUSES } from './ai-model-registry';
import { route, preferredTier, ROUTING_POLICY_VERSION, NoRoutableModelError, HighRiskFailoverRefused, type ProviderHealthView } from './ai-model-router';
import { AI_MODEL_PRICES } from './ai-pricing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const t = (k: string) => AI_TASKS[k] as TaskDefinition;
const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
const down = (...providers: string[]): ProviderHealthView => ({ isOpen: (p) => !providers.includes(p) });

describe('§14–§16 the model registry', () => {
  it('every model has a price row in the EXISTING price table — one cost registry, not two (§96)', () => {
    for (const m of Object.values(AI_MODELS)) expect(AI_MODEL_PRICES[m.key], m.key).toBeDefined();
  });
  it('§16 provider keys are the ADAPTER names — the strings selectRealProvider() actually matches on', () => {
    // A first draft named the third provider 'google' and marked it DISABLED as "having no adapter". GeminiProvider
    // existed the whole time, keyed 'gemini'. This test reads the adapter file so the registry cannot drift from it.
    const adapterSrc = readFileSync(resolve(__dirname, 'ai-providers.ts'), 'utf8');
    for (const p of INTEGRATED_PROVIDERS) if (p !== 'mock') expect(adapterSrc, p).toMatch(new RegExp(`name = '${p}'`));
    for (const m of Object.values(AI_MODELS)) expect(INTEGRATED_PROVIDERS.has(m.provider), `${m.key} → ${m.provider}`).toBe(true);
  });
  it('§15 DISABLED/DEPRECATED/DEGRADED are not routable; only ACTIVE and BETA are', () => {
    expect([...ROUTABLE_STATUSES].sort()).toEqual(['ACTIVE', 'BETA']);
  });
  it('the Mock is excluded unless explicitly included (dev/test)', () => {
    expect(modelsFor('text.generate').some((m) => m.provider === 'mock')).toBe(false);
    expect(modelsFor('text.generate', { includeMock: true }).some((m) => m.provider === 'mock')).toBe(true);
  });
});

describe('§13 do not automatically use the most expensive model', () => {
  it('classification routes to a FAST model; a HIGH-risk explanation routes to a STRONG one', () => {
    expect(preferredTier(t('review.sentiment_analyze'))).toBe('fast');
    expect(preferredTier(t('reconciliation.explain_exception'))).toBe('strong');
    const cheap = route(t('review.sentiment_analyze'), { env: prod });
    const strong = route(t('reconciliation.explain_exception'), { env: prod });
    expect(AI_MODELS[cheap.model].tier).toBe('fast');
    expect(AI_MODELS[strong.model].tier).toBe('strong');
    const price = (k: string) => AI_MODEL_PRICES[k].inPerM + AI_MODEL_PRICES[k].outPerM;
    expect(price(cheap.model)).toBeLessThan(price(strong.model));
  });
  it('within a tier the cheapest capable model wins', () => {
    const d = route(t('review.sentiment_analyze'), { env: prod });
    expect(d.model).toBe('gpt-4o-mini');        // cheapest fast text.classify model with an adapter
  });
  it('a cost-sensitive tenant gets the cheapest model even for a strong-tier task', () => {
    const d = route(t('reconciliation.explain_exception'), { env: prod, tenant: { costSensitive: true } });
    expect(AI_MODELS[d.model].tier).toBe('fast');
    expect(d.reason).toMatch(/cost-sensitive/);
  });
});

describe('§11/§18/§52 the task and the tenant bound the choice; nothing widens it', () => {
  it('the task allow-list is respected: voice.transcribe may only use openai', () => {
    const d = route(t('voice.transcribe'), { env: prod });
    expect(d.provider).toBe('openai'); expect(d.model).toBe('whisper-1');
  });
  it('a tenant block removes a provider; blocking every allowed provider is a 503, not a silent widening', () => {
    const d = route(t('review.sentiment_analyze'), { env: prod, tenant: { blockedProviders: ['openai'] } });
    expect(d.provider).toBe('anthropic');
    expect(() => route(t('voice.transcribe'), { env: prod, tenant: { blockedProviders: ['openai'] } })).toThrow(NoRoutableModelError);
  });
  it('a tenant pin is honoured only when the task allows that model', () => {
    expect(route(t('marketing.content_draft'), { env: prod, tenant: { pinnedModel: 'claude-3-5-sonnet-latest' } }).model).toBe('claude-3-5-sonnet-latest');
    // pinning a model the task does not allow → pin ignored, normal routing
    expect(route(t('voice.transcribe'), { env: prod, tenant: { pinnedModel: 'gpt-4o' } }).model).toBe('whisper-1');
  });
  it('§268: the Mock provider is never chosen in production, even when the TASK explicitly allows it', () => {
    // The first version of this test used a task whose allow-list excluded the mock, so the task filter did the
    // work and removing BOTH production guards still passed. The task must allow it for the guard to be what stops it.
    const mockTask = { ...t('marketing.content_draft'), allowedProviders: ['mock'] };
    expect(() => route(mockTask, { env: prod })).toThrow(NoRoutableModelError);
    expect(() => route({ ...t('marketing.content_draft'), allowedProviders: ['openai', 'anthropic', 'mock'] }, { env: prod, health: down('openai', 'anthropic') })).toThrow(NoRoutableModelError);
    // …but outside production, the mock IS a legitimate fallback for dev/CI
    expect(route(mockTask, { env: { NODE_ENV: 'test' } as never }).provider).toBe('mock');
  });
});

describe('§78 every decision is versioned and explained', () => {
  it('carries routingPolicyVersion and a reason', () => {
    const d = route(t('review.response_draft'), { env: prod });
    expect(d.routingPolicyVersion).toBe(ROUTING_POLICY_VERSION);
    expect(d.reason.length).toBeGreaterThan(10);
    expect(d.alternatives.length).toBeGreaterThan(0);
  });
});

describe('§79/§80 failover', () => {
  it('a LOW/MEDIUM task fails over to a compatible provider and RECORDS it', () => {
    const d = route(t('review.sentiment_analyze'), { env: prod, health: down('openai') });
    expect(d.provider).toBe('anthropic');
    expect(d.fallback).toEqual({ fromProvider: 'openai', fromModel: 'gpt-4o-mini', reason: 'primary provider circuit open' });
  });
  it('call-time exclusion (the provider just failed) is also a recorded failover', () => {
    const d = route(t('review.sentiment_analyze'), { env: prod, excludeProvider: 'openai' });
    expect(d.provider).toBe('anthropic');
    expect(d.fallback?.reason).toBe('primary provider failed at call time');
  });
  it('§80 a HIGH-risk task is NEVER silently moved to another provider — it refuses', () => {
    const task = t('money.explain_alert');
    const normal = route(task, { env: prod });
    expect(() => route(task, { env: prod, health: down(normal.provider) })).toThrow(HighRiskFailoverRefused);
    expect(() => route(task, { env: prod, excludeProvider: normal.provider })).toThrow(HighRiskFailoverRefused);
  });
  it('failover within the SAME provider (model swap) is not a provider failover and needs no record', () => {
    // openai down entirely → whole-provider failover; but if only the primary MODEL is unavailable we have no
    // per-model health yet, so the only observable is provider-level. Documented, not tested further.
    const d = route(t('review.sentiment_analyze'), { env: prod });
    expect(d.fallback).toBeUndefined();
  });
  it('when every allowed provider is down the router says so with a 503, never a fake result (§303)', () => {
    try { route(t('review.sentiment_analyze'), { env: prod, health: down('openai', 'anthropic') }); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(NoRoutableModelError); expect((e as NoRoutableModelError).status).toBe(503); }
  });
});

describe('every registered task can be routed in production right now', () => {
  it('no task is orphaned by the registry (a task whose allowed providers have no model would be a silent 503 on first use)', () => {
    for (const task of Object.values(AI_TASKS)) expect(() => route(task as TaskDefinition, { env: prod }), task.key).not.toThrow();
  });
});
