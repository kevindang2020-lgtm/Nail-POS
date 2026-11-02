// booking-verification-guard.vitest.spec.ts
//
// ONE guard, three remote channels: the customer app, the public booking page, and the AI receptionist.
//
// The reason it is one guard and not three is the reason booking abuse works at all: attackers probe every
// entrance until one is unlocked. Three channels enforcing verification three different ways is three chances
// to leave one open — and the public booking page, which is UNAUTHENTICATED and open to the internet, is the
// one that would hurt most.
import { describe, it, expect } from 'vitest';
import {
  BookingVerificationGuard,
  BookingPhoneNotVerifiedError,
  BookingVerificationUnavailableError,
  BookingPhoneInvalidError,
  type BookingVerificationConfigPort,
} from './booking-verification-guard';
import { phoneKey, normalizePhone } from '@aipowersalon/customers';
import type { BookingChannel } from './booking-verification-policy';

const NOW = 1_700_000_000_000;
const PHONE = '+15551234567';

function cfg(over: Partial<{
  emergency: boolean; required: boolean; blocked: boolean;
  tenantEnabled: boolean; channels: Partial<Record<BookingChannel, boolean>>;
  verifyEvery: boolean; reverifyAfterSeconds: number;
  configured: boolean; healthy: boolean;
  verifiedAt: number | null; revoked: boolean;
}> = {}): { port: BookingVerificationConfigPort; lookups: string[] } {
  const o = {
    emergency: false, required: false, blocked: false,
    tenantEnabled: true, channels: { online: true, customer_app: true, ai_receptionist: true } as any,
    verifyEvery: false, reverifyAfterSeconds: 86_400,
    configured: true, healthy: true,
    verifiedAt: null as number | null, revoked: false,
    ...over,
  };
  const lookups: string[] = [];
  const port: BookingVerificationConfigPort = {
    async platform() { return { emergencyDisabled: o.emergency, moduleEnabled: true, requiredForTenant: o.required, blockedForTenant: o.blocked, version: 1 }; },
    async tenant() {
      return {
        enabled: o.tenantEnabled, channels: o.channels, verifyEveryBooking: o.verifyEvery,
        reverifyAfterSeconds: o.reverifyAfterSeconds,
        reverifyOnGroupBooking: true, reverifyOnDeposit: true, reverifyOnHighValue: true, version: 1,
      };
    },
    async branch() { return null; },
    async provider() { return { configured: o.configured, healthy: o.healthy, version: 1 }; },
    async lastVerified(_tenantId, phoneHash) {
      lookups.push(phoneHash);
      return o.verifiedAt == null ? null : { verifiedAt: o.verifiedAt, revoked: o.revoked };
    },
  };
  return { port, lookups };
}

const guard = (over = {}) => new BookingVerificationGuard(cfg(over).port);
const ctx = (channel: BookingChannel = 'online') => ({ tenantId: 't1', branchId: 'b1', channel });

describe('every remote channel is gated by the SAME guard', () => {
  for (const channel of ['online', 'customer_app', 'ai_receptionist'] as BookingChannel[]) {
    it(`refuses an unverified booking on: ${channel}`, async () => {
      const g = guard();
      await expect(g.assertMayBook(ctx(channel), { customerPhone: PHONE, now: NOW }))
        .rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
    });

  }
});

// Phase 4 (audit: "session binding — trust keyed only by phone hash, so another session knowing a recently verified
// number can book through the public link"). Who an earlier verification may excuse depends on the channel.
describe('a recent verification excuses only the right requester', () => {
  it('customer app: the account\u2019s own number is trusted for the window', async () => {
    const r = await guard({ verifiedAt: NOW - 60_000 }).assertMayBook(ctx('customer_app'), { customerPhone: PHONE, now: NOW });
    expect(r.decision).toBe('recent_verification_accepted');
  });
  it('public link: a number verified elsewhere is NOT trusted — only from the same device', async () => {
    await expect(guard({ verifiedAt: NOW - 60_000 }).assertMayBook(ctx('online'), { customerPhone: PHONE, now: NOW })).rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
    const c = cfg({ verifiedAt: NOW - 60_000 });
    const devices: string[] = [];
    c.port.lastVerifiedOnDevice = async (_t, _h, device) => { devices.push(device); return device === 'dev-1' ? NOW - 60_000 : null; };
    const g = new BookingVerificationGuard(c.port);
    expect((await g.assertMayBook(ctx('online'), { customerPhone: PHONE, deviceId: 'dev-1', now: NOW })).decision).toBe('recent_verification_accepted');
    await expect(g.assertMayBook(ctx('online'), { customerPhone: PHONE, deviceId: 'dev-2', now: NOW })).rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
    expect(devices).toEqual(['dev-1', 'dev-2']);
  });
  for (const channel of ['ai_receptionist', 'kiosk'] as BookingChannel[]) {
    it(`${channel}: never — caller ID is spoofable and a kiosk is shared`, async () => {
      const c = cfg({ verifiedAt: NOW - 60_000, channels: { online: true, customer_app: true, ai_receptionist: true, kiosk: true } });
      c.port.lastVerifiedOnDevice = async () => NOW - 60_000;
      await expect(new BookingVerificationGuard(c.port).assertMayBook(ctx(channel), { customerPhone: PHONE, deviceId: 'dev-1', now: NOW })).rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
    });
  }
});

