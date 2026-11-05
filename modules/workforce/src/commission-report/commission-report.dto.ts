// commission-report.dto.ts — per-technician commission + tips rollup over a period. Reads the IMMUTABLE compensation
// snapshot (ticket_compensation_snapshots — PAID tickets only, the engine's own per-line figures, tips from the engine's
// allocations) so this legacy report shows the SAME numbers as payroll / the Tech App (Payroll mandate §155: reports
// read the authoritative snapshot, never an independent formula). ONE-PAY (Oct 13 2026): the rollup never prices a line
// itself — a line's commission is the snapshot's figure (commissionCents) or nothing. Money = integer cents.

export interface CommissionReportContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export type CommissionPreset = 'today' | 'week' | 'month' | 'quarter' | 'year';

// A single service line's commission inputs (snapshot-based).
export interface CommissionLine {
  technicianId: string | null;
  lineTotalCents: number;
  /** the rate stamped on the line (display / audit only — never multiplied here) */
  commissionType?: string;
  commissionValue?: number;
  /** the compensation snapshot's figure for the line — this IS the commission (ONE-PAY: no recomputation, no fallback) */
  commissionCents: number;
}

export interface CommissionTechRow {
  technicianId: string;
  technicianName: string | null;
  serviceCount: number;
  serviceRevenueCents: number;
  commissionCents: number;
  tipsCents: number;
  payoutCents: number;             // commission + tips
  effectiveRatePercent: number;    // commission / serviceRevenue, 1 dp
}

export interface CommissionKpis {
  technicianCount: number;
  totalServiceRevenueCents: number;
  totalCommissionCents: number;
  totalTipsCents: number;
  totalPayoutCents: number;
  averageRatePercent: number;      // total commission / total service revenue, 1 dp
}

export interface CommissionReportState {
  preset: CommissionPreset;
  from: string;
  to: string;
  kpis: CommissionKpis;
  rows: CommissionTechRow[];
}

// Inclusive [from,to] ISO date range for a preset, relative to nowIso. Server-controlled (never client dates).
export function presetRange(preset: CommissionPreset, nowIso: string): { from: string; to: string } {
  const now = new Date(nowIso);
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  const endOfToday = new Date(Date.UTC(y, m, d, 23, 59, 59));
  let start: Date;
  switch (preset) {
    case 'today': start = new Date(Date.UTC(y, m, d)); break;
    case 'week': { const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); start = new Date(Date.UTC(y, m, d - dow)); break; }
    case 'quarter': { const qm = Math.floor(m / 3) * 3; start = new Date(Date.UTC(y, qm, 1)); break; }
    case 'year': start = new Date(Date.UTC(y, 0, 1)); break;
    case 'month': default: start = new Date(Date.UTC(y, m, 1)); break;
  }
  return { from: iso(start), to: iso(endOfToday) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Pure rollup: group lines by technician, sum the snapshot commission per line, add ticket tips, sort by
// commission desc. No DB, fully unit-testable.
export function buildCommissionReport(
  lines: CommissionLine[],
  tipsByTech: Record<string, number>,
  techNames: Record<string, string>,
  // Oct 13 2026 (FLOW D8): posted ledger adjustments per technician — commission (reversals/corrections) and tips
  adjustments?: { commission: Record<string, number>; tips: Record<string, number> },
): { kpis: CommissionKpis; rows: CommissionTechRow[] } {
  const acc = new Map<string, { rev: number; comm: number; count: number }>();
  for (const l of lines) {
    const tech = l.technicianId || '';
    if (!tech) continue;
    const comm = Math.round(Number(l.commissionCents) || 0);   // the snapshot's figure; absent ⇒ 0, never a re-priced estimate
    const cur = acc.get(tech) || { rev: 0, comm: 0, count: 0 };
    cur.rev += Math.max(0, Math.round(l.lineTotalCents)); cur.comm += comm; cur.count += 1;
    acc.set(tech, cur);
  }
  // include techs that only have tips or ledger money (no commissionable lines)
  for (const tech of [...Object.keys(tipsByTech), ...Object.keys(adjustments?.commission ?? {}), ...Object.keys(adjustments?.tips ?? {})]) if (tech && !acc.has(tech)) acc.set(tech, { rev: 0, comm: 0, count: 0 });

  const rows: CommissionTechRow[] = [...acc.entries()].map(([technicianId, v]) => {
    // a reversal can take a technician's period money below zero; the report shows it honestly (payroll floors the payment, §150)
    const tipsCents = Math.max(0, Math.round(tipsByTech[technicianId] || 0)) + Math.round(adjustments?.tips?.[technicianId] || 0);
    const commissionCents = v.comm + Math.round(adjustments?.commission?.[technicianId] || 0);
    return {
      technicianId, technicianName: techNames[technicianId] ?? null,
      serviceCount: v.count, serviceRevenueCents: v.rev, commissionCents, tipsCents,
      payoutCents: commissionCents + tipsCents,
      effectiveRatePercent: v.rev > 0 ? round1((commissionCents / v.rev) * 100) : 0,
    };
  }).sort((a, b) => b.commissionCents - a.commissionCents || b.payoutCents - a.payoutCents);

  const totalServiceRevenueCents = rows.reduce((a, r) => a + r.serviceRevenueCents, 0);
  const totalCommissionCents = rows.reduce((a, r) => a + r.commissionCents, 0);
  const totalTipsCents = rows.reduce((a, r) => a + r.tipsCents, 0);
  const kpis: CommissionKpis = {
    technicianCount: rows.length,
    totalServiceRevenueCents, totalCommissionCents, totalTipsCents,
    totalPayoutCents: totalCommissionCents + totalTipsCents,
    averageRatePercent: totalServiceRevenueCents > 0 ? round1((totalCommissionCents / totalServiceRevenueCents) * 100) : 0,
  };
  return { kpis, rows };
}
