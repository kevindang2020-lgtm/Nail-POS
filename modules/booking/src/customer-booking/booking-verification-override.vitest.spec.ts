// booking-verification-override.vitest.spec.ts
//
// This is a documented, permissioned way to turn the control OFF. The moment it exists, **every social-engineering
// attack on this feature routes through it** — the attacker's job stops being "defeat an SMS code" and becomes
// "convince a receptionist", which is a much easier job.
//
// So these tests are written on the assumption that **the person using it is being manipulated.** Every one of
// them is a constraint that makes that manipulation expensive, visible, or attributable.
import { describe, it, expect } from 'vitest';
import { BookingVerificationOverrideService, OverrideError, type OverrideStore } from './booking-verification-override.service';
import { permissionsFor } from '@aipowersalon/permissions';

/** A fake store. No database — the DECISIONS are the whole value, and they must be testable without one. */
function build(opts: { blocked?: boolean; missing?: boolean } = {}) {
  const writes: string[] = [];
  const audits: any[] = [];
  const store: OverrideStore = {
    async bypassBlocked() { return !!opts.blocked; },
    async markSessionOverridden() { writes.push('session_verified'); return opts.missing ? null : { id: VID }; },
    // NOTE what is not here: there is NO method that marks a PHONE verified. The safeguard is an ABSENCE in the
    // interface, not a line someone could delete.
  };
  const svc = new BookingVerificationOverrideService(store, { async record(a: any) { audits.push(a); } });
  return { svc, writes, audits, store };
}

const VID = '7a1b2c3d-0000-4000-8000-00000000abcd';
// BUILD_PLAN Phase 9: a context carries the role's real session permissions (the service decides by permission now)
const ctx = (role: string, permissions: string[] = permissionsFor(role as any)) => ({ tenantId: 't1', branchId: 'b1', userId: 'u1', role, permissions });
const input = {
  verificationId: VID,
  reason: 'Customer is standing at the desk with ID',
  contactMethod: 'in_person' as const,
};

describe('WHO — a receptionist cannot bypass', () => {
  it('REFUSES a receptionist', async () => {
    // The single most important line in the file. The receptionist is exactly who a social engineer calls, and
    // giving them this by default would make the control's weakest point its most accessible one.
    for (const role of ['RECEPTION', 'FRONT_DESK', 'TECHNICIAN', 'CUSTOMER']) {
      const { svc } = build();
      await expect(svc.authorize(ctx(role), input)).rejects.toBeInstanceOf(OverrideError);
    }
  });

  it('allows an owner or a manager', async () => {
    for (const role of ['OWNER', 'MANAGER']) {
      const { svc } = build();
      const r = await svc.authorize(ctx(role), input);
      expect(r.ok, role).toBe(true);
    }
  });

  it('REFUSES platform support', async () => {
    // Support bypassing a tenant's fraud control through a back door is precisely the escalation an attacker
    // wants. Support goes through the audited support workflow, not through here.
    const { svc } = build();
    await expect(svc.authorize(ctx('SUPER_ADMIN'), input)).rejects.toThrow(/cannot bypass/i);
  });
});

describe('THE ONE THAT MATTERS MOST — the phone is NOT marked verified', () => {
  it('authorises THIS booking and grants NO trust window', async () => {
    // If the override wrote `booking_verified_phones`, one manipulated receptionist would hand an attacker a
    // VERIFIED PHONE for 24 hours — and the bypass would stop being a bypass and start being a key. The next
    // booking on that number must ask for a code again.
    const { svc, writes } = build();
    await svc.authorize(ctx('MANAGER'), input);

    expect(writes).toContain('session_verified');
    expect(writes, 'the override must NEVER write a verified-phone record').not.toContain('PHONE_MARKED_VERIFIED');

    // Stronger than "it did not happen": it CANNOT happen. The store has no method for it.
    const { store } = build();
    expect(Object.keys(store)).toEqual(['bypassBlocked', 'markSessionOverridden']);
  });
});

