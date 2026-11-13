// team-tips-splits.vitest.spec — Team Tips spec (Nov 13 2026) §07 / §09 / §20 #14–#18, verified on the EXISTING engine (no
// second split algorithm): the payment-time tip policy in engineInputFromLines + allocateTips (largest remainder, integer cents).
//   · one $9.60 tip, one technician → exactly $9.60 (never $19.20)
//   · two technicians, no explicit split → 50/50 exact-cent: $12.01 → $6.01 + $6.00 (Σ = $12.01); a card/cash mix stays exact
//   · an explicit (customer-directed) uneven split ALWAYS overrides the 50/50 default
//   · three or more technicians → the salon's configured rule: proportional to service earnings unless the salon opted into
//     'equal' — an explicit allocation still wins; Σ == the tip in every case
//   · tips are 100 % the technicians': the salon's tip share is 0 and a 60/40 commission never touches the tip
import { describe, it, expect } from 'vitest';
import { engineInputFromLines, type ServiceLineRow, type TicketMeta } from './compensation.service';
import { computeTicketCompensation, allocateTips } from './compensation-engine';

const ctx = { tenantId: 't1', branchId: 'b1' };
const line = (id: string, tech: string, cents: number, pct = 60): ServiceLineRow => ({ id, service_id: 's-' + id, technician_id: tech, price_cents_snapshot: cents, line_total_cents: cents, commission_type_snapshot: 'percent', commission_value_snapshot: pct });
const meta = (card: number, cash = 0, extra: Partial<TicketMeta> = {}): TicketMeta => ({ discountCents: 0, cardTipCents: card, cashTipCents: cash, ...extra });
const tipsOf = (lines: ServiceLineRow[], m: TicketMeta) => {
  const r = computeTicketCompensation(engineInputFromLines(ctx, 'tk', lines, m));
  return { r, by: Object.fromEntries(r.perTechnician.map((t) => [t.technicianId, t.cardTipCents + t.cashTipCents])) as Record<string, number> };
};

describe('Team Tips — exact-cent tip splits on the existing engine', () => {
  it('#15: one $9.60 tip for one technician is exactly $9.60 — even with two service lines', () => {
    const { r, by } = tipsOf([line('L1', 'vishal', 4000), line('L2', 'vishal', 2500)], meta(960));
    expect(by.vishal).toBe(960);
    expect(r.totals.cardTipCents + r.totals.cashTipCents).toBe(960);
    expect(r.salonTipCents).toBe(0);
  });
  it('#16: two technicians, no explicit split → $12.01 = $6.01 + $6.00 (deterministic remainder, Σ exact)', () => {
    const { r, by } = tipsOf([line('L1', 'anna', 4500), line('L2', 'bao', 3000)], meta(1201));
    expect(Object.values(by).sort((a, b) => b - a)).toEqual([601, 600]);
    expect(by.anna + by.bao).toBe(1201);
    expect(r.reconciliation.tipsReconcile).toBe(true);
    // the same input always gives the same cents (no random tie-break)
    expect(tipsOf([line('L1', 'anna', 4500), line('L2', 'bao', 3000)], meta(1201)).by).toEqual(by);
    // 50/50 even though the services are unequal: the default for exactly two is EQUAL, not proportional
    const mix = tipsOf([line('L1', 'anna', 9000), line('L2', 'bao', 1000)], meta(701, 300));
    expect(mix.by.anna + mix.by.bao).toBe(1001); expect(Math.abs(mix.by.anna - mix.by.bao)).toBeLessThanOrEqual(1);
  });
  it('#17: the customer\'s explicit uneven split overrides the 50/50 default', () => {
    const { by } = tipsOf([line('L1', 'anna', 4500), line('L2', 'bao', 3000)], meta(1000, 0, { directedTips: [{ technicianId: 'anna', tipCents: 700 }, { technicianId: 'bao', tipCents: 300 }] }));
    expect(by).toEqual({ anna: 700, bao: 300 });
  });
  it('#18: three technicians follow the salon\'s configured rule (proportional by default, equal only when opted in); explicit wins', () => {
    const three = [line('L1', 'anna', 6000), line('L2', 'bao', 3000), line('L3', 'chi', 1000)];
    const prop = tipsOf(three, meta(1001)).by;
    expect(prop.anna + prop.bao + prop.chi).toBe(1001);
    expect(prop.anna).toBeGreaterThan(prop.bao); expect(prop.bao).toBeGreaterThan(prop.chi);   // by service earnings, not a silent equal split
    const eq = tipsOf(three, meta(1001, 0, { manyTechTipMethod: 'equal' })).by;
    expect([eq.anna, eq.bao, eq.chi].sort((a, b) => b - a)).toEqual([334, 334, 333]);
    const directed = tipsOf(three, meta(1001, 0, { manyTechTipMethod: 'equal', directedTips: [{ technicianId: 'anna', tipCents: 1 }, { technicianId: 'bao', tipCents: 500 }, { technicianId: 'chi', tipCents: 500 }] })).by;
    expect(directed).toEqual({ anna: 1, bao: 500, chi: 500 });
  });
  it('#14: 100 % of the tip to technicians — a 60/40 commission never reduces it', () => {
    const { r, by } = tipsOf([line('L1', 'anna', 10000, 60)], meta(2000));
    expect(by.anna).toBe(2000);
    expect(r.perTechnician[0].serviceEarningsCents).toBe(6000);   // 60 % of the service only
    expect(r.salonTipCents).toBe(0);
    // the raw allocator: card and cash pools are each split exactly
    const m = allocateTips({ method: 'equal', cardTipCents: 1201, cashTipCents: 1, eligibleTechnicianIds: ['a', 'b'] } as never, [], []);
    expect((m.get('a')!.cardTipCents + m.get('b')!.cardTipCents)).toBe(1201);
    expect((m.get('a')!.cashTipCents + m.get('b')!.cashTipCents)).toBe(1);
  });
});
