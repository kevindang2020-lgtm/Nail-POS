// booking-verification-policy.vitest.spec.ts
//
// This module exists to stop fake phone numbers, fake appointments and booking abuse. So the tests that matter
// are not "does it say required when it should" — they are the ones that prove the DANGEROUS answers cannot be
// reached:
//
//   • verification is required, the provider is down → the booking is BLOCKED, never quietly let through
//   • the customer changed their phone number       → the old verification does NOT carry over
//   • a tenant cannot switch off a platform requirement
//   • a verification for tenant A never excuses a booking at tenant B (the caller passes tenant-scoped history;
//     there is no code path here that could reach across tenants even if it wanted to)
//
// Each of those, if it went the other way, would silently turn the feature off during exactly the situation it
// was bought for.
import { describe, it, expect } from 'vitest';
import {
  resolveBookingVerificationPolicy, isRemote, POLICY_VERSION,
  type PolicyInput, type BookingChannel,
} from './booking-verification-policy';

const base = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  channel: 'online',
  platform: { emergencyDisabled: false, moduleEnabled: true, requiredForTenant: false, blockedForTenant: false, version: 1 },
  tenant: {
    enabled: true,
    channels: { online: true, customer_app: true, ai_receptionist: true },
    verifyEveryBooking: false,
    reverifyAfterSeconds: 86_400,          // trust a verification for 24h
    reverifyOnGroupBooking: true,
    reverifyOnDeposit: true,
    reverifyOnHighValue: true,
    version: 7,
  },
  branch: null,
  provider: { configured: true, healthy: true, version: 3 },
  history: null,
  risk: null,
  now: 1_000_000_000_000,
  ...over,
});

const decide = (over: Partial<PolicyInput> = {}) => resolveBookingVerificationPolicy(base(over));

