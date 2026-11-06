// booking-verification-settings.vitest.spec.ts
//
// One rule matters more than everything else in this file:
//
//     A tenant must not be able to ENABLE verification without a Twilio account that is connected AND tested.
//
// Not because a form should be tidy. Because the policy resolver — correctly — BLOCKS a remote booking when
// verification is required and cannot be performed. So a tenant who flips the switch with no working provider
// does not get a slightly degraded feature. **Their online booking stops.** Every remote booking is refused, and
// the cause is a toggle we let them turn on.
//
// "Configured" is not "working", either. Somebody typing an account SID into a form proves nothing about whether
// Twilio will accept it, and finding that out at the first real customer is not acceptable.
import { describe, it, expect } from 'vitest';
import { BookingVerificationSettingsService, VerificationSettingsError, type VerificationSettingsStore } from './booking-verification-settings.service';
import type { TenantCredentialResolver } from './booking-verification-provider';
import { MAX_HOLD_SECONDS, MIN_HOLD_SECONDS } from './booking-hold-core';

const creds = (status: 'configured' | 'not_configured'): TenantCredentialResolver => ({
  async resolve() {
    return status === 'configured'
      ? { status, credentials: { accountSid: 'AC1', authToken: 't', verifyServiceSid: 'VA1' }, kind: 'twilio_verify' as const }
      : { status: 'not_configured' as const };
  },
});

/** A fake store. No database, no SQL — the DECISIONS are what matter here, and they are what break a tenant's
 *  bookings if they are wrong. */
function svcWith(opts: { configured: boolean; validated?: boolean; required?: boolean; blocked?: boolean; row?: any; moduleOff?: boolean; ownBranches?: string[] }) {
  const writes: any[] = [];
  const store: VerificationSettingsStore = {
    async settingsRow() { return opts.row ?? null; },
    async upsert(row) { writes.push(row); },
    async providerValidated() { return !!opts.validated; },
    ...(opts.ownBranches ? { async branchInTenant(_t: string, b: string) { return opts.ownBranches!.includes(b); } } : {}),
    async platformPolicy() {
      return { requiredForTenant: !!opts.required, blockedForTenant: !!opts.blocked, emergencyDisabled: false, moduleEnabled: !opts.moduleOff };
    },
  };
  const svc = new BookingVerificationSettingsService(store, creds(opts.configured ? 'configured' : 'not_configured'));
  return { svc, writes };
}

describe('THE RULE — enabling requires a connected AND tested provider', () => {
  it('REFUSES to enable when no Twilio is connected', async () => {
    const { svc, writes } = svcWith({ configured: false });
    const err = await svc.patch('u1', 't1', null, { enabled: true }).catch((e) => e);
    expect(err).toBeInstanceOf(VerificationSettingsError);
    expect(err.code).toBe('provider_required');
    expect(err.message).toMatch(/connect and verify your twilio/i);
    // Nothing was written. A refused enable must not half-persist.
    expect(writes).toHaveLength(0);
  });

  it('REFUSES to enable when Twilio is connected but never TESTED', async () => {
    // "Configured" is not "working". Somebody typed an account SID into a form. Discovering it is wrong at the
    // first real customer means that customer's booking is refused and nobody knows why.
    const { svc, writes } = svcWith({ configured: true, validated: false });
    const err = await svc.patch('u1', 't1', null, { enabled: true }).catch((e) => e);
    expect(err.code).toBe('provider_required');
    expect(err.message).toMatch(/test your twilio connection/i);
    expect(writes).toHaveLength(0);
  });

  it('ALLOWS enabling once the provider is connected and validated', async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true });
    await svc.patch('u1', 't1', null, { enabled: true });
    expect(writes).toHaveLength(1);
  });

  it('a tenant may still change other settings with no provider — only ENABLING is gated', async () => {
    // Locking the whole form would stop a tenant from preparing their configuration before connecting Twilio.
    // Only the switch that would break their bookings is gated.
    const { svc, writes } = svcWith({ configured: false });
    await svc.patch('u1', 't1', null, { verifyEveryBooking: true });
    expect(writes).toHaveLength(1);
  });

  it('a tenant may always turn it OFF, provider or not', async () => {
    const { svc, writes } = svcWith({ configured: false });
    await svc.patch('u1', 't1', null, { enabled: false });
    expect(writes).toHaveLength(1);
  });
});

