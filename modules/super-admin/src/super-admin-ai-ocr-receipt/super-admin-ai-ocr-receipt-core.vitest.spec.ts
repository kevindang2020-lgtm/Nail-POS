// super-admin-ai-ocr-receipt-core.vitest.spec.ts — platform oversight is counts-only (no tenant document content), and
// tenant support access is role-gated, reason-required, and time-limited.
import { describe, it, expect } from 'vitest';
import { buildPlatformOverview, evaluateSupportAccess, isSupportSessionActive, operationalTenantSummary } from './super-admin-ai-ocr-receipt-core';

describe('platform overview', () => {
  it('aggregates operational counts only', () => {
    const ov = buildPlatformOverview({ enabledTenants: 3, statuses: [{ pipelineState: 'review_required' }, { pipelineState: 'review_required' }, { pipelineState: 'posted' }, { pipelineState: 'failed' }, { pipelineState: 'quarantined' }] });
    expect(ov).toMatchObject({ totalDocuments: 5, reviewBacklog: 2, postingFailures: 1, quarantined: 1, ocrFailureRate: 0.2 });
    expect(Object.keys(ov)).not.toContain('vendor');
  });
});

describe('support access gate', () => {
  it('requires role, tenant, reason, and expires', () => {
    expect(evaluateSupportAccess({ role: 'viewer', tenantId: 'T1', reason: 'investigating issue', nowMs: 0 }).granted).toBe(false);
    expect(evaluateSupportAccess({ role: 'super_admin', tenantId: null, reason: 'investigating issue', nowMs: 0 }).error).toBe('TENANT_REQUIRED');
    expect(evaluateSupportAccess({ role: 'super_admin', tenantId: 'T1', reason: 'x', nowMs: 0 }).error).toBe('REASON_REQUIRED');
    const grant = evaluateSupportAccess({ role: 'super_admin', tenantId: 'T1', reason: 'debugging failed posting', nowMs: 1000, sessionTtlMs: 60000 });
    expect(grant.granted).toBe(true);
    expect(grant.audit?.action).toBe('support_mode_started');
    expect(isSupportSessionActive(grant, 30000)).toBe(true);
    expect(isSupportSessionActive(grant, 99999)).toBe(false);
  });
  it('tenant summary exposes counts only', () => {
    expect(Object.keys(operationalTenantSummary({ tenantId: 'T1', documentCount: 10, byStatus: { posted: 5 }, storageBytes: 1000 })).sort()).toEqual(['byStatus', 'documentCount', 'storageBytes', 'tenantId']);
  });
});
