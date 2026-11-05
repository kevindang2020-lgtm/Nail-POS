// super-admin-revenue-residuals.service.ts — shapes the platform Revenue & Residuals reads.
// Read-only surface (overview + records + agreement detail). Honest availability flag when no DB is wired.

import type { ResidualRevenueForecast } from '@aipowersalon/api-contracts/platform';
import { KyselyRevenueResidualsRepo, type RevenueListOpts } from './super-admin-revenue-residuals.kysely.repository';
import { computeApplicableCosts, RESIDUAL_EXPENSE_CATEGORIES, type ExpenseLine } from './residual-eligible-expenses';
import { splitPercentsValid } from './revenue-split';
import { toCsvGrid, toXlsxGrid, toPdfGrid } from '../super-admin-analytics/analytics-export';

const isDate = (s?: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const dollars = (cents: number) => (Number(cents || 0) / 100).toFixed(2);

const EMPTY_KPIS = {
  subscriptionRevenueCents: 0, processingResidualsCents: 0, monthlyRecurringRevenueCents: 0, addOnRevenueCents: 0,
  refundsCreditsCents: 0, outstandingBalancesCents: 0, forecastedRevenueCents: 0, partnerPayoutsDueCents: 0,
};

export class SuperAdminRevenueResidualsService {
  constructor(private readonly repo?: KyselyRevenueResidualsRepo) {}

  async overview(agreementId?: string) {
    if (!this.repo) {
      return {
        available: false, generatedAt: new Date().toISOString(), kpis: EMPTY_KPIS,
        revenueByProcessor: { totalCents: 0, slices: [] }, revenueSplitBreakdown: { totalCents: 0, aiCents: 0, processorCents: 0, salonCents: 0, aiPct: 0, processorPct: 0, salonPct: 0 },
        revenueTrend: [], recentActivity: [], outstandingBalances: [], forecastSummary: { grossCents: 0, netCents: 0, aiCents: 0, processorCents: 0, salonCents: 0 },
        selectedAgreement: null,
      };
    }
    const o = await this.repo.overview();
    const id = agreementId || (await this.repo.defaultAgreementId());
    const selectedAgreement = id ? await this.repo.agreementDetail(id) : null;
    return { available: true, generatedAt: new Date().toISOString(), ...o, selectedAgreement };
  }

  async listRecords(opts: RevenueListOpts) {
    const page = Math.max(1, Math.trunc(opts.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(opts.pageSize || 10)));
    if (!this.repo) return { page, pageSize, total: 0, rows: [] as any[], available: false };
    const { rows, total } = await this.repo.listRecords({ ...opts, page, pageSize });
    return { page, pageSize, total, rows, available: true };
  }

  async agreementDetail(agreementId: string) {
    if (!this.repo) return { available: false, agreement: null };
    if (!String(agreementId ?? '').trim()) return { available: true, agreement: null };
    const agreement = await this.repo.agreementDetail(agreementId);
    return { available: true, agreement };
  }

  async listAgreements(opts: { q?: string; tenantId?: string; processor?: string; status?: string } = {}) {
    if (!this.repo) return { available: false, agreements: [] as any[] };
    return { available: true, agreements: await this.repo.listAgreements(opts) };
  }

  async listVersions(agreementId: string) {
    if (!this.repo) return { available: false, versions: [] as any[] };
    if (!String(agreementId ?? '').trim()) return { available: true, versions: [] };
    return { available: true, versions: await this.repo.listVersions(agreementId) };
  }

  private validateTerms(t: { aiPct?: number; processorPct?: number; salonPct?: number; effectiveDate?: string; expirationDate?: string | null }): string | null {
    const ai = Number(t.aiPct), pr = Number(t.processorPct), sa = Number(t.salonPct);
    if (![ai, pr, sa].every((x) => Number.isFinite(x))) return 'percentages_required';
    if (!splitPercentsValid({ ai, processor: pr, salon: sa })) return 'percentages_must_total_100';
    if (!isDate(t.effectiveDate)) return 'effective_date_required';
    if (t.expirationDate != null && t.expirationDate !== '' && !isDate(t.expirationDate)) return 'invalid_expiration_date';
    if (isDate(t.expirationDate) && String(t.expirationDate) < String(t.effectiveDate)) return 'expiration_before_effective';
    return null;
  }

  async createAgreement(actor: { id?: string; role?: string }, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(input?.name ?? '').trim()) return { ok: false as const, error: 'name_required', status: 400 };
    const bad = this.validateTerms(input);
    if (bad) return { ok: false as const, error: bad, status: 400 };
    const res = await this.repo.createAgreement(actor, {
      name: String(input.name).trim(), agreementType: input.agreementType, tenantId: input.tenantId ?? null, branchId: input.branchId ?? null,
      processor: input.processor ?? null, revenueSource: input.revenueSource ?? null,
      aiPct: Number(input.aiPct), processorPct: Number(input.processorPct), salonPct: Number(input.salonPct),
      effectiveDate: input.effectiveDate, expirationDate: input.expirationDate || null, currency: input.currency,
      roundingPolicy: input.roundingPolicy, refundAllocation: input.refundAllocation,
      minimumVolumeCents: input.minimumVolumeCents ?? null, maximumVolumeCents: input.maximumVolumeCents ?? null,
      status: input.status, changeReason: input.changeReason,
    });
    if (!res.ok) return { ...res, status: res.error === 'overlap' || res.error === 'duplicate_code' ? 409 : 400 };
    return { ...res, status: 201 };
  }

  async addVersion(actor: { id?: string; role?: string }, agreementId: string, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(agreementId ?? '').trim()) return { ok: false as const, error: 'agreement_required', status: 400 };
    const bad = this.validateTerms(input);
    if (bad) return { ok: false as const, error: bad, status: 400 };
    const res = await this.repo.addVersion(actor, agreementId, {
      aiPct: Number(input.aiPct), processorPct: Number(input.processorPct), salonPct: Number(input.salonPct),
      effectiveDate: input.effectiveDate, expirationDate: input.expirationDate || null, currency: input.currency,
      roundingPolicy: input.roundingPolicy, refundAllocation: input.refundAllocation, changeReason: input.changeReason,
    });
    if (!res.ok) return { ...res, status: res.error === 'overlap' ? 409 : res.error === 'not_found' ? 404 : 400 };
    return { ...res, status: 201 };
  }

  // ── Review Residual Statements ──
  async importStatement(actor: { id?: string; role?: string }, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(input?.processor ?? '').trim()) return { ok: false as const, error: 'processor_required', status: 400 };
    if (!String(input?.statementRef ?? '').trim()) return { ok: false as const, error: 'statement_ref_required', status: 400 };
    if (!isDate(input?.periodStart) || !isDate(input?.periodEnd)) return { ok: false as const, error: 'period_required', status: 400 };
    if (String(input.periodEnd) < String(input.periodStart)) return { ok: false as const, error: 'period_end_before_start', status: 400 };
    // Costs may arrive itemized (`costLines`) or as one opaque total (`applicableCostsCents`, the historical shape).
    // Itemized wins: only ELIGIBLE categories reach the split, and the breakdown is returned so a reviewer can see
    // exactly what was deducted and what was excluded — an unexplained deduction is what this closes.
    const costLines: ExpenseLine[] = Array.isArray(input?.costLines)
      ? input.costLines.map((l: any) => ({ category: String(l?.category ?? 'other'), amountCents: Number(l?.amountCents) || 0, note: l?.note ?? null }))
      : [];
    const breakdown = costLines.length ? computeApplicableCosts(costLines, input?.eligibilityOverrides ?? {}) : null;
    const applicableCostsCents = breakdown ? breakdown.applicableCostsCents : (Math.abs(Math.round(Number(input?.applicableCostsCents) || 0)));

    const res = await this.repo.importStatement(actor, {
      applicableCostsCents,
      processor: String(input.processor).trim(), statementRef: String(input.statementRef).trim(), merchantAccount: input.merchantAccount ?? null,
      tenantId: input.tenantId ?? null, branchId: input.branchId ?? null, periodStart: input.periodStart, periodEnd: input.periodEnd, currency: input.currency,
      transactionVolumeCents: Number(input.transactionVolumeCents) || 0, eligibleRevenueCents: Number(input.eligibleRevenueCents) || 0,
      processingResidualCents: Number(input.processingResidualCents) || 0, feesCents: Number(input.feesCents) || 0, refundsCents: Number(input.refundsCents) || 0,
      chargebacksCents: Number(input.chargebacksCents) || 0, adjustmentsCents: Number(input.adjustmentsCents) || 0,
      processorCalculatedCents: Number(input.processorCalculatedCents) || 0, sourceFile: input.sourceFile ?? null,
      lines: Array.isArray(input.lines) ? input.lines.map((l: any) => ({ merchantAccount: l.merchantAccount ?? null, tenantId: l.tenantId ?? null, branchId: l.branchId ?? null, grossVolumeCents: Number(l.grossVolumeCents) || 0, eligibleRevenueCents: Number(l.eligibleRevenueCents) || 0, residualCents: Number(l.residualCents) || 0, note: l.note ?? null })) : [],
    });
    if (!res.ok) return { ...res, status: 400 };
    return { ...res, ...(breakdown ? { costBreakdown: breakdown } : {}), status: res.duplicate ? 200 : 201 };
  }

  /** The eligible-expense catalog + defaults, so the Super Admin screen can show what may be deducted and why. */
  expenseCategories() { return { categories: RESIDUAL_EXPENSE_CATEGORIES }; }

  async listStatements(opts: { processor?: string; tenantId?: string; reviewStatus?: string } = {}) {
    if (!this.repo) return { available: false, statements: [] as any[] };
    return { available: true, statements: await this.repo.listStatements(opts) };
  }

  async statementDetail(id: string) {
    if (!this.repo) return { available: false, statement: null };
    if (!String(id ?? '').trim()) return { available: true, statement: null };
    return { available: true, statement: await this.repo.statementDetail(id) };
  }

  async reviewStatement(actor: { id?: string; role?: string }, id: string, status: string, notes?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'statement_required', status: 400 };
    if (!['pending', 'in_review', 'reviewed', 'flagged', 'reconciled'].includes(String(status))) return { ok: false as const, error: 'invalid_status', status: 400 };
    const res = await this.repo.reviewStatement(actor, id, String(status), notes);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : 400 };
    return { ...res, status: 200 };
  }

  // ── Reconcile Processor Reports ──
  async reconcileStatement(actor: { id?: string; role?: string }, statementId: string, notes?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(statementId ?? '').trim()) return { ok: false as const, error: 'statement_required', status: 400 };
    const res = await this.repo.reconcileStatement(actor, statementId, notes);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : 400 };
    return res; // domain result carries status: 'matched' | 'variance' (do not overwrite with an HTTP code)
  }

  async listReconciliations(opts: { statementId?: string; status?: string } = {}) {
    if (!this.repo) return { available: false, reconciliations: [] as any[] };
    return { available: true, reconciliations: await this.repo.listReconciliations(opts) };
  }

  // ── Calculate Partner Payouts ──
  async calculatePartnerPayout(actor: { id?: string; role?: string }, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(input?.agreementId ?? '').trim()) return { ok: false as const, error: 'agreement_required', status: 400 };
    if (!isDate(input?.periodStart) || !isDate(input?.periodEnd)) return { ok: false as const, error: 'period_required', status: 400 };
    if (String(input.periodEnd) < String(input.periodStart)) return { ok: false as const, error: 'period_end_before_start', status: 400 };
    const res = await this.repo.calculatePartnerPayout(actor, { agreementId: String(input.agreementId), periodStart: input.periodStart, periodEnd: input.periodEnd, priorBalanceCents: Number(input.priorBalanceCents) || 0 });
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : 400 };
    return res; // domain result carries duplicate + amounts (no HTTP-status override)
  }

  async approvePartnerPayout(actor: { id?: string; role?: string }, id: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'payout_required', status: 400 };
    const res = await this.repo.approvePartnerPayout(actor, id);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : res.error === 'invalid_state' ? 409 : 400 };
    return res; // { ok, status: 'approved' } — domain status preserved
  }

  async listPartnerPayouts(opts: { processor?: string; agreementId?: string; status?: string } = {}) {
    if (!this.repo) return { available: false, payouts: [] as any[] };
    return { available: true, payouts: await this.repo.listPartnerPayouts(opts) };
  }

  // ── Calculate Tenant Incentives ──
  async calculateTenantIncentive(actor: { id?: string; role?: string }, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(input?.agreementId ?? '').trim()) return { ok: false as const, error: 'agreement_required', status: 400 };
    if (!String(input?.tenantId ?? '').trim()) return { ok: false as const, error: 'tenant_required', status: 400 };
    if (!isDate(input?.periodStart) || !isDate(input?.periodEnd)) return { ok: false as const, error: 'period_required', status: 400 };
    if (String(input.periodEnd) < String(input.periodStart)) return { ok: false as const, error: 'period_end_before_start', status: 400 };
    const res = await this.repo.calculateTenantIncentive(actor, { agreementId: String(input.agreementId), tenantId: String(input.tenantId), periodStart: input.periodStart, periodEnd: input.periodEnd, priorUnpaidBalanceCents: Number(input.priorUnpaidBalanceCents) || 0 });
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : 400 };
    return res; // domain result carries duplicate + amounts
  }

  async approveTenantIncentive(actor: { id?: string; role?: string }, id: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'incentive_required', status: 400 };
    const res = await this.repo.approveTenantIncentive(actor, id);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : res.error === 'invalid_state' ? 409 : 400 };
    return res; // { ok, status: 'approved' }
  }

  async listTenantIncentives(opts: { tenantId?: string; agreementId?: string; status?: string } = {}) {
    if (!this.repo) return { available: false, incentives: [] as any[] };
    return { available: true, incentives: await this.repo.listTenantIncentives(opts) };
  }

  // ── Export Payout Reports (filter-aware, audited, formula-injection-guarded CSV) ──
  async exportPayoutReports(actor: { id?: string; role?: string }, opts: { dataset?: string } & RevenueListOpts) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    const dataset = ['records', 'payouts', 'incentives'].includes(String(opts.dataset)) ? String(opts.dataset) : 'records';
    const stamp = new Date().toISOString().slice(0, 10);
    let headers: string[] = [];
    let rows: (string | number | null)[][] = [];

    if (dataset === 'payouts') {
      const list = await this.repo.listPartnerPayouts({ processor: opts.processor, agreementId: opts.agreementId, status: opts.status, limit: 5000 });
      headers = ['Agreement', 'Partner', 'Period Start', 'Period End', 'Eligible Revenue', 'Partner %', 'Gross Share', 'Refund Alloc', 'Adjustment Alloc', 'Prior Balance', 'Amount Due', 'Status'];
      rows = list.map((p: any) => [p.agreementCode ?? '', p.processor ?? '', p.periodStart ?? '', p.periodEnd ?? '', dollars(p.eligibleRevenueCents), p.partnerPct == null ? '' : String(p.partnerPct), dollars(p.partnerGrossShareCents), dollars(p.refundAllocationCents), dollars(p.adjustmentAllocationCents), dollars(p.priorBalanceCents), dollars(p.amountDueCents), p.status]);
    } else if (dataset === 'incentives') {
      const list = await this.repo.listTenantIncentives({ tenantId: opts.tenantId, agreementId: opts.agreementId, status: opts.status, limit: 5000 });
      headers = ['Agreement', 'Tenant', 'Period Start', 'Period End', 'Eligible Revenue', 'Salon %', 'Incentive Earned', 'Refund Alloc', 'Adjustment Alloc', 'Prior Unpaid', 'Amount Due', 'Status'];
      rows = list.map((i: any) => [i.agreementCode ?? '', i.tenantName ?? i.tenantId ?? '', i.periodStart ?? '', i.periodEnd ?? '', dollars(i.eligibleGrossRevenueCents), i.salonPct == null ? '' : String(i.salonPct), dollars(i.incentiveEarnedCents), dollars(i.refundAllocationCents), dollars(i.adjustmentAllocationCents), dollars(i.priorUnpaidBalanceCents), dollars(i.currentAmountDueCents), i.status]);
    } else {
      const { rows: recs } = await this.repo.listRecords({ ...opts, page: 1, pageSize: 5000 } as RevenueListOpts);
      headers = ['Agreement', 'Tenant', 'Branch', 'Processor', 'Revenue Source', 'Gross Revenue', 'Salon Incentive', 'Processor Share', 'AI PowerSalon Share', 'Refunds/Credits', 'Net Revenue', 'Effective Date', 'Status'];
      rows = recs.map((r: any) => [r.agreementCode ?? '', r.tenantName ?? '', r.branchName ?? '', r.processor ?? '', r.revenueSource ?? '', dollars(r.grossRevenueCents), dollars(r.salonIncentiveShareCents), dollars(r.processorShareCents), dollars(r.aiShareCents), dollars(r.refundsCreditsCents), dollars(r.netRevenueCents), r.effectiveDate ?? '', r.status]);
    }

    const content = toCsvGrid(headers, rows);
    const filterSummary = ['agreementId', 'tenantId', 'branchId', 'processor', 'revenueType', 'status', 'startDate', 'endDate']
      .map((k) => (opts as any)[k] ? `${k}=${(opts as any)[k]}` : null).filter(Boolean).join(', ') || 'no filters';
    await this.repo.recordExportAudit(actor, dataset, rows.length, filterSummary);

    const fmt = ['csv', 'xlsx', 'pdf'].includes(String((opts as any).format)) ? String((opts as any).format) : 'csv';
    const title = `Revenue ${dataset[0].toUpperCase()}${dataset.slice(1)} — ${stamp}`;
    if (fmt === 'xlsx') {
      const buf = toXlsxGrid(headers, rows, dataset.slice(0, 28));
      return { ok: true as const, status: 200, filename: `revenue-${dataset}-${stamp}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', encoding: 'base64' as const, rowCount: rows.length, content: buf.toString('base64') };
    }
    if (fmt === 'pdf') {
      const buf = toPdfGrid(title, headers, rows);
      return { ok: true as const, status: 200, filename: `revenue-${dataset}-${stamp}.pdf`, mime: 'application/pdf', encoding: 'base64' as const, rowCount: rows.length, content: buf.toString('base64') };
    }
    return { ok: true as const, status: 200, filename: `revenue-${dataset}-${stamp}.csv`, mime: 'text/csv', encoding: 'utf8' as const, rowCount: rows.length, content };
  }

  // ── Approve Revenue Adjustments ──
  private static readonly ADJ_TYPES = ['processor_correction', 'refund_correction', 'credit', 'billing_correction', 'reclassification', 'partner_share_correction', 'tenant_incentive_correction', 'rounding_correction', 'prior_period', 'write_off', 'other'];

  async createAdjustment(actor: { id?: string; role?: string }, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    const amount = Math.round(Number(input?.amountCents));
    if (!Number.isFinite(amount) || amount === 0) return { ok: false as const, error: 'amount_required', status: 400 };
    if (!String(input?.reason ?? '').trim()) return { ok: false as const, error: 'reason_required', status: 400 };
    if (!SuperAdminRevenueResidualsService.ADJ_TYPES.includes(String(input?.adjustmentType))) return { ok: false as const, error: 'invalid_adjustment_type', status: 400 };
    const res = await this.repo.createAdjustment(actor, {
      revenueRecordId: input.revenueRecordId ?? null, agreementId: input.agreementId ?? null, accountingPeriodId: input.accountingPeriodId ?? null,
      tenantId: input.tenantId ?? null, branchId: input.branchId ?? null, processor: input.processor ?? null,
      adjustmentType: String(input.adjustmentType), amountCents: amount, reason: String(input.reason).trim(), supportingEvidence: input.supportingEvidence ?? null,
    });
    if (!res.ok) return { ...res, status: res.error === 'period_locked' ? 409 : 400 };
    return res; // domain result carries status: 'pending_approval' + ref + requiresDualApproval (POST → 201)
  }

  async approveAdjustment(actor: { id?: string; role?: string }, id: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'adjustment_required', status: 400 };
    const res = await this.repo.approveAdjustment(actor, id);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : ['invalid_state', 'same_approver', 'period_locked'].includes(res.error) ? 409 : 400 };
    return res; // { ok, status: 'applied' | 'pending_second_approval', ... }
  }

  async rejectAdjustment(actor: { id?: string; role?: string }, id: string, reason?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'adjustment_required', status: 400 };
    const res = await this.repo.rejectAdjustment(actor, id, reason);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : res.error === 'invalid_state' ? 409 : 400 };
    return res;
  }

  async reverseAdjustment(actor: { id?: string; role?: string }, id: string, reason?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'adjustment_required', status: 400 };
    const res = await this.repo.reverseAdjustment(actor, id, reason);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : ['invalid_state', 'period_locked'].includes(res.error) ? 409 : 400 };
    return res; // { ok, status: 'reversed', reversalLedgerId }
  }

  async listAdjustments(opts: { revenueRecordId?: string; agreementId?: string; status?: string } = {}) {
    if (!this.repo) return { available: false, adjustments: [] as any[] };
    return { available: true, adjustments: await this.repo.listAdjustments(opts) };
  }

  // ── Lock Finalized Accounting Periods ──
  async listPeriods(opts: { status?: string } = {}) {
    if (!this.repo) return { available: false, periods: [] as any[] };
    return { available: true, periods: await this.repo.listPeriods(opts) };
  }

  async createPeriod(actor: { id?: string; role?: string }, input: any) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(input?.name ?? '').trim()) return { ok: false as const, error: 'name_required', status: 400 };
    if (!isDate(input?.startDate) || !isDate(input?.endDate)) return { ok: false as const, error: 'period_required', status: 400 };
    if (String(input.endDate) < String(input.startDate)) return { ok: false as const, error: 'period_end_before_start', status: 400 };
    const res = await this.repo.createPeriod(actor, { name: String(input.name).trim(), startDate: input.startDate, endDate: input.endDate, currency: input.currency });
    if (!res.ok) return { ...res, status: res.error === 'duplicate_name' ? 409 : 400 };
    return res; // domain result carries status: 'open' (POST → 201)
  }

  async lockPeriod(actor: { id?: string; role?: string }, id: string, reason?: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'period_id_required', status: 400 };
    const res = await this.repo.lockPeriod(actor, id, reason);
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : ['already_locked', 'pending_adjustments'].includes(res.error) ? 409 : 400 };
    return res; // { ok, status: 'locked', readiness }
  }

  async reopenPeriod(actor: { id?: string; role?: string }, id: string, reason: string) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    if (!String(id ?? '').trim()) return { ok: false as const, error: 'period_id_required', status: 400 };
    if (!String(reason ?? '').trim()) return { ok: false as const, error: 'reason_required', status: 400 };
    const res = await this.repo.reopenPeriod(actor, id, String(reason).trim());
    if (!res.ok) return { ...res, status: res.error === 'not_found' ? 404 : res.error === 'not_locked' ? 409 : 400 };
    return res; // { ok, status: 'reopened' }
  }

  // ── Track Unpaid Residuals ──
  async unpaidResiduals(opts: { processor?: string; tenantId?: string } = {}) {
    if (!this.repo) return { available: false, rows: [] as any[], totals: { outstandingCents: 0, currentCents: 0, b31_60Cents: 0, b61_90Cents: 0, b90PlusCents: 0 } };
    const aging = await this.repo.unpaidResidualsAging(opts);
    return { available: true, ...aging };
  }

  // ── Revenue Forecast ──
  async forecast(opts: { horizonMonths?: number } = {}): Promise<ResidualRevenueForecast> {
    if (!this.repo) return { available: false, reason: 'unavailable' };
    return this.repo.revenueForecast(opts);
  }

  // ── Background export jobs (for very large exports) ──
  async enqueueExportJob(actor: { id?: string; role?: string }, opts: { dataset?: string; format?: string } & RevenueListOpts) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503 };
    const job = await this.repo.createExportJob(actor, { dataset: String(opts.dataset ?? 'records'), format: String(opts.format ?? 'csv'), filters: opts });
    if (!job.ok) return { ...job, status: 400 };
    // process off the request path; the in-process worker reuses the synchronous export builder
    void this.processExportJob(actor, job.jobId, opts);
    return { ok: true as const, status: 202, jobId: job.jobId, jobStatus: 'queued' };
  }

  async processExportJob(actor: { id?: string; role?: string }, jobId: string, opts: any): Promise<void> {
    if (!this.repo) return;
    await this.repo.markExportJobRunning(jobId);
    try {
      const res: any = await this.exportPayoutReports(actor, { ...opts, page: 1, pageSize: 5000 });
      if (res.ok) await this.repo.completeExportJob(jobId, { filename: res.filename, mime: res.mime, encoding: res.encoding, content: res.content, rowCount: res.rowCount });
      else await this.repo.failExportJob(jobId, res.error ?? 'export_failed');
    } catch (e: any) { await this.repo.failExportJob(jobId, String(e?.message ?? 'error')); }
  }

  async getExportJob(id: string) {
    if (!this.repo) return { available: false, job: null };
    const job = await this.repo.getExportJob(id);
    return { available: true, job };
  }

  async listExportJobs() {
    if (!this.repo) return { available: false, jobs: [] as any[] };
    return { available: true, jobs: await this.repo.listExportJobs() };
  }
}
