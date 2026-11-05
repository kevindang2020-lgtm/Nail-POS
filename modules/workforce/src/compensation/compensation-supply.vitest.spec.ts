// compensation-supply.vitest.spec.ts — §9 supply methods (fixed, percent, tiered, recipe) + validation, and that the
// resolved cents flow through the engine to reduce the commissionable base (not tips).
import { describe, it, expect } from 'vitest';
import { resolveSupplyCents, validateSupplyConfig, type SupplyChargeConfig } from './compensation-supply';
import { computeTicketCompensation } from './compensation-engine';

describe('supply charges (§9)', () => {
  it('fixed: $8 per service', () => { expect(resolveSupplyCents({ method: 'fixed', amountCents: 800 }, 5000)).toBe(800); });
  it('percent: 10% of $90 price = $9', () => { expect(resolveSupplyCents({ method: 'percent', percent: 10 }, 9000)).toBe(900); });

  it('tiered by price: ≤$50→$5, $50.01–$100→$10, >$100→$15', () => {
    const cfg: SupplyChargeConfig = { method: 'tiered', tiers: [{ uptoCents: 5000, chargeCents: 500 }, { uptoCents: 10000, chargeCents: 1000 }, { uptoCents: null, chargeCents: 1500 }] };
    expect(resolveSupplyCents(cfg, 5000)).toBe(500);   // exactly $50
    expect(resolveSupplyCents(cfg, 5001)).toBe(1000);  // $50.01
    expect(resolveSupplyCents(cfg, 10000)).toBe(1000); // $100
    expect(resolveSupplyCents(cfg, 12000)).toBe(1500); // above $100
  });

  it('recipe: salon recovery sums product usage', () => {
    const cfg: SupplyChargeConfig = { method: 'recipe', items: [
      { productId: 'powder', expectedQty: 2, unitCostCents: 150 },              // 300
      { productId: 'gel', expectedQty: 1, unitCostCents: 200, salonRecoveryCents: 250 }, // explicit 250
    ] };
    expect(resolveSupplyCents(cfg, 9000)).toBe(550);
  });

  it('feeds the engine: $100 service, tiered supply $10, 60/40 → commissionable $90, tech $54', () => {
    const supplyCents = resolveSupplyCents({ method: 'tiered', tiers: [{ uptoCents: 10000, chargeCents: 1000 }, { uptoCents: null, chargeCents: 1500 }] }, 10000);
    const r = computeTicketCompensation({ tenantId: 't1', branchId: 'b1', ticketId: 'tk1',
      serviceLines: [{ lineId: 'L1', priceCents: 10000, supply: { method: 'fixed', value: supplyCents }, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'a', method: 'equal' }] }],
      tip: { method: 'equal', cardTipCents: 2000 } });
    expect(r.totals.supplyCents).toBe(1000);
    expect(r.totals.commissionableCents).toBe(9000);
    expect(r.totals.techServiceEarningsCents).toBe(5400);
    expect(r.perTechnician[0].cardTipCents).toBe(2000); // tip untouched by supply
  });

  it('§27 validation', () => {
    expect(validateSupplyConfig({ method: 'percent', percent: 120 }).errors[0]).toMatch(/0–100/);
    expect(validateSupplyConfig({ method: 'tiered', tiers: [{ uptoCents: null, chargeCents: 1 }, { uptoCents: null, chargeCents: 2 }] }).errors[0]).toMatch(/one open-ended/);
    expect(validateSupplyConfig({ method: 'fixed', amountCents: -1 }).errors[0]).toMatch(/≥ 0/);
  });
});
