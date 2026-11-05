// customer-phone-update.service.vitest.spec.ts
//
// One service, both frontends — because two frontends with two rule sets is two rule sets that drift, and the
// fraud moves to whichever drifted.
//
// The failures that matter here are the ones that either cut a real person off from their own account, or hand an
// attacker somebody else's. Almost every test is one of those.
import { describe, it, expect } from 'vitest';
import {
  CustomerPhoneUpdateService, PhoneUpdateError,
  type PhoneStore, type VerificationPort, type SyncPort, type PhoneUpdateCtx, type PhoneSettings,
} from './customer-phone-update.service';
import { phoneKey, normalizePhone } from '@aipowersalon/customers';

const PHONE = '+15551234567';
const HASH = phoneKey(normalizePhone(PHONE)!);

const SETTINGS: PhoneSettings = {
  allowReceptionistUpdates: true,
  requireSmsVerification: true,
  allowPendingUnverified: true,
  allowSharedFamilyPhones: true,
  allowManualConfirmation: false,
  customerAppSelfService: true,
  notifyOldNumber: true,
};

function build(o: {
  settings?: Partial<PhoneSettings>;
  matches?: any[];
  version?: number;
  sendStatus?: string;
  checkStatus?: string;
  activateOk?: boolean;
  syncOk?: boolean;
} = {}) {
  const calls: string[] = [];
  const audits: any[] = [];
  const notifications: any[] = [];
  let sessionState: any = 'pending_phone_saved';

  const store: PhoneStore = {
    async settings() { return { ...SETTINGS, ...o.settings }; },
    async customer() { return { id: 'c1', fullName: 'Sarah Chen', recordVersion: o.version ?? 1 }; },
    async matchesByHash() { return (o.matches ?? []) as any; },
    async activePhone() { return { id: 'old-1', mask: '••••0000', status: 'active_verified' as any }; },
    async createSession() { calls.push('createSession'); return { id: 'sess-1' }; },
    async session() {
      return {
        id: 'sess-1', customerId: 'c1', state: sessionState,
        newPhoneHash: HASH, newPhoneMask: '••••4567', oldPhoneId: 'old-1',
        source: 'staff_pos' as any, customerVersion: o.version ?? 1,
        newPhoneId: 'new-1', closed: false, expired: false,
      };
    },
    async openSession() { return null; },
    async sessionByIdempotencyKey() { return null; },
    async closeSession(_t, _id, st) { calls.push('close:' + st); sessionState = st; },
    async adoptLegacyPhone() { return null; },
    async setSessionState(_id, st) { calls.push('state:' + st); sessionState = st; },
    async savePendingPhone() { calls.push('savePendingPhone'); return { id: 'new-1' }; },
    async activate() { calls.push('ACTIVATE'); return o.activateOk !== false; },
  };

  const verification: VerificationPort = {
    async send() { calls.push('send'); return { status: o.sendStatus ?? 'code_sent', message: 'sent' }; },
    async check() { calls.push('check'); return { status: o.checkStatus ?? 'phone_verified', message: 'ok' }; },
  };
  const sync: SyncPort = { async synchronize() { calls.push('sync'); return o.syncOk !== false; } };

  const svc = new CustomerPhoneUpdateService(
    store, verification, sync,
    { async record(a: any) { audits.push(a); } },
    { async phoneChanged(n: any) { notifications.push(n); } },
  );
  return { svc, calls, audits, notifications };
}

const ctx = (over: Partial<PhoneUpdateCtx> = {}): PhoneUpdateCtx => ({
  tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', source: 'staff_pos', ...over,
});

// ══ start ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('starting an update NEVER touches the active number', () => {
  it('saves the new number as PENDING and nothing else', async () => {
    const { svc, calls } = build();
    const r = await svc.start(ctx(), { customerId: 'c1', newPhone: PHONE });
    expect(r.state).toBe('pending_phone_saved');
    expect(calls).toContain('savePendingPhone');
    // The active number is untouched. There is no path from here to activation without a proven code.
    expect(calls).not.toContain('ACTIVATE');
  });

  it('refuses an unparseable number', async () => {
    const { svc } = build();
    for (const bad of ['', 'abc', '123', 'not-a-phone']) {
      await expect(svc.start(ctx(), { customerId: 'c1', newPhone: bad })).rejects.toMatchObject({ code: 'invalid_phone' });
    }
  });
});

