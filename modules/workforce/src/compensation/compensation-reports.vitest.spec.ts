// compensation-reports.vitest.spec.ts — §34 commission + supply reports: grouping, reconciliation, CSV.
import { describe, it, expect } from 'vitest';
import { buildCommissionReport, buildSupplyReport, commissionReportToCsv, type CommissionReportRow } from './compensation-reports';

const rows: CommissionReportRow[] = [
  { technicianId: 'a', branchId: 'b1', serviceId: 'gel', day: '2026-06-25', grossPriceCents: 10000, discountCents: 0, supplyCents: 1000, commissionableCents: 9000, techServiceEarningsCents: 5400, salonServiceShareCents: 3600, retailCommissionCents: 0 },
  { technicianId: 'b', branchId: 'b1', serviceId: 'pedi', day: '2026-06-25', grossPriceCents: 5000, discountCents: 500, supplyCents: 500, commissionableCents: 4000, techServiceEarningsCents: 2000, salonServiceShareCents: 2000, retailCommissionCents: 0 },
  { technicianId: 'a', branchId: 'b2', serviceId: 'gel', day: '2026-06-26', grossPriceCents: 10000, discountCents: 0, supplyCents: 1000, commissionableCents: 9000, techServiceEarningsCents: 5400, salonServiceShareCents: 3600, retailCommissionCents: 300 },
];

describe('commission report (§34)', () => {
  const rep = buildCommissionReport(rows);
  it('totals reconcile: Σ tech + Σ salon == Σ commissionable', () => {
    expect(rep.totals.commissionableCents).toBe(22000);
    expect(rep.totals.techShareCents).toBe(12800);
    expect(rep.totals.salonShareCents).toBe(9200);
    expect(rep.reconciles).toBe(true);
  });
  it('groups by technician / branch / service / day', () => {
    expect(rep.byTechnician.find((t) => t.technicianId === 'a')!.techShareCents).toBe(10800);
    expect(rep.byBranch.find((b) => b.branchId === 'b1')!.commissionableCents).toBe(13000);
    expect(rep.byService.find((s) => s.serviceId === 'gel')!.grossPriceCents).toBe(20000);
    expect(rep.byDay.map((d) => d.day).sort()).toEqual(['2026-06-25', '2026-06-26']);
    expect(rep.totals.ticketDays).toBe(2);
  });
  it('CSV export has a header + one row per technician', () => {
    const csv = commissionReportToCsv(rep);
    expect(csv.split('\n')[0]).toMatch(/technicianId,gross/);
    expect(csv.split('\n').length).toBe(1 + rep.byTechnician.length);
  });
});

describe('supply report (§34)', () => {
  it('salon-retained supply by service/technician/branch', () => {
    const rep = buildSupplyReport(rows);
    expect(rep.totalSupplyCents).toBe(2500);
    expect(rep.byService.find((s) => s.serviceId === 'gel')!.supplyCents).toBe(2000);
    expect(rep.byTechnician.find((t) => t.technicianId === 'a')!.supplyCents).toBe(2000);
  });
});
