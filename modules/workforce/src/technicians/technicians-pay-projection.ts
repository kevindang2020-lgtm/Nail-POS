// technicians-pay-projection.ts — pure projections for the Technicians read surface (Technician Profile merge, Oct 12 2026; mandate §72 / §122).
//
// `technicians.view` is the ROSTER read (name, status, skills, schedule, today's sales). PAY — commission %,
// commission config/history, payroll summary, tip and commission figures — is `technicians.view_pay` (OWNER/MANAGER).
// A principal without view_pay gets the same shapes with the pay fields projected OUT (0 / absent), so every
// consumer keeps type-checking and a front-desk screen simply shows "—".
//
// Also the ONE place that strips commission from a profile edit: PATCH /pos/technicians/:id must never write
// commission columns; that goes through PATCH /commission (admin code) only.
import type { POSTechnicianRow, POSTechnicianDetail, POSTechniciansFullState, TechnicianListResponse, UpdateTechnicianRequest } from './technicians.dto';

/** Keys of UpdateTechnicianRequest that are pay data. Everything else is a profile edit. */
export const COMMISSION_UPDATE_KEYS = ['commissionSplitPercent'] as const;

export function stripCommissionFromUpdate(req: UpdateTechnicianRequest): { commissionSplitPercent: number | undefined } & UpdateTechnicianRequest {
  const out: any = { ...(req || {}) };
  const attempted = out.commissionSplitPercent;
  for (const k of COMMISSION_UPDATE_KEYS) delete out[k];
  // belt and braces: the raw column names, should a client send them
  for (const k of ['default_commission_split_percent', 'commission_value', 'commission_type', 'defaultCommissionPercent']) delete out[k];
  return { commissionSplitPercent: typeof attempted === 'number' ? attempted : undefined, ...out };
}

/** Field names a non-pay reader must not receive on a roster row. */
export const ROW_PAY_FIELDS = ['estimatedCommissionCents', 'todayTipsCents'] as const;

export function projectRowPay<T extends Partial<POSTechnicianRow>>(row: T, canViewPay: boolean): T {
  if (canViewPay) return row;
  const out: any = { ...row };
  for (const k of ROW_PAY_FIELDS) if (k in out) out[k] = 0;
  return out;
}

export function projectTechnicianPay(detail: POSTechnicianDetail, canViewPay: boolean): POSTechnicianDetail {
  if (canViewPay) return detail;
  const out: any = projectRowPay(detail, false);
  // Keep the keys (the drawer destructures them) but carry no figures.
  out.commission = { defaultPercent: 0, byService: [], byCategory: [], tipHandling: detail.commission?.tipHandling ?? 'keep', payrollPeriod: detail.commission?.payrollPeriod ?? 'biweekly', redacted: true };
  out.payroll = { periodLabel: detail.payroll?.periodLabel ?? '', salesCents: detail.payroll?.salesCents ?? 0, tipsCents: 0, commissionCents: 0, estimatedTodayCents: 0, closed: !!detail.payroll?.closed, redacted: true };
  return out;
}

export function projectTechnicianListPay(list: TechnicianListResponse, canViewPay: boolean): TechnicianListResponse {
  if (canViewPay) return list;
  // TechnicianListItem carries no pay fields today; projected defensively so a future column cannot leak by default.
  return { ...list, items: list.items.map((i) => projectRowPay(i as any, false)) };
}

export function projectTechniciansStatePay(st: POSTechniciansFullState, canViewPay: boolean): POSTechniciansFullState {
  if (canViewPay) return st;
  const out: any = { ...st };
  out.rows = { ...st.rows, items: st.rows.items.map((r) => projectRowPay(r, false)) };
  out.kpisFull = { ...st.kpisFull, todayTipsCents: 0, estimatedCommissionCents: 0 };
  if (st.insights) out.insights = { ...st.insights, payrollSnapshotCents: 0 };
  if (st.selectedTechnicianDetail) out.selectedTechnicianDetail = projectTechnicianPay(st.selectedTechnicianDetail, false);
  out.technicians = projectTechnicianListPay(st.technicians, false);
  return out;
}
