import { describe, it, expect } from 'vitest';
import { buildCustomerDataOverview, type OverviewInputs } from './customer-data-overview';
import type { CustomerLike } from './customer-data-governance-core';

const mk = (o: Partial<CustomerLike & { tenantName: string | null }> = {}): CustomerLike & { tenantName?: string | null } => ({
  id: 'c1', tenantId: 't1', branchId: 'b1', fullName: 'Emily Johnson', normalizedPhone: '+12025550123',
  email: 'emily@example.com', phoneVerifiedAt: '2026-06-01T00:00:00Z', status: 'active',
  marketingSmsOptIn: true, marketingEmailOptIn: true, marketingOptIn: true, createdById: 'u1',
  createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z', ...o,
});

const base = (records: any[], extra: Partial<OverviewInputs> = {}): OverviewInputs => ({ records, now: new Date('2026-06-30T00:00:00Z'), ...extra });

describe('buildCustomerDataOverview', () => {
  it('produces exactly 15 KPIs in reference order', () => {
    const ov = buildCustomerDataOverview(base([mk()]));
    expect(ov.kpis).toHaveLength(15);
    expect(ov.kpis.map((k) => k.key)).toEqual([
      'total_customers', 'customers_by_tenant', 'duplicate_records', 'incomplete_records', 'invalid_phone',
      'invalid_email', 'failed_imports', 'privacy_requests', 'export_requests', 'deletion_requests',
      'consent_status', 'cross_tenant', 'legal_hold', 'avg_completeness', 'integrity_score',
    ]);
  });

  it('counts totals and tenants from real records', () => {
    const ov = buildCustomerDataOverview(base([mk({ id: 'a', tenantId: 't1' }), mk({ id: 'b', tenantId: 't2' })]));
    expect(ov.kpis.find((k) => k.key === 'total_customers')!.value).toBe('2');
    expect(ov.kpis.find((k) => k.key === 'customers_by_tenant')!.value).toBe('2');
  });

  it('marks unbacked modules NotConnected instead of fabricating values', () => {
    const ov = buildCustomerDataOverview(base([mk()]));
    const failed = ov.kpis.find((k) => k.key === 'failed_imports')!;
    const legal = ov.kpis.find((k) => k.key === 'legal_hold')!;
    expect(failed.available).toBe(false); expect(failed.value).toBeNull();
    expect(legal.available).toBe(false); expect(legal.value).toBeNull();
    expect(ov.importSuccess.available).toBe(false);
    expect(ov.recentMerges.available).toBe(false);
  });

  it('surfaces real privacy/export/deletion counts when connected', () => {
    const ov = buildCustomerDataOverview(base([mk()], {
      privacy: { total: 58, pending: 18, byStatus: [{ key: 'pending', label: 'Pending', count: 18 }] },
      exportRequests: { total: 22, pending: 7 }, deletionRequests: { total: 31, pending: 9 },
    }));
    expect(ov.kpis.find((k) => k.key === 'privacy_requests')!.value).toBe('58');
    expect(ov.kpis.find((k) => k.key === 'privacy_requests')!.supporting).toBe('Pending 18');
    expect(ov.privacyRequestStatus.available).toBe(true);
    expect(ov.kpis.find((k) => k.key === 'deletion_requests')!.value).toBe('31');
  });

  it('reconciles invalid phone/email, incomplete, and duplicate counts with the directory', () => {
    const records = [
      mk({ id: 'a', normalizedPhone: '+12025550100', email: 'bad-email', fullName: 'Dup One' }),
      mk({ id: 'b', normalizedPhone: '+12025550100', email: 'ok@x.com', fullName: 'Dup One' }), // same phone+name as a → dup
      mk({ id: 'c', normalizedPhone: null, email: 'fine@x.com' }),
    ];
    const ov = buildCustomerDataOverview(base(records));
    expect(ov.kpis.find((k) => k.key === 'invalid_email')!.value).toBe('1'); // record a
    expect(ov.duplicateDistribution.total).toBe(2);                          // a & b cluster
    expect(ov.kpis.find((k) => k.key === 'duplicate_records')!.value).toBe('2');
    expect(ov.directory).toHaveLength(3);
    expect(ov.directory.find((d) => d.id === 'a')!.emailStatus).toBe('invalid');
    expect(ov.directory.find((d) => d.id === 'a')!.duplicateRisk).toBe('high');
  });

  it('flags cross-tenant matches as alerts without exposing PII', () => {
    const records = [mk({ id: 'a', tenantId: 't1', normalizedPhone: '+12025550999', email: null }), mk({ id: 'b', tenantId: 't2', normalizedPhone: '+12025550999', email: null })];
    const ov = buildCustomerDataOverview(base(records));
    expect(ov.suspiciousCrossTenant.count).toBe(1);
    expect(JSON.stringify(ov.suspiciousCrossTenant.alerts)).not.toContain('Emily');
    expect(ov.kpis.find((k) => k.key === 'cross_tenant')!.value).toBe('1');
  });

  it('labels integrity issues as occurrences (not unique customers)', () => {
    const ov = buildCustomerDataOverview(base([mk({ normalizedPhone: '123', email: 'bad' })])); // one record: invalid phone + invalid email → also incomplete
    expect(ov.integrityIssues.total).toBe(3); // 3 issue occurrences on a single record
    expect(ov.integrityIssues.note).toMatch(/occurrences/i);
  });
});
