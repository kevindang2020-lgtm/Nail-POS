// ai-control-plane-service.vitest.spec — Constitution 10 §166, §171–§176, §129 over the service + controllers.
import { describe, it, expect } from 'vitest';
import { AiControlPlaneService, type AiUsageReadPort } from './ai-control-plane.service';
import { SuperAdminAiPlatformController, TenantAiDashboardController } from './ai-control-plane.controller';
import { ProviderCircuitBreakers } from './ai-provider-health';
import { DEFAULT_AI_PERMISSIONS, AI_PERMISSIONS } from './ai-feedback';
import type { UsageRow } from './ai-control-plane';
import type { FeedbackRow } from './ai-feedback';
import { InMemoryAiSettingsStore } from './ai-settings-store';

const row = (over: Partial<UsageRow> = {}): UsageRow => ({ tenantId: 't1', packageCode: 'ai_review_reputation_assistant', action: 'review.response_draft', modelProvider: 'openai', modelName: 'gpt-4o-mini', inputTokens: 100, outputTokens: 50, costMicroUsd: 45, status: 'success', createdAt: new Date().toISOString(), ...over });

const port = (over: Partial<AiUsageReadPort> = {}): AiUsageReadPort => ({
  usageSince: async () => [row(), row({ tenantId: 't2', costMicroUsd: 200 }), row({ status: 'failed', costMicroUsd: 10 })],
  runningJobs: async () => 2, safetyEventCount: async () => 1,
  pendingApprovals: async () => [{ requestId: 'r1', taskKey: 'review.response_draft', riskLevel: 'MEDIUM', createdAt: 'x' }, { requestId: 'r2', taskKey: 'reconciliation.explain_exception', riskLevel: 'HIGH', createdAt: 'x' }],
  budgetFor: async () => ({ limitMicroUsd: 1_000_000, spentMicroUsd: 255_000 }),
  enabledPackages: async () => ['ai_review_reputation_assistant'],
  feedbackFor: async () => [],
  ...over,
});
const svc = (over: Partial<AiUsageReadPort> = {}) => new AiControlPlaneService(port(over), new ProviderCircuitBreakers());
const req = (role: string, extra: Record<string, unknown> = {}) => ({ tenant: { id: 't1' }, user: { id: 'u1', tenantId: 't1', role }, ...extra });

describe('§172–§175 Super Admin pages', () => {
  it('overview aggregates from the usage ledger and live breaker state', async () => {
    const o = await svc().overview();
    expect(o).toMatchObject({ requestsToday: 3, activeTenants: 2, failures: 1, jobsRunning: 2, safetyEvents: 1 });
    expect(o.costTodayMicroUsd).toBe(255);
  });
  it('an empty platform reports nulls rather than flattering numbers', async () => {
    const o = await svc({ usageSince: async () => [], runningJobs: async () => 0, safetyEventCount: async () => 0 }).overview();
    expect(o.successRate).toBeNull(); expect(o.requestsToday).toBe(0);
  });
  it('providers, models and routing all answer', async () => {
    const c = new SuperAdminAiPlatformController(svc());
    expect((await c.providers()).some((p) => p.provider === 'openai')).toBe(true);
    expect((await c.models()).some((m) => m.model === 'gpt-4o-mini')).toBe(true);
    expect((await c.routing()).some((r) => r.taskKey === 'money.explain_alert')).toBe(true);
    expect((await c.tenants('1'))).toHaveLength(1);
  });
  it('§173 no provider panel carries anything credential-shaped', async () => {
    const blob = JSON.stringify(await new SuperAdminAiPlatformController(svc()).providers());
    expect(blob).not.toMatch(/key|secret|token|authorization/i);
  });
});

