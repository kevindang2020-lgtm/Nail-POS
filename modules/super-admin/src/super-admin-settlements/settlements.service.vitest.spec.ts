import { describe, it, expect } from 'vitest';
import { SettlementsService } from './settlements.service';
import type { RawSettlement, RawSettlementData } from './settlements.repository';

const raw = (o: Partial<RawSettlement> = {}): RawSettlement => ({
  id: 'id-1', batchRef: 'BCH-2026-0506-001', tenantId: 'ten-a', tenantName: 'Glamour Studio', branchId: 'br-1', branchName: 'Downtown',
  processor: 'fiserv', grossCents: 2681235, feeCents: 56215, refundsCents: 102540, chargebacksCents: 24500, adjustmentsCents: 0,
  netCents: 2497980, expectedNetCents: 2497980, actualDepositCents: 2497980, transactionCount: 412,
  expectedDepositDate: '2026-05-06', actualDepositDate: '2026-05-06', fundingLast4: '7890', status: 'settled',
  reconciliationStatus: 'reconciled', signedDifferenceCents: 0, currency: 'USD', settledAtMs: Date.parse('2026-05-06T14:31:00Z'), createdAtMs: Date.parse('2026-05-06T09:00:00Z'), ...o,
});

function svc(rows: RawSettlement[], selected: RawSettlement | null = null, notes: any[] = []) {
  const repo = {
    settlementData: async (): Promise<RawSettlementData> => ({ aggItems: rows, pageItems: rows.slice(0, 10), pageTotal: rows.length, selected }),
    notesFor: async () => notes,
    insertNote: async () => ({ id: 'n1', createdAt: new Date().toISOString() }),
  };
  return new SettlementsService(repo as any);
}

describe('SettlementsService', () => {
  it('builds an overview whose KPIs and distributions reconcile to the rows', async () => {
    const rows = [
      raw(),
      raw({ id: 'id-2', batchRef: 'BCH-002', status: 'pending', reconciliationStatus: 'pending', actualDepositCents: null, actualDepositDate: null, expectedNetCents: 2211870, signedDifferenceCents: null, fundingLast4: '4567' }),
      raw({ id: 'id-3', batchRef: 'BCH-003', status: 'settled', reconciliationStatus: 'in_review', actualDepositCents: 1653715, expectedNetCents: 1640470, signedDifferenceCents: 13245, fundingLast4: '1234' }),
    ];
    const o = await svc(rows).getOverview({}, svc(rows).parseFilters({}));
    expect(o.kpis.totalBatches).toBe(3);
    expect(o.kpis.grossCents).toBe(2681235 * 3);
    expect(o.depositStatus.total).toBe(3);
    expect(o.depositStatus.slices.reduce((a, s) => a + s.count, 0)).toBe(3);
    expect(o.reconciliationDifferences.totalCents).toBe(13245);       // one unresolved +132.45
    expect(o.kpis.pendingDepositsCents).toBe(2211870);                // only the pending batch's expected
  });

  it('masks funding accounts everywhere and never returns a raw suffix longer than 4', async () => {
    const o = await svc([raw({ fundingLast4: '9876543210' })]).getOverview({}, svc([]).parseFilters({}));
    expect(o.batches.rows[0].fundingMasked).toBe('•••• 3210');
  });

  it('exposes a selected batch with append-only notes', async () => {
    const sel = raw({ id: 'sel', batchRef: 'BCH-SEL' });
    const o = await svc([sel], sel, [{ id: 'n1', category: 'reconciliation', body: 'All matched.', authorRole: 'super_admin', createdAt: '2026-05-06T14:31:00Z' }])
      .getOverview({}, svc([]).parseFilters({ selectedId: 'sel' }));
    expect(o.selectedBatch?.batchRef).toBe('BCH-SEL');
    expect(o.selectedBatch?.notes[0].body).toBe('All matched.');
    expect(o.selectedBatch?.fundingMasked).toBe('•••• 7890');
  });

  it('clamps pagination', () => {
    const f = svc([]).parseFilters({ page: -3, pageSize: 9999 });
    expect(f.page).toBeGreaterThanOrEqual(1);
    expect(f.pageSize).toBeLessThanOrEqual(100);
  });

  it('daily funding variance is signed actual − expected', async () => {
    const rows = [raw({ expectedNetCents: 1000, actualDepositCents: 900, actualDepositDate: '2026-05-06', expectedDepositDate: '2026-05-06' })];
    const o = await svc(rows).getOverview({}, svc([]).parseFilters({}));
    expect(o.dailyFundingTotals.varianceCents).toBe(-100);
  });
});
