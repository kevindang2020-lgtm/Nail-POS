// customer-phone-core.vitest.spec.ts
//
// Changing a phone number is not an edit. It changes:
//   • where every future booking code is sent
//   • how the AI receptionist recognises a caller
//   • how the customer signs into the app (the identity phone IS the login credential)
//
// So the failures that matter are the ones that cut a real person off from their own account, or hand somebody
// else's account to an attacker. Almost every test below is one of those.
import { describe, it, expect } from 'vitest';
import {
  transition, isTerminal, isProven, classifyDuplicates, can, activationPolicy,
  canReceiveSms, canCompleteBookingVerification,
  MANUAL_CONFIRMATION_STATUS, MANUAL_CONFIRMATION_LABEL,
  type PhoneMatch, type PhoneStatus,
} from './customer-phone-core';

// ══ status model ══════════════════════════════════════════════════════════════════════════════════════════
describe('an UNVERIFIED number can be texted, but cannot complete a booking', () => {
  it('lets a pending number receive the code that will prove it', () => {
    // Obvious once said, easy to get wrong: if an unverified number could not be texted, it could never BECOME
    // verified. The verification SMS is exactly the message it must be allowed to receive.
    expect(canReceiveSms('active_unverified')).toBe(true);
    expect(canReceiveSms('active_verified')).toBe(true);
  });

  it('but ONLY a verified number satisfies the booking gate', () => {
    // Otherwise the phone-change flow becomes a way around the entire booking-verification module: change your
    // number to the victim's, and book as them without ever proving anything.
    expect(canCompleteBookingVerification('active_verified')).toBe(true);
    for (const s of ['active_unverified', 'pending_verification', 'verification_failed', 'replaced', 'locked'] as PhoneStatus[]) {
      expect(canCompleteBookingVerification(s), s).toBe(false);
    }
  });

  it('a REPLACED number is never messaged again', () => {
    // The old number belongs to whoever holds it now. Sending them the new owner's booking codes is both a leak
    // and a nuisance.
    expect(canReceiveSms('replaced')).toBe(false);
    expect(canReceiveSms('inactive')).toBe(false);
  });
});

describe('a MANUALLY confirmed number is not an SMS-verified one', () => {
  it('produces active_unverified, and says so', () => {
    // Labelling a manager's judgement as "SMS verified" launders it into cryptographic evidence. It is usable —
    // and it is honest about never having been proven.
    expect(MANUAL_CONFIRMATION_STATUS).toBe('active_unverified');
    expect(MANUAL_CONFIRMATION_LABEL).toMatch(/OTP not completed/i);
    expect(MANUAL_CONFIRMATION_LABEL).not.toMatch(/sms verified/i);
  });

  it('and therefore cannot complete a booking verification either', () => {
    expect(canCompleteBookingVerification(MANUAL_CONFIRMATION_STATUS)).toBe(false);
  });
});

// ══ the state machine ═════════════════════════════════════════════════════════════════════════════════════
describe('the happy path', () => {
  it('runs start → validated → dup-checked → pending → sent → verified → activated → synced', () => {
    let s: any = 'phone_update_started';
    for (const [ev, expected] of [
      ['validate_ok', 'phone_validated'],
      ['dup_none', 'duplicate_check_completed'],
      ['save_pending', 'pending_phone_saved'],
      ['send_ok', 'verification_sent'],
      ['code_ok', 'phone_verified'],
      ['activate', 'phone_activated'],
      ['sync_ok', 'customer_records_synchronized'],
    ] as const) {
      const r = transition(s, ev);
      expect(r.ok, `${s} --${ev}-->`).toBe(true);
      s = (r as any).state;
      expect(s).toBe(expected);
    }
    expect(isTerminal(s)).toBe(true);
  });
});

describe('a verified change is NEVER lost', () => {
  it('a sync failure AFTER activation does not un-prove the number', () => {
    // The customer answered the SMS. That fact is banked. A crashed job, a full disk, a timeout — none of them
    // un-happen it. Sending the customer back to the start would make them re-verify a number they already proved,
    // for a failure that was never theirs.
    const r = transition('phone_activated', 'sync_fail');
    expect(r).toEqual({ ok: true, state: 'synchronization_failed' });
    expect(isProven('synchronization_failed')).toBe(true);
    expect(isTerminal('synchronization_failed')).toBe(false);   // retryable
  });

  it('and a retry can still complete it', () => {
    expect(transition('synchronization_failed', 'sync_ok')).toEqual({ ok: true, state: 'customer_records_synchronized' });
  });

  it('a proven state cannot be cancelled back to nothing', () => {
    // Once the number is proven, "cancel" is not a legal move — the customer HAS the new phone, and pretending
    // otherwise would leave the records disagreeing with reality.
    expect(transition('phone_verified', 'cancel').ok).toBe(false);
    expect(transition('phone_activated', 'cancel').ok).toBe(false);
  });
});

