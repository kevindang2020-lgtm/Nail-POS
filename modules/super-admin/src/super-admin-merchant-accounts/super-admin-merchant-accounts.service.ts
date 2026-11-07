// super-admin-merchant-accounts.service.ts — assembles the Merchant Accounts Overview + directory from REAL data
// (tenant_payment_config + tenants + terminals), applying honest rendering for fields not yet modelled
// (pricing plan, structured rates, risk review, funding/bank verification → "—" / available:false), masking, and
// tenant-scoped audit. Read-only; no secrets. Processors surfaced are Fiserv/CardPointe/Clover only.
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { parseScope, type OverviewScope } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { ProviderSecrets } from '@aipowersalon/security';
import { last4 } from './funding-display';
import { merchantAccountsExportCsv, merchantAccountsExportFilename } from './merchant-accounts-export-core';
import { SuperAdminMerchantAccountsRepository, type MerchantFilter, type MerchantRow } from './super-admin-merchant-accounts.kysely.repository';
import {
  MERCHANT_PROCESSORS, PROCESSOR_LABEL, processorBucket, processingStatus, underwritingStatus, applicationStatus,
  distribution, formatRate, riskStatus, bankVerification, fundingSchedule, FUNDING_ISSUE_LABELS, alertSeverity, maskBankAccount, pct, type Semantic,
} from './merchant-accounts-core';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const num = (v: string | null | undefined) => Number(v ?? 0) || 0;

function shapeRow(r: MerchantRow) {
  const proc = processorBucket(r.processor);
  const ps = processingStatus(r.status);
  const uw = underwritingStatus(r.onboarding_status);
  const app = applicationStatus(r.onboarding_status);
  const rate = r.active_rate; // real, decimal-safe active schedule (basis points + minor units) or null
  const hasRate = !!rate && rate.bps != null;
  const rk = riskStatus(r.risk_level); // current risk from latest review, or unknown/— when no review exists
  const bv = bankVerification(r.funding?.verification); // current bank-verification status (or not_started)
  const fs = fundingSchedule(r.funding?.schedule); // current funding schedule (or not_configured)
  return {
    tenantId: r.tenant_id,
    merchantId: r.merchant_id || '—',
    processor: proc, processorLabel: PROCESSOR_LABEL[proc],
    tenant: r.tenant_name || '—',
    branch: r.branch_name || (r.branch_count > 1 ? 'All Branches' : '—'),
    legalBusinessName: r.legal_name || r.tenant_name || '—',
    processingStatus: ps.key, processingStatusLabel: ps.label, processingSemantic: ps.semantic,
    underwritingStatus: uw.key, underwritingStatusLabel: uw.label, underwritingSemantic: uw.semantic,
    bankVerification: bv.key, bankVerificationLabel: bv.label, bankVerificationSemantic: bv.semantic, bankVerificationAvailable: r.funding?.verification != null,
    pricingPlan: (hasRate && rate!.plan) || '—', pricingPlanAvailable: !!(hasRate && rate!.plan),
    processingRates: hasRate ? formatRate(rate!.bps, rate!.fee) : '—', processingRatesAvailable: hasRate,
    terminalAssignments: r.terminal_count,
    applicationStatus: app.key, applicationStatusLabel: app.label,
    riskStatus: rk.key, riskStatusLabel: rk.label, riskStatusAvailable: r.risk_level != null,
    fundingSchedule: fs.key, fundingScheduleLabel: fs.label, fundingScheduleAvailable: fs.available,
    environment: r.environment || '—',
  };
}

export class SuperAdminMerchantAccountsService {
  constructor(private readonly repo: SuperAdminMerchantAccountsRepository, private readonly sealer?: ProviderSecrets) {}
  private seal(plain: string): string { if (!this.sealer) throw new Error('funding sealing is not wired (SECRET_SEALERS)'); return this.sealer.encrypt(plain); }

  private parseFilters(q: any): MerchantFilter {
    const s = (k: string) => (typeof q?.[k] === 'string' && q[k] && q[k] !== 'all' ? q[k] : null);
    return {
      search: typeof q?.search === 'string' ? q.search.trim().slice(0, 80) || null : null,
      processor: s('processor'), underwritingStatus: s('underwritingStatus'), processingStatus: s('processingStatus'),
      riskStatus: s('riskStatus'), fundingSchedule: s('fundingSchedule'),
    };
  }

