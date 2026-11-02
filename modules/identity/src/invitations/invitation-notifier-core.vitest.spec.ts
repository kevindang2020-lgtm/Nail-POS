// invitation-notifier-core.vitest.spec.ts — the delivery envelope must carry the accept link + recipient and nothing
// secret beyond it, and the status mapping must be unambiguous.
import { describe, it, expect } from 'vitest';
import { buildInvitationDeliveryPayload, deliveryStatusFor } from './invitation-notifier-core';

describe('buildInvitationDeliveryPayload', () => {
  it('carries the recipient, channel, and the raw accept link', () => {
    const p = buildInvitationDeliveryPayload({ email: 'tech@salon.com', channel: 'email', acceptUrl: 'https://app.example.com/accept-invite?token=abc123', tokenPrefix: 'abc123de', role: 'TECHNICIAN', tenantId: 't1', expiresAt: '2026-07-07T00:00:00Z' });
    expect(p).toEqual({ type: 'user_invitation', channel: 'email', to: 'tech@salon.com', acceptUrl: 'https://app.example.com/accept-invite?token=abc123', tokenPrefix: 'abc123de', role: 'TECHNICIAN', tenantId: 't1', expiresAt: '2026-07-07T00:00:00Z' });
  });
  it('nulls absent role/tenant/expiry rather than dropping them', () => {
    const p = buildInvitationDeliveryPayload({ email: 'a@b.com', channel: 'email', acceptUrl: 'https://x/accept-invite?token=t', tokenPrefix: 't', role: null, tenantId: null, expiresAt: null });
    expect(p.role).toBeNull(); expect(p.tenantId).toBeNull(); expect(p.expiresAt).toBeNull();
  });
});

describe('deliveryStatusFor', () => {
  it('maps a 2xx to delivered and anything else to failed', () => {
    expect(deliveryStatusFor(true)).toBe('delivered');
    expect(deliveryStatusFor(false)).toBe('failed');
  });
});
