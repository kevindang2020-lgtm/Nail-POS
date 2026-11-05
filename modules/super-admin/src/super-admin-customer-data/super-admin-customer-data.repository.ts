// Repository for Customer Data Oversight. Loads a TENANT-SCOPED projection of real customer records (the Super
// Admin cross-tenant path is the only place that may omit a tenant filter, and only behind SuperAdminGuard) plus
// the real privacy/deletion request counts from existing infrastructure. The aggregate + engine derive everything
// else, so the repo stays a thin, auditable data source.

import type { MergeLogRow, ActivityRow } from '@aipowersalon/api-contracts/platform';
export type { MergeLogRow, ActivityRow };   // owned by packages/api-contracts (Constitution 13 §13)
import type { CustomerLike } from './customer-data-governance-core';

export type ProjectionRow = CustomerLike & { tenantName: string | null; branchName: string | null; importSource: string | null; privacyRequestLabel: string | null };

export interface OverviewScope {
  tenantId?: string;   // when set, hard-scopes to one tenant (also used to enforce a tenant admin's own scope)
  branchId?: string;
  status?: string;
  search?: string;
  cap?: number;        // safety cap on the projection size (aggregates are computed in-memory)
}

export interface PrivacyCounts { total: number; pending: number; byStatus: { key: string; label: string; count: number }[] }
export interface SimpleReqCounts { total: number; pending: number }

export interface CustomerDataOversightRepo {
  loadCustomerProjection(scope: OverviewScope): Promise<ProjectionRow[]>;
  privacyCounts(scope: OverviewScope): Promise<PrivacyCounts | null>;
  deletionCounts(scope: OverviewScope): Promise<SimpleReqCounts | null>;
  exportCounts(scope: OverviewScope): Promise<SimpleReqCounts | null>;
  recentMerges(scope: OverviewScope): Promise<MergeLogRow[]>;
  mergeHistory(scope: OverviewScope): Promise<MergeLogRow[]>;
  recentActivity(scope: OverviewScope): Promise<ActivityRow[]>;
  auditHistory(scope: OverviewScope): Promise<ActivityRow[]>;
}


/** Offline implementation: a small seeded, deliberately-messy multi-tenant population so the page and tests run
 *  without Postgres. Includes a within-tenant duplicate pair and a cross-tenant shared phone to exercise alerts. */
