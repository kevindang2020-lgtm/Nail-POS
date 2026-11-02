import { describe, it, expect } from 'vitest';
import { summariseBalance, resolveAttemptAmount, PartialAmountError } from './mobile-remaining-balance';

const a = (status: string, amountCents: number) => ({ status, amountCents });

describe('summariseBalance — confirmed consumes, in-flight reserves, released frees', () => {
  it('with no attempts, the whole total remains and nothing is paid', () => {
    const s = summariseBalance(10000, []);
    expect(s).toMatchObject({ confirmedCents: 0, inFlightCents: 0, remainingCents: 10000, isFullyPaid: false });
  });

  it('a confirmed attempt consumes its slice; two that sum to the total pay it in full', () => {
    expect(summariseBalance(10000, [a('confirmed', 4000)]).remainingCents).toBe(6000);
    const full = summariseBalance(10000, [a('confirmed', 4000), a('confirmed', 6000)]);
    expect(full).toMatchObject({ confirmedCents: 10000, remainingCents: 0, isFullyPaid: true });
  });

  it('an in-flight attempt reserves its slice but does not count as paid', () => {
    const s = summariseBalance(10000, [a('confirmed', 4000), a('authorization_pending', 6000)]);
    expect(s).toMatchObject({ confirmedCents: 4000, inFlightCents: 6000, remainingCents: 0, isFullyPaid: false });
  });

  it("'created' reserves too (a fresh attempt already holds its slice)", () => {
    expect(summariseBalance(10000, [a('created', 3000)]).remainingCents).toBe(7000);
  });

  it('released states free their slice — the balance is available again', () => {
    for (const dead of ['declined', 'timed_out', 'failed', 'canceled', 'voided', 'refunded']) {
      expect(summariseBalance(10000, [a(dead, 10000)]).remainingCents, dead).toBe(10000);
    }
  });

  it('a partial confirm plus a failed attempt leaves exactly the unpaid remainder', () => {
    const s = summariseBalance(10000, [a('confirmed', 3000), a('declined', 7000)]);
    expect(s).toMatchObject({ confirmedCents: 3000, inFlightCents: 0, remainingCents: 7000 });
  });
});

describe('resolveAttemptAmount — never charges more than what is left', () => {
  const remaining = (r: number) => summariseBalance(10000, r < 10000 ? [a('confirmed', 10000 - r)] : []);

  it('defaults to the whole remaining when no amount is given', () => {
    expect(resolveAttemptAmount(undefined, remaining(6000))).toBe(6000);
  });

  it('accepts a partial that fits and rejects one that exceeds the remaining', () => {
    expect(resolveAttemptAmount(2500, remaining(6000))).toBe(2500);
    expect(() => resolveAttemptAmount(6001, remaining(6000))).toThrow(PartialAmountError);
  });

  it('rejects a non-positive amount, and rejects any charge once fully paid', () => {
    expect(() => resolveAttemptAmount(0, remaining(6000))).toThrow(/greater than zero/);
    expect(() => resolveAttemptAmount(-100, remaining(6000))).toThrow(/greater than zero/);
    let code = '';
    try { resolveAttemptAmount(undefined, remaining(0)); } catch (e) { code = (e as PartialAmountError).code; }
    expect(code).toBe('already_paid');
  });

  it('M6-5: a balance held by an attempt in flight (or being verified) is NOT "already paid"', () => {
    const held = summariseBalance(10000, [{ status: 'unknown', amountCents: 10000 }], { paidCents: 0 });
    let code = '';
    try { resolveAttemptAmount(undefined, held); } catch (e) { code = (e as PartialAmountError).code; }
    expect(code).toBe('in_flight');
    const paid = summariseBalance(10000, [], { paidCents: 10000 });
    try { resolveAttemptAmount(undefined, paid); } catch (e) { code = (e as PartialAmountError).code; }
    expect(code).toBe('already_paid');
  });
});