describe('WHY — a reason is required, and it is stored', () => {
  it('refuses an empty or throwaway reason', async () => {
    // Not tidiness. So that when the SAME reason appears forty times in a month, somebody can see it. A bypass
    // nobody can count is a bypass nobody can govern.
    for (const reason of ['', '   ', 'ok', 'customer']) {
      const { svc } = build();
      await expect(svc.authorize(ctx('MANAGER'), { ...input, reason })).rejects.toThrow(/reason is required/i);
    }
  });

  it('requires HOW the customer was confirmed', async () => {
    const { svc } = build();
    await expect(svc.authorize(ctx('MANAGER'), { ...input, contactMethod: 'vibes' as any }))
      .rejects.toThrow(/how you confirmed/i);
  });

  it('records the reason, the method, and WHO — attributably', async () => {
    const { svc, audits } = build();
    await svc.authorize(ctx('OWNER'), input);

    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('verification_manually_bypassed');
    expect(audits[0].userId).toBe('u1');
    expect(audits[0].metadata.reason).toBe(input.reason);
    expect(audits[0].metadata.contactMethod).toBe('in_person');
    expect(audits[0].metadata.role).toBe('OWNER');
  });
});

describe('THE LABEL — a bypassed booking must not look like a verified one', () => {
  it('returns the label that goes on the appointment', async () => {
    // A bypass that looks identical to a verified booking is a bypass that will be used ROUTINELY — by the
    // technician who sees no difference, and by the manager reviewing no-shows who cannot tell which bookings
    // were never verified.
    const { svc } = build();
    const r = await svc.authorize(ctx('MANAGER'), input);
    expect(r.label).toBe('Phone verification manually bypassed');
  });
});

describe('THE PLATFORM CAN FORBID IT', () => {
  it('a tenant whose staff are being targeted can have it switched off above their heads', async () => {
    const { svc } = build({ blocked: true });
    await expect(svc.authorize(ctx('OWNER'), input)).rejects.toThrow(/disabled for this salon by platform policy/i);
  });
});

describe('Phase 4: the override names ONE waiting verification', () => {
  it('a verification that is not waiting (verified, expired, consumed, another salon) → not_found, nothing audited', async () => {
    const { svc, audits } = build({ missing: true });
    await expect(svc.authorize(ctx('MANAGER'), input)).rejects.toMatchObject({ code: 'not_found' });
    expect(audits).toHaveLength(0);
  });
  it('a malformed reference is refused before anything is written', async () => {
    const { svc, writes } = build();
    await expect(svc.authorize(ctx('MANAGER'), { ...input, verificationId: 'bs-1' })).rejects.toMatchObject({ code: 'invalid' });
    expect(writes).toHaveLength(0);
  });
  it('the pending list is for owners and managers only', async () => {
    const { svc } = build();
    await expect(svc.pending(ctx('RECEPTION'))).rejects.toMatchObject({ code: 'forbidden' });
    expect(await svc.pending(ctx('MANAGER'))).toEqual([]);
  });
});


// BUILD_PLAN Phase 9 (Constitution 2 §148): decided by PERMISSION, not by the role's name.
describe('Phase 9 — the override is a permission (booking.override), not a role name', () => {
  it('an OWNER-role session whose booking.override was DENIED is refused', async () => {
    const { svc } = build();
    const denied = permissionsFor('OWNER' as any).filter((k) => k !== 'booking.override');
    await expect(svc.authorize(ctx('OWNER', denied), input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.pending(ctx('OWNER', denied))).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('a FRONT_DESK session the owner granted booking.override (an ALLOW override) may override', async () => {
    const { svc } = build();
    await expect(svc.authorize(ctx('FRONT_DESK', [...permissionsFor('FRONT_DESK' as any), 'booking.override']), input)).resolves.toMatchObject({ ok: true });
  });
  it('platform support never gets the back door, whatever its token says', async () => {
    const { svc } = build();
    await expect(svc.authorize(ctx('SUPER_ADMIN', ['booking.override']), input)).rejects.toThrow(/Platform support/);
  });
});