describe('§166–§169 the tenant dashboard is filtered by the CALLER, not by the client', () => {
  it('an owner sees usage, budget and settings', async () => {
    const d = await new TenantAiDashboardController(svc(), new InMemoryAiSettingsStore()).dashboard(req('OWNER'));
    expect(d.usage).toMatchObject({ requests: 3, failures: 1 });
    expect(d.budget!.usedPercent).toBeCloseTo(25.5);
    expect(d.canManageSettings).toBe(true); expect(d.hidden).toEqual([]);
  });
  it('§168 a technician gets NO usage and NO budget, and the sections are named as hidden', async () => {
    const d = await new TenantAiDashboardController(svc(), new InMemoryAiSettingsStore()).dashboard(req('TECHNICIAN'));
    expect(d.usage).toBeNull(); expect(d.budget).toBeNull();
    expect(d.hidden).toEqual(['usage', 'budget', 'settings']);
  });
  it('approvals are filtered to what the role can grant — a manager sees no reconciliation approval', async () => {
    const d = await new TenantAiDashboardController(svc(), new InMemoryAiSettingsStore()).dashboard(req('MANAGER'));
    expect(d.pendingApprovals.map((a) => a.requestId)).toEqual(['r1']);
  });
  it('an unknown role falls back to the LEAST privileged default, not the most', async () => {
    const d = await new TenantAiDashboardController(svc(), new InMemoryAiSettingsStore()).dashboard(req('SOMETHING_NEW'));
    expect(d.canManageSettings).toBe(false); expect(d.usage).toBeNull();
  });
  it('no tenant on the request → 401, never a cross-tenant read', () => {
    // The guard throws SYNCHRONOUSLY, before any promise is created — which is the behaviour we want (nothing
    // is queried) and the reason this is not an `await expect(...).rejects`.
    expect(() => new TenantAiDashboardController(svc(), new InMemoryAiSettingsStore()).dashboard({ user: { role: 'OWNER' } })).toThrow(/unauthenticated/);
  });
});

describe('§129 feedback endpoint', () => {
  const c = () => new TenantAiDashboardController(svc({ feedbackFor: async () => ([{ tenantId: 't1', requestId: 'r1', taskKey: 'review.response_draft', promptKey: 'review.response_draft', promptVersion: 1, outcome: 'edited', retainedRatio: 0.5, createdAt: 'x' }] as FeedbackRow[]) }), new InMemoryAiSettingsStore());
  const body = { requestId: 'r9', taskKey: 'review.response_draft', promptKey: 'review.response_draft', promptVersion: 1, outcome: 'edited', retainedRatio: 0.7, reasonCode: 'too_long' };

  it('reading the summary needs usage-read; a technician is refused before any query runs', async () => {
    expect(() => c().feedback(req('TECHNICIAN'))).toThrow();          // permission is checked synchronously
    try { c().feedback(req('TECHNICIAN')); } catch (e: any) { expect(e.status).toBe(403); expect(e.getResponse().need).toBe(AI_PERMISSIONS.USAGE_READ); }
    await expect(c().feedback(req('OWNER'))).resolves.toMatchObject({ total: 1, correctionRate: 1 });
  });
  it('anyone who may use AI may report on it — a technician CAN submit, a customer cannot', async () => {
    await expect(c().submitFeedback(req('TECHNICIAN'), body)).resolves.toMatchObject({ ok: true });
    expect(() => c().submitFeedback(req('CUSTOMER'), body)).toThrow();
    try { c().submitFeedback(req('CUSTOMER'), body); } catch (e: any) { expect(e.status).toBe(403); }
  });
  it('§135 tenantId comes from the SESSION — a body that claims another tenant is overruled', async () => {
    const r = await c().submitFeedback(req('OWNER'), { ...body, tenantId: 'tenant-ELSEWHERE' });
    expect(r.feedback.tenantId).toBe('t1');
  });
  it('§129 a body carrying the draft text is refused 400', async () => {
    await expect(c().submitFeedback(req('OWNER'), { ...body, editedText: 'the customer said…' })).rejects.toMatchObject({ status: 400 });
  });
  it('an incoherent record is refused with a reason', async () => {
    await expect(c().submitFeedback(req('OWNER'), { ...body, retainedRatio: undefined })).rejects.toMatchObject({ status: 400 });
  });
});
