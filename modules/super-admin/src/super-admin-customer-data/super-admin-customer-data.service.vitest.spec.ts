import { describe, it, expect } from 'vitest';
import { CustomerDataOversightService } from './super-admin-customer-data.service';
import { InMemoryCustomerDataOversightRepo } from './super-admin-customer-data.repository';

const svc = () => new CustomerDataOversightService(new InMemoryCustomerDataOversightRepo());

describe('CustomerDataOversightService.getOverview', () => {
  it('returns 15 KPIs and a paginated directory over the seeded population', async () => {
    const ov = await svc().getOverview({ page: 1, pageSize: 5 });
    expect(ov.kpis).toHaveLength(15);
    expect(ov.directory.length).toBeLessThanOrEqual(5);
    expect(ov.pagination.totalItems).toBe(6);     // 6 seeded customers
    expect(ov.directoryTotal).toBe(6);
  });

  it('hard-scopes to a single tenant when tenantId is supplied', async () => {
    const ov = await svc().getOverview({ tenantId: 't1' });
    expect(ov.directory.every((r) => r.tenantId === 't1')).toBe(true);
    expect(ov.kpis.find((k) => k.key === 'total_customers')!.value).toBe('3'); // t1 has 3 seeded
  });

  it('applies derived directory filters (duplicate risk)', async () => {
    const ov = await svc().getOverview({ duplicateRisk: 'high', pageSize: 50 });
    expect(ov.directory.length).toBeGreaterThan(0);
    expect(ov.directory.every((r) => r.duplicateRisk === 'high')).toBe(true);
  });

  it('surfaces the real privacy/deletion/export counts and keeps imports/legal-hold NotConnected', async () => {
    const ov = await svc().getOverview();
    expect(ov.kpis.find((k) => k.key === 'privacy_requests')!.available).toBe(true);
    expect(ov.kpis.find((k) => k.key === 'deletion_requests')!.available).toBe(true);
    expect(ov.kpis.find((k) => k.key === 'failed_imports')!.available).toBe(false);
    expect(ov.kpis.find((k) => k.key === 'legal_hold')!.available).toBe(false);
  });

  it('detects the seeded cross-tenant phone as an alert without exposing PII', async () => {
    const ov = await svc().getOverview();
    expect(ov.suspiciousCrossTenant.count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(ov.suspiciousCrossTenant.alerts)).not.toMatch(/Daniel|James/);
  });

  it('sorts the directory by completeness descending', async () => {
    const ov = await svc().getOverview({ sort: 'completeness', direction: 'desc', pageSize: 50 });
    const scores = ov.directory.map((r) => r.completeness);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('connects the Legal Hold KPI when a LegalHoldService is wired', async () => {
    const { LegalHoldService } = await import('@aipowersalon/customers');
    const { InMemoryLegalHoldRepo } = await import('@aipowersalon/customers');
    const holds = new LegalHoldService(new InMemoryLegalHoldRepo());
    await holds.applyHold({ tenantId: 't1', customerId: 'CUS-0087321', matterRef: 'M-1', reason: 'litigation', scope: 'customer' });
    const service = new CustomerDataOversightService(new InMemoryCustomerDataOversightRepo(), holds);
    const ov = await service.getOverview();
    const legal = ov.kpis.find((k) => k.key === 'legal_hold')!;
    expect(legal.available).toBe(true);
    expect(legal.value).toBe('1');
  });

  it('connects the Failed Imports KPI + Import Success when a CustomerImportService is wired', async () => {
    const { CustomerImportService } = await import('./customer-import.service');
    const { InMemoryImportRepo } = await import('./customer-import.repository');
    const imports = new CustomerImportService(new InMemoryImportRepo());
    const created = await imports.createJob({ tenantId: 't1', rows: [{ rowNumber: 1, firstName: 'A', lastName: 'B', phone: '+12125550101' }] });
    await imports.approveJob(created.job!.id);
    await imports.processPendingImportJobs(); // the worker performs the import off the request path
    const service = new CustomerDataOversightService(new InMemoryCustomerDataOversightRepo(), undefined, imports);
    const ov = await service.getOverview();
    const failed = ov.kpis.find((k) => k.key === 'failed_imports')!;
    expect(failed.available).toBe(true);
    expect(ov.importSuccess.available).toBe(true);
    expect(ov.importSuccess.successRatePct).toBe(100);
  });

  it('surfaces recent merges and recent activity from the repo (panels connected)', async () => {
    const ov = await svc().getOverview();
    expect(ov.recentMerges.available).toBe(true);
    expect(ov.recentMerges.rows.length).toBeGreaterThanOrEqual(1);
    expect(ov.recentActivity.available).toBe(true);
    expect(ov.recentActivity.rows.length).toBeGreaterThanOrEqual(1);
  });
});
