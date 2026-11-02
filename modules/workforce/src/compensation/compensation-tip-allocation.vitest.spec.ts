// compensation-tip-allocation.vitest.spec.ts — manual tip allocation rules (Payroll mandate §22–§28): Σ == tip, only
// technicians on the ticket, and a PAID ticket's correction is a signed delta per technician (never a snapshot edit).
import { describe, it, expect } from 'vitest';
import { validateTipAllocation, tipCorrectionDeltas } from './compensation-tip-allocation.service';
import { splitTipByPaymentMethod } from './compensation.kysely.ports';

describe('validateTipAllocation', () => {
  const eligible = new Set(['lisa', 'mary']);
  it('accepts an explicit split that sums to the tip (the mandate\'s $15.00 / $6.01)', () => {
    expect(validateTipAllocation(2101, [{ technicianId: 'lisa', tipCents: 1500 }, { technicianId: 'mary', tipCents: 601 }], eligible)).toEqual([]);
  });
  it('refuses a sum mismatch, a duplicate technician, a non-integer, a negative, an outsider, and an empty list', () => {
    expect(validateTipAllocation(2101, [{ technicianId: 'lisa', tipCents: 1500 }], eligible)[0]).toMatch(/total 1500 but the ticket tip is 2101/);
    expect(validateTipAllocation(2000, [{ technicianId: 'lisa', tipCents: 1000 }, { technicianId: 'lisa', tipCents: 1000 }], eligible).join(' ')).toMatch(/appears twice/);
    expect(validateTipAllocation(2000, [{ technicianId: 'lisa', tipCents: 10.5 }, { technicianId: 'mary', tipCents: 1989.5 }], eligible).join(' ')).toMatch(/non-negative integer/);
    expect(validateTipAllocation(2000, [{ technicianId: 'lisa', tipCents: -1 }, { technicianId: 'mary', tipCents: 2001 }], eligible).join(' ')).toMatch(/non-negative integer/);
    expect(validateTipAllocation(2000, [{ technicianId: 'zoe', tipCents: 2000 }], eligible).join(' ')).toMatch(/did not work this ticket/);
    expect(validateTipAllocation(2000, [], eligible)).toEqual(['allocations[] is required.']);
    expect(validateTipAllocation(2000, undefined, eligible)).toEqual(['allocations[] is required.']);
  });
  it('with no eligibility set (nothing known about the ticket) only the sum rule applies', () => {
    expect(validateTipAllocation(100, [{ technicianId: 'anyone', tipCents: 100 }], new Set())).toEqual([]);
  });
});

describe('tipCorrectionDeltas — a paid ticket keeps its snapshot; the ledger carries the signed difference', () => {
  it('moving $21.01 from a 50/50 (10.51 / 10.50) to an explicit 15.00 / 6.01 yields deltas that net to zero', () => {
    const d = tipCorrectionDeltas([{ technicianId: 'lisa', tipCents: 1500 }, { technicianId: 'mary', tipCents: 601 }], new Map([['lisa', 1051], ['mary', 1050]]), new Map());
    expect(d).toEqual(expect.arrayContaining([{ technicianId: 'lisa', deltaCents: 449 }, { technicianId: 'mary', deltaCents: -449 }]));
    expect(d.reduce((s, x) => s + x.deltaCents, 0)).toBe(0);
  });
  it('a second correction is net of the first (idempotent re-submission produces no delta)', () => {
    const d = tipCorrectionDeltas([{ technicianId: 'lisa', tipCents: 1500 }, { technicianId: 'mary', tipCents: 601 }], new Map([['lisa', 1051], ['mary', 1050]]), new Map([['lisa', 449], ['mary', -449]]));
    expect(d).toEqual([]);
  });
  it('a technician dropped from the split is reversed in full; a newcomer gets the whole target', () => {
    const d = tipCorrectionDeltas([{ technicianId: 'zoe', tipCents: 2101 }], new Map([['lisa', 1051], ['mary', 1050]]), new Map());
    expect(d).toEqual(expect.arrayContaining([{ technicianId: 'lisa', deltaCents: -1051 }, { technicianId: 'mary', deltaCents: -1050 }, { technicianId: 'zoe', deltaCents: 2101 }]));
    expect(d.reduce((s, x) => s + x.deltaCents, 0)).toBe(0);
  });
});

describe('splitTipByPaymentMethod — card vs cash from the payment rows, Σ == the ticket tip (§26, §29)', () => {
  it('reads settled payments by method', () => {
    expect(splitTipByPaymentMethod(2000, [{ method: 'card', tip_cents: 1500, status: 'approved' }, { method: 'cash', tip_cents: 500, status: 'approved' }], 'card')).toEqual({ cardTipCents: 1500, cashTipCents: 500 });
  });
  it('ignores unsettled rows and falls back to the chosen method when no payment carries the tip', () => {
    expect(splitTipByPaymentMethod(2000, [{ method: 'card', tip_cents: 2000, status: 'declined' }], 'cash')).toEqual({ cardTipCents: 0, cashTipCents: 2000 });
    expect(splitTipByPaymentMethod(2000, [], null)).toEqual({ cardTipCents: 2000, cashTipCents: 0 });
    expect(splitTipByPaymentMethod(0, [], 'cash')).toEqual({ cardTipCents: 0, cashTipCents: 0 });
  });
  it('keeps the ticket total when the payments disagree (tip added after a partial payment) — the remainder goes to the dominant rail', () => {
    expect(splitTipByPaymentMethod(2101, [{ method: 'card', tip_cents: 1000, status: 'approved' }, { method: 'cash', tip_cents: 500, status: 'approved' }], 'card')).toEqual({ cardTipCents: 1601, cashTipCents: 500 });
    const r = splitTipByPaymentMethod(500, [{ method: 'card', tip_cents: 1000, status: 'approved' }], 'card');
    expect(r.cardTipCents + r.cashTipCents).toBe(500);
    expect(r.cashTipCents).toBeGreaterThanOrEqual(0); expect(r.cardTipCents).toBeGreaterThanOrEqual(0);
  });
});
