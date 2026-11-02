import { describe, it, expect } from 'vitest';
import { AiUsageConfigService } from './ai-usage-config.service';
import { InMemoryUsageConfigRepo } from './ai-usage-config.repository';

import { testProviderSecrets } from '@aipowersalon/testing';   // real AES-GCM under a fixed test key
const svc = () => new AiUsageConfigService(new InMemoryUsageConfigRepo(), testProviderSecrets);

describe('AiUsageConfigService', () => {
  it('returns the overview with 12 KPIs and masked providers (no key material)', async () => {
    const ov = await svc().getOverview();
    expect(ov.kpis).toHaveLength(12);
    expect(ov.providers.length).toBeGreaterThan(0);
    for (const p of ov.providers) {
      expect(p).not.toHaveProperty('apiKeyCiphertext');
      expect(p).not.toHaveProperty('apiKey');
      if (p.apiKeyMasked) expect(p.apiKeyMasked).toContain('•');
    }
    expect(ov.security.note).toMatch(/never displayed in full/);
  });

  it('saves a provider and NEVER returns the plaintext key — only a mask + fingerprint', async () => {
    const s = svc();
    const secret = 'sk_live_supersecretvalue1234ZZZ';
    const res = await s.saveProvider({ providerKey: 'openai', displayName: 'OpenAI', apiKey: secret });
    expect(res.ok).toBe(true);
    const p = res.provider!;
    expect(JSON.stringify(p)).not.toContain(secret);          // plaintext never surfaced
    expect(JSON.stringify(p)).not.toContain('supersecret');
    expect(p.apiKeyMasked).toContain('•');
    expect(p.apiKeyMasked!.endsWith('ZZZ'.slice(-3)) || p.apiKeyMasked!.endsWith('4ZZZ')).toBe(true);
    expect(p.apiKeyFingerprint).toHaveLength(12);
    expect(p.hasKey).toBe(true);
    // overview also never leaks it
    const ov = await s.getOverview();
    expect(JSON.stringify(ov)).not.toContain(secret);
  });

  it('requires provider + name, and requires a key only when creating', async () => {
    const s = svc();
    expect((await s.saveProvider({ providerKey: '', displayName: '' })).ok).toBe(false);
    // openai already seeded → updating display name without a key is allowed
    expect((await s.saveProvider({ providerKey: 'openai', displayName: 'OpenAI (Primary)' })).ok).toBe(true);
    // brand-new provider without a key → rejected
    expect((await s.saveProvider({ providerKey: 'mistral', displayName: 'Mistral' })).ok).toBe(false);
  });

  it('sets provider status with validation', async () => {
    const s = svc();
    expect((await s.setProviderStatus('openai', 'bogus')).ok).toBe(false);
    expect((await s.setProviderStatus('openai', 'disabled')).ok).toBe(true);
  });

  it('lists global prompts and includes them in the overview', async () => {
    const s = svc();
    expect((await s.listPrompts()).length).toBeGreaterThan(0);
    const ov = await s.getOverview();
    expect(ov.prompts.length).toBeGreaterThan(0);
  });

  it('includes usage analytics (trend, cost/requests, provider + feature mix, tenants) in the overview', async () => {
    const ov = await svc().getOverview();
    expect(ov.analytics.trend.available).toBe(true);
    expect(ov.analytics.trend.points.length).toBe(7);
    expect(ov.analytics.byProvider.segments[0].label).toBe('OpenAI');
    expect(Math.round(ov.analytics.byProvider.segments.reduce((s, x) => s + x.pct, 0))).toBe(100);
    expect(ov.analytics.byFeature.segments[0].label).toBe('AI Receptionist');
    expect(ov.analytics.tenants.length).toBe(5);
  });

  it('saves a prompt, bumping the version on edit', async () => {
    const s = svc();
    const created = await s.savePrompt({ promptKey: 'new_prompt', name: 'New', body: 'Hello' });
    expect(created.ok).toBe(true);
    expect(created.prompt!.version).toBe(1);
    const edited = await s.savePrompt({ promptKey: 'reminders', name: 'Reminders', body: 'Updated body' });
    expect(edited.prompt!.version).toBe(4); // seeded reminders was v3
  });

  it('rejects an invalid prompt', async () => {
    expect((await svc().savePrompt({ promptKey: 'Bad Key', name: '', body: '' })).ok).toBe(false);
  });
});
