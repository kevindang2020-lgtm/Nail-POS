// settlements.service.ts — composes settlements-core over the repository into the Super Admin "Settlements & Deposits"
// overview: 8 KPIs, the batches directory (paginated, masked funding), selected-batch detail + notes, deposit-status
// donut, settlement trend, daily funding, reconciliation differences, recent activity, and funding exceptions.
// Every number reconciles to the batch rows; unknowns are honest (null / not fabricated). Read-only.
import type { SettlementRow } from '@aipowersalon/api-contracts/platform';
export type { SettlementRow };   // owned by packages/api-contracts (Constitution 13 §13)
import type { SettlementsRepository, RawSettlement, SettlementFilters } from './settlements.repository';
import {
  netDepositCents, reconciliationDiffCents, isUnresolvedDiscrepancy, depositStatusDistribution,
  rollupKpis, fundingExceptionType, maskAccount, normalizeSettlementStatus, normalizeReconStatus,
  type BatchLike, type SettlementKpis, type SettlementStatus, type ReconciliationStatus, type FundingExceptionType,
} from './settlements-core';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { SettlementsOverview } from '@aipowersalon/api-contracts/platform';
import type { SettlementsOverview } from '@aipowersalon/api-contracts/platform';

export interface AdminCtx { userId?: string; email?: string; ip?: string }

const expectedNetOf = (r: RawSettlement): number =>
  r.expectedNetCents != null ? r.expectedNetCents : netDepositCents({ grossCents: r.grossCents, refundsCents: r.refundsCents, chargebacksCents: r.chargebacksCents, feesCents: r.feeCents, adjustmentsCents: r.adjustmentsCents });

const toBatchLike = (r: RawSettlement): BatchLike => ({
  grossCents: r.grossCents, refundsCents: r.refundsCents, chargebacksCents: r.chargebacksCents, feesCents: r.feeCents, adjustmentsCents: r.adjustmentsCents,
  settlementStatus: normalizeSettlementStatus(r.status), reconciliationStatus: normalizeReconStatus(r.reconciliationStatus),
  actualDepositCents: r.actualDepositCents, expectedNetCents: expectedNetOf(r),
});



export class SettlementsService {
  constructor(private readonly repo: SettlementsRepository) {}

