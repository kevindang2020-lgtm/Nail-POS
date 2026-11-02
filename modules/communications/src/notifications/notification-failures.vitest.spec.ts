// notification-failures.vitest — Customer Notifications Complete Build Guide §05 / §08 / §10 / §12: the pure rules.
// The three failure texts of the reference screenshot are reproduced here (with invented numbers / SIDs of the same shape).
import { describe, it, expect } from 'vitest';
import { classifyFailure, sanitizeProviderText, displayState, maskRecipient, detectFromStats, normalizeAlertSettings, DEFAULT_ALERT_SETTINGS, isE164 } from './notification-failures';

const AUTH_TEXT = 'sms_failed:Authentication failed, auth token is not valid for account AC0123456789abcdef0123456789abcdef';
const REGION_TEXT = "sms_failed:Permission to send an SMS has not been enabled for the region indicated by the 'To' number: 7876299624";
const REGION_E164 = "sms_failed:Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +79161234567";

describe('P0 — the six screenshot failures classify by evidence', () => {
  it('auth: wrong / invalid credentials → auth, resend only after the setup is fixed, SID never shown', () => {
    const f = classifyFailure({ status: 'failed', channel: 'sms', toAddress: '+917876299622', failureReason: AUTH_TEXT });
    expect(f).toEqual({ category: 'auth', retry: 'after_fix', action: 'messaging_setup', rootCause: null });
    const shown = sanitizeProviderText(AUTH_TEXT)!;
    expect(shown).not.toMatch(/AC0123456789abcdef/);
    expect(shown).toContain('AC…cdef');
    expect(shown.startsWith('sms_failed')).toBe(false);
  });
  it('"region not enabled" to a national number with no +country code → invalid destination (missing_country_code), never resent', () => {
    const f = classifyFailure({ status: 'failed', channel: 'sms', toAddress: '7876299624', failureReason: REGION_TEXT });
    expect(f).toEqual({ category: 'invalid_destination', retry: 'never', action: 'customer_phone', rootCause: 'missing_country_code' });
    expect(sanitizeProviderText(REGION_TEXT)).not.toMatch(/7876299624/);
  });
  it('the same refusal for a real E.164 number IS a geo permission (account setup), never auto-changed', () => {
    expect(classifyFailure({ status: 'failed', channel: 'sms', toAddress: '+79161234567', failureReason: REGION_E164 })).toMatchObject({ category: 'geo_permission', retry: 'never', action: 'messaging_setup' });
  });
  it('the provider code wins over text: 21211 invalid To, 21610 unsubscribed, 30007 filtered, 20429 rate, 30003 transient', () => {
    const c = (code: string) => classifyFailure({ status: 'failed', channel: 'sms', toAddress: '+15551234567', failureReason: 'provider_undelivered', providerErrorCode: code })!.category;
    expect([c('21211'), c('21610'), c('30007'), c('20429'), c('30003'), c('20003'), c('30034')]).toEqual(['invalid_destination', 'opted_out', 'carrier_filtered', 'rate_limit', 'transient', 'auth', 'registration']);
  });
  it('our own reason words: opted_out / over_limit / not_configured / invalid_destination', () => {
    const c = (w: string) => classifyFailure({ status: 'blocked', channel: 'sms', toAddress: '+15551234567', failureReason: w })!;
    expect(c('opted_out')).toMatchObject({ category: 'opted_out', retry: 'never' });
    expect(c('over_limit')).toMatchObject({ category: 'over_limit', retry: 'after_fix' });
    expect(c('not_configured')).toMatchObject({ category: 'not_configured', retry: 'after_fix', action: 'messaging_setup' });
    expect(c('invalid_destination')).toMatchObject({ category: 'invalid_destination', retry: 'never' });
  });
  it('a network failure is transient (bounded resend allowed); an unexplained one is unknown (investigate, no resend)', () => {
    expect(classifyFailure({ status: 'failed', channel: 'sms', toAddress: '+15551234567', failureReason: 'fetch failed: ETIMEDOUT' })).toMatchObject({ category: 'transient', retry: 'allowed' });
    expect(classifyFailure({ status: 'failed', channel: 'sms', toAddress: '+15551234567', failureReason: 'something odd' })).toMatchObject({ category: 'unknown', retry: 'never', action: 'investigate' });
  });
  it('email: hard bounce never resent; unverified sender → email setup', () => {
    expect(classifyFailure({ status: 'failed', channel: 'email', toAddress: 'a@b.co', failureReason: '550 mailbox unavailable (hard bounce)' })).toMatchObject({ category: 'email_bounce', retry: 'never' });
    expect(classifyFailure({ status: 'failed', channel: 'email', toAddress: 'a@b.co', failureReason: 'The from address does not match a verified Sender Identity' })).toMatchObject({ category: 'email_sender', action: 'email_setup' });
  });
  it('a sent / delivered row has no failure', () => {
    expect(classifyFailure({ status: 'sent', channel: 'sms', toAddress: '+15551234567' })).toBeNull();
    expect(classifyFailure({ status: 'delivered', channel: 'sms', toAddress: '+15551234567' })).toBeNull();
  });
});

