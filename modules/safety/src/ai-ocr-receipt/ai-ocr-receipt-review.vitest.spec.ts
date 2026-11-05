// ai-ocr-receipt-review.vitest.spec.ts — review + approval. Corrections record before/after and never mutate; approval
// rules only raise the bar; and a document is not 'approved' until the required number of DISTINCT approvers sign off.
import { describe, it, expect } from 'vitest';
import { applyFieldCorrection, evaluateApprovalRequirement, applyDecision, isApproved, type ReviewDecisionState } from './ai-ocr-receipt-review';

const rules = { requireApprovalAboveCents: 25000, dualApprovalAboveCents: 100000, restrictedCategories: ['equipment'] };

describe('field corrections', () => {
  it('records before/after, marks state, stays pure', () => {
    const field = { fieldKey: 'total', value: '$100.00', valueCents: 10000, state: 'low' as const };
    const corr = applyFieldCorrection(field, { value: '$105.00', valueCents: 10500, userId: 'u1' });
    expect(corr.field.valueCents).toBe(10500);
    expect(corr.field.state).toBe('manually_corrected');
    expect(corr.audit.before.valueCents).toBe(10000);
    expect(field.valueCents).toBe(10000); // untouched
    expect(applyFieldCorrection(field, { userId: 'u2', confirmOnly: true }).field.state).toBe('manually_confirmed');
  });
});

describe('approval requirement', () => {
  it('only raises the bar', () => {
    expect(evaluateApprovalRequirement({ totalCents: 5000, category: 'supplies' }, rules).approversRequired).toBe(1);
    expect(evaluateApprovalRequirement({ totalCents: 150000, category: 'supplies' }, rules).approversRequired).toBe(2);
    expect(evaluateApprovalRequirement({ totalCents: 30000, category: 'supplies' }, rules).reasons).toContain('amount_over_approval_threshold');
    expect(evaluateApprovalRequirement({ totalCents: 100, category: 'equipment' }, rules).restricted).toBe(true);
  });
});

describe('decision engine', () => {
  it('finalizes only with enough distinct approvers', () => {
    const req1 = { approversRequired: 1, restricted: false, reasons: [] };
    const single = applyDecision({ status: 'in_review', approvals: [] }, { userId: 'a1', action: 'approve', at: 't1' }, req1);
    expect(single.state.status).toBe('approved');
    expect(isApproved(single.state, req1)).toBe(true);

    const req2 = { approversRequired: 2, restricted: false, reasons: [] };
    let s: ReviewDecisionState = applyDecision({ status: 'in_review', approvals: [] }, { userId: 'a1', action: 'approve', at: 't1' }, req2).state;
    expect(s.status).toBe('in_review');
    const dupe = applyDecision(s, { userId: 'a1', action: 'approve', at: 't2' }, req2);
    expect(dupe.state.status).toBe('in_review');
    expect(dupe.error).toBe('duplicate_approver_ignored');
    expect(applyDecision(s, { userId: 'a2', action: 'approve', at: 't3' }, req2).state.status).toBe('approved');
  });
  it('handles reject/return and blocks decisions on final docs', () => {
    const req1 = { approversRequired: 1, restricted: false, reasons: [] };
    expect(applyDecision({ status: 'in_review', approvals: [] }, { userId: 'a1', action: 'reject', at: 't' }, req1).state.status).toBe('rejected');
    expect(applyDecision({ status: 'in_review', approvals: [] }, { userId: 'a1', action: 'return', at: 't' }, req1).state.status).toBe('returned');
    expect(applyDecision({ status: 'approved', approvals: [{ userId: 'a1', at: 't' }] }, { userId: 'a2', action: 'approve', at: 't2' }, req1).error).toBe('already_final');
  });
});
