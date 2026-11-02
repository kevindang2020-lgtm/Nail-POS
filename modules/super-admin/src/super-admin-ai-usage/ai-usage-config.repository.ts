// Repository for AI Usage & Configuration. Providers store only ciphertext + a mask + a fingerprint; the plaintext
// key is never persisted in the clear and never read back out. Usage aggregates come from ai_usage_logs in
// production; the in-memory impl seeds realistic dev fixtures.

import type { UsageAggregate } from './ai-usage-config-core';
import type { UsageSeries } from './ai-usage-analytics-core';

export interface ProviderRecord {
  id: string; providerKey: string; displayName: string; status: string; defaultModel: string | null;
  apiKeyMasked: string | null; apiKeyFingerprint: string | null; hasKey: boolean; lastSyncAt: string | null; updatedAt: string;
}
export interface ProviderWrite { providerKey: string; displayName: string; status?: string; defaultModel?: string | null; apiKeyCiphertext?: string | null; apiKeyMasked?: string | null; apiKeyFingerprint?: string | null }

export interface GlobalPromptRecord { id: string; promptKey: string; name: string; body: string | null; version: number; status: string; updatedAt: string }
export interface GlobalPromptWrite { promptKey: string; name: string; body: string; status?: string; version: number }

export interface UsageConfigRepo {
  usageAggregate(scope: { tenantId?: string }): Promise<UsageAggregate>;
  usageSeries(scope: { tenantId?: string; days?: number }): Promise<UsageSeries>;
  listProviders(): Promise<ProviderRecord[]>;
  getProviderByKey(providerKey: string): Promise<ProviderRecord | null>;
  upsertProvider(w: ProviderWrite): Promise<ProviderRecord>;    // keeps existing key when apiKeyCiphertext omitted
  setStatus(providerKey: string, status: string): Promise<ProviderRecord | null>;
  listPrompts(): Promise<GlobalPromptRecord[]>;
  getPromptByKey(promptKey: string): Promise<GlobalPromptRecord | null>;
  upsertPrompt(w: GlobalPromptWrite): Promise<GlobalPromptRecord>;
}

let PSEQ = 1;
const now = () => new Date().toISOString();

const seedProviders: ProviderRecord[] = [
  prov('openai', 'OpenAI', 'active', 'GPT-4.1', 'sk_live_••••••••9X4K', 'a1b2c3d4e5f6'),
  prov('anthropic', 'Anthropic', 'active', 'Claude 3.5 Sonnet', 'sk_live_••••••••7B2L', 'b2c3d4e5f6a1'),
  prov('google', 'Google', 'active', 'Gemini 2.5 Pro', 'AIz••••••••KBM1', 'c3d4e5f6a1b2'),
  prov('retell', 'Retell', 'active', 'Retell Voice Agent', 'rt_live_••••••••2M9Q', 'd4e5f6a1b2c3'),
];
function prov(providerKey: string, displayName: string, status: string, defaultModel: string, masked: string, fp: string): ProviderRecord {
  return { id: `AIPRV-${String(PSEQ++).padStart(4, '0')}`, providerKey, displayName, status, defaultModel, apiKeyMasked: masked, apiKeyFingerprint: fp, hasKey: true, lastSyncAt: now(), updatedAt: now() };
}

const seedAggregate: UsageAggregate = {
  activeTenants: 87, totalTokens: 2_480_000, totalMinutes: 14_260, receptionistCalls: 18_642, costCents: 1_284_640,
  modelRequests: 248_420, failedRequests: 186, allowanceUsedPct: 78, overageEvents: 37, activeFeatures: 5,
  avgLatencyMs: null, safetyFlags: null, providerHealthPct: null,
};

export class InMemoryUsageConfigRepo implements UsageConfigRepo {
  private providers: ProviderRecord[];
  private prompts: GlobalPromptRecord[] = [
    { id: 'AIPMT-0001', promptKey: 'reminders', name: 'Reminders', body: 'You are a helpful salon reminder assistant.', version: 3, status: 'active', updatedAt: now() },
    { id: 'AIPMT-0002', promptKey: 'smart_reminders', name: 'Smart Reminders', body: 'Craft a concise, friendly reminder.', version: 2, status: 'active', updatedAt: now() },
    { id: 'AIPMT-0003', promptKey: 'reporting_assistant', name: 'Reporting Assistant', body: 'Summarize operational metrics clearly.', version: 1, status: 'active', updatedAt: now() },
    { id: 'AIPMT-0004', promptKey: 'customer_support', name: 'Customer Support', body: 'Answer politely and escalate when unsure.', version: 3, status: 'active', updatedAt: now() },
    { id: 'AIPMT-0005', promptKey: 'insights_engine', name: 'Insights Engine', body: 'Produce recommendations only; never take actions.', version: 1, status: 'active', updatedAt: now() },
  ];
  constructor(seed?: ProviderRecord[]) { this.providers = seed ? [...seed] : seedProviders.map((p) => ({ ...p })); }

