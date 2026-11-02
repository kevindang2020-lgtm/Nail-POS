// compensation-retail-policy.vitest.spec.ts — §16 retail commission: the configured salon rate is applied to retail
// lines by engineInputFromLines and computed separately by the engine (never mixed with service commission). Default
// 'none' ⇒ retail commission stays 0. Plus policy validation.
import { describe, it, expect } from 'vitest';
import { engineInputFromLines, type ServiceLineRow } from './compensation.service';
import { computeTicketCompensation } from './compensation-engine';
import { cleanRetailPolicy, RetailCommissionService } from './compensation-retail-policy.service';

const ctx = { tenantId: 't', branchId: null };
const meta = { discountCents: 0, cardTipCents: 0, cashTipCents: 0 };
const rows: ServiceLineRow[] = [
  { id: 'l1', line_kind: null, service_id: 's1', technician_id: 't1', price_cents_snapshot: 10000, line_total_cents: 10000, commission_type_snapshot: 'percent', commission_value_snapshot: 60, supply_method_snapshot: 'none', supply_value_snapshot: 0 },
  { id: 'r1', line_kind: 'retail', service_id: null, technician_id: 't1', price_cents_snapshot: 5000, line_total_cents: 5000, commission_type_snapshot: 'percent', commission_value_snapshot: 0, supply_method_snapshot: 'none', supply_value_snapshot: 0 },
];

describe('retail commission at the engine (§16)', () => {
  it('is off by default (no config) → retail commission 0, service commission unaffected', () => {
    const res = computeTicketCompensation(engineInputFromLines(ctx, 'tk', rows, meta));
    expect(res.totals.retailCommissionCents).toBe(0);
    expect(res.totals.techServiceEarningsCents).toBe(6000); // 60% of the $100 service, retail separate
  });

  it('applies a configured percent-of-gross rate (10% of $50 = $5)', () => {
    const res = computeTicketCompensation(engineInputFromLines(ctx, 'tk', rows, { ...meta, retailCommission: { method: 'percent', value: 10 } }));
    expect(res.totals.retailCommissionCents).toBe(500);
    expect(res.totals.techServiceEarningsCents).toBe(6000); // service commission untouched
  });

  it('applies a fixed per-item retail rate', () => {
    const res = computeTicketCompensation(engineInputFromLines(ctx, 'tk', rows, { ...meta, retailCommission: { method: 'fixed', value: 300 } }));
    expect(res.totals.retailCommissionCents).toBe(300);
  });
});

describe('cleanRetailPolicy + service defaults', () => {
  it('normalizes method + value, clamps percent, drops value when none', () => {
    expect(cleanRetailPolicy({ method: 'percent', value: 15 })).toEqual({ method: 'percent', value: 15 });
    expect(cleanRetailPolicy({ method: 'percent', value: 150 })).toEqual({ method: 'percent', value: 100 });
    expect(cleanRetailPolicy({ method: 'fixed', value: 250 })).toEqual({ method: 'fixed', value: 250 });
    expect(cleanRetailPolicy({ method: 'bogus', value: 50 })).toEqual({ method: 'none', value: 0 });
    expect(cleanRetailPolicy({ method: 'none', value: 99 })).toEqual({ method: 'none', value: 0 });
    expect(cleanRetailPolicy({ method: 'percent', value: -5 })).toEqual({ method: 'percent', value: 0 });
  });

  it('service without a db returns the safe default and echoes a cleaned set', async () => {
    const s = new RetailCommissionService(null);
    expect(await s.get({ tenantId: 't', branchId: null })).toEqual({ method: 'none', value: 0 });
    expect(await s.set({ tenantId: 't', branchId: null }, { method: 'percent', value: 10 })).toEqual({ method: 'percent', value: 10 });
  });
});
