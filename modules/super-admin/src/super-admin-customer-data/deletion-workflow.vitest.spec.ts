import { describe, it, expect } from 'vitest';
import { validateRequest, canApprove, validateExecute } from './deletion-workflow';

describe('deletion-workflow engine', () => {
  it('request requires tenant, customer, and reason', () => {
    expect(validateRequest({}).ok).toBe(false);
    expect(validateRequest({ tenantId: 't1', customerId: 'c1', reason: 'GDPR erasure' }).ok).toBe(true);
  });

  it('approval requires a distinct second approver on a requested deletion', () => {
    expect(canApprove('requested', 'u1', 'u2').ok).toBe(true);
    const same = canApprove('requested', 'u1', 'u1');
    expect(same.ok).toBe(false);
    expect(same.errors.join(' ')).toMatch(/different person/i);
    expect(canApprove('approved', 'u1', 'u2').ok).toBe(false); // already approved
    expect(canApprove('requested', 'u1', null).ok).toBe(false); // no approver identity
  });

  it('execute requires approved + exact typed confirmation + retention ok + no hold', () => {
    const base = { status: 'approved' as const, customerId: 'CUS-1', typedConfirmation: 'CUS-1', retentionOk: true, legalHoldBlocked: false };
    expect(validateExecute(base).ok).toBe(true);
    expect(validateExecute({ ...base, typedConfirmation: 'CUS-2' }).ok).toBe(false);
    expect(validateExecute({ ...base, status: 'requested' }).ok).toBe(false);
    expect(validateExecute({ ...base, retentionOk: false }).ok).toBe(false);
    const held = validateExecute({ ...base, legalHoldBlocked: true });
    expect(held.ok).toBe(false);
    expect(held.errors.join(' ')).toMatch(/legal hold/i);
  });

  it('reports every failed precondition at once', () => {
    const r = validateExecute({ status: 'requested', customerId: 'CUS-1', typedConfirmation: 'wrong', retentionOk: false, legalHoldBlocked: true });
    expect(r.errors.length).toBe(4);
  });
});