describe('the happy path', () => {
  it('requires verification for an enabled remote channel', () => {
    const r = decide();
    expect(r.decision).toBe('required');
    expect(r.mustVerify).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('stamps every version, so a disputed booking can be explained months later', () => {
    expect(decide().versions).toEqual({ policy: POLICY_VERSION, platform: 1, tenant: 7, branch: null, provider: 3 });
  });
});

describe('provider failure must BLOCK, never wave the booking through', () => {
  it('blocks when no tenant Twilio is configured', () => {
    const r = decide({ provider: { configured: false, healthy: false, version: null } });
    expect(r.decision).toBe('provider_not_configured');
    expect(r.blocked).toBe(true);
    // The one thing that must never happen: silently deciding no verification is needed because we cannot do it.
    expect(r.decision).not.toBe('not_required');
    expect(r.mustVerify).toBe(false);      // there is nothing to verify WITH — the booking is refused instead
  });

  it('blocks when Twilio is configured but unhealthy', () => {
    const r = decide({ provider: { configured: true, healthy: false, version: 3 } });
    expect(r.decision).toBe('provider_unavailable');
    expect(r.blocked).toBe(true);
  });

  it('does not leak provider internals to the customer', () => {
    const r = decide({ provider: { configured: false, healthy: false, version: null } });
    expect(r.message).not.toMatch(/twilio|sid|token|credential/i);
  });

  it('a broken provider CANNOT be excused by a recent verification', () => {
    // Trusting history here would mean: the provider is down, so we stop checking — which is the failure mode
    // this whole ordering exists to prevent. Provider is evaluated BEFORE history for exactly this reason.
    const r = decide({
      provider: { configured: false, healthy: false, version: null },
      history: { lastVerifiedAt: 1_000_000_000_000 - 60_000, phoneChanged: false },
    });
    expect(r.decision).toBe('provider_not_configured');
    expect(r.blocked).toBe(true);
  });
});

describe('a changed phone number always re-verifies', () => {
  it('ignores a still-valid recent verification when the phone changed', () => {
    // Otherwise: verify your OWN phone once, then book against anybody's number for 24 hours. That is the exact
    // fraud this module is bought to stop, reintroduced through the trust window.
    const r = decide({ history: { lastVerifiedAt: 1_000_000_000_000 - 60_000, phoneChanged: true } });
    expect(r.decision).toBe('required');
    expect(r.reason).toBe('phone_changed');
  });

  it('accepts a recent verification when the phone did NOT change', () => {
    const r = decide({ history: { lastVerifiedAt: 1_000_000_000_000 - 60_000, phoneChanged: false } });
    expect(r.decision).toBe('recent_verification_accepted');
    expect(r.mustVerify).toBe(false);
  });

  it('re-verifies once the trust window has expired', () => {
    const r = decide({ history: { lastVerifiedAt: 1_000_000_000_000 - 90_000_000, phoneChanged: false } });   // > 24h
    expect(r.decision).toBe('required');
  });

  it('never trusts a verification dated in the FUTURE', () => {
    // A future timestamp is a clock skew or a tampered row. It is not evidence of anything.
    const r = decide({ history: { lastVerifiedAt: 1_000_000_000_000 + 60_000, phoneChanged: false } });
    expect(r.decision).toBe('required');
  });

  it('never trusts history at all when the tenant set the window to 0', () => {
    const r = decide({
      tenant: { ...base().tenant, reverifyAfterSeconds: 0 },
      history: { lastVerifiedAt: 1_000_000_000_000 - 1000, phoneChanged: false },
    });
    expect(r.decision).toBe('required');
  });

  it('verifyEveryBooking overrides any history', () => {
    const r = decide({
      tenant: { ...base().tenant, verifyEveryBooking: true },
      history: { lastVerifiedAt: 1_000_000_000_000 - 1000, phoneChanged: false },
    });
    expect(r.decision).toBe('required');
    expect(r.reason).toBe('tenant_verify_every_booking');
  });
});

describe('platform precedence', () => {
  it('emergency disable beats a tenant that requires verification — and does NOT block bookings', () => {
    // An outage in OUR verification layer must not take every tenant's bookings offline with it.
    const r = decide({
      platform: { ...base().platform, emergencyDisabled: true },
      tenant: { ...base().tenant, verifyEveryBooking: true },
    });
    expect(r.decision).toBe('disabled');
    expect(r.blocked).toBe(false);
    expect(r.mustVerify).toBe(false);
    expect(r.message).toMatch(/platform operations/i);
  });

  it('a tenant CANNOT switch off a platform requirement', () => {
    const r = decide({
      platform: { ...base().platform, requiredForTenant: true },
      tenant: { ...base().tenant, enabled: false, channels: {} },
    });
    expect(r.decision).toBe('required');
  });

  it('Super Admin can block a compromised tenant outright', () => {
    const r = decide({ platform: { ...base().platform, blockedForTenant: true } });
    expect(r.decision).toBe('blocked_by_platform');
    expect(r.blocked).toBe(true);
  });

  it('a platform requirement still does not OTP a walk-in', () => {
    // Forcing a code on a customer standing at the counter is theatre. The policy targets REMOTE abuse.
    const r = decide({ channel: 'walk_in', platform: { ...base().platform, requiredForTenant: true } });
    expect(r.mustVerify).toBe(false);
  });
});

describe('channels', () => {
  it('front-desk and walk-in are not remote and are not verified by default', () => {
    for (const c of ['front_desk', 'walk_in'] as BookingChannel[]) {
      expect(isRemote(c)).toBe(false);
      expect(decide({ channel: c }).mustVerify).toBe(false);
    }
  });

  it('a tenant CAN opt front-desk in explicitly', () => {
    const r = decide({ channel: 'front_desk', tenant: { ...base().tenant, channels: { front_desk: true } } });
    expect(r.decision).toBe('required');
  });

  it('a remote channel the tenant did not enable is not required', () => {
    const r = decide({ channel: 'kiosk' });        // kiosk absent from the tenant's channel map
    expect(r.decision).toBe('not_required');
  });

  it('a branch override beats the tenant', () => {
    const r = decide({
      branch: { enabled: true, channels: { kiosk: true }, version: 2 },
      channel: 'kiosk',
    });
    expect(r.decision).toBe('required');
    expect(r.versions.branch).toBe(2);
  });

  it('a branch can turn the feature OFF where the tenant had it on', () => {
    const r = decide({ branch: { enabled: false, channels: null, version: 2 } });
    expect(r.decision).toBe('disabled');
  });

  it('but a branch cannot switch off a platform requirement', () => {
    const r = decide({
      platform: { ...base().platform, requiredForTenant: true },
      branch: { enabled: false, channels: null, version: 2 },
    });
    expect(r.decision).toBe('required');
  });
});

describe('risk overrides trusted history', () => {
  const recent = { lastVerifiedAt: 1_000_000_000_000 - 1000, phoneChanged: false };

  it('a flagged session re-verifies even with a fresh verification', () => {
    const r = decide({ history: recent, risk: { isGroupBooking: false, requiresDeposit: false, isHighValue: false, highRisk: true } });
    expect(r.decision).toBe('high_risk_reverification_required');
    expect(r.mustVerify).toBe(true);
  });

  it('group / deposit / high-value re-verify when the tenant asked them to', () => {
    for (const k of ['isGroupBooking', 'requiresDeposit', 'isHighValue'] as const) {
      const r = decide({ history: recent, risk: { isGroupBooking: false, requiresDeposit: false, isHighValue: false, highRisk: false, [k]: true } as any });
      expect(r.mustVerify, k).toBe(true);
    }
  });

  it('but they do NOT re-verify when the tenant turned that rule off', () => {
    const r = decide({
      history: recent,
      tenant: { ...base().tenant, reverifyOnGroupBooking: false },
      risk: { isGroupBooking: true, requiresDeposit: false, isHighValue: false, highRisk: false },
    });
    expect(r.decision).toBe('recent_verification_accepted');
  });
});

describe('the invariant that matters most', () => {
  it('NO input combination ever produces "not_required" while the provider is broken AND verification is on', () => {
    // Exhaustive over the flags that could plausibly interact. The failure this guards against is the quiet one:
    // a booking sailing through unverified because the thing that verifies it is down.
    const bools = [true, false];
    let checked = 0;
    for (const verifyEvery of bools)
      for (const phoneChanged of bools)
        for (const hasHistory of bools)
          for (const highRisk of bools)
            for (const configured of bools)
              for (const healthy of bools) {
                const r = decide({
                  tenant: { ...base().tenant, verifyEveryBooking: verifyEvery },
                  provider: { configured, healthy, version: 1 },
                  history: hasHistory ? { lastVerifiedAt: 1_000_000_000_000 - 1000, phoneChanged } : null,
                  risk: { isGroupBooking: false, requiresDeposit: false, isHighValue: false, highRisk },
                });
                checked++;
                const providerBroken = !configured || !healthy;
                if (providerBroken) {
                  // The tenant has the feature ON for this channel, so a broken provider must BLOCK — never
                  // "not_required", and never a silent pass.
                  expect(r.blocked, JSON.stringify({ verifyEvery, phoneChanged, hasHistory, highRisk, configured, healthy })).toBe(true);
                  expect(r.decision).not.toBe('not_required');
                }
              }
    expect(checked).toBe(64);
  });
});

describe('Phase 4: a branch’s own re-verification rules (found by the live proof)', () => {
  const recent = { lastVerifiedAt: 1_000_000_000_000 - 60_000, phoneChanged: false };
  it('"verify every booking" set on the BRANCH applies there, even with a recent proof', () => {
    const r = decide({ history: recent, branch: { enabled: true, channels: null, verifyEveryBooking: true, version: 2 } });
    expect(r.decision).toBe('required');
  });
  it('a branch row that says nothing about re-verification inherits the tenant (recent proof accepted)', () => {
    const r = decide({ history: recent, branch: { enabled: true, channels: null, version: 2 } });
    expect(r.decision).toBe('recent_verification_accepted');
  });
  it('a branch can shorten the trust window to zero', () => {
    const r = decide({ history: recent, branch: { enabled: true, channels: null, reverifyAfterSeconds: 0, version: 2 } });
    expect(r.mustVerify).toBe(true);
  });
});