describe('the refusal never leaks the number', () => {
  it('carries a MASKED phone, and no long digit run', async () => {
    const g = guard();
    const err = await guard().assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }).catch((e) => e) as BookingPhoneNotVerifiedError;
    // The platform's maskPhone shows only the last four ("••••4567"). What matters is not WHICH character it
    // masks with, but that the number cannot be reconstructed from what we hand back.
    expect(err.maskedPhone).not.toContain('5551234');
    expect(err.maskedPhone).not.toContain(PHONE);
    expect(err.maskedPhone.replace(/\D/g, '')).toHaveLength(4);        // last four only
    expect(JSON.stringify({ m: err.message, p: err.maskedPhone })).not.toMatch(/\d{7,}/);
    expect(g).toBeTruthy();
  });
});

describe('the phone is hashed before it is looked up', () => {
  it('never passes the raw number to the store', async () => {
    // The verification store holds a HASH. A raw E.164 sitting in a lookup — and therefore in a query log, a
    // slow-query trace, an APM span — is the leak this avoids.
    const { port, lookups } = cfg();
    const g = new BookingVerificationGuard(port);
    await g.assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }).catch(() => {});
    expect(lookups.length).toBeGreaterThan(0);
    for (const l of lookups) {
      expect(l).not.toBe(PHONE);
      expect(l).toBe(phoneKey(normalizePhone(PHONE)!));
    }
  });
});

describe('an unparseable number cannot opt out of verification', () => {
  it('refuses rubbish rather than skipping the check', async () => {
    // If an unparseable number simply skipped verification, an attacker would opt out by typing rubbish — and
    // the fake bookings this module exists to stop would sail straight through the hole.
    for (const bad of ['', '   ', 'abc', '123', '+', 'not-a-phone']) {
      await expect(guard().assertMayBook(ctx(), { customerPhone: bad, now: NOW }))
        .rejects.toBeInstanceOf(BookingPhoneInvalidError);
    }
  });

  it('refuses a MISSING number too', async () => {
    await expect(guard().assertMayBook(ctx(), { customerPhone: null, now: NOW }))
      .rejects.toBeInstanceOf(BookingPhoneInvalidError);
  });
});

describe('a broken provider REFUSES the booking on every channel', () => {
  for (const channel of ['online', 'customer_app', 'ai_receptionist'] as BookingChannel[]) {
    it(`blocks on ${channel} when Twilio is not configured`, async () => {
      await expect(guard({ configured: false, healthy: false }).assertMayBook(ctx(channel), { customerPhone: PHONE, now: NOW }))
        .rejects.toBeInstanceOf(BookingVerificationUnavailableError);
    });
  }

  it('blocks even for a phone verified one minute ago', async () => {
    // "The provider is down, but this phone verified recently, so let it through" is the same failure wearing a
    // friendlier face. Provider is checked before history, and stays checked.
    await expect(guard({ configured: false, healthy: false, verifiedAt: NOW - 60_000 }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }))
      .rejects.toBeInstanceOf(BookingVerificationUnavailableError);
  });

  it('never names the provider to the customer', async () => {
    const err = await guard({ configured: false, healthy: false }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }).catch((e) => e);
    expect(err.message).not.toMatch(/twilio|sid|token|credential/i);
  });
});

describe('the policy is honoured, not second-guessed', () => {
  it('does not verify when the tenant has the feature off', async () => {
    const r = await guard({ tenantEnabled: false }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW });
    expect(r.decision).toBe('disabled');
  });

  it('does not verify a channel the tenant did not enable', async () => {
    const r = await guard({ channels: { customer_app: true } }).assertMayBook(ctx('online'), { customerPhone: PHONE, now: NOW });
    expect(r.decision).toBe('not_required');
  });

  it('verifyEveryBooking beats a fresh verification', async () => {
    await expect(guard({ verifyEvery: true, verifiedAt: NOW - 1000 }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }))
      .rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
  });

  it('an EXPIRED verification window re-verifies', async () => {
    await expect(guard({ reverifyAfterSeconds: 60, verifiedAt: NOW - 3_600_000 }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }))
      .rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
  });

  it('a platform emergency disable does not block the booking', async () => {
    // An outage in OUR verification layer must not take every tenant's bookings offline with it.
    const r = await guard({ emergency: true }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW });
    expect(r.decision).toBe('disabled');
  });

  it('a tenant cannot switch off a platform requirement', async () => {
    await expect(guard({ required: true, tenantEnabled: false, channels: {} }).assertMayBook(ctx(), { customerPhone: PHONE, now: NOW }))
      .rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
  });
});

describe('resolve() is a probe and never enforces', () => {
  it('returns the policy without throwing, even when verification is required', async () => {
    const r = await guard().resolve(ctx(), { customerPhone: PHONE, now: NOW });
    expect(r.mustVerify).toBe(true);        // a client can ask "will I need to verify?" without being refused
  });
});

describe('a number retired from a customer has lost its trust (Phase 3, audit E7)', () => {
  it('a revoked verification inside the trust window still re-verifies, as a CHANGED phone', async () => {
    const g = guard({ verifiedAt: NOW - 60_000, revoked: true });
    const r = await g.resolve(ctx(), { customerPhone: PHONE, now: NOW });
    expect(r.decision).toBe('required');
    expect(r.reason).toBe('phone_changed');
    await expect(g.assertMayBook(ctx(), { customerPhone: PHONE, now: NOW })).rejects.toBeInstanceOf(BookingPhoneNotVerifiedError);
  });
});
