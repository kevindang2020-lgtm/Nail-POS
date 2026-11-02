// gift-card-fifo.vitest.spec.ts — Decision 31: a redemption spends the card's sales first in, first out, so a reload sold
// at another branch counts for THAT branch (before Oct 2 everything cleared to the card's first seller).
import { describe, it, expect } from 'vitest';
import { redemptionSources, buildBranchLiability, type CardHistoryRow } from './gift-cards.dto';

const row = (id: string, type: string, amountCents: number, branchId: string | null, idempotencyKey: string | null = null): CardHistoryRow => ({ id, type, amountCents, branchId, idempotencyKey });
const names = new Map([['A', 'Cherry Hill'], ['B', 'Moorestown'], ['C', 'Haddonfield']]);

describe('redemptionSources', () => {
  it("$50 sold at A, $40 reload at C, $60 redeemed at B → $50 from A, $10 from C", () => {
    const r = redemptionSources([row('1', 'issue', 5000, 'A'), row('2', 'reload', 4000, 'C'), row('3', 'redeem', 6000, 'B')], 'A');
    expect(r.get('3')).toEqual([{ branchId: 'A', cents: 5000 }, { branchId: 'C', cents: 1000 }]);
  });
  it('earlier redemptions use up the oldest value first; a reload booked as adjust "reload:" is a sale', () => {
    const r = redemptionSources([row('1', 'issue', 5000, 'A'), row('2', 'redeem', 3000, 'A'), row('3', 'adjust', 4000, 'C', 'reload:h1'), row('4', 'redeem', 3000, 'B')], 'A');
    expect(r.get('2')).toEqual([{ branchId: 'A', cents: 3000 }]);
    expect(r.get('4')).toEqual([{ branchId: 'A', cents: 2000 }, { branchId: 'C', cents: 1000 }]);
  });
  it('a negative adjustment or outgoing transfer spends value without a split; value coming back has no known seller and is spent first', () => {
    const r = redemptionSources([row('1', 'issue', 5000, 'A'), row('2', 'adjust', -1000, null), row('3', 'refund_reversal', 500, 'B'), row('4', 'redeem', 2000, 'B'), row('5', 'transfer', -1000, null), row('6', 'redeem', 2000, 'B')], 'A');
    expect(r.get('4')).toEqual([{ branchId: null, cents: 500 }, { branchId: 'A', cents: 1500 }]);
    expect(r.get('6')).toEqual([{ branchId: 'A', cents: 2000 }]);   // $15 of A's sale left + $5 beyond the known sales (card branch A)
  });
  it('spending more than the known sales (a card older than the ledger) falls back to the card branch', () => {
    expect(redemptionSources([row('1', 'redeem', 2500, 'B')], 'A').get('1')).toEqual([{ branchId: 'A', cents: 2500 }]);
  });
});

describe('buildBranchLiability with the split', () => {
  it('the report: A pays B $50, C pays B $10 (not A pays B $60)', () => {
    const r = buildBranchLiability([{ branchId: 'B', type: 'redeem', amountCents: 6000, idempotencyKey: null, soldBranchId: 'A', sourceSplits: [{ branchId: 'A', cents: 5000 }, { branchId: 'C', cents: 1000 }] }], names);
    expect(r.transfers.map((t) => [t.fromBranchName, t.toBranchName, t.amountCents])).toEqual([['Cherry Hill', 'Moorestown', 5000], ['Haddonfield', 'Moorestown', 1000]]);
  });
  it('value spent where it was sold clears nothing; value with no known seller is reported as not cleared', () => {
    const r = buildBranchLiability([{ branchId: 'B', type: 'redeem', amountCents: 3000, idempotencyKey: null, sourceSplits: [{ branchId: 'B', cents: 2000 }, { branchId: null, cents: 1000 }] }], names);
    expect(r.transfers).toEqual([]);
    expect(r.unclearableRedeemedCents).toBe(1000);
  });
});
