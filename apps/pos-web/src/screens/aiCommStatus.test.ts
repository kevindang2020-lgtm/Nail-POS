import { describe, it, expect } from 'vitest';
import { entitlementOf, providerOf, readinessOf, aiCommRows, aiCommMetrics } from './aiCommStatus';
import type { PosAiPackage } from '../api/posAiApi';
import type { MessagingReadiness } from '@aipowersalon/api-contracts/tenant';

const pkg = (code: string, o: Partial<PosAiPackage> = {}): PosAiPackage => ({ code, name: code, description: '', usageUnit: 'x', subscription: null, used: 0, remainingUsage: 0, accessible: false, lockReason: 'not_subscribed', lockLabel: null, trialAvailable: true, ...o });
const rd = (account: string, voice: boolean | null, outbound: string) => ({ account: { state: account, lastCheckedAt: '2026-11-09T10:00:00Z' }, voice: { numberVoiceCapable: voice, fixLink: '' }, outbound: { state: outbound } }) as unknown as MessagingReadiness;

describe('AI & Communication — three separate axes', () => {
  it('a cancelled package stays cancelled and not permitted even when the provider is connected', () => {
    const p = pkg('ai_phone_call_assistant', { subscription: { status: 'cancelled', usageLimit: 0 }, lockReason: 'cancelled' });
    const e = entitlementOf(p);
    expect(e).toBe('cancelled');
    expect(providerOf(p.code, rd('connected', true, 'ready_to_attempt'))).toBe('connected');
    expect(readinessOf(p.code, e, rd('connected', true, 'ready_to_attempt'))).toBe('not_permitted');
  });
  it('a trialing row whose trial ended is shown as Trial ended, not Trial', () => {
    expect(entitlementOf(pkg('ai_voice_transcription', { subscription: { status: 'trialing', usageLimit: 0 }, lockReason: 'trial_expired' }))).toBe('trial_expired');
    expect(entitlementOf(pkg('ai_voice_transcription', { subscription: { status: 'trialing', usageLimit: 0 }, accessible: true, lockReason: null }))).toBe('trial');
  });
  it('voice assistants need a voice-capable number; SMS assistants need outbound SMS', () => {
    const r = rd('connected', false, 'ready_to_attempt');
    expect(readinessOf('ai_phone_call_assistant', 'active', r)).toBe('missing_config');
    expect(readinessOf('ai_review_reputation_assistant', 'active', r)).toBe('ready');
    expect(readinessOf('ai_booking_assistant', 'trial', rd('connected', true, 'blocked'))).toBe('blocked');
    expect(readinessOf('ai_reception_copilot', 'active', null)).toBe('ready');
    expect(providerOf('ai_reception_copilot', null)).toBe('not_required');
  });
  it('unknown provider status is unknown, and metrics stay null instead of a guessed 0', () => {
    const rows = aiCommRows([pkg('ai_booking_assistant', { accessible: true, subscription: { status: 'active', usageLimit: 1 }, lockReason: null })], null);
    expect(rows[0].prov).toBe('unknown'); expect(rows[0].ready).toBe('unknown');
    const m = aiCommMetrics(rows, true, null);
    expect(m).toMatchObject({ configured: 1, entitled: 1, verified: null, attention: null, lastCheck: null });
  });
  it('keeps the five assistants in the original order and ignores other packages', () => {
    const codes = ['ai_voice_transcription', 'ai_marketing_assistant', 'ai_booking_assistant', 'ai_reception_copilot', 'ai_phone_call_assistant', 'ai_review_reputation_assistant'];
    expect(aiCommRows(codes.map((c) => pkg(c)), null).map((r) => r.p.code)).toEqual(['ai_booking_assistant', 'ai_phone_call_assistant', 'ai_reception_copilot', 'ai_review_reputation_assistant', 'ai_voice_transcription']);
  });
});