  async getList(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const filters = this.parseFilters(q);
    const page = Math.max(1, Math.min(1000, Math.round(Number(q?.page)) || 1));
    const pageSize = Math.max(1, Math.min(100, Math.round(Number(q?.pageSize)) || 10));
    const { rows, total } = await this.repo.merchantsPage(scope, filters, page, pageSize);
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'directory_viewed', scope, 'Viewed Merchant Accounts directory', { page, pageSize, filters });
    return { ok: true, scope: this.scopeOut(scope), page, pageSize, total, rows: rows.map(shapeRow) };
  }

  async getOverview(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const filters = this.parseFilters(q);
    const selectedTenantId = typeof q?.selected === 'string' && q.selected ? q.selected : null;

    const [kpiRaw, dir, proc, statusC, uw, term, activity, highRiskCount, highRisk, bankPending, fundingIssues, topFunding, alertCount, openAlerts, selected] = await Promise.all([
      this.repo.kpiCounts(scope),
      this.repo.merchantsPage(scope, filters, 1, 10),
      this.repo.processorCounts(scope),
      this.repo.statusCounts(scope),
      this.repo.underwritingCounts(scope),
      this.repo.terminalCounts(scope),
      this.repo.recentActivity(scope),
      this.repo.highRiskCount(scope),
      this.repo.highRiskAccounts(scope),
      this.repo.bankVerificationPendingCount(scope),
      this.repo.fundingIssuesCount(scope),
      this.repo.topFundingIssues(scope),
      this.repo.alertCount(scope),
      this.repo.openAlerts(scope),
      selectedTenantId ? this.repo.merchantByTenant(scope, selectedTenantId) : Promise.resolve(null),
    ]);

    const total = num(kpiRaw.total);
    const kpi = (key: string, label: string, value: number, opts: { available?: boolean; href?: string; semantic?: Semantic } = {}) => ({
      key, label, value, display: opts.available === false ? '—' : value.toLocaleString(),
      available: opts.available !== false, href: opts.href ?? null, semantic: opts.semantic ?? 'neutral',
    });

    const kpis = [
      kpi('total', 'Total Merchant Accounts', total, { href: '/merchant-accounts', semantic: 'neutral' }),
      kpi('active', 'Active Processing Accounts', num(kpiRaw.active), { href: '/merchant-accounts?processingStatus=active', semantic: 'good' }),
      kpi('pending_underwriting', 'Pending Underwriting', num(kpiRaw.pending_underwriting), { href: '/merchant-accounts?underwritingStatus=under_review', semantic: 'warn' }),
      // Not modelled yet → surfaced honestly as unavailable rather than a fabricated number.
      kpi('bank_verification_pending', 'Bank Verification Pending', num(bankPending.c), { href: '/merchant-accounts', semantic: 'warn' }),
      kpi('high_risk', 'High Risk Accounts', num(highRiskCount.c), { href: '/merchant-accounts?riskStatus=high', semantic: 'bad' }),
      kpi('assigned_terminals', 'Assigned Terminals', num(kpiRaw.terminals), { semantic: 'neutral' }),
      kpi('funding_issues', 'Funding Issues', num(fundingIssues.c), { semantic: 'bad' }),
      kpi('inactive', 'Inactive Accounts', num(kpiRaw.inactive), { href: '/merchant-accounts?processingStatus=disabled', semantic: 'neutral' }),
    ];

    // Processor distribution — Fiserv/CardPointe/Clover + Other, reconciling to the merchant population.
    const procAgg: Record<string, number> = { fiserv: 0, cardpointe: 0, clover: 0, other: 0 };
    for (const p of proc) procAgg[processorBucket(p.processor)] += num(p.c);
    const processorDistribution = { total, segments: distribution([...MERCHANT_PROCESSORS, 'other'].map((k) => ({ key: k, label: PROCESSOR_LABEL[k], count: procAgg[k] })).filter((r) => r.count > 0), total) };

    // Merchant status breakdown → Active / Pending / Suspended / Inactive.
    const statusAgg: Record<string, number> = { active: 0, pending: 0, suspended: 0, inactive: 0 };
    for (const s of statusC) { const b = processingStatus(s.status).key; statusAgg[b] = (statusAgg[b] || 0) + num(s.c); }
    const merchantStatusBreakdown = { total, segments: distribution([
      { key: 'active', label: 'Active', count: statusAgg.active }, { key: 'pending', label: 'Pending', count: statusAgg.pending },
      { key: 'suspended', label: 'Suspended', count: statusAgg.suspended }, { key: 'inactive', label: 'Inactive', count: statusAgg.inactive },
    ], total) };

    // Underwriting pipeline (cohort = all configured merchant accounts, grouped by onboarding_status).
    const uwAgg: Record<string, number> = {};
    for (const u of uw) uwAgg[(u.onboarding_status || 'not_started')] = num(u.c);
    const underwritingPipeline = { stages: [
      { key: 'submitted', label: 'Applications Submitted', count: (uwAgg.submitted || 0) + (uwAgg.under_review || 0) + (uwAgg.approved || 0) + (uwAgg.declined || 0) },
      { key: 'under_review', label: 'In Review', count: uwAgg.under_review || 0 },
      { key: 'approved', label: 'Approved', count: uwAgg.approved || 0 },
      { key: 'declined', label: 'Declined', count: uwAgg.declined || 0 },
    ] };

    const termTotal = num(term.total);
    const terminalAssignmentOverview = { total: termTotal, segments: distribution([
      { key: 'assigned', label: 'Assigned', count: num(term.assigned) },
      { key: 'unassigned', label: 'Unassigned', count: num(term.unassigned) },
      { key: 'inactive', label: 'Inactive', count: num(term.inactive) },
    ], termTotal) };

    if (scope.tenantId) await this.repo.writeAudit(ctx, 'overview_viewed', scope, 'Viewed Merchant Accounts overview', { filters });
    return {
      ok: true,
      metadata: { generatedAt: new Date().toISOString() },
      scope: this.scopeOut(scope),
      kpis,
      merchants: dir.rows.map(shapeRow),
      merchantsTotal: dir.total,
      selectedMerchant: selected ? { ...shapeRow(selected), funding: this.fundingPanel(selected) } : null,
      processorDistribution,
      underwritingPipeline,
      merchantStatusBreakdown,
      terminalAssignmentOverview,
      recentActivity: activity.map((a) => ({ time: a.occurred_at, merchantId: '—', activity: a.summary || a.action || '—', user: a.actor_name || 'super_admin' })),
      // Not modelled yet → honest empty with availability flags (later units add these stores).
      alerts: { available: true, total: num(alertCount.c), items: openAlerts.map((a) => ({ id: a.id, merchantId: a.merchant_id || '—', tenant: a.tenant_name || '—', alertType: a.alert_type, severity: alertSeverity(a.severity).key, severityLabel: alertSeverity(a.severity).label, severitySemantic: alertSeverity(a.severity).semantic, summary: a.summary, status: a.status, reviewer: a.assigned_reviewer_name || null, createdAt: a.created_at })) },
      topFundingIssues: (() => {
        const totalIssues = num(fundingIssues.c);
        return { available: true, total: totalIssues, items: topFunding.map((f) => ({ key: f.funding_issue_type || 'other', label: FUNDING_ISSUE_LABELS[f.funding_issue_type || 'other'] || 'Other', count: num(f.c), pct: pct(num(f.c), totalIssues) })) };
      })(),
      highRiskAccounts: { available: true, total: num(highRiskCount.c), items: highRisk.map((h) => ({ merchantId: h.merchant_id || '—', tenant: h.tenant_name || '—', riskStatus: riskStatus(h.risk_level).key, riskLabel: riskStatus(h.risk_level).label, reviewedAt: h.reviewed_at })) },
    };
  }

  /** Controlled high-risk write (§28): secure funding update. Requires a step-up confirmation gate; validates inputs;
   *  stores full account/routing ONLY in the AES-256-GCM vault columns (never returned/logged); keeps masked last4 for
   *  display; supersedes the prior profile (history preserved) and appends a new current one with verification reset to
   *  pending (a new bank account must be re-verified). The audit + response contain MASKED values only. */
  async updateFunding(ctx: AdminCtx, tenantId: string, body: any) {
    const unscoped: OverviewScope = parseScope(undefined);
    const merchant = await this.repo.merchantByTenant(unscoped, tenantId);
    if (!merchant) throw new NotFoundException('Merchant account not found');

    // Step-up gate: the client must have completed a step-up challenge before this sensitive change is accepted.
    if (body?.stepUpConfirmed !== true) {
      await this.repo.writeAudit(ctx, 'funding_update_step_up_required', parseScope(tenantId), 'Funding update requires step-up authentication', {});
      throw new ForbiddenException('step_up_required');
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('reason is required');

    const acctDigits = String(body?.accountNumber ?? '').replace(/\D/g, '');
    const routingDigits = String(body?.routingNumber ?? '').replace(/\D/g, '');
    if (acctDigits.length < 4 || acctDigits.length > 17) throw new BadRequestException('accountNumber is invalid');
    if (routingDigits.length !== 9) throw new BadRequestException('routingNumber must be 9 digits');
    const bankName = typeof body?.bankName === 'string' && body.bankName.trim() ? body.bankName.trim().slice(0, 120) : null;
    const accountType = body?.accountType === 'checking' || body?.accountType === 'savings' ? body.accountType : null;
    const fundingScheduleKey = typeof body?.fundingSchedule === 'string' ? body.fundingSchedule : (merchant.funding?.schedule || 'not_configured');

    // Masked before/after — full numbers never appear here or in the audit.
    const before = merchant.funding?.account_last4 || merchant.funding?.bank_name
      ? { bankAccount: maskBankAccount(merchant.funding?.account_last4), bankName: merchant.funding?.bank_name || '—', bankVerification: bankVerification(merchant.funding?.verification).label }
      : null;
    const newLast4 = last4(acctDigits);
    const after = { bankAccount: maskBankAccount(newLast4), bankName: bankName || '—', accountType: accountType ? accountType[0].toUpperCase() + accountType.slice(1) : '—', bankVerification: 'Pending' };

    await this.repo.supersedeCurrentFunding(tenantId);
    const created = await this.repo.insertFundingProfile(tenantId, {
      fundingSchedule: fundingScheduleKey,
      bankVerificationStatus: 'pending', // a new bank account must be re-verified
      bankName, accountType, accountLast4: newLast4, routingLast4: last4(routingDigits),
      bankAccountEnc: this.seal(acctDigits), routingEnc: this.seal(routingDigits),
      createdBy: this.validUuid(ctx.userId),
    });
    await this.repo.writeAudit(ctx, 'funding_updated', parseScope(tenantId), 'Funding information updated (masked)', { profileId: created.id, before, after, reason });
    return { ok: true, profileId: created.id, before, after, verificationStatus: 'pending', note: 'Bank details are encrypted and stored securely. Re-verification is required.' };
  }

  private scopeOut(scope: OverviewScope) {
    return { tenantId: scope.tenantId ?? null, label: scope.tenantId ? 'Tenant-scoped' : 'All tenants' };
  }

  /** Server-side audited export (§48): builds an injection-guarded CSV of the FILTERED merchant directory. Respects the
   *  same filters + tenant scope as the list; exports SAFE display fields only (never bank/routing numbers, secrets, or
   *  credentials); records an audit event. XLSX/PDF are honestly reported as unavailable (no generator library). */
  async exportReport(ctx: AdminCtx, q: any) {
    const scope: OverviewScope = parseScope(q?.tenantId);
    const filters = this.parseFilters(q);
    const { rows } = await this.repo.merchantsPage(scope, filters, 1, 5000); // cap; larger sets would move to a background job
    const shaped = rows.map(shapeRow);
    const csv = merchantAccountsExportCsv(shaped);
    const filename = merchantAccountsExportFilename();
    if (scope.tenantId) await this.repo.writeAudit(ctx, 'export_generated', scope, `Exported ${shaped.length} merchant accounts (CSV)`, { rowCount: shaped.length, filters });
    return { ok: true, filename, mimeType: 'text/csv', rowCount: shaped.length, csv, formats: { csv: true, xlsx: false, pdf: false } };
  }

  /** Controlled write (§29): assign a terminal to a branch. Validates terminal ownership (no cross-tenant assignment),
   *  branch ownership, requires a reason, preserves the prior branch in the audit (history), and is idempotent when the
   *  terminal is already on the target branch. */
  async assignTerminal(ctx: AdminCtx, tenantId: string, body: any) {
    const unscoped: OverviewScope = parseScope(undefined);
    const merchant = await this.repo.merchantByTenant(unscoped, tenantId);
    if (!merchant) throw new NotFoundException('Merchant account not found');

    const terminalId = typeof body?.terminalId === 'string' ? body.terminalId.trim() : '';
    const branchId = typeof body?.branchId === 'string' ? body.branchId.trim() : '';
    if (!terminalId || !branchId) throw new BadRequestException('terminalId and branchId are required');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('reason is required');

    const terminal = await this.repo.terminalById(terminalId);
    if (!terminal) throw new NotFoundException('Terminal not found');
    if (terminal.tenant_id !== tenantId) throw new BadRequestException('terminal does not belong to this merchant account'); // cross-account guard (§29)
    if (!(await this.repo.branchBelongsToTenant(branchId, tenantId))) throw new BadRequestException('branch does not belong to this tenant');

    const previousBranchId = terminal.branch_id || null;
    if (previousBranchId === branchId && terminal.status === 'active') return { ok: true, idempotent: true, terminalId, previousBranchId, branchId, label: terminal.label || null };

    await this.repo.assignTerminal(terminalId, branchId, 'active');
    await this.repo.writeAudit(ctx, 'terminal_assigned', parseScope(tenantId), `Terminal assigned → branch`, { terminalId, previousBranchId, newBranchId: branchId, reason });
    return { ok: true, idempotent: false, terminalId, previousBranchId, branchId, label: terminal.label || null };
  }

  /** Controlled write (§23): assign/reassign a MID to a merchant account (optionally validated against a branch).
   *  Prevents cross-account MID conflicts, validates branch ownership (no cross-tenant assignment), requires a reason,
   *  preserves the prior MID in the audit (history), and is idempotent when the MID is unchanged. */
  async assignMid(ctx: AdminCtx, tenantId: string, body: any) {
    const unscoped: OverviewScope = parseScope(undefined);
    const merchant = await this.repo.merchantByTenant(unscoped, tenantId);
    if (!merchant) throw new NotFoundException('Merchant account not found');

    const merchantId = typeof body?.merchantId === 'string' ? body.merchantId.trim() : '';
    if (!/^[A-Za-z0-9-]{3,40}$/.test(merchantId)) throw new BadRequestException('merchantId must be 3–40 chars (letters, digits, hyphens)');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('reason is required');

    const branchId = typeof body?.branchId === 'string' && body.branchId ? body.branchId : null;
    if (branchId && !(await this.repo.branchBelongsToTenant(branchId, tenantId))) {
      throw new BadRequestException('branch does not belong to this tenant'); // cross-tenant prevention (§45)
    }

    // Conflict: the MID must not already belong to a different merchant account (§30 MID assignment conflict).
    const owner = await this.repo.midOwner(merchantId);
    if (owner && owner.tenant_id !== tenantId) throw new ConflictException('MID is already assigned to another merchant account');

    const previousMid = merchant.merchant_id || null;
    if (previousMid === merchantId) return { ok: true, idempotent: true, merchantId, previousMid, branchId };

    await this.repo.assignMid(tenantId, merchantId, this.validUuid(ctx.userId));
    await this.repo.writeAudit(ctx, 'mid_assigned', parseScope(tenantId), `MID assigned → ${merchantId}`, { previousMid, newMid: merchantId, branchId, reason });
    return { ok: true, idempotent: false, merchantId, previousMid, branchId };
  }

  /** Fiserv master build §9.2 — record a merchant's Fiserv Merchant Surcharge Program enrollment. AI PowerSalon cannot turn
   *  surcharging on for a salon by itself: this records what FISERV enrolled (rate fixed per MID, 1.00%–3.00%) with
   *  Fiserv's written reference. Checkout then surcharges only when the salon's own switch is on AND this is recorded;
   *  the fee itself is still assessed by the provider on each authorization (never added locally). Audited. */
  async setSurchargeEnrollment(ctx: AdminCtx, tenantId: string, body: any) {
    const unscoped: OverviewScope = parseScope(undefined);
    const merchant = await this.repo.merchantByTenant(unscoped, tenantId);
    if (!merchant) throw withCode(new NotFoundException('Merchant account not found'), 'RESOURCE_NOT_FOUND');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw withCode(new BadRequestException('reason is required'), 'VALIDATION_FAILED', { field: 'reason' });
    const enrolled = body?.enrolled === true;
    const reference = typeof body?.reference === 'string' && body.reference.trim() ? body.reference.trim().slice(0, 200) : null;
    let rateBps: number | null = null;
    if (enrolled) {
      rateBps = Number(body?.rateBps);
      if (!Number.isInteger(rateBps) || rateBps < 100 || rateBps > 300) throw withCode(new BadRequestException('rateBps must be Fiserv\'s enrolled rate in basis points, 100–300 (1.00%–3.00%)'), 'VALIDATION_FAILED', { field: 'rateBps' });
      if (!reference) throw withCode(new BadRequestException('reference (Fiserv\'s written enrollment confirmation) is required to enroll'), 'VALIDATION_FAILED', { field: 'reference' });
    }
    const branchId = typeof body?.branchId === 'string' && body.branchId ? body.branchId : null;
    if (branchId && !(await this.repo.branchBelongsToTenant(branchId, tenantId))) throw withCode(new BadRequestException('branch does not belong to this tenant'), 'BRANCH_ACCESS_DENIED');
    const r = await this.repo.setSurchargeEnrollment(tenantId, branchId, { enrolled, rateBps, reference: enrolled ? reference : null }, this.validUuid(ctx.userId));
    if (!r) throw new NotFoundException(branchId ? 'This branch has no merchant account of its own' : 'Merchant account not found');
    await this.repo.writeAudit(ctx, enrolled ? 'surcharge_enrollment_recorded' : 'surcharge_enrollment_withdrawn', parseScope(tenantId),
      enrolled ? `Surcharge enrollment recorded at ${(rateBps! / 100).toFixed(2)}%` : 'Surcharge enrollment withdrawn',
      { previous: r.previous, enrolled, rateBps, reference: enrolled ? reference : null, branchId, reason });
    return { ok: true as const, enrolled, rateBps, branchId: branchId as string | null };
  }

  private validUuid(id?: string | null): string | null {
    return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  }

  /** Controlled write (§27): activate / deactivate / suspend processing. Activation enforces real blocking checks against
   *  live data (underwriting approved, MID assigned, bank verified, rates configured, no critical risk); if any are unmet
   *  the status is NOT changed and the unmet requirements are returned. Deactivation/suspension require a reason and
   *  surface an impact summary. Every transition is audited (previous → new). The merchant account is never deleted. */
  async setProcessingStatus(ctx: AdminCtx, tenantId: string, action: 'activate' | 'deactivate' | 'suspend', body: any) {
    const unscoped: OverviewScope = parseScope(undefined);
    const merchant = await this.repo.merchantByTenant(unscoped, tenantId);
    if (!merchant) throw new NotFoundException('Merchant account not found');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) throw new BadRequestException('reason is required');
    const prev = processingStatus(merchant.status);

    if (action === 'activate') {
      const requirements = [
        { key: 'underwriting_approved', label: 'Underwriting approved', met: (merchant.onboarding_status || '') === 'approved' },
        { key: 'mid_assigned', label: 'MID assigned', met: !!merchant.merchant_id },
        { key: 'bank_verified', label: 'Bank account verified', met: (merchant.funding?.verification || '') === 'verified' },
        { key: 'pricing_configured', label: 'Processing rates configured', met: !!merchant.active_rate },
        { key: 'risk_cleared', label: 'No critical risk block', met: (merchant.risk_level || '') !== 'critical' },
      ];
      const blockers = requirements.filter((r) => !r.met);
      if (blockers.length) {
        await this.repo.writeAudit(ctx, 'processing_activation_blocked', parseScope(tenantId), `Activation blocked (${blockers.length} unmet)`, { requirements, reason });
        return { ok: false, blocked: true, action, requirements, blockers, status: prev.key };
      }
      await this.repo.updateProcessingStatus(tenantId, 'active', this.validUuid(ctx.userId));
      await this.repo.writeAudit(ctx, 'processing_activated', parseScope(tenantId), 'Processing activated', { previous: prev.key, next: 'active', reason, requirements });
      return { ok: true, blocked: false, action, status: 'active', requirements };
    }

    const nextStatus = action === 'suspend' ? 'paused' : 'disabled';
    const impact = { currentStatus: prev.key, assignedTerminals: merchant.terminal_count };
    await this.repo.updateProcessingStatus(tenantId, nextStatus, this.validUuid(ctx.userId));
    await this.repo.writeAudit(ctx, action === 'suspend' ? 'processing_suspended' : 'processing_deactivated', parseScope(tenantId), `Processing ${action}d`, { previous: prev.key, next: processingStatus(nextStatus).key, reason, impact });
    return { ok: true, blocked: false, action, status: processingStatus(nextStatus).key, impact };
  }

  /** Controlled write (§24, §40): configure processing rates. Permissioned via SuperAdminGuard; validates the merchant
   *  and decimal-safe inputs; APPENDS a new effective-dated schedule (history preserved, prior rows never mutated);
   *  idempotent on identical (tenant, effective instant, bps, fee); records a before/after audit event. Rates are
   *  authoritative as integers (basis points + minor units) — never a float, never a mutable string. */
  async configureRates(ctx: AdminCtx, tenantId: string, body: any) {
    const unscoped: OverviewScope = parseScope(undefined); // authorized cross-tenant Super Admin action, targeted by tenantId
    const merchant = await this.repo.merchantByTenant(unscoped, tenantId);
    if (!merchant) throw new NotFoundException('Merchant account not found');

    const intOf = (v: unknown, name: string, min: number, max: number): number => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${name} must be an integer between ${min} and ${max}`);
      return n;
    };
    const bps = intOf(body?.percentageBasisPoints, 'percentageBasisPoints', 0, 100000);
    const fee = intOf(body?.perTxnFeeMinor ?? 0, 'perTxnFeeMinor', 0, 100000000);
    const monthly = intOf(body?.monthlyFeeMinor ?? 0, 'monthlyFeeMinor', 0, 100000000);
    const refund = intOf(body?.refundFeeMinor ?? 0, 'refundFeeMinor', 0, 100000000);
    const chargeback = intOf(body?.chargebackFeeMinor ?? 0, 'chargebackFeeMinor', 0, 100000000);
    const changeReason = typeof body?.changeReason === 'string' ? body.changeReason.trim() : '';
    if (!changeReason) throw new BadRequestException('changeReason is required');

    let effectiveAt = new Date();
    if (body?.effectiveAt) { const d = new Date(body.effectiveAt); if (isNaN(d.getTime())) throw new BadRequestException('effectiveAt is not a valid date'); effectiveAt = d; }
    const effectiveAtIso = effectiveAt.toISOString();

    let planId: string | null = null;
    if (body?.pricingPlanId) { const p = await this.repo.pricingPlanName(String(body.pricingPlanId)); if (!p) throw new BadRequestException('Unknown pricingPlanId'); planId = String(body.pricingPlanId); }

    const before = merchant.active_rate ? { bps: merchant.active_rate.bps, fee: merchant.active_rate.fee, plan: merchant.active_rate.plan, display: formatRate(merchant.active_rate.bps, merchant.active_rate.fee) } : null;
    const afterDisplay = formatRate(bps, fee);

    // Idempotency: an identical schedule at the same effective instant is a duplicate submission → no-op.
    const dupe = await this.repo.findIdenticalRate(tenantId, effectiveAtIso, bps, fee);
    if (dupe) return { ok: true, idempotent: true, scheduleId: dupe.id, before, after: { bps, fee, display: afterDisplay }, effectiveAt: effectiveAtIso };

    const createdBy = ctx.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.userId) ? ctx.userId : null;
    const created = await this.repo.insertRateSchedule(tenantId, { bps, fee, monthly, refund, chargeback, planId, effectiveAtIso, changeReason, createdBy, status: 'approved' });
    await this.repo.writeAudit(ctx, 'rates_configured', parseScope(tenantId), `Configured processing rates → ${afterDisplay}`, { scheduleId: created.id, before, after: { bps, fee, display: afterDisplay }, effectiveAt: effectiveAtIso, reason: changeReason });
    return { ok: true, idempotent: false, scheduleId: created.id, before, after: { bps, fee, display: afterDisplay }, effectiveAt: effectiveAtIso };
  }

  /** Secure Funding Information — masking is enforced HERE (backend), never in the UI. Only display-safe fields leave
   *  the service: a masked account (•••• 1234), bank name, and account type. Full bank/routing numbers and the *_enc
   *  vault columns are never selected or returned. */
  private fundingPanel(r: MerchantRow) {
    const f = r.funding;
    const configured = !!f && (f.account_last4 != null || f.bank_name != null || (f.verification != null && f.verification !== 'not_started'));
    if (!configured) return { available: false, note: 'Bank details are encrypted and stored securely.' };
    return {
      available: true,
      bankAccount: maskBankAccount(f!.account_last4),
      bankName: f!.bank_name || '—',
      accountType: f!.account_type ? (f!.account_type.charAt(0).toUpperCase() + f!.account_type.slice(1)) : '—',
      bankVerificationLabel: bankVerification(f!.verification).label,
      note: 'Bank details are encrypted and stored securely.',
    };
  }
}
