// Customer Data Oversight service. Cross-tenant by design behind SuperAdminGuard; when a tenantId is supplied it
// hard-scopes the projection. Composes the real privacy/deletion/export counts with the pure aggregate, then
// applies the derived directory filters (phone/email/consent/duplicate-risk) and server-side pagination.

import { buildCustomerDataOverview } from './customer-data-overview';
import type { CustomerDataOversightRepo, OverviewScope } from './super-admin-customer-data.repository';
import type { LegalHoldService } from '@aipowersalon/customers';
import type { CustomerImportService } from './customer-import.service';

export interface OverviewQuery extends OverviewScope {
  page?: number; pageSize?: number;
  phoneStatus?: string; emailStatus?: string; consentStatus?: string; duplicateRisk?: string;
  sort?: 'name' | 'tenant' | 'completeness' | 'duplicateRisk' | 'consent' | 'updated';
  direction?: 'asc' | 'desc';
}

const RISK_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };

export class CustomerDataOversightService {
  constructor(private readonly repo: CustomerDataOversightRepo, private readonly legalHolds?: LegalHoldService, private readonly imports?: CustomerImportService) {}

  async getOverview(q: OverviewQuery = {}) {
    const scope: OverviewScope = { tenantId: q.tenantId, branchId: q.branchId, status: q.status, search: q.search, cap: q.cap };
    const [records, privacy, deletionRequests, exportRequests, legalHold, importStats, recentMerges, recentActivity] = await Promise.all([
      this.repo.loadCustomerProjection(scope),
      this.repo.privacyCounts(scope),
      this.repo.deletionCounts(scope),
      this.repo.exportCounts(scope),
      this.legalHolds ? this.legalHolds.counts({ tenantId: q.tenantId }).catch(() => null) : Promise.resolve(null),
      this.imports ? this.imports.overviewStats({ tenantId: q.tenantId }).catch(() => null) : Promise.resolve(null),
      this.repo.recentMerges(scope).catch(() => null),
      this.repo.recentActivity(scope).catch(() => null),
    ]);

    const ov = buildCustomerDataOverview({
      records, now: new Date(), privacy, deletionRequests, exportRequests, legalHold,
      failedImports: importStats ? importStats.failedImports : null,
      importSuccessRate: importStats ? importStats.successRatePct : null,
      recentMerges, recentActivity,
    });

    // Derived directory filters (computed values, applied after engine derivation).
    let dir = ov.directory;
    if (q.phoneStatus) dir = dir.filter((r) => r.phoneStatus === q.phoneStatus);
    if (q.emailStatus) dir = dir.filter((r) => r.emailStatus === q.emailStatus);
    if (q.consentStatus) dir = dir.filter((r) => r.consentStatus === q.consentStatus);
    if (q.duplicateRisk) dir = dir.filter((r) => r.duplicateRisk === q.duplicateRisk);

    if (q.sort) {
      const dirn = q.direction === 'asc' ? 1 : -1;
      const val = (r: typeof dir[number]) => q.sort === 'name' ? r.name.toLowerCase()
        : q.sort === 'tenant' ? (r.tenantName || '').toLowerCase()
        : q.sort === 'completeness' ? r.completeness
        : q.sort === 'duplicateRisk' ? RISK_RANK[r.duplicateRisk]
        : q.sort === 'consent' ? r.consentStatus
        : r.lastUpdated;
      dir = [...dir].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -dirn : va > vb ? dirn : 0; });
    }

    const filteredTotal = dir.length;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 10));
    const slice = dir.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    return {
      ...ov,
      directory: slice,
      directoryTotal: ov.directoryTotal,
      pagination: { page, pageSize, totalItems: filteredTotal, totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)) },
    };
  }

  listMerges(scope: { tenantId?: string }) { return this.repo.mergeHistory({ tenantId: scope.tenantId }); }
  listActivity(scope: { tenantId?: string }) { return this.repo.auditHistory({ tenantId: scope.tenantId }); }
}