describe('optimistic locking — a stale screen must not clobber a newer number', () => {
  it('REFUSES a write from a stale profile screen', async () => {
    // Two receptionists, two tills, one customer. The one looking at a screen from five minutes ago must be
    // refused, not allowed to overwrite the number the other just changed.
    const { svc } = build({ version: 5 });
    await expect(svc.start(ctx(), { customerId: 'c1', newPhone: PHONE, expectedVersion: 3 }))
      .rejects.toMatchObject({ code: 'stale_record' });
  });

  it('tells the caller the CURRENT version, so the UI can refresh rather than guess', async () => {
    const { svc } = build({ version: 5 });
    const err: any = await svc.start(ctx(), { customerId: 'c1', newPhone: PHONE, expectedVersion: 3 }).catch((e) => e);
    expect(err.extra.currentVersion).toBe(5);
  });

  it('accepts a fresh one', async () => {
    const { svc } = build({ version: 5 });
    await expect(svc.start(ctx(), { customerId: 'c1', newPhone: PHONE, expectedVersion: 5 })).resolves.toBeTruthy();
  });
});

describe('duplicates block, and never merge', () => {
  const other = { customerId: 'c2', tenantId: 't1', fullName: 'Bob Diaz', isSameCustomer: false, status: 'active_verified' };

  it('a different person on the number blocks the update', async () => {
    const { svc, calls } = build({ matches: [other] });
    await expect(svc.start(ctx(), { customerId: 'c1', newPhone: PHONE })).rejects.toMatchObject({ code: 'duplicate_conflict' });
    // Nothing was saved. A blocked update must not half-persist.
    expect(calls).not.toContain('savePendingPhone');
  });

  it('but a SHARED FAMILY PHONE proceeds when staff say so', async () => {
    // A mother books for her daughter. Refusing this would make the salon unable to record the truth.
    const { svc } = build({ matches: [other] });
    const r = await svc.start(ctx(), { customerId: 'c1', newPhone: PHONE, staffAssertsSharedPhone: true });
    expect(r.duplicates.outcome).toBe('shared_family_phone');
  });

  it('the conflict payload never carries a phone number or a full name', async () => {
    const { svc } = build({ matches: [other] });
    const err: any = await svc.start(ctx(), { customerId: 'c1', newPhone: PHONE }).catch((e) => e);
    const json = JSON.stringify(err.extra);
    expect(json).not.toMatch(/\d{7,}/);
    expect(json).not.toContain('Diaz');       // masked to "Bob D." — a warning must not become a directory
  });
});

// ══ the code ══════════════════════════════════════════════════════════════════════════════════════════════
describe('the code is bound to the session', () => {
  it('REFUSES to send to a number that is not the one this update proposed', async () => {
    // Otherwise a caller opens a session for their own number and has the code sent to someone else's.
    const { svc } = build();
    await expect(svc.sendCode(ctx(), 'sess-1', '+15559998888', 'c1')).rejects.toMatchObject({ code: 'invalid_phone' });
  });

  it('REFUSES to check a code against a different number', async () => {
    const { svc } = build();
    await expect(svc.verify(ctx(), 'sess-1', '+15559998888', '123456', 'c1')).rejects.toMatchObject({ code: 'invalid_phone' });
  });
});

describe('a missing provider does NOT destroy the update', () => {
  it('keeps the pending number and says why', async () => {
    // Twilio being down is not the customer's fault. Throwing the update away would make them start over for a
    // problem that was never theirs.
    const { svc } = build({ sendStatus: 'twilio_not_configured' });
    const err: any = await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1').catch((e) => e);
    expect(err.code).toBe('no_provider');
    expect(err.extra.sessionId).toBe('sess-1');    // still resumable
  });
});

// ══ activation ════════════════════════════════════════════════════════════════════════════════════════════
describe('only a PROVEN number is activated', () => {
  it('a wrong code does not activate anything', async () => {
    const { svc, calls } = build({ checkStatus: 'incorrect_code' });
    await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1');           // a code must be SENT before it can be checked
    const r = await svc.verify(ctx(), 'sess-1', PHONE, '000000', 'c1');
    expect(r.activated).toBe(false);
    expect(calls).not.toContain('ACTIVATE');
  });

  it('a correct code activates, syncs, audits and notifies', async () => {
    const { svc, calls, audits, notifications } = build();
    await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1');
    const r = await svc.verify(ctx(), 'sess-1', PHONE, '123456', 'c1');
    expect(r.activated).toBe(true);
    expect(calls).toContain('ACTIVATE');
    expect(calls).toContain('sync');
    expect(audits.some((a) => a.action === 'phone_verified_and_activated')).toBe(true);
    // Notifying the customer is what turns a silent account takeover into one the victim can SEE.
    expect(notifications).toHaveLength(1);
  });

  it('audits with a MASKED number — never the full one', async () => {
    // A full phone number in an audit message is a phone number in a log aggregator, a slow-query trace, and a
    // support ticket.
    const { svc, audits } = build();
    await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1');
    await svc.verify(ctx(), 'sess-1', PHONE, '123456', 'c1');
    expect(JSON.stringify(audits)).not.toContain('5551234567');
    expect(JSON.stringify(audits)).not.toMatch(/\d{7,}/);
  });
});

