// AI Usage & Configuration service. Composes the usage overview (12 KPIs + providers, masked) and saves providers.
// SECURITY INVARIANT: an API key is accepted once, immediately encrypted, and only its mask + fingerprint are ever
// returned. No method returns ciphertext or plaintext to a caller.

import type { AiProviderPublic } from '@aipowersalon/api-contracts/platform';
import { buildUsageKpis, validateProviderInput, type ProviderInput } from './ai-usage-config-core';
import { buildUsageAnalytics } from './ai-usage-analytics-core';
import { validateGlobalPromptInput, nextPromptVersion, type GlobalPromptInput } from './ai-global-prompt-core';
import type { ProviderSecrets } from '@aipowersalon/security';
import { maskKey, keyFingerprint } from './ai-key-display';
import type { UsageConfigRepo, ProviderRecord } from './ai-usage-config.repository';

// Public provider view — deliberately omits any key material beyond the mask + fingerprint.
const publicProvider = (p: ProviderRecord): AiProviderPublic => ({   // the wire contract (Constitution 13 §15)
  id: p.id, providerKey: p.providerKey, displayName: p.displayName, status: p.status, defaultModel: p.defaultModel,
  apiKeyMasked: p.apiKeyMasked, apiKeyFingerprint: p.apiKeyFingerprint, hasKey: p.hasKey, lastSyncAt: p.lastSyncAt,
});

export class AiUsageConfigService {
  constructor(private readonly repo: UsageConfigRepo, private readonly sealer?: ProviderSecrets) {}

  async getOverview(scope: { tenantId?: string } = {}) {
    const [agg, providers, prompts, series] = await Promise.all([this.repo.usageAggregate(scope), this.repo.listProviders(), this.repo.listPrompts(), this.repo.usageSeries({ tenantId: scope.tenantId, days: 7 })]);
    return {
      kpis: buildUsageKpis(agg),
      providers: providers.map(publicProvider),
      prompts,
      analytics: buildUsageAnalytics(series),
      security: { kekConfigured: this.sealer?.isConfigured() ?? false, note: 'Secrets are encrypted (AES-256-GCM) and never displayed in full after being saved.' },
    };
  }

  listPrompts() { return this.repo.listPrompts(); }
  async savePrompt(input: GlobalPromptInput & { updatedByUserId?: string | null }): Promise<{ ok: boolean; errors?: string[]; prompt?: import('./ai-usage-config.repository').GlobalPromptRecord }> {
    const { errors } = validateGlobalPromptInput(input);
    if (errors.length) return { ok: false, errors };
    const existing = await this.repo.getPromptByKey(String(input.promptKey));
    const version = existing ? nextPromptVersion(existing.version) : 1;   // editing bumps the version
    const prompt = await this.repo.upsertPrompt({ promptKey: String(input.promptKey), name: String(input.name), body: String(input.body), status: input.status || 'active', version });
    return { ok: true, prompt };
  }

  async saveProvider(input: ProviderInput & { createdByUserId?: string | null }): Promise<{ ok: boolean; errors?: string[]; provider?: ReturnType<typeof publicProvider> }> {
    const existing = input.providerKey ? await this.repo.getProviderByKey(String(input.providerKey)) : null;
    const { errors } = validateProviderInput(input, { requireKey: !existing }); // key required only when creating
    if (errors.length) return { ok: false, errors };

    const write: any = { providerKey: String(input.providerKey), displayName: String(input.displayName), status: input.status || undefined, defaultModel: input.defaultModel ?? null };
    const key = String(input.apiKey ?? '').trim();
    if (key) {
      // Encrypt immediately; store only ciphertext + mask + fingerprint. The plaintext is never persisted or returned.
      if (!this.sealer) throw new Error('AI provider key sealing is not wired (SECRET_SEALERS)');
      write.apiKeyCiphertext = this.sealer.encrypt(key);
      write.apiKeyMasked = maskKey(key);
      write.apiKeyFingerprint = keyFingerprint(key);
    }
    const saved = await this.repo.upsertProvider(write);
    return { ok: true, provider: publicProvider(saved) };
  }

  async setProviderStatus(providerKey: string, status: string): Promise<{ ok: boolean; errors?: string[]; provider?: ReturnType<typeof publicProvider> }> {
    if (!['active', 'inactive', 'error', 'disabled'].includes(status)) return { ok: false, errors: ['Invalid status.'] };
    const p = await this.repo.setStatus(providerKey, status);
    return p ? { ok: true, provider: publicProvider(p) } : { ok: false, errors: ['Provider not found.'] };
  }
}