describe('failures are retryable, not fatal', () => {
  it('a failed SEND can be retried — the pending number survives', () => {
    // Twilio being down is not the customer's fault. Throwing the update away would make them start over for a
    // problem that was never theirs.
    expect(transition('verification_send_failed', 'send_ok')).toEqual({ ok: true, state: 'verification_sent' });
  });

  it('twilio_not_configured can be resolved by connecting Twilio — the number is still pending', () => {
    expect(transition('twilio_not_configured', 'send_ok')).toEqual({ ok: true, state: 'verification_sent' });
  });

  it('a wrong code does not destroy the update', () => {
    const failed = transition('verification_sent', 'code_fail');
    expect(failed).toEqual({ ok: true, state: 'verification_failed' });
    // They get another go. (The ATTEMPT LIMIT lives in the OTP core — this state machine must not silently become
    // a second, weaker limiter.)
    expect(transition('verification_failed', 'code_ok')).toEqual({ ok: true, state: 'phone_verified' });
  });

  it('an expired code can be resent', () => {
    expect(transition('verification_expired', 'send_ok')).toEqual({ ok: true, state: 'verification_sent' });
  });
});

describe('illegal moves are refused', () => {
  it('cannot activate a number that was never verified', () => {
    // The single most important refusal in the machine.
    for (const s of ['pending_phone_saved', 'verification_sent', 'verification_failed', 'duplicate_conflict'] as any[]) {
      expect(transition(s, 'activate').ok, s).toBe(false);
    }
  });

  it('cannot skip the duplicate check', () => {
    expect(transition('phone_validated', 'save_pending').ok).toBe(false);
  });

  it('cannot send a code before the number is saved', () => {
    expect(transition('phone_validated', 'send_ok').ok).toBe(false);
  });

  it('a cancelled update is over', () => {
    expect(isTerminal('update_canceled')).toBe(true);
    expect(transition('update_canceled', 'send_ok').ok).toBe(false);
  });
});

// ══ duplicates ════════════════════════════════════════════════════════════════════════════════════════════
const match = (o: Partial<PhoneMatch> = {}): PhoneMatch => ({
  customerId: 'other-1', tenantId: 't1', fullName: 'Bob Diaz',
  isSameCustomer: false, status: 'active_verified', ...o,
});

describe('duplicates are CLASSIFIED, never auto-merged', () => {
  it('no matches → no conflict', () => {
    const r = classifyDuplicates({ matches: [], customerId: 'c1', customerName: 'Sarah Chen' });
    expect(r.outcome).toBe('no_conflict');
    expect(r.requiresResolution).toBe(false);
  });

  it("the customer's OWN number is a no-op, not a conflict", () => {
    // Otherwise a receptionist re-saving a profile they had not actually changed would be blocked by a "conflict"
    // with the customer themselves.
    const r = classifyDuplicates({
      matches: [match({ customerId: 'c1', isSameCustomer: true, fullName: 'Sarah Chen' })],
      customerId: 'c1', customerName: 'Sarah Chen',
    });
    expect(r.outcome).toBe('same_customer');
    expect(r.requiresResolution).toBe(false);
  });

  it('a DIFFERENT person on the number blocks and asks — it does not merge', () => {
    // "Do not automatically merge customers only because they share a phone number." An automatic merge of the
    // wrong two people is close to impossible to undo, and it destroys two histories at once.
    const r = classifyDuplicates({ matches: [match()], customerId: 'c1', customerName: 'Sarah Chen' });
    expect(r.outcome).toBe('phone_in_use');
    expect(r.requiresResolution).toBe(true);
    expect(r.message).toMatch(/shared family phone/i);
  });

  it('the SAME name on one number is a PROBABLE DUPLICATE — flagged, still not merged', () => {
    const r = classifyDuplicates({
      matches: [match({ fullName: 'Sarah Chen' })],
      customerId: 'c1', customerName: 'Sarah Chen',
    });
    expect(r.outcome).toBe('probable_duplicate');
    expect(r.requiresResolution).toBe(true);
  });

  it('SHARED FAMILY PHONES are supported — staff can say so, and it is recorded', () => {
    // A salon's list is full of shared numbers: a mother books for her daughter, a husband's number is on his
    // wife's record. Refusing those updates would make the salon unable to record the truth.
    const r = classifyDuplicates({
      matches: [match({ fullName: 'Anna Chen' })],
      customerId: 'c1', customerName: 'Sarah Chen',
      staffAssertsSharedPhone: true,
    });
    expect(r.outcome).toBe('shared_family_phone');
    expect(r.requiresResolution).toBe(false);
  });

  it('THREE people on one number needs a MANAGER', () => {
    // Either a family or a mess — and a receptionist under time pressure should not be the one deciding which.
    const r = classifyDuplicates({
      matches: [match({ customerId: 'o1' }), match({ customerId: 'o2' })],
      customerId: 'c1', customerName: 'Sarah Chen',
    });
    expect(r.outcome).toBe('multiple_matches');
    expect(r.requiresManager).toBe(true);
  });
});

