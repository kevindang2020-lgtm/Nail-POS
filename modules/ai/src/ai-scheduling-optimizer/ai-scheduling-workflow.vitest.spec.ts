// ai-scheduling-workflow.vitest.spec.ts — the state machine only reaches 'applied' via accepted → application_pending;
// confirmed-appointment changes must pass customer_approval_required → customer_approved first; consent is an explicit
// external input; and a customer proposal preserves the original appointment until (and unless) the customer approves.
import { describe, it, expect } from 'vitest';
import { transition, canApply, isTerminal, createProposal, recordCustomerDecision, applyStaffDecision, type RecState } from './ai-scheduling-workflow';

describe('recommendation state machine', () => {
  it('walks the non-customer path only through accept + queue', () => {
    let s: RecState = 'generated';
    const step = (e: any, c?: any) => { s = transition(s, e, c).state; return s; };
    expect(step('submit_for_review')).toBe('review_required');
    expect(step('start_review')).toBe('review_in_progress');
    expect(step('accept', { requiresCustomerApproval: false })).toBe('accepted');
    expect(step('queue_application')).toBe('application_pending');
    expect(step('apply_ok')).toBe('applied');
    expect(isTerminal('applied')).toBe(true);
  });
  it('requires customer approval for confirmed-appointment changes', () => {
    let c: RecState = 'review_in_progress';
    const step = (e: any, x?: any) => { c = transition(c, e, x).state; return c; };
    expect(step('accept', { requiresCustomerApproval: true })).toBe('customer_approval_required');
    expect(step('customer_approve')).toBe('customer_approved');
    expect(step('queue_application')).toBe('application_pending');
    expect(step('apply_ok')).toBe('applied');
    expect(transition('customer_approval_required', 'customer_reject').state).toBe('rejected');
    expect(transition('customer_approval_required', 'queue_application' as any).ok).toBe(false);
  });
  it('forbids skipping to applied and handles failure/rollback', () => {
    expect(transition('review_in_progress', 'apply_ok' as any).ok).toBe(false);
    expect(transition('accepted', 'apply_ok' as any).ok).toBe(false);
    expect(canApply('application_pending')).toBe(true);
    expect(canApply('accepted')).toBe(false);
    expect(transition('application_pending', 'apply_fail').state).toBe('application_failed');
    expect(transition('application_failed', 'retry').state).toBe('application_pending');
    expect(transition('applied', 'rollback').state).toBe('rolled_back');
    expect(transition('applied', 'expire' as any).ok).toBe(false);
  });
});

describe('customer proposal', () => {
  it('preserves the original until approval and honors expiry', () => {
    const prop = createProposal({ appointmentId: 'ap1', recommendationId: 'r1', proposedStart: 'x', proposedEnd: 'y', nowMs: 1000 });
    expect(prop.originalPreserved).toBe(true);
    expect(recordCustomerDecision(prop, true, 2000).proposal.originalPreserved).toBe(false);
    expect(recordCustomerDecision(prop, false, 2000).proposal.originalPreserved).toBe(true);
    expect(recordCustomerDecision(prop, true, prop.expiresAtMs + 1).error).toBe('expired');
  });
});

describe('staff decisions', () => {
  it('advances state and requires a reason to edit', () => {
    expect(applyStaffDecision('review_in_progress', { userId: 'u', action: 'accept', at: 't' }, { requiresCustomerApproval: false }).state).toBe('accepted');
    expect(applyStaffDecision('review_in_progress', { userId: 'u', action: 'edit', at: 't' }).error).toBe('edit_requires_reason');
    expect(applyStaffDecision('review_in_progress', { userId: 'u', action: 'edit', reason: 'fix', at: 't' }).error).toBeUndefined();
    expect(applyStaffDecision('review_in_progress', { userId: 'u', action: 'reject', reason: 'no', at: 't' }).audit.after).toBe('rejected');
  });
});
