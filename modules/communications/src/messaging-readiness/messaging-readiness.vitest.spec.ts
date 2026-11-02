// messaging-readiness.vitest.spec.ts — the readiness evaluator. Confirms the overall states, per-check logic (E.164,
// KEK length), the rendered webhook URLs, and that the input surface carries no secret values.
import { describe, it, expect } from 'vitest';
import { evaluateMessagingReadiness } from './messaging-readiness-core';

const NONE = { hasAccountSid: false, hasAuthToken: false, fromNumber: null, hasStatusCallbackUrl: false, statusCallbackUrl: null, vaultKekLength: 0, publicApiBaseUrl: null, isvEmailSet: false, primaryProfileSid: null };

describe('evaluateMessagingReadiness', () => {
  it('not_configured when nothing is set, with placeholder webhook URLs', () => {
    const r = evaluateMessagingReadiness(NONE);
    expect(r.overall).toBe('not_configured');
    expect(r.webhooks.inbound).toBe('<public-api>/webhooks/twilio/sms/inbound');
    expect(r.webhooks.status).toBe('<public-api>/webhooks/twilio/sms/status');
  });
  it('partial when some but not all required vars are set', () => {
    const r = evaluateMessagingReadiness({ ...NONE, hasAccountSid: true });
    expect(r.overall).toBe('partial');
  });
  it('ready when the three required vars are set with a valid E.164 from', () => {
    const r = evaluateMessagingReadiness({ ...NONE, hasAccountSid: true, hasAuthToken: true, fromNumber: '+18565551234' });
    expect(r.overall).toBe('ready');
    expect(r.checks.find((c) => c.key === 'from')!.ok).toBe(true);
  });
  it('flags an invalid from number and a too-short KEK', () => {
    const r = evaluateMessagingReadiness({ ...NONE, hasAccountSid: true, hasAuthToken: true, fromNumber: '5551234', vaultKekLength: 10 });
    expect(r.checks.find((c) => c.key === 'from')!.ok).toBe(false);
    expect(r.checks.find((c) => c.key === 'vault_kek')!.ok).toBe(false);
    expect(r.checks.find((c) => c.key === 'vault_kek')!.detail).toMatch(/≥32|too short/i);
  });
  it('accepts a >=32 char KEK (length only, never the value) and renders real webhook URLs from the base', () => {
    const r = evaluateMessagingReadiness({ ...NONE, hasAccountSid: true, hasAuthToken: true, fromNumber: '+18565551234', vaultKekLength: 40, publicApiBaseUrl: 'https://api.aipowersalon.com/' });
    expect(r.checks.find((c) => c.key === 'vault_kek')!.ok).toBe(true);
    expect(r.webhooks.inbound).toBe('https://api.aipowersalon.com/webhooks/twilio/sms/inbound');
    expect(r.webhooks.status).toBe('https://api.aipowersalon.com/webhooks/twilio/sms/status');
  });
  it('validates the ISV Primary Profile SID shape', () => {
    const ok = evaluateMessagingReadiness({ ...NONE, primaryProfileSid: 'BU' + 'a'.repeat(32) });
    const bad = evaluateMessagingReadiness({ ...NONE, primaryProfileSid: 'not-a-sid' });
    expect(ok.checks.find((c) => c.key === 'primary_profile')!.ok).toBe(true);
    expect(bad.checks.find((c) => c.key === 'primary_profile')!.ok).toBe(false);
  });
});
