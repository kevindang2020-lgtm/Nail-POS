// customer-identity-phone.vitest.spec.ts
//
// This service moves a LOGIN CREDENTIAL. `customer_identities.normalized_phone` is how a customer signs in
// (`select * from customer_identities where normalized_phone = $1`), and it is UNIQUE.
//
// So the threat here is not a mistyped digit. It is:
//
//     an attacker with a STOLEN SESSION — a borrowed phone, an unlocked laptop, a hijacked token — changes the
//     login phone to their own and owns the account. The real customer is locked out of their history, their
//     bookings, and the recovery flow, and the attacker holds the number every future code goes to.
//
// A stolen session is EXACTLY the situation a "change my phone" endpoint is most likely to be used in by someone
// who should not be using it. Every test below is one step of that attack, closed.
import { describe, it, expect } from 'vitest';
import {
  CustomerIdentityPhoneService, IdentityPhoneError,
  type IdentityStore, type AuthPort, type SecurityNotifier,
} from './customer-identity-phone.service';

const OLD = '+15551110000';
const NEW = '+15552223333';

function build(o: { passwordOk?: boolean; taken?: boolean; hasPassword?: boolean; moveOk?: boolean; proven?: boolean; notify?: 'ok' | 'simulated' | 'fails'; production?: boolean } = {}) {
  const events: string[] = [];
  const notifications: any[] = [];
  const audits: any[] = [];

  const store: IdentityStore = {
    async identityFor() {
      return { identityId: 'i1', normalizedPhone: OLD, passwordHash: o.hasPassword === false ? null : 'hash' };
    },
    async phoneTakenByAnother() { return !!o.taken; },
    async setIdentityPhone() { events.push('phone_moved'); return o.moveOk !== false; },
    async provenRecently() { return o.proven !== false; },
  };
  const auth: AuthPort = {
    async verifyPassword() { return o.passwordOk !== false; },
    async revokeAllSessions() { events.push('sessions_revoked'); },
  };
  const notify: SecurityNotifier = {
    async loginPhoneChanged(i) {
      if (o.notify === 'fails') throw new Error('no provider');
      events.push('old_number_notified'); notifications.push(i);
      return { sent: true, simulated: o.notify === 'simulated' };
    },
  };

  const svc = new CustomerIdentityPhoneService(store, auth, notify, { async record(a) { audits.push(a); } }, { production: !!o.production });
  return { svc, events, notifications, audits };
}

const req = { userId: 'u1', tenantId: 't1', currentPassword: 'correct-horse', verifiedNewPhone: NEW };

describe('1. REAUTHENTICATION — a session is not enough', () => {
  it('REFUSES a wrong password, and changes nothing', async () => {
    // The whole attack starts with a session the attacker did not earn. A borrowed phone carries a valid session.
    // It does not carry the password.
    const { svc, events } = build({ passwordOk: false });
    const err = await svc.changeLoginPhone(req).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityPhoneError);
    expect(err.code).toBe('reauth_required');
    expect(events, 'nothing may happen on a failed reauth').toEqual([]);
  });

  it('records the failed reauth — repeated failures are somebody trying to take an account', async () => {
    const { svc, audits } = build({ passwordOk: false });
    await svc.changeLoginPhone(req).catch(() => {});
    expect(audits[0].action).toBe('login_phone_change_reauth_failed');
  });

  it('refuses an account with no password rather than skipping the check', async () => {
    // "No password, so no reauthentication" is how a control becomes optional.
    const { svc, events } = build({ hasPassword: false });
    await expect(svc.changeLoginPhone(req)).rejects.toThrow(/set a password/i);
    expect(events).toEqual([]);
  });
});

describe('2. the number must not already BE somebody\u2019s login', () => {
  it('REFUSES a number that is another account\u2019s sign-in', async () => {
    // `normalized_phone` is UNIQUE precisely because two accounts on one login is an ambiguous login. Without this
    // check the insert just fails and the customer sees a database error instead of the truth.
    const { svc, events } = build({ taken: true });
    const err = await svc.changeLoginPhone(req).catch((e) => e);
    expect(err.code).toBe('in_use');
    expect(events).toEqual([]);
  });
});