describe('platform precedence is enforced at the write, not just at read time', () => {
  it('a tenant CANNOT turn off what the platform requires', async () => {
    // Enforcing this only in the resolver would leave the tenant's UI showing "off" while verification still
    // ran — a setting that lies about itself.
    const { svc } = svcWith({ configured: true, validated: true, required: true });
    const err = await svc.patch('u1', 't1', null, { enabled: false }).catch((e) => e);
    expect(err.code).toBe('forbidden');
    expect(err.message).toMatch(/platform policy/i);
  });

  it('a tenant CANNOT turn on what the platform blocked', async () => {
    const { svc } = svcWith({ configured: true, validated: true, blocked: true });
    const err = await svc.patch('u1', 't1', null, { enabled: true }).catch((e) => e);
    expect(err.code).toBe('forbidden');
  });
});

describe('values a tenant should not be able to set', () => {
  it('clamps an hour-long hold down to the platform maximum', async () => {
    // An hour-long hold is a denial-of-service on the salon's own calendar, and it must not be reachable through
    // a settings form. The clamp is applied BEFORE the write, so the bad value never reaches the database.
    const { svc, writes } = svcWith({ configured: true, validated: true });
    await svc.patch('u1', 't1', null, { holdSeconds: 3600 });
    expect(writes[0].hold_seconds).toBe(MAX_HOLD_SECONDS);
  });

  it('clamps a too-SHORT hold up — a slow SMS must not lose the slot', async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true });
    await svc.patch('u1', 't1', null, { holdSeconds: 5 });
    expect(writes[0].hold_seconds).toBe(MIN_HOLD_SECONDS);
  });

  it('BUMPS the version on every change — a disputed booking is explained from the row', async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true, row: { version: 7, enabled: true } });
    await svc.patch('u1', 't1', null, { verifyEveryBooking: true });
    expect(writes[0].version).toBe(8);
  });
});

describe('the view explains WHY the switch is locked', () => {
  it('carries a blockedReason the UI can show instead of a dead toggle', async () => {
    const { svc } = svcWith({ configured: false });
    const v = await svc.get('t1', null);
    expect(v.provider.connected).toBe(false);
    expect(v.provider.blockedReason).toMatch(/connect and verify/i);
    // A disabled toggle with no explanation is how a tenant ends up filing a support ticket.
  });

  it('says when the platform is forcing it, so the UI shows text rather than a toggle that does nothing', async () => {
    const { svc } = svcWith({ configured: true, validated: true, required: true });
    const v = await svc.get('t1', null);
    expect(v.platform.requiredByPlatform).toBe(true);
  });
});

describe('Phase 4', () => {
  it('REFUSES to enable while the platform has the module switched off (a switch that shows ON and does nothing)', async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true, moduleOff: true });
    const err = await svc.patch('u1', 't1', null, { enabled: true }).catch((e) => e);
    expect(err).toMatchObject({ code: 'forbidden' });
    expect(writes).toHaveLength(0);
    expect((await svc.get('t1')).platform.moduleDisabled).toBe(true);
  });
  it('in-salon channels cannot be switched on (decided: front desk, walk-in and the kiosk make no remote bookings)', async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true });
    for (const channels of [{ frontDesk: true }, { walkIn: true }, { kiosk: true }]) {
      expect(await svc.patch('u1', 't1', null, { channels }).catch((e) => e)).toMatchObject({ code: 'invalid' });
    }
    expect(writes).toHaveLength(0);
    await svc.patch('u1', 't1', null, { channels: { online: false } });
    expect(writes[0]).toMatchObject({ channel_online: false, channel_kiosk: false, channel_front_desk: false, channel_walk_in: false });
  });
});


// §74 (Nov 5 2026, the live write sweep): the table has no branch FK, so salon B patching salon A's location id
// stored a settings row under B keyed to A's location and answered 200.
describe('a location that is not the salon\'s own is refused before anything is stored', () => {
  it("another salon's location id → BRANCH_NOT_FOUND, nothing written", async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true, ownBranches: ['b-own'] });
    await expect(svc.patch('u1', 't1', 'b-of-salon-A', { holdSeconds: 300 })).rejects.toMatchObject({ code: 'not_found', apiCode: 'BRANCH_NOT_FOUND' });
    expect(writes).toHaveLength(0);
  });
  it('its own location and the salon default still save', async () => {
    const { svc, writes } = svcWith({ configured: true, validated: true, ownBranches: ['b-own'] });
    await svc.patch('u1', 't1', 'b-own', { holdSeconds: 300 });
    await svc.patch('u1', 't1', null, { holdSeconds: 300 });
    expect(writes).toHaveLength(2);
  });
});
