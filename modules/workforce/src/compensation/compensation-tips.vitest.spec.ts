// compensation-tips.vitest.spec.ts — §12 allocation mapping (salon 0) + §18 card/cash report aggregates.
import { describe, it, expect } from 'vitest';
import { computeTicketCompensation } from './compensation-engine';
import { tipAllocationRowsFromResult, buildTipReport, type TipReportRow } from './compensation-tips';
import type { TicketCompensationInput } from './compensation.types';

const input: TicketCompensationInput = {
  tenantId: 't1', branchId: 'b1', ticketId: 'tk1',
  serviceLines: [{ lineId: 'L1', priceCents: 10000, commission: { type: 'percent', value: 60 },
    technicians: [{ technicianId: 'a', method: 'equal' }, { technicianId: 'b', method: 'equal' }] }],
  tip: { method: 'by_commission_pool', cardTipCents: 1000, cashTipCents: 600 },
};

describe('tips wiring (§12/§18)', () => {
  it('§12 allocation rows: per-tech total, salon keeps none, totals reconcile to ticket tip', () => {
    const r = computeTicketCompensation(input);
    const rows = tipAllocationRowsFromResult(input, r, { tenantId: 't1', branchId: 'b1' });
    const sum = rows.reduce((a, x) => a + x.tip_cents, 0);
    expect(sum).toBe(1600);                       // == card 1000 + cash 600
    expect(rows.every((x) => x.technician_id !== 'unassigned')).toBe(true);
    expect(r.salonTipCents).toBe(0);
  });

  it('§18 report: gross card/cash separate, totals, average, by technician/branch/day', () => {
    const rows: TipReportRow[] = [
      { technicianId: 'a', technicianName: 'Ann', branchId: 'b1', ticketId: 'tk1', day: '2026-06-25', cardTipCents: 1000, cashTipCents: 0 },
      { technicianId: 'b', technicianName: 'Bea', branchId: 'b1', ticketId: 'tk1', day: '2026-06-25', cardTipCents: 0, cashTipCents: 600 },
      { technicianId: 'a', technicianName: 'Ann', branchId: 'b2', ticketId: 'tk2', day: '2026-06-26', cardTipCents: 2000, cashTipCents: 0 },
    ];
    const rep = buildTipReport(rows);
    expect(rep.grossCardTipCents).toBe(3000);
    expect(rep.cashTipCents).toBe(600);
    expect(rep.totalTipCents).toBe(3600);
    expect(rep.salonTipCents).toBe(0);
    expect(rep.ticketCount).toBe(2);
    expect(rep.averageTipCents).toBe(1800);       // 3600 / 2 tickets
    expect(rep.byTechnician.find((t) => t.technicianId === 'a')!.totalCents).toBe(3000);
    expect(rep.byBranch.find((b) => b.branchId === 'b1')!.totalCents).toBe(1600);
    expect(rep.byDay.map((d) => d.day)).toEqual(['2026-06-25', '2026-06-26']);
  });

  it('empty report is zeros, not NaN', () => {
    const rep = buildTipReport([]);
    expect(rep.totalTipCents).toBe(0);
    expect(rep.averageTipCents).toBe(0);
  });
});