describe('a VERIFIED change is never lost', () => {
  it('a sync failure still activates the number, and reports honestly', async () => {
    // The customer answered the SMS. That fact is banked. A crashed sync does not un-happen it — and sending them
    // back to the start would make them re-verify a number they already proved.
    const { svc, calls } = build({ syncOk: false });
    await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1');
    const r = await svc.verify(ctx(), 'sess-1', PHONE, '123456', 'c1');
    expect(r.activated).toBe(true);
    expect(r.state).toBe('synchronization_failed');    // retryable, not lost
    expect(r.message).toMatch(/finish syncing/i);
    expect(calls).toContain('ACTIVATE');
  });

  it('a STALE record refuses rather than clobbers — and the verification survives', async () => {
    // Somebody changed this customer while we were verifying. The newer write wins; we do not overwrite it. But
    // the customer DID prove the number, so the session stays proven and can be retried.
    const { svc } = build({ activateOk: false });
    await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1');
    const err: any = await svc.verify(ctx(), 'sess-1', PHONE, '123456', 'c1').catch((e) => e);
    expect(err.code).toBe('stale_record');
    expect(err.extra.state).toBe('phone_verified');
  });
});

// ══ manual confirmation ═══════════════════════════════════════════════════════════════════════════════════
describe('manual confirmation is a JUDGEMENT, not proof', () => {
  it('is OFF by default', async () => {
    const { svc } = build();
    await expect(svc.manuallyConfirm(ctx(), 'sess-1', PHONE, 'Customer is at the desk with ID', 'c1'))
      .rejects.toMatchObject({ code: 'disabled' });
  });

  it('a RECEPTIONIST cannot use it, even when the tenant enabled it', async () => {
    // The receptionist is exactly who a social engineer calls.
    const { svc } = build({ settings: { allowManualConfirmation: true } });
    await expect(svc.manuallyConfirm(ctx({ role: 'RECEPTION' }), 'sess-1', PHONE, 'Customer is at the desk', 'c1'))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('requires a specific reason', async () => {
    const { svc } = build({ settings: { allowManualConfirmation: true } });
    await expect(svc.manuallyConfirm(ctx(), 'sess-1', PHONE, 'ok', 'c1')).rejects.toBeInstanceOf(PhoneUpdateError);
  });

  it('produces "OTP not completed" — and NEVER "SMS verified"', async () => {
    // Labelling a manager's judgement as SMS-verified would launder it into cryptographic evidence, and the manual
    // path would quietly become the normal path.
    const { svc, audits } = build({ settings: { allowManualConfirmation: true } });
    const r = await svc.manuallyConfirm(ctx(), 'sess-1', PHONE, 'Customer is standing at the desk with ID', 'c1');
    expect(r.label).toMatch(/OTP not completed/i);
    expect(r.label).not.toMatch(/sms verified/i);
    expect(audits.some((a) => a.action === 'manual_confirmation_used')).toBe(true);
  });
});

// ══ who ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('permissions', () => {
  it('platform support cannot change a tenant\u2019s customer phone at all', async () => {
    // Support does not get a side door into customer data.
    const { svc } = build();
    await expect(svc.start(ctx({ role: 'SUPER_ADMIN' }), { customerId: 'c1', newPhone: PHONE }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a receptionist is blocked when the tenant turned reception updates off', async () => {
    const { svc } = build({ settings: { allowReceptionistUpdates: false } });
    await expect(svc.start(ctx({ role: 'RECEPTION' }), { customerId: 'c1', newPhone: PHONE }))
      .rejects.toMatchObject({ code: 'disabled' });
  });

  it('the customer app can be turned off by the tenant', async () => {
    const { svc } = build({ settings: { customerAppSelfService: false } });
    await expect(svc.start(ctx({ role: 'CUSTOMER', source: 'customer_app' }), { customerId: 'c1', newPhone: PHONE }))
      .rejects.toMatchObject({ code: 'disabled' });
  });
});

describe('cancel', () => {
  it('a PROVEN number cannot be cancelled back to nothing', async () => {
    // The customer HAS the new phone. Pretending otherwise would leave the records disagreeing with reality.
    const { svc } = build();
    await svc.sendCode(ctx(), 'sess-1', PHONE, 'c1');
    await svc.verify(ctx(), 'sess-1', PHONE, '123456', 'c1');
    await expect(svc.cancel(ctx(), 'sess-1', 'c1')).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('a code that was never SENT cannot be verified', () => {
  it('refuses to verify from pending_phone_saved', async () => {
    // My first draft of these tests skipped sendCode() and the service refused — correctly. Accepting a code for a
    // verification that was never initiated would let a caller "verify" a number nobody ever texted, which is the
    // whole control turned inside out.
    const { svc, calls } = build();
    await expect(svc.verify(ctx(), 'sess-1', PHONE, '123456', 'c1')).rejects.toMatchObject({ code: 'invalid_state' });
    expect(calls).not.toContain('ACTIVATE');
  });
});
