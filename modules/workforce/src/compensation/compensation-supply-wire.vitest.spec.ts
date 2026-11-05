// compensation-supply-wire.vitest.spec.ts — proves Phase 3a: the supply snapshot on a line flows through
// engineInputFromLines into the engine. Default 'none' is Method A (commission on gross, product cost NOT deducted);
// an explicitly-authored 'fixed' supply is Method C (reduces the commissionable base before the split). Integer cents.
import { describe, it, expect } from 'vitest';
import { engineInputFromLines, type ServiceLineRow } from './compensation.service';
import { computeTicketCompensation } from './compensation-engine';

const row = (over: Partial<ServiceLineRow> = {}): ServiceLineRow => ({
  id: 'l1', service_id: 's1', technician_id: 't1', price_cents_snapshot: 10000, line_total_cents: 10000,
  commission_type_snapshot: 'percent', commission_value_snapshot: 60, supply_method_snapshot: 'none', supply_value_snapshot: 0, ...over,
});
const meta = { discountCents: 0, cardTipCents: 0, cashTipCents: 0 };
const ctx = { tenantId: 't', branchId: null };

describe('supply snapshot → engine (§9)', () => {
  it('Method A (supply none): commission on gross, nothing deducted', () => {
    const res = computeTicketCompensation(engineInputFromLines(ctx, 'tk', [row()], meta));
    expect(res.totals.supplyCents).toBe(0);
    expect(res.totals.techServiceEarningsCents).toBe(6000);   // 60% of 10000
    expect(res.totals.salonServiceShareCents).toBe(4000);
  });

  it('Method C (fixed supply): base reduced before the split', () => {
    const res = computeTicketCompensation(engineInputFromLines(ctx, 'tk', [row({ supply_method_snapshot: 'fixed', supply_value_snapshot: 1000 })], meta));
    expect(res.totals.supplyCents).toBe(1000);
    expect(res.totals.techServiceEarningsCents).toBe(5400);   // 60% of (10000 − 1000)
    expect(res.totals.salonServiceShareCents).toBe(3600);     // salon share of the reduced base (supply is retained on top)
  });

  it("'recipe'/'tiered' supply is tracked separately, not deducted (Method A safety)", () => {
    const res = computeTicketCompensation(engineInputFromLines(ctx, 'tk', [row({ supply_method_snapshot: 'recipe', supply_value_snapshot: 800 })], meta));
    expect(res.totals.supplyCents).toBe(0);                   // engine does not deduct recipe supply
    expect(res.totals.techServiceEarningsCents).toBe(6000);   // full 60% of gross
  });
});