describe('a duplicate warning must not become a customer directory', () => {
  it('masks the other customer\u2019s name', () => {
    const r = classifyDuplicates({ matches: [match({ fullName: 'Bob Diaz' })], customerId: 'c1', customerName: 'Sarah Chen' });
    expect(r.matches[0].maskedName).toBe('Bob D.');
    expect(JSON.stringify(r)).not.toContain('Diaz');
  });

  it('never carries a phone number', () => {
    const r = classifyDuplicates({ matches: [match()], customerId: 'c1', customerName: 'Sarah Chen' });
    expect(JSON.stringify(r)).not.toMatch(/\d{7,}/);
  });
});

// ══ permissions ═══════════════════════════════════════════════════════════════════════════════════════════
describe('who may do what', () => {
  it('a receptionist may update and send a code — and nothing else', () => {
    expect(can('RECEPTION', 'update')).toBe(true);
    expect(can('RECEPTION', 'sendCode')).toBe(true);
    // The three that matter: a receptionist must not be able to mark a number verified without an SMS, resolve a
    // duplicate, or merge two people.
    expect(can('RECEPTION', 'manuallyConfirm')).toBe(false);
    expect(can('RECEPTION', 'resolveDuplicate')).toBe(false);
    expect(can('RECEPTION', 'merge')).toBe(false);
  });

  it('a manager may confirm manually and resolve duplicates — but not merge', () => {
    expect(can('MANAGER', 'manuallyConfirm')).toBe(true);
    expect(can('MANAGER', 'resolveDuplicate')).toBe(true);
    expect(can('MANAGER', 'merge')).toBe(false);   // merging destroys data; that is an owner's call
  });

  it('PLATFORM SUPPORT cannot edit a tenant\u2019s customer at all', () => {
    // Support does not get a side door into customer data. It goes through the audited support workflow, which is
    // where it can be seen.
    for (const c of ['update', 'sendCode', 'manuallyConfirm', 'merge'] as const) {
      expect(can('SUPER_ADMIN', c), c).toBe(false);
    }
  });

  it('a customer may change their OWN number but cannot judge somebody else\u2019s record', () => {
    expect(can('CUSTOMER', 'update')).toBe(true);
    expect(can('CUSTOMER', 'resolveDuplicate')).toBe(false);
    expect(can('CUSTOMER', 'manuallyConfirm')).toBe(false);
  });
});

// ══ the two flows ═════════════════════════════════════════════════════════════════════════════════════════
describe('the customer app verifies FIRST — and this is the whole safety argument', () => {
  it('customer_app = verify_then_activate', () => {
    // The customer is alone with their phone. If they mistype a digit and we swap the number immediately, we have
    // cut them off from their own account AND from every future code — including the one that would let them fix
    // it. The old number stays live until the new one answers.
    expect(activationPolicy('customer_app')).toBe('verify_then_activate');
  });

  it('staff POS may save pending — the customer is standing right there', () => {
    // A receptionist who mistypes can retype. And the salon needs to record what the customer just told them even
    // if the SMS never arrives.
    expect(activationPolicy('staff_pos')).toBe('save_pending_then_verify');
    expect(activationPolicy('kiosk')).toBe('save_pending_then_verify');
  });

  it('but NEITHER flow can make an unproven number active_verified', () => {
    // The line that does not move.
    expect(canCompleteBookingVerification('pending_verification')).toBe(false);
    expect(transition('pending_phone_saved', 'activate').ok).toBe(false);
  });
});
