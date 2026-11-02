// Repository for campaign delivery rollups + failures. In-memory impl seeds a small realistic set so the KPIs and
// the Delivery Failures module render without a database.

import { isRetryable, type FailureCategory } from './campaign-delivery-core';

export interface FailureRow {
  id: string; subjectType: string; subjectId: string; tenantId: string | null; channel: string | null; provider: string | null;
  failureCategory: string; maskedDestination: string | null; providerResponse: string | null; attemptCount: number;
  retryable: boolean; resolutionStatus: string; firstFailureAt: string; lastAttemptAt: string;
}

export interface DeliveryRepo {
  deliveryTotals(tenantId: string): Promise<{ attempted: number; delivered: number; optedOut: number }>;
  failureCounts(tenantId: string): Promise<{ failureCategory: string; count: number }[]>;
  listFailures(scope: { tenantId: string; category?: string; cap?: number }): Promise<FailureRow[]>;
  metricSnapshots(days: number): Promise<{ snapshotDate: string; attempted: number; delivered: number; opened: number; clicked: number }[]>;
}

let XSEQ = 1;
const now = () => new Date().toISOString();

export class InMemoryDeliveryRepo implements DeliveryRepo {
  /** Seeded rows belong to this tenant. The fake ENFORCES scoping like the real repo — a fake that ignored the
   *  tenant would let a cross-tenant read pass every test, which is how a leak survives a green suite. */
  static readonly SEED_TENANT = 't1';   // the tenant the seeded rows already belonged to
  private totals = { attempted: 0, delivered: 0, optedOut: 0 };
  private failures: FailureRow[] = [];
  private snapshots: { snapshotDate: string; attempted: number; delivered: number; opened: number; clicked: number }[] = [];

  private seedTenant: string;

  constructor(seed?: { tenantId?: string; totals?: { attempted: number; delivered: number; optedOut: number }; failures?: { category: FailureCategory; count: number }[]; snapshots?: { snapshotDate: string; attempted: number; delivered: number; opened: number; clicked: number }[] }) {
    this.seedTenant = seed?.tenantId ?? InMemoryDeliveryRepo.SEED_TENANT;
    if (seed?.totals) this.totals = seed.totals;
    this.snapshots = seed?.snapshots ?? [];
    for (const f of seed?.failures ?? []) {
      for (let i = 0; i < f.count; i++) {
        this.failures.push({
          id: `CFAIL-${String(XSEQ++).padStart(5, '0')}`, subjectType: 'tenant_campaign', subjectId: 'c1', tenantId: this.seedTenant, channel: 'email', provider: 'provider',
          failureCategory: f.category, maskedDestination: 'j***@e***.com', providerResponse: 'rejected', attemptCount: 1,
          retryable: isRetryable(f.category), resolutionStatus: 'open', firstFailureAt: now(), lastAttemptAt: now(),
        });
      }
    }
  }

  async deliveryTotals(tenantId: string) { return tenantId === this.seedTenant ? this.totals : { attempted: 0, delivered: 0, optedOut: 0 }; }
  async failureCounts(tenantId: string): Promise<{ failureCategory: string; count: number }[]> {
    // ENFORCE the tenant, exactly as the real repo does. A fake that took `tenantId` and ignored it would let a
    // cross-tenant read pass every test — which is how a leak survives a green suite.
    if (!tenantId) return [];
    const m = new Map<string, number>();
    for (const f of this.failures.filter((x) => String((x as any).tenantId ?? '') === String(tenantId))) {
      m.set(f.failureCategory, (m.get(f.failureCategory) || 0) + 1);
    }
    return [...m.entries()].map(([failureCategory, count]) => ({ failureCategory, count }));
  }
  async listFailures(scope: { tenantId: string; category?: string; cap?: number }): Promise<FailureRow[]> {
    if (!scope.tenantId) return [];
    let r = this.failures.filter((f) => String((f as any).tenantId ?? '') === String(scope.tenantId));
    if (scope.category) r = r.filter((f) => f.failureCategory === scope.category);
    return r.slice(0, scope.cap ?? 200);
  }
  async metricSnapshots(days: number): Promise<{ snapshotDate: string; attempted: number; delivered: number; opened: number; clicked: number }[]> {
    return [...this.snapshots].sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1)).slice(0, Math.max(1, days));
  }
}
