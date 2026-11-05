// super-admin-ai-review-reputation.vitest.spec.ts — Super Admin oversight exposes platform/tenant OPERATIONAL
// aggregates only (never review content), and the per-tenant drill-down is reason-required and audited.
import { describe, it, expect } from 'vitest';
import { buildReputationPlatformOverview, buildReputationTenantView, SuperAdminAiReviewReputationService, SuperAdminReputationError } from './super-admin-ai-review-reputation.service';

describe('platform + tenant overview (operational only)', () => {
  it('computes platform counts and carries no review content', () => {
    const ov = buildReputationPlatformOverview({ totalTenants: 100, settingsRows: [{ enabled: false }, { enabled: true }, { enabled: null }], connectedIntegrations: 42, syncFailures: 3, reviewsIngested: 5000, reviewsAnalyzed: 4900, draftsGenerated: 1200, aiFailures: 7, publicationFailures: 11, reviewRequestFailures: 9, escalationsOpen: 14, aiUsageMessages: 8000, aiCostCents: 24000 });
    expect(ov.tenantsDisabled).toBe(1);
    expect(ov.tenantsEnabled).toBe(99);
    expect(ov.publicationFailures).toBe(11);
    expect('comment' in ov).toBe(false);
    expect('reviews' in ov).toBe(false);
  });
  it('tenant view is operational-only with supportMode and no review bodies', () => {
    const tv = buildReputationTenantView('T1', { disabled: false, reviewsIngested: 120, reviewsAnalyzed: 118, draftsGenerated: 40, published: 30, publicationFailures: 2, escalationsOpen: 1, requestsSent: 80, requestFailures: 3, integrations: [] });
    expect(tv.supportMode).toBe(true);
    expect(tv.published).toBe(30);
    expect('comment' in tv).toBe(false);
    expect('reviewText' in tv).toBe(false);
  });
});

describe('audited, reason-required support drill-down', () => {
  it('requires a reason and audits the access', async () => {
    const audits: any[] = [];
    const svc = new SuperAdminAiReviewReputationService(null as any, { record: (_w: any, e: any) => audits.push(e) } as any);
    await expect(svc.tenantView({ userId: 'sa' }, 'T1', '')).rejects.toBeInstanceOf(SuperAdminReputationError);
    const view = await svc.tenantView({ userId: 'sa', ip: '1.2.3.4' }, 'T1', 'Investigating failed publications');
    expect(view.supportMode).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('reputation_support_view');
    expect(audits[0].metadata.reason).toMatch(/failed publications/);
  });
  it('returns honest zeros without a database', async () => {
    const svc = new SuperAdminAiReviewReputationService(null as any);
    const ov = await svc.platformOverview({});
    expect(ov.totalTenants).toBe(0);
    expect(ov.reviewsIngested).toBe(0);
  });
});
