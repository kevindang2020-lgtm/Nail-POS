import { describe, it, expect } from 'vitest';
import { parseSnapshot, redemptionToCompEntry, MEMBERSHIP_COMP_REASON_PREFIX } from './membership-compensation-core';

describe('parseSnapshot', () => {
  it('reads the frozen split from valid JSON', () => {
    const s = parseSnapshot(JSON.stringify({ basis: 'standard', techCents: 3600, ownerCents: 2400, eligibleCents: 6000 }));
    expect(s).toEqual({ techCents: 3600, ownerCents: 2400, eligibleCents: 6000, basis: 'standard' });
  });
  it('returns null for missing or garbage input', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('not json')).toBeNull();
  });
  it('coerces negatives/non-numbers to zero and defaults basis', () => {
    const s = parseSnapshot(JSON.stringify({ techCents: -5, ownerCents: 'x' }));
    expect(s).toEqual({ techCents: 0, ownerCents: 0, eligibleCents: 0, basis: 'allocated' });
  });
});

describe('redemptionToCompEntry', () => {
  it('credits the technician their frozen techCents', () => {
    const e = redemptionToCompEntry({ redemptionId: 'r1', serviceLineId: 'sl1', technicianId: 't1', commissionBasisSnapshot: JSON.stringify({ basis: 'allocated', techCents: 3000 }) });
    expect(e).toEqual({ technicianId: 't1', serviceLineId: 'sl1', amountCents: 3000, reason: `${MEMBERSHIP_COMP_REASON_PREFIX} · allocated basis`, redemptionId: 'r1' });
  });
  it('skips when there is no technician', () => {
    expect(redemptionToCompEntry({ redemptionId: 'r2', serviceLineId: 'sl2', technicianId: null, commissionBasisSnapshot: JSON.stringify({ techCents: 3000 }) })).toBeNull();
  });
  it('skips when tech earnings are zero', () => {
    expect(redemptionToCompEntry({ redemptionId: 'r3', serviceLineId: 'sl3', technicianId: 't1', commissionBasisSnapshot: JSON.stringify({ techCents: 0 }) })).toBeNull();
  });
  it('skips on a null/garbage snapshot', () => {
    expect(redemptionToCompEntry({ redemptionId: 'r4', serviceLineId: 'sl4', technicianId: 't1', commissionBasisSnapshot: null })).toBeNull();
  });
});