export class InMemoryCustomerDataOversightRepo implements CustomerDataOversightRepo {
  private rows: ProjectionRow[];
  constructor(seed?: ProjectionRow[]) {
    this.rows = seed ?? DEFAULT_SEED();
  }
  async loadCustomerProjection(scope: OverviewScope): Promise<ProjectionRow[]> {
    let r = this.rows;
    if (scope.tenantId) r = r.filter((x) => x.tenantId === scope.tenantId);
    if (scope.branchId) r = r.filter((x) => x.branchId === scope.branchId);
    if (scope.status) r = r.filter((x) => (x.status || '').toLowerCase() === scope.status!.toLowerCase());
    if (scope.search) { const s = scope.search.toLowerCase(); r = r.filter((x) => (x.fullName || '').toLowerCase().includes(s) || (x.email || '').toLowerCase().includes(s) || x.id.toLowerCase().includes(s)); }
    return r.slice(0, scope.cap ?? 5000);
  }
  async privacyCounts(): Promise<PrivacyCounts | null> {
    return { total: 3, pending: 1, byStatus: [{ key: 'pending', label: 'Pending', count: 1 }, { key: 'in_progress', label: 'In Progress', count: 1 }, { key: 'completed', label: 'Completed', count: 1 }] };
  }
  async deletionCounts(): Promise<SimpleReqCounts | null> { return { total: 2, pending: 1 }; }
  async exportCounts(): Promise<SimpleReqCounts | null> { return { total: 1, pending: 0 }; }
  async recentMerges(): Promise<MergeLogRow[]> {
    return [{ id: 'mrg_1', sourceCustomerId: 'CUS-0087325', targetCustomerId: 'CUS-0087321', mergedByUserId: 'admin1', mergedAt: new Date(Date.now() - 36e5).toISOString() }];
  }
  async mergeHistory(): Promise<MergeLogRow[]> {
    return [
      { id: 'mrg_1', sourceCustomerId: 'CUS-0087325', targetCustomerId: 'CUS-0087321', mergedByUserId: 'admin1', mergedAt: new Date(Date.now() - 36e5).toISOString() },
      { id: 'mrg_2', sourceCustomerId: 'CUS-0087340', targetCustomerId: 'CUS-0087333', mergedByUserId: 'admin2', mergedAt: new Date(Date.now() - 864e5).toISOString() },
    ];
  }
  async recentActivity(): Promise<ActivityRow[]> {
    return [
      { action: 'super_admin_customer_merged', entityType: 'customer', entityId: 'CUS-0087325', actorUserId: 'admin1', at: new Date(Date.now() - 36e5).toISOString() },
      { action: 'customer_legal_hold_applied', entityType: 'customer_legal_hold', entityId: 'lh_1', actorUserId: 'admin1', at: new Date(Date.now() - 72e5).toISOString() },
    ];
  }
  async auditHistory(): Promise<ActivityRow[]> {
    return [
      { action: 'super_admin_customer_merged', entityType: 'customer', entityId: 'CUS-0087325', actorUserId: 'admin1', at: new Date(Date.now() - 36e5).toISOString() },
      { action: 'customer_legal_hold_applied', entityType: 'customer_legal_hold', entityId: 'lh_1', actorUserId: 'admin1', at: new Date(Date.now() - 72e5).toISOString() },
      { action: 'customer_import_approved', entityType: 'customer_import_job', entityId: 'imp_1', actorUserId: 'admin2', at: new Date(Date.now() - 108e5).toISOString() },
      { action: 'customer_deletion_executed', entityType: 'customer', entityId: 'CUS-0087399', actorUserId: 'admin1', at: new Date(Date.now() - 172e5).toISOString() },
    ];
  }
}

function row(o: Partial<ProjectionRow> & { id: string; tenantId: string }): ProjectionRow {
  return {
    branchId: 'b1', fullName: 'Customer', normalizedPhone: '+12025550000', email: 'c@example.com',
    phoneVerifiedAt: '2026-06-01T00:00:00Z', status: 'active', marketingSmsOptIn: true, marketingEmailOptIn: true,
    marketingOptIn: true, createdById: 'u1', createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
    tenantName: 'Glamour Studio', branchName: 'Downtown', importSource: 'Web Form', privacyRequestLabel: 'None', ...o,
  };
}
function DEFAULT_SEED(): ProjectionRow[] {
  return [
    row({ id: 'CUS-0087321', tenantId: 't1', tenantName: 'Glamour Studio', fullName: 'Emily Johnson', email: 'emily@example.com', normalizedPhone: '+12025550101' }),
    row({ id: 'CUS-0087322', tenantId: 't1', tenantName: 'Glamour Studio', fullName: 'Michael Brown', normalizedPhone: '123', email: 'michael@example.com', marketingOptIn: false, marketingSmsOptIn: false, marketingEmailOptIn: false }),
    row({ id: 'CUS-0087323', tenantId: 't2', tenantName: 'Luxe Salon & Spa', fullName: 'Sarah Davis', email: 'bad-email', normalizedPhone: '+12025550103', privacyRequestLabel: 'Delete Requested' }),
    row({ id: 'CUS-0087324', tenantId: 't2', tenantName: 'Luxe Salon & Spa', fullName: 'James Wilson', email: 'james@example.com', normalizedPhone: '+12025550104' }),
    // within-tenant duplicate pair (same phone in t1)
    row({ id: 'CUS-0087325', tenantId: 't1', tenantName: 'Glamour Studio', fullName: 'Olivia Martinez', normalizedPhone: '+12025550101', email: null }),
    // cross-tenant shared phone with CUS-0087324 (t2) → integrity alert, NOT a merge
    row({ id: 'CUS-0087326', tenantId: 't3', tenantName: 'The Hair Lounge', fullName: 'Daniel Taylor', normalizedPhone: '+12025550104', email: 'daniel@example.com' }),
  ];
}
