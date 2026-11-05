// ai-control-plane.vitest.spec — Constitution 10 §171–§176.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOverview, buildProviderPanels, buildModelPanels, buildRoutingPanels, buildTenantUsage, type UsageRow } from './ai-control-plane';
import { ProviderCircuitBreakers } from './ai-provider-health';
import { AI_TASKS } from './ai-task-registry';
import { AI_MODELS } from './ai-model-registry';

const row = (over: Partial<UsageRow> = {}): UsageRow => ({ tenantId: 't1', packageCode: 'ai_review_reputation_assistant', action: 'review.sentiment_analyze', modelProvider: 'openai', modelName: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50, costMicroUsd: 45, status: 'success', createdAt: '2026-09-20T10:00:00Z', ...over });

describe('§172 overview', () => {
  it('aggregates requests, cost, tenants and failures from the usage ledger', () => {
    const today = [row(), row({ tenantId: 't2', costMicroUsd: 100 }), row({ status: 'failed', costMicroUsd: 20 })];
    const o = buildOverview({ usageToday: today, usageMonth: [...today, row({ costMicroUsd: 500 })], jobsRunning: 3, safetyEvents: 1, breakers: new ProviderCircuitBreakers(), latenciesMs: [100, 200, 300] });
    expect(o).toMatchObject({ requestsToday: 3, costTodayMicroUsd: 165, costMonthMicroUsd: 665, activeTenants: 2, failures: 1, jobsRunning: 3, safetyEvents: 1, averageLatencyMs: 200 });
    expect(o.successRate).toBeCloseTo(2 / 3);
  });
  it('an idle platform reports successRate NULL, not 100% — nothing has been measured', () => {
    const o = buildOverview({ usageToday: [], usageMonth: [], jobsRunning: 0, safetyEvents: 0, breakers: new ProviderCircuitBreakers() });
    expect(o.successRate).toBeNull(); expect(o.averageLatencyMs).toBeNull(); expect(o.requestsToday).toBe(0);
  });
  it('carries live provider health from the breakers', () => {
    const b = new ProviderCircuitBreakers({ failureThreshold: 1, openMs: 1000, latencySamples: 5 });
    b.recordFailure('openai', 'TIMEOUT');
    expect(buildOverview({ usageToday: [], usageMonth: [], jobsRunning: 0, safetyEvents: 0, breakers: b }).providerHealth.openai.status).toBe('UNAVAILABLE');
  });
});

describe('§173 provider dashboard', () => {
  it('reports status, latency, error rate, usage and last incident', () => {
    const b = new ProviderCircuitBreakers({ failureThreshold: 5, openMs: 1000, latencySamples: 5 });
    b.recordSuccess('openai', 120); b.recordFailure('openai', 'TRANSIENT');
    const panels = buildProviderPanels([row(), row({ status: 'failed' }), row({ modelProvider: 'anthropic', modelName: 'claude-3-5-haiku-latest' })], b.snapshot());
    const oa = panels.find((p) => p.provider === 'openai')!;
    expect(oa).toMatchObject({ requests: 2, costMicroUsd: 90, latencyMsP50: 120 });
    expect(oa.errorRate).toBeCloseTo(0.5);
    expect(oa.lastIncidentAt).toMatch(/^\d{4}-/);
    expect(panels.find((p) => p.provider === 'anthropic')!.errorRate).toBe(0);
  });
  it('a provider with no traffic reports errorRate NULL rather than a flattering zero', () => {
    const b = new ProviderCircuitBreakers(); b.recordSuccess('gemini', 90);
    expect(buildProviderPanels([], b.snapshot()).find((p) => p.provider === 'gemini')!.errorRate).toBeNull();
  });
  it('§173 NO CREDENTIALS: the source cannot read a key', () => {
    // Strip comments first: the file QUOTES §173's "No credentials displayed", and a naive grep matched its own
    // documentation. Same trap as the `sk-` pattern that matched the words "ai-task-registry" earlier in this arc.
    const src = readFileSync(resolve(__dirname, 'ai-control-plane.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/API_KEY|apiKey|process\.env|credential|secret|authorization/i);
  });
});

describe('§174 model dashboard', () => {
  it('lists every registered model with its allowed tasks and real prices', () => {
    const panels = buildModelPanels([row(), row()]);
    expect(panels).toHaveLength(Object.keys(AI_MODELS).length);
    const mini = panels.find((p) => p.model === 'gpt-4o-mini')!;
    expect(mini).toMatchObject({ provider: 'openai', requests: 2, costMicroUsd: 90, inPerM: 0.15 });
    expect(mini.allowedTasks).toContain('review.sentiment_analyze');
    expect(mini.allowedTasks).not.toContain('voice.transcribe');     // whisper-only task
  });
  it('§174 quality score is NULL until evaluations exist — an invented score is worse than none', () => {
    for (const p of buildModelPanels([])) expect(p.qualityScore).toBeNull();
  });
  it('a task restricted to one provider shows on that provider\'s models only', () => {
    const panels = buildModelPanels([]);
    expect(panels.find((p) => p.model === 'whisper-1')!.allowedTasks).toEqual(['voice.transcribe']);
    for (const p of panels) if (p.provider !== 'openai') expect(p.allowedTasks).not.toContain('voice.transcribe');
  });
});

describe('§175 routing dashboard', () => {
  it('shows every task with its risk, tier, ceilings and automation maximum — derived, not stored twice', () => {
    const panels = buildRoutingPanels();
    expect(panels).toHaveLength(Object.keys(AI_TASKS).length);
    const money = panels.find((p) => p.taskKey === 'money.explain_alert')!;
    expect(money).toMatchObject({ riskLevel: 'HIGH', preferredTier: 'strong', maxAutomation: 'SUGGEST_ONLY', approval: 'REVIEW_BEFORE_USE', routingPolicyVersion: 'routing.v1' });
    for (const p of panels) { expect(p.allowedProviders.length).toBeGreaterThan(0); expect(p.maxOutputTokens).toBeGreaterThan(0); }
  });
});

describe('Tenant AI Usage', () => {
  it('ranks tenants by cost and names each one\'s busiest task', () => {
    const rows = [row({ tenantId: 'a', costMicroUsd: 10 }), row({ tenantId: 'b', costMicroUsd: 900 }), row({ tenantId: 'b', costMicroUsd: 100, action: 'marketing.content_draft' }), row({ tenantId: 'b', costMicroUsd: 1, action: 'marketing.content_draft', status: 'failed' })];
    const panels = buildTenantUsage(rows);
    expect(panels[0]).toMatchObject({ tenantId: 'b', requests: 3, costMicroUsd: 1001, failures: 1, topTask: 'marketing.content_draft' });
    expect(panels[1]).toMatchObject({ tenantId: 'a', requests: 1, topTask: 'review.sentiment_analyze' });
  });
  it('no usage → no rows, not a row of zeroes', () => { expect(buildTenantUsage([])).toEqual([]); });
});