  parseFilters(q: Record<string, unknown>, scope?: unknown): SettlementFilters {
    const clampPage = Math.max(1, Math.trunc(Number(q.page)) || 1);
    const clampSize = Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize)) || 10));
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    return {
      tenantId: str(q.tenantId), branchId: str(q.branchId), processor: str(q.processor),
      settlementStatus: str(q.settlementStatus), reconciliationStatus: str(q.reconciliationStatus), fundingLast4: str(q.fundingLast4),
      search: str(q.search), startDate: str(q.startDate), endDate: str(q.endDate),
      page: clampPage, pageSize: clampSize, sort: str(q.sort), direction: q.direction === 'asc' ? 'asc' : 'desc',
      scope, selectedId: str(q.selectedId),
    };
  }

  private toRow(r: RawSettlement): SettlementRow {
    const expected = expectedNetOf(r);
    const diff = r.signedDifferenceCents != null ? r.signedDifferenceCents : reconciliationDiffCents(r.actualDepositCents, expected);
    return {
      id: r.id, batchRef: r.batchRef, tenantId: r.tenantId, tenantName: r.tenantName, branchId: r.branchId, branchName: r.branchName,
      processor: r.processor, grossCents: r.grossCents, refundsCents: r.refundsCents, chargebacksCents: r.chargebacksCents, feesCents: r.feeCents,
      adjustmentsCents: r.adjustmentsCents, netCents: r.netCents, expectedNetCents: expected, actualDepositCents: r.actualDepositCents,
      expectedDepositDate: r.expectedDepositDate, actualDepositDate: r.actualDepositDate, fundingMasked: maskAccount(r.fundingLast4),
      settlementStatus: normalizeSettlementStatus(r.status), reconciliationStatus: normalizeReconStatus(r.reconciliationStatus),
      differenceCents: diff, transactionCount: r.transactionCount,
    };
  }

  async getOverview(_ctx: AdminCtx, f: SettlementFilters): Promise<SettlementsOverview> {
    const data = await this.repo.settlementData(f);
    const now = Date.now();
    const agg = data.aggItems;
    const likes = agg.map(toBatchLike);

    const kpis = rollupKpis(likes);

    // deposit-status distribution + settled/pending amount summaries
    const dist = depositStatusDistribution(likes.map((b) => ({ settlementStatus: b.settlementStatus })));
    let settledAmount = 0, pendingAmount = 0;
    for (const r of agg) {
      const bl = toBatchLike(r);
      if (bl.settlementStatus === 'settled' && r.actualDepositCents != null) settledAmount += r.actualDepositCents;
      if (['pending', 'processing', 'delayed', 'held', 'partially_settled'].includes(bl.settlementStatus)) pendingAmount += expectedNetOf(r);
    }

    // settlement trend (by created day): gross vs net(actual if present else expected)
    const trendMap = new Map<string, { g: number; net: number }>();
    for (const r of agg) {
      const day = new Date(r.createdAtMs).toISOString().slice(0, 10);
      const e = trendMap.get(day) ?? { g: 0, net: 0 };
      e.g += r.grossCents; e.net += r.actualDepositCents != null ? r.actualDepositCents : expectedNetOf(r);
      trendMap.set(day, e);
    }
    const settlementTrend = [...trendMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({ date, grossCents: v.g, netCents: v.net }));
    const settlementTrendTotals = { grossCents: settlementTrend.reduce((a, x) => a + x.grossCents, 0), netCents: settlementTrend.reduce((a, x) => a + x.netCents, 0) };

    // daily funding: expected by expected_deposit_date, actual by actual_deposit_date
    const fundMap = new Map<string, { exp: number; act: number }>();
    for (const r of agg) {
      if (r.expectedDepositDate) { const e = fundMap.get(r.expectedDepositDate) ?? { exp: 0, act: 0 }; e.exp += expectedNetOf(r); fundMap.set(r.expectedDepositDate, e); }
      if (r.actualDepositDate && r.actualDepositCents != null) { const e = fundMap.get(r.actualDepositDate) ?? { exp: 0, act: 0 }; e.act += r.actualDepositCents; fundMap.set(r.actualDepositDate, e); }
    }
    const dailyFunding = [...fundMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, v]) => ({ date, expectedCents: v.exp, actualCents: v.act }));
    const expectedTotal = dailyFunding.reduce((a, x) => a + x.expectedCents, 0);
    const actualTotal = dailyFunding.reduce((a, x) => a + x.actualCents, 0);
    const dailyFundingTotals = { expectedCents: expectedTotal, actualCents: actualTotal, varianceCents: actualTotal - expectedTotal };

    // reconciliation differences (unresolved, signed), sorted by magnitude
    const diffRows = agg.map((r) => {
      const expected = expectedNetOf(r);
      const d = r.signedDifferenceCents != null ? r.signedDifferenceCents : reconciliationDiffCents(r.actualDepositCents, expected);
      return { id: r.id, batchRef: r.batchRef, differenceCents: d, recon: normalizeReconStatus(r.reconciliationStatus) };
    }).filter((x) => x.differenceCents != null && x.differenceCents !== 0)
      .sort((a, b) => Math.abs(b.differenceCents as number) - Math.abs(a.differenceCents as number));
    const reconciliationDifferences = {
      rows: diffRows.slice(0, 12).map((x) => ({ id: x.id, batchRef: x.batchRef, differenceCents: x.differenceCents as number, status: x.recon })),
      totalCents: diffRows.filter((x) => isUnresolvedDiscrepancy(x.differenceCents, x.recon)).reduce((a, x) => a + Math.abs(x.differenceCents as number), 0),
    };

    // recent activity (newest by settled_at or created_at)
    const recentActivity = [...agg]
      .sort((a, b) => (b.settledAtMs ?? b.createdAtMs) - (a.settledAtMs ?? a.createdAtMs))
      .slice(0, 8)
      .map((r) => ({ id: r.id, batchRef: r.batchRef, tenantName: r.tenantName, branchName: r.branchName, status: normalizeSettlementStatus(r.status), amountCents: r.actualDepositCents ?? expectedNetOf(r), atMs: r.settledAtMs ?? r.createdAtMs }));

    // funding exceptions by category
    const excMap = new Map<FundingExceptionType, number>();
    for (const b of likes) { const t = fundingExceptionType(b); if (t) excMap.set(t, (excMap.get(t) ?? 0) + 1); }
    const order: FundingExceptionType[] = ['delayed_deposit', 'failed_deposit', 'large_difference', 'missing_deposit'];
    const fundingExceptions = { categories: order.filter((t) => excMap.has(t)).map((t) => ({ type: t, count: excMap.get(t)! })), total: [...excMap.values()].reduce((a, c) => a + c, 0) };

    const totalPages = Math.max(1, Math.ceil(data.pageTotal / f.pageSize));
    const selectedBatch = data.selected
      ? { ...this.toRow(data.selected), notes: await this.repo.notesFor(data.selected.id, f.tenantId ?? (f.scope as any)?.tenantId ?? null) }
      : null;

    return {
      meta: { generatedAt: new Date(now).toISOString(), scope: f.tenantId || (f.scope as any)?.tenantId ? 'tenant' : 'platform' },
      kpis,
      batches: { rows: data.pageItems.map((r) => this.toRow(r)), total: data.pageTotal, page: Math.min(f.page, totalPages), pageSize: f.pageSize, totalPages },
      selectedBatch,
      depositStatus: { ...dist, settledAmountCents: settledAmount, pendingAmountCents: pendingAmount },
      settlementTrend, settlementTrendTotals, dailyFunding, dailyFundingTotals, reconciliationDifferences, recentActivity, fundingExceptions,
    };
  }
}
