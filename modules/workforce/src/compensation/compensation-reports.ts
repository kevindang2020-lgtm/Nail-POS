/**
 * compensation-reports.ts — commission + supply reports (spec §34) built PURELY from the immutable snapshot, so every
 * report reconciles with checkout and with the Tech App (one source of truth). Tips reports live in compensation-tips.ts.
 * Integer cents. Grouping is by the keys present on the snapshot (technician/branch/service/day); category grouping is a
 * service lookup the caller can layer on.
 */
import type { Cents } from './compensation.types';

export interface CommissionReportRow {
  technicianId: string | null; branchId: string | null; serviceId: string | null; day: string;
  grossPriceCents: number; discountCents: number; supplyCents: number; commissionableCents: number;
  techServiceEarningsCents: number; salonServiceShareCents: number; retailCommissionCents: number;
}

interface CommissionGroup { grossPriceCents: Cents; discountCents: Cents; supplyCents: Cents; commissionableCents: Cents; techShareCents: Cents; salonShareCents: Cents; retailCents: Cents }
const emptyGroup = (): CommissionGroup => ({ grossPriceCents: 0, discountCents: 0, supplyCents: 0, commissionableCents: 0, techShareCents: 0, salonShareCents: 0, retailCents: 0 });

function accumulate<T extends string | null>(rows: CommissionReportRow[], key: (r: CommissionReportRow) => T) {
  const m = new Map<T, CommissionGroup>();
  for (const r of rows) {
    const k = key(r); const g = m.get(k) ?? emptyGroup();
    g.grossPriceCents += r.grossPriceCents; g.discountCents += r.discountCents; g.supplyCents += r.supplyCents;
    g.commissionableCents += r.commissionableCents; g.techShareCents += r.techServiceEarningsCents;
    g.salonShareCents += r.salonServiceShareCents; g.retailCents += r.retailCommissionCents;
    m.set(k, g);
  }
  return m;
}

export interface CommissionReport {
  totals: CommissionGroup & { ticketDays: number };
  byTechnician: ({ technicianId: string | null } & CommissionGroup)[];
  byBranch: ({ branchId: string | null } & CommissionGroup)[];
  byService: ({ serviceId: string | null } & CommissionGroup)[];
  byDay: ({ day: string } & CommissionGroup)[];
  reconciles: boolean; // Σ techShare + Σ salonShare == Σ commissionable
}

/** PURE: §34 commission report (before/after supply & discount visible; salon vs technician share). */
export function buildCommissionReport(rows: CommissionReportRow[]): CommissionReport {
  const totals = [...accumulate(rows, () => 'all').values()][0] ?? emptyGroup();
  const out = (m: Map<any, CommissionGroup>, idKey: string) => [...m].map(([id, g]) => ({ [idKey]: id, ...g })) as any;
  return {
    totals: { ...totals, ticketDays: new Set(rows.map((r) => r.day)).size },
    byTechnician: out(accumulate(rows, (r) => r.technicianId), 'technicianId'),
    byBranch: out(accumulate(rows, (r) => r.branchId), 'branchId'),
    byService: out(accumulate(rows, (r) => r.serviceId), 'serviceId'),
    byDay: out(accumulate(rows, (r) => r.day), 'day'),
    reconciles: totals.techShareCents + totals.salonShareCents === totals.commissionableCents,
  };
}

export interface SupplyReport {
  totalSupplyCents: Cents;
  byService: { serviceId: string | null; supplyCents: Cents }[];
  byTechnician: { technicianId: string | null; supplyCents: Cents }[];
  byBranch: { branchId: string | null; supplyCents: Cents }[];
}

/** PURE: §34 supply report — salon-retained supply recovery by service/technician/branch. */
export function buildSupplyReport(rows: CommissionReportRow[]): SupplyReport {
  const group = <T extends string | null>(key: (r: CommissionReportRow) => T) => {
    const m = new Map<T, Cents>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.supplyCents);
    return m;
  };
  return {
    totalSupplyCents: rows.reduce((a, r) => a + r.supplyCents, 0),
    byService: [...group((r) => r.serviceId)].map(([serviceId, supplyCents]) => ({ serviceId, supplyCents })),
    byTechnician: [...group((r) => r.technicianId)].map(([technicianId, supplyCents]) => ({ technicianId, supplyCents })),
    byBranch: [...group((r) => r.branchId)].map(([branchId, supplyCents]) => ({ branchId, supplyCents })),
  };
}

/** Minimal CSV (§34 export) — header + rows, integer cents to 2dp dollars. */
export function commissionReportToCsv(rep: CommissionReport): string {
  const d = (c: Cents) => (c / 100).toFixed(2);
  const head = 'technicianId,gross,discount,supply,commissionable,techShare,salonShare,retail';
  const lines = rep.byTechnician.map((t) => [t.technicianId ?? '', d(t.grossPriceCents), d(t.discountCents), d(t.supplyCents), d(t.commissionableCents), d(t.techShareCents), d(t.salonShareCents), d(t.retailCents)].join(','));
  return [head, ...lines].join('\n');
}