describe('3. SESSION ROTATION — if an attacker was riding a session, it dies here', () => {
  it('revokes every session after a successful change', async () => {
    const { svc, events } = build();
    await svc.changeLoginPhone(req);
    expect(events).toContain('sessions_revoked');
  });

  it('and the victim\u2019s session dying is how they NOTICE', async () => {
    // If the account had already been taken, this is the moment the real customer gets logged out and looks.
    const { svc, audits } = build();
    await svc.changeLoginPhone(req);
    expect(audits.find((a) => a.action === 'login_phone_changed')?.metadata.sessionsRevoked).toBe(true);
  });
});

describe('4. NOTIFY THE OLD NUMBER — the control an attacker cannot suppress', () => {
  it('notifies the old number BEFORE the change is written', async () => {
    // THE ORDER IS THE POINT.
    //
    // The old number is the only channel an attacker cannot reach, and it is how a real customer finds out their
    // account is being taken **while the number is still theirs.** Retire it first and the warning goes to a number
    // we have just stopped believing in.
    //
    // Before the WRITE, too: if the write succeeded and the notification then failed, the victim would never hear.
    // Better to warn and fail than to change and go quiet.
    const { svc, events } = build();
    await svc.changeLoginPhone(req);
    expect(events.indexOf('old_number_notified')).toBeLessThan(events.indexOf('phone_moved'));
  });

  it('the warning goes to the OLD number, and says what changed', async () => {
    const { svc, notifications } = build();
    await svc.changeLoginPhone(req);
    expect(notifications[0].oldPhoneE164).toBe(OLD);
    expect(notifications[0].maskedOld).not.toContain('1110000');
  });

  it('it does NOT reveal the new number in full', async () => {
    // Telling a victim the attacker's number hands them a target. Telling an attacker the victim's number hands
    // them a victim. Masked, both ways.
    const { svc, notifications } = build();
    await svc.changeLoginPhone(req);
    expect(JSON.stringify({ o: notifications[0].maskedOld, n: notifications[0].maskedNew })).not.toMatch(/\d{7,}/);
  });
});

describe('the happy path', () => {
  it('reauth → not-taken → notify old → move → revoke, in that order', async () => {
    const { svc, events } = build();
    const r = await svc.changeLoginPhone(req);
    expect(r.ok).toBe(true);
    expect(events).toEqual(['old_number_notified', 'phone_moved', 'sessions_revoked']);
  });

  it('the audit record carries no phone number', async () => {
    // A login credential in an audit message is a login credential in a log aggregator.
    const { svc, audits } = build();
    await svc.changeLoginPhone(req);
    const done = audits.find((a) => a.action === 'login_phone_changed');
    expect(JSON.stringify(done)).not.toMatch(/\d{7,}/);
    expect(done.metadata.reauthenticated).toBe(true);
  });
});

describe('it refuses to run on a number nobody proved', () => {
  it('takes an ALREADY-VERIFIED number and never sends or checks a code itself', async () => {
    // Deliberate split. This service is the LAST step: the SMS happens upstream, in the phone-update flow. There is
    // therefore no path *here* that can move a login credential without a completed verification somewhere before
    // it — the capability simply does not exist in this class.
    const { svc } = build();
    await expect(svc.changeLoginPhone({ ...req, verifiedNewPhone: 'not-a-phone' }))
      .rejects.toThrow(/does not look valid/i);
  });
});

describe('Phase 3 (audit E5): the new sign-in number must have been PROVED by this customer, just now', () => {
  it('refuses a valid number nobody verified — a password alone does not move a login credential', async () => {
    const { svc, events } = build({ proven: false });
    const err = await svc.changeLoginPhone(req).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityPhoneError);
    expect(err.code).toBe('not_verified');
    expect(events).toEqual([]);
  });
  it('a proved number moves, after the old number is warned', async () => {
    const { svc, events } = build();
    await svc.changeLoginPhone(req);
    expect(events).toEqual(['old_number_notified', 'phone_moved', 'sessions_revoked']);
  });
  it('in production, a warning that could not really be sent stops the change (no mock in production)', async () => {
    for (const notify of ['simulated', 'fails'] as const) {
      const { svc, events } = build({ notify, production: true });
      const err = await svc.changeLoginPhone(req).catch((e) => e);
      expect(err.code, notify).toBe('notify_unavailable');
      expect(events).not.toContain('phone_moved');
    }
  });
  it('outside production a simulated warning is allowed (development has no SMS provider)', async () => {
    const { svc, events } = build({ notify: 'simulated', production: false });
    await svc.changeLoginPhone(req);
    expect(events).toContain('phone_moved');
  });
});
