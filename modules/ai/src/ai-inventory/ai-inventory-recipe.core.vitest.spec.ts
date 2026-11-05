// ai-inventory-recipe.core.vitest.spec.ts — pure recipe validation + lifecycle.
import { describe, it, expect } from 'vitest';
import { validateDraft, canApprove, canArchive, nextVersion, scopeKey, type RecipeDraftInput } from './ai-inventory-recipe.core';

const draft = (o: Partial<RecipeDraftInput> = {}): RecipeDraftInput => ({
  serviceId: 'svc1',
  lines: [{ productId: 'p1', expectedQuantity: 4, consumptionUnit: 'mL', wasteAllowancePct: 10 }],
  ...o,
});

describe('validateDraft', () => {
  it('accepts a valid draft', () => expect(validateDraft(draft())).toBeNull());
  it('requires a service', () => expect(validateDraft(draft({ serviceId: '' }))).toMatch(/serviceId/));
  it('requires at least one line', () => expect(validateDraft(draft({ lines: [] }))).toMatch(/at least one/));
  it('rejects negative quantity', () => expect(validateDraft(draft({ lines: [{ productId: 'p1', expectedQuantity: -1, consumptionUnit: 'mL' }] }))).toMatch(/non-negative/));
  it('requires a consumption unit', () => expect(validateDraft(draft({ lines: [{ productId: 'p1', expectedQuantity: 1, consumptionUnit: '' }] }))).toMatch(/consumptionUnit/));
  it('rejects duplicate supplies', () => expect(validateDraft(draft({ lines: [
    { productId: 'p1', expectedQuantity: 1, consumptionUnit: 'mL' },
    { productId: 'p1', expectedQuantity: 2, consumptionUnit: 'mL' },
  ] }))).toMatch(/Duplicate/));
  it('bounds waste allowance', () => expect(validateDraft(draft({ lines: [{ productId: 'p1', expectedQuantity: 1, consumptionUnit: 'mL', wasteAllowancePct: 150 }] }))).toMatch(/wasteAllowancePct/));
});

describe('lifecycle', () => {
  it('only drafts can be approved', () => {
    expect(canApprove('draft')).toBe(true);
    expect(canApprove('approved')).toBe(false);
    expect(canApprove('archived')).toBe(false);
  });
  it('non-archived can be archived', () => {
    expect(canArchive('draft')).toBe(true);
    expect(canArchive('approved')).toBe(true);
    expect(canArchive('archived')).toBe(false);
  });
  it('nextVersion increments the max', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1, 2, 5])).toBe(6);
  });
  it('scopeKey folds null branch to sentinel', () => {
    expect(scopeKey(null)).toBe('00000000-0000-0000-0000-000000000000');
    expect(scopeKey('b1')).toBe('b1');
  });
});
