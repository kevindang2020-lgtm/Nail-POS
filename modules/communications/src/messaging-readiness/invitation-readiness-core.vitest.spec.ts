// invitation-readiness-core.vitest.spec.ts — does anybody KNOW that invitations do not send?
//
// `smsFromEnv()` and `emailFromEnv()` fall back to a Mock when their env vars are unset. Nothing throws, nothing
// logs, and SMS and email simply do not happen — technician invitations, password resets and customer OTPs
// alike. The only place that fact ever surfaced was inside a single hire, one technician at a time, at the exact
// moment it was too late to matter.
//
// An operator who finds out invitations do not send because a technician phoned to ask why she never got her text
// is not a configuration story. It is a system that knew and did not say.
import { describe, it, expect } from 'vitest';
import { evaluateInvitationDelivery, evaluateMessagingReadiness } from './messaging-readiness-core';

const env = (over: Partial<Parameters<typeof evaluateInvitationDelivery>[0]> = {}) => ({
  hasTwilio: false, hasSendGrid: false, hasNotifierUrl: false, hasAppBaseUrl: false, ...over,
});

describe('can this platform actually deliver an invitation?', () => {
  it('nothing configured → NOT_CONNECTED, and it says what that means in plain English', () => {
    const r = evaluateInvitationDelivery(env());
    expect(r.status).toBe('not_connected');
    expect(r.canSendSms).toBe(false);
    expect(r.canSendEmail).toBe(false);
    expect(r.consequence).toContain('NOTHING WILL BE SENT');
    expect(r.consequence).toContain('by hand');            // the manual link is the only route left
  });

  it('both transports → READY', () => {
    const r = evaluateInvitationDelivery(env({ hasTwilio: true, hasSendGrid: true, hasAppBaseUrl: true }));
    expect(r.status).toBe('ready');
    expect(r.blockers).toEqual([]);
    expect(r.consequence).toBe('Invitations will be sent.');
  });

  it('EMAIL ONLY is the dangerous half-configuration, and it is named as such', () => {
    // A nail technician frequently has a phone and NO email address. A platform with SendGrid and no Twilio can
    // invite the office staff and not a single technician — while every screen says "messaging: configured".
    const r = evaluateInvitationDelivery(env({ hasSendGrid: true, hasAppBaseUrl: true }));
    expect(r.status).toBe('partial');
    expect(r.canSendSms).toBe(false);
    expect(r.consequence).toContain('cannot be invited at all');
    expect(r.blockers.join(' ')).toContain('TWILIO_FROM');
    expect(r.blockers.join(' ')).toContain('phone and no email');
  });

  it('SMS only is partial too — and says which people it fails for', () => {
    const r = evaluateInvitationDelivery(env({ hasTwilio: true, hasAppBaseUrl: true }));
    expect(r.status).toBe('partial');
    expect(r.canSendEmail).toBe(false);
    expect(r.consequence).toContain('cannot be invited at all');
  });

  it('the generic notifier webhook counts as a route for BOTH channels', () => {
    const r = evaluateInvitationDelivery(env({ hasNotifierUrl: true, hasAppBaseUrl: true }));
    expect(r.status).toBe('ready');
    expect(r.hasNotifierFallback).toBe(true);
  });

  it('a missing APP_BASE_URL is a blocker even when the transports work', () => {
    // The link is built from a guessed host. A link to a host provisioned in no DNS config fails silently, and
    // only the person clicking it ever finds out — which is exactly how this codebase lost invitations before.
    const r = evaluateInvitationDelivery(env({ hasTwilio: true, hasSendGrid: true, hasAppBaseUrl: false }));
    expect(r.status).toBe('ready');                        // it will send…
    expect(r.hasAcceptUrl).toBe(false);                    // …to a link nobody can be sure resolves
    expect(r.blockers.join(' ')).toContain('APP_BASE_URL');
    expect(r.blockers.join(' ')).toContain('silently');
  });
});

describe('the readiness report FAILS CLOSED', () => {
  it('a caller that supplies no delivery config is told NOT_CONNECTED — never "ready"', () => {
    // A readiness surface whose default answer is "you're fine" is the one thing it must never be.
    const report = evaluateMessagingReadiness({
      hasAccountSid: true, hasAuthToken: true, fromNumber: '+15551234567',
      hasStatusCallbackUrl: false, statusCallbackUrl: null, vaultKekLength: 0,
      publicApiBaseUrl: null, isvEmailSet: false, primaryProfileSid: null,
      // invitations deliberately omitted
    });
    expect(report.invitations.status).toBe('not_connected');
    expect(report.invitations.canSendSms).toBe(false);
  });

  it('and it rides along on the surface an operator already looks at', () => {
    const report = evaluateMessagingReadiness({
      hasAccountSid: true, hasAuthToken: true, fromNumber: '+15551234567',
      hasStatusCallbackUrl: false, statusCallbackUrl: null, vaultKekLength: 0,
      publicApiBaseUrl: null, isvEmailSet: false, primaryProfileSid: null,
      invitations: { hasTwilio: true, hasSendGrid: false, hasNotifierUrl: false, hasAppBaseUrl: true },
    });
    expect(report.overall).toBe('ready');                   // Twilio itself is fine…
    expect(report.invitations.status).toBe('partial');      // …and invitations still are not
    expect(report.invitations.consequence).toContain('cannot be invited at all');
  });
});
