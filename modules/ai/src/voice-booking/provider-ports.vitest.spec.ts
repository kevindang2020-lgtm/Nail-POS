// provider-ports.vitest.spec.ts — the provider seam. Verifies the NotConnected defaults report an honest status with
// a credential-derived reason, and that every provider ACTION throws ProviderNotConnectedError (no fake success, no
// simulated provisioning). This is the guarantee that the "connect account" states can never silently become fake.
import { describe, it, expect } from 'vitest';
import { resolveVoiceProvider, resolveTelephonyProvider, ProviderNotConnectedError } from './provider-ports';

describe('voice provider (Retell) seam', () => {
  it('reports not_connected with a specific reason when creds are absent', () => {
    const p = resolveVoiceProvider({} as any);
    expect(p.status()).toMatchObject({ state: 'not_connected', provider: 'retell' });
    expect(p.status().detail).toMatch(/RETELL_API_KEY/);
  });
  it('returns the live adapter when creds are present, NotConnected otherwise', () => {
    const p = resolveVoiceProvider({} as any);
    expect(p.status().state).toBe('not_connected');
    expect(p.status().detail).toMatch(/RETELL_API_KEY/);
    const live = resolveVoiceProvider({ RETELL_API_KEY: 'sk_test' } as any);
    expect(live.status().state).toBe('connected');
  });
  it('throws on any action instead of faking success', async () => {
    const p = resolveVoiceProvider({} as any);
    await expect(p.createAgent({ name: 'X', language: 'en', greeting: '', behavior: '', knowledge: '', tools: [] })).rejects.toBeInstanceOf(ProviderNotConnectedError);
    await expect(p.registerWebhook('a', 'https://x')).rejects.toBeInstanceOf(ProviderNotConnectedError);
  });
});

describe('telephony provider (Twilio) seam', () => {
  it('reports not_connected with a specific reason when creds are absent', () => {
    const p = resolveTelephonyProvider({} as any);
    expect(p.status()).toMatchObject({ state: 'not_connected', provider: 'twilio' });
    expect(p.status().detail).toMatch(/TWILIO_ACCOUNT_SID/);
  });
  it('throws on any action instead of faking a purchase', async () => {
    const p = resolveTelephonyProvider({} as any);
    await expect(p.searchNumbers({ areaCode: '856' })).rejects.toBeInstanceOf(ProviderNotConnectedError);
    await expect(p.purchaseNumber('+18565550000')).rejects.toBeInstanceOf(ProviderNotConnectedError);
  });
});
