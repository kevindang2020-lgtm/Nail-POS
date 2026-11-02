// booking-verification-fraud.vitest.spec.ts
//
// The `send` endpoint emits an outbound SMS, to a number of the caller's choosing, billed to a salon that has
// never heard of them. Three attacks, and only one of them is caught by the per-phone cooldown:
//
//   SMS PUMPING     codes to a premium-rate range the attacker profits from. Each number asked ONCE, so the
//                   cooldown NEVER fires. The salon pays. The bill arrives a month later.
//   SPRAY           one source, many numbers. Cooldown never fires — that is what makes it work.
//   HARASSMENT      many codes at one number. This one the cooldown DOES catch.
//
// And the constraint that shapes everything: *"Do not automatically label a legitimate customer as fraudulent."*
// A real customer on hotel wifi, retrying a code that never arrived, looks like an attacker to every naive
// heuristic. So `block` is reserved for what a real booking CANNOT produce, and everything survivable is a
// CAPTCHA — which costs a human three seconds and a script the whole attack.
import { describe, it, expect } from 'vitest';
import { assessSendRisk, destinationRisk, NotConfiguredCaptcha, T, type RiskSignals } from './booking-verification-fraud';

const clean = (over: Partial<RiskSignals> = {}): RiskSignals => ({
  ipCodesLastHour: 1,
  ipDistinctPhonesLastHour: 1,
  deviceCodesLastHour: 1,
  ipFailedChecksLastHour: 0,
  abandonedHoldsLastHour: 0,
  phoneCodesLastHour: 1,
  destination: 'normal',
  novelCountryForTenant: false,
  ...over,
});

describe('a normal customer is not harassed', () => {
  it('allows a first-time booking outright', () => {
    const r = assessSendRisk(clean());
    expect(r.action).toBe('allow');
    expect(r.score).toBe(0);
  });

  it('allows a customer who asks for one resend', () => {
    // A code that never arrived is the single most common REAL reason to hit this endpoint twice.
    const r = assessSendRisk(clean({ phoneCodesLastHour: 2, ipCodesLastHour: 2 }));
    expect(r.action).toBe('allow');
  });

  it('a novel country ALONE is worth nothing — every salon has a first foreign customer', () => {
    const r = assessSendRisk(clean({ novelCountryForTenant: true }));
    expect(r.action).toBe('allow');
    expect(r.reasons).not.toContain('novel_country');
  });
});

describe('SMS PUMPING — the expensive attack the cooldown cannot see', () => {
  it('BLOCKS a premium-rate destination outright', () => {
    // The attacker owns (or is paid by) the terminating range and takes a cut of the fee. Each number is asked
    // for exactly ONE code, so no per-phone limit ever fires. This rule is the only thing that stops it before
    // the bill — which arrives a month later, when it is somebody's problem and nobody's fault.
    const r = assessSendRisk(clean({ destination: 'premium_rate' }));
    expect(r.action).toBe('block');
    expect(r.reasons).toContain('destination_premium_rate');
    expect(r.score).toBe(100);
  });

  it('blocks it even when every other signal looks perfectly innocent', () => {
    // This is what a competent pumping run looks like: low volume, one code per number, clean IP. It must not be
    // possible to launder a premium destination past this by simply being polite about it.
    const r = assessSendRisk(clean({ destination: 'premium_rate', ipCodesLastHour: 1, ipDistinctPhonesLastHour: 1, phoneCodesLastHour: 1 }));
    expect(r.action).toBe('block');
  });

  it('a merely FOREIGN destination is a challenge, NOT a block', () => {
    // A real customer may be travelling. Refusing them to save a few cents of SMS is the wrong trade in the wrong
    // direction — that customer is lost, and the salon never finds out why.
    const r = assessSendRisk(clean({ destination: 'high_cost' }));
    expect(r.action).not.toBe('block');
  });
});