describe('sanitizing and masking (§14)', () => {
  it('phones, emails, SIDs and tokens are masked; length is capped', () => {
    const s = sanitizeProviderText('to +1 (555) 123-4567 from MG0123456789abcdef0123456789abcdef by bob@example.com token=abc123 ' + 'x'.repeat(300))!;
    expect(s).not.toMatch(/555\) 123/); expect(s).toContain('•••4567'); expect(s).toContain('MG…cdef'); expect(s).toContain('b•••@example.com'); expect(s).toContain('token=•••');
    expect(s.length).toBeLessThanOrEqual(180);
  });
  it('recipient masks', () => {
    expect(maskRecipient('sms', '+15551234567')).toBe('•••4567');
    expect(maskRecipient('email', 'jane@example.com')).toBe('j•••@example.com');
    expect(isE164('+15551234567')).toBe(true); expect(isE164('7876299624')).toBe(false); expect(isE164('+0123')).toBe(false);
  });
});

describe('display state (§05): sent ≠ delivered; no callback for 24 h = Unknown, never green', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  it('pending under 24 h, unknown after', () => {
    expect(displayState({ status: 'sent', createdAt: '2026-10-30T00:00:00Z' }, now)).toBe('pending');
    expect(displayState({ status: 'sent', createdAt: '2026-10-29T11:59:00Z' }, now)).toBe('unknown');
    expect(displayState({ status: 'delivered', createdAt: '2026-10-01T00:00:00Z' }, now)).toBe('delivered');
    expect(displayState({ status: 'simulated', createdAt: '2026-10-30T00:00:00Z' }, now)).toBe('simulated');
  });
});

describe('alert rules (§12 defaults)', () => {
  it('3 same-family failures in 15 min → one repeated_failures detection; opted_out never alerts', () => {
    const d = detectFromStats({ channel: 'sms', failuresInRepeatWindow: [{ category: 'auth', count: 3, first: 'a', last: 'b' }, { category: 'opted_out', count: 9, first: 'a', last: 'b' }, { category: 'transient', count: 2, first: 'a', last: 'b' }],
      ratioAttempts: 0, ratioTerminalFailures: 0, ratioFirst: null, ratioLast: null }, DEFAULT_ALERT_SETTINGS);
    expect(d.map((x) => [x.rule, x.category, x.severity])).toEqual([['repeated_failures', 'auth', 'critical']]);
  });
  it('ratio: ≥ 5 attempts and > 25% terminal failures', () => {
    const base = { channel: 'sms' as const, failuresInRepeatWindow: [], ratioFirst: 'a', ratioLast: 'b' };
    expect(detectFromStats({ ...base, ratioAttempts: 4, ratioTerminalFailures: 4 }, DEFAULT_ALERT_SETTINGS)).toEqual([]);
    expect(detectFromStats({ ...base, ratioAttempts: 8, ratioTerminalFailures: 2 }, DEFAULT_ALERT_SETTINGS)).toEqual([]);   // exactly 25%: not above
    expect(detectFromStats({ ...base, ratioAttempts: 8, ratioTerminalFailures: 3 }, DEFAULT_ALERT_SETTINGS).map((x) => x.rule)).toEqual(['failure_ratio']);
  });
  it('settings are clamped; disabled turns every rule off', () => {
    const s = normalizeAlertSettings({ repeatedFailures: { count: 1, windowMinutes: 99999 }, enabled: false });
    expect(s.repeatedFailures).toEqual({ count: 2, windowMinutes: 240 }); expect(s.enabled).toBe(false);
    expect(detectFromStats({ channel: 'sms', failuresInRepeatWindow: [{ category: 'auth', count: 50, first: 'a', last: 'b' }], ratioAttempts: 50, ratioTerminalFailures: 50, ratioFirst: 'a', ratioLast: 'b' }, s)).toEqual([]);
  });
});
