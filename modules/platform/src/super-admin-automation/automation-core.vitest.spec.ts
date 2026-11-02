import { describe, it, expect } from 'vitest';
import {
  isTrigger, isAllowedAction, isSensitiveAction, TRIGGER_CATEGORY, evaluateConditions, idempotencyKey,
  loopDepthExceeded, classifyFailure, isRetryable, successRatePct, distribution, trendOf, type ConditionGroup,
} from './automation-core';

describe('automation-core catalogs', () => {
  it('validates structured triggers + maps to categories', () => {
    expect(isTrigger('TENANT_PAYMENT_FAILED')).toBe(true);
    expect(isTrigger('rm -rf /')).toBe(false);
    expect(TRIGGER_CATEGORY.TENANT_PAYMENT_FAILED).toBe('billing');
    expect(TRIGGER_CATEGORY.DEVICE_OFFLINE).toBe('devices');
  });
  it('allowlists actions and flags sensitive ones', () => {
    expect(isAllowedAction('send_email')).toBe(true);
    expect(isAllowedAction('exec_shell')).toBe(false);           // arbitrary code never allowed
    expect(isSensitiveAction('activate_payment_configuration')).toBe(true);
    expect(isSensitiveAction('send_email')).toBe(false);
  });
});

describe('automation-core condition engine (no eval)', () => {
  const grp: ConditionGroup = { logic: 'and', conditions: [{ field: 'amount', operator: 'gt', value: 100 }], groups: [{ logic: 'or', conditions: [{ field: 'status', operator: 'eq', value: 'failed' }, { field: 'retries', operator: 'gte', value: 3 }] }] };
  it('evaluates AND/OR groups and returns a per-condition trace', () => {
    const pass = evaluateConditions(grp, { amount: 250, status: 'failed', retries: 0 });
    expect(pass.passed).toBe(true);
    expect(pass.trace.length).toBe(3);
    const fail = evaluateConditions(grp, { amount: 50, status: 'failed' });
    expect(fail.passed).toBe(false);   // amount gt 100 fails
  });
  it('empty group passes; depth is bounded', () => {
    expect(evaluateConditions(undefined, {}).passed).toBe(true);
    expect(evaluateConditions({ logic: 'and', conditions: [] }, {}).passed).toBe(true);
  });
});

describe('automation-core idempotency + loop guard', () => {
  it('same trigger event ⇒ identical idempotency key', () => {
    const a = idempotencyKey({ ruleVersionId: 'v1', triggerEventId: 'e1', tenantId: 't1', entityId: 'x' });
    const b = idempotencyKey({ ruleVersionId: 'v1', triggerEventId: 'e1', tenantId: 't1', entityId: 'x' });
    expect(a).toBe(b);
    expect(idempotencyKey({ ruleVersionId: 'v1', triggerEventId: 'e2', tenantId: 't1' })).not.toBe(a);
  });
  it('loop depth guard trips past the max', () => {
    expect(loopDepthExceeded(5)).toBe(false);
    expect(loopDepthExceeded(6)).toBe(true);
  });
});

describe('automation-core failure classification', () => {
  it('classifies temporary / permanent / safety', () => {
    expect(classifyFailure('Email Service Timeout')).toBe('temporary');
    expect(classifyFailure('Provider rate limit')).toBe('temporary');
    expect(classifyFailure('Invalid condition parameter')).toBe('permanent');
    expect(classifyFailure('Loop detected at depth 6')).toBe('safety');
    expect(isRetryable('network error')).toBe(true);
    expect(isRetryable('unauthorized action')).toBe(false);
  });
});

describe('automation-core rollups', () => {
  it('success rate + distribution reconcile', () => {
    expect(successRatePct(17984, 18130)).toBe(99.2);
    const d = distribution([{ key: 'active', count: 71 }, { key: 'draft', count: 16 }, { key: 'error', count: 8 }, { key: 'disabled', count: 5 }]);
    expect(d.total).toBe(100);
    expect(d.slices[0].key).toBe('active');
    expect(d.slices.reduce((a, s) => a + s.count, 0)).toBe(100);
  });
  it('business-semantic trends: failures/avg-time up is unfavorable, neutral where unset', () => {
    expect(trendOf('failedAutomations', 146, 123)?.favorable).toBe(false);
    expect(trendOf('avgExecutionMs', 74000, 83000)?.favorable).toBe(true);   // faster is better
    expect(trendOf('successfulAutomations', 17984, 16000)?.favorable).toBe(true);
    expect(trendOf('tenantExceptions', 37, 33)?.favorable).toBeNull();       // neutral
  });
});