describe('SPRAY — one source, many numbers', () => {
  it('challenges at the spray threshold', () => {
    const r = assessSendRisk(clean({ ipDistinctPhonesLastHour: T.SPRAY_PHONES_CHALLENGE, ipCodesLastHour: 5 }));
    expect(['challenge', 'slow']).toContain(r.action);
    expect(r.reasons).toContain('multiple_phones_one_source');
  });

  it('BLOCKS an obvious walk of a number list', () => {
    const r = assessSendRisk(clean({ ipDistinctPhonesLastHour: T.SPRAY_PHONES_BLOCK }));
    expect(r.action).toBe('block');
    expect(r.reasons).toContain('spray_distinct_phones');
  });

  it('does NOT block a family booking from one household', () => {
    // Two or three people booking from one home wifi is a normal Saturday, not an attack.
    const r = assessSendRisk(clean({ ipDistinctPhonesLastHour: 2, ipCodesLastHour: 2 }));
    expect(r.action).toBe('allow');
  });
});

describe('HARASSMENT and BRUTE FORCE', () => {
  it('blocks repeated codes hammered at one number', () => {
    // Somebody using our sender to text a stranger. That is harassment, on the salon's bill.
    const r = assessSendRisk(clean({ phoneCodesLastHour: T.PHONE_CODES_BLOCK }));
    expect(r.action).toBe('block');
    expect(r.reasons).toContain('phone_harassment');
  });

  it('blocks code guessing', () => {
    const r = assessSendRisk(clean({ ipFailedChecksLastHour: T.FAILED_CHECKS_BLOCK }));
    expect(r.action).toBe('block');
    expect(r.reasons).toContain('brute_force_codes');
  });

  it('challenges a few failed attempts rather than blocking — people mistype', () => {
    const r = assessSendRisk(clean({ ipFailedChecksLastHour: T.FAILED_CHECKS_CHALLENGE }));
    expect(r.action).not.toBe('block');
  });
});

describe('the calendar-denial pattern', () => {
  it('flags a device taking holds and never finishing', () => {
    const r = assessSendRisk(clean({ abandonedHoldsLastHour: T.ABANDONED_HOLDS_CHALLENGE, ipCodesLastHour: 5 }));
    expect(r.reasons).toContain('abandoned_holds');
    expect(r.action).not.toBe('allow');
  });
});

describe('the reasons never leak a phone number', () => {
  it('carries machine-readable causes only', () => {
    const r = assessSendRisk(clean({ destination: 'high_cost', ipDistinctPhonesLastHour: 4, ipFailedChecksLastHour: 6 }));
    expect(JSON.stringify(r)).not.toMatch(/\d{7,}/);
    for (const reason of r.reasons) expect(reason).toMatch(/^[a-z_]+$/);
  });
});

describe('destinationRisk', () => {
  it('treats the tenant\u2019s own country as normal', () => {
    expect(destinationRisk('+15551234567', '1')).toBe('normal');
    expect(destinationRisk('+442071234567', '44')).toBe('normal');
  });

  it('flags premium-rate and satellite ranges — nobody books a manicure from a satellite phone', () => {
    for (const n of ['+8821234567', '+8831234567', '+8701234567', '+8811234567']) {
      expect(destinationRisk(n, '1'), n).toBe('premium_rate');
    }
  });

  it('treats a foreign destination as high-cost, not premium', () => {
    expect(destinationRisk('+442071234567', '1')).toBe('high_cost');
  });

  it('treats an unparseable number as elevated — we do not know what it is', () => {
    expect(destinationRisk('5551234567', '1')).toBe('elevated');   // no +, not E.164
    expect(destinationRisk('', '1')).toBe('elevated');
  });
});

describe('CAPTCHA — the unconfigured adapter FAILS CLOSED', () => {
  it('refuses a challenge it cannot perform', async () => {
    // If a request scores 90, demands a CAPTCHA, finds none configured, and is then waved through, the entire
    // risk engine is decorative. A tenant with no CAPTCHA provider sees challenged requests REFUSED — a
    // configuration problem with a loud symptom, which is the only kind worth having.
    const c = new NotConfiguredCaptcha();
    expect(await c.verify('any-token')).toBe(false);
    expect(c.provider).toBe('none');
  });
});