  async usageAggregate(): Promise<UsageAggregate> { return { ...seedAggregate }; }
  async usageSeries(): Promise<UsageSeries> {
    return {
      trend: [
        { date: '2026-04-30', tokens: 128000 }, { date: '2026-05-01', tokens: 142000 }, { date: '2026-05-02', tokens: 176000 },
        { date: '2026-05-03', tokens: 158000 }, { date: '2026-05-04', tokens: 189000 }, { date: '2026-05-05', tokens: 201000 }, { date: '2026-05-06', tokens: 186000 },
      ],
      costRequests: [
        { date: '2026-04-30', costCents: 168000, requests: 32000 }, { date: '2026-05-01', costCents: 182000, requests: 34200 },
        { date: '2026-05-02', costCents: 214000, requests: 41000 }, { date: '2026-05-03', costCents: 196000, requests: 38000 },
        { date: '2026-05-04', costCents: 224000, requests: 43200 }, { date: '2026-05-05', costCents: 236000, requests: 45100 }, { date: '2026-05-06', costCents: 184236, requests: 36842 },
      ],
      byProvider: [{ provider: 'openai', requests: 45200 }, { provider: 'anthropic', requests: 24000 }, { provider: 'google', requests: 18600 }, { provider: 'retell', requests: 11400 }],
      byFeature: [{ feature: 'ai_receptionist', requests: 34600 }, { feature: 'ai_insights', requests: 21500 }, { feature: 'ai_reports', requests: 16400 }, { feature: 'smart_reminders', requests: 14200 }, { feature: 'automation_rules', requests: 13300 }],
      tenants: [
        { tenantId: 't1', tenantName: 'VIP Nail Club', tokens: 452100, minutes: 2540, calls: 3420, costCents: 234560, requests: 5000, failed: 12 },
        { tenantId: 't2', tenantName: 'Gel Polish Plus', tokens: 361780, minutes: 1980, calls: 2860, costCents: 187620, requests: 4200, failed: 3 },
        { tenantId: 't3', tenantName: 'Spa Pedicure Club', tokens: 295450, minutes: 1640, calls: 2410, costCents: 154210, requests: 3600, failed: 6 },
        { tenantId: 't4', tenantName: 'Basic Care Plan', tokens: 184220, minutes: 1120, calls: 1560, costCents: 98230, requests: 2400, failed: 9 },
        { tenantId: 't5', tenantName: 'Manicure Express', tokens: 112880, minutes: 620, calls: 950, costCents: 56820, requests: 1500, failed: 2 },
      ],
    };
  }
  async listProviders(): Promise<ProviderRecord[]> { return this.providers.map((p) => ({ ...p })); }
  async getProviderByKey(providerKey: string): Promise<ProviderRecord | null> { return this.providers.find((p) => p.providerKey === providerKey) ?? null; }
  async upsertProvider(w: ProviderWrite): Promise<ProviderRecord> {
    const existing = this.providers.find((p) => p.providerKey === w.providerKey);
    if (existing) {
      existing.displayName = w.displayName; existing.status = w.status || existing.status; existing.defaultModel = w.defaultModel ?? existing.defaultModel;
      if (w.apiKeyCiphertext) { existing.apiKeyMasked = w.apiKeyMasked ?? existing.apiKeyMasked; existing.apiKeyFingerprint = w.apiKeyFingerprint ?? existing.apiKeyFingerprint; existing.hasKey = true; }
      existing.updatedAt = now(); existing.lastSyncAt = now();
      return { ...existing };
    }
    const rec: ProviderRecord = {
      id: `AIPRV-${String(PSEQ++).padStart(4, '0')}`, providerKey: w.providerKey, displayName: w.displayName, status: w.status || 'inactive',
      defaultModel: w.defaultModel ?? null, apiKeyMasked: w.apiKeyMasked ?? null, apiKeyFingerprint: w.apiKeyFingerprint ?? null,
      hasKey: !!w.apiKeyCiphertext, lastSyncAt: now(), updatedAt: now(),
    };
    this.providers.push(rec);
    return { ...rec };
  }
  async setStatus(providerKey: string, status: string): Promise<ProviderRecord | null> {
    const p = this.providers.find((x) => x.providerKey === providerKey);
    if (!p) return null;
    p.status = status; p.updatedAt = now();
    return { ...p };
  }
  async listPrompts(): Promise<GlobalPromptRecord[]> { return this.prompts.map((p) => ({ ...p })); }
  async getPromptByKey(promptKey: string): Promise<GlobalPromptRecord | null> { return this.prompts.find((p) => p.promptKey === promptKey) ?? null; }
  async upsertPrompt(w: GlobalPromptWrite): Promise<GlobalPromptRecord> {
    const existing = this.prompts.find((p) => p.promptKey === w.promptKey);
    if (existing) { existing.name = w.name; existing.body = w.body; existing.status = w.status || existing.status; existing.version = w.version; existing.updatedAt = now(); return { ...existing }; }
    const rec: GlobalPromptRecord = { id: `AIPMT-${String(this.prompts.length + 1).padStart(4, '0')}`, promptKey: w.promptKey, name: w.name, body: w.body, version: w.version, status: w.status || 'active', updatedAt: now() };
    this.prompts.push(rec);
    return { ...rec };
  }
}
