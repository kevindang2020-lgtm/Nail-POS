// hardware-payment.service.ts — Hardware Payment Recovery orchestration (build doc §5–§18).
// Backend-authoritative: all money via the pure core; tenant-scoped; tokenized charges only; audit + alerts on every
// material action. The HTTP controllers are thin wrappers over this.
import { looksLikeRawPan, tokenizerForGatewayBase } from '../payments/card-data';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  RevenueSplitSettings, reconcileMonth, decideAutoCharge, validateSplitSettings, DEFAULT_SPLIT_SETTINGS,
} from './hardware-payment-core';
import {
  HardwarePaymentError, HardwarePaymentPlan, AUTOPAY_CONSENT_VERSION,
  type HardwareChargePort, type AlertSink, type AuditSink, type PaymentMethod, type PaymentMethodView, toPaymentMethodView,
} from './hardware-payment.dto';
import { HardwarePaymentDataPort, InMemoryHardwarePaymentRepository } from './hardware-payment.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export const HW_REPO = Symbol('HW_REPO');
export const HW_CHARGE = Symbol('HW_CHARGE');
export const HW_ALERTS = Symbol('HW_ALERTS');
export const HW_AUDIT = Symbol('HW_AUDIT');

export interface ActorCtx { userId?: string | null; role?: string | null; ipAddress?: string | null; deviceInfo?: string | null; }

@Injectable()
export class HardwarePaymentService {
  constructor(
    @Optional() @Inject(HW_REPO) private readonly repo: HardwarePaymentDataPort = new InMemoryHardwarePaymentRepository(),
    @Optional() @Inject(HW_CHARGE) private readonly chargePort?: HardwareChargePort,
    @Optional() @Inject(HW_ALERTS) private readonly alerts?: AlertSink,
    @Optional() @Inject(HW_AUDIT) private readonly audit?: AuditSink,
  ) {}

  private async audited(a: { tenantId: string; action: string; ctx?: ActorCtx; oldValue?: unknown; newValue?: unknown }) {
    try { await this.audit?.log({ tenantId: a.tenantId, userId: a.ctx?.userId, role: a.ctx?.role, action: a.action, oldValue: a.oldValue, newValue: a.newValue, ipAddress: a.ctx?.ipAddress, deviceInfo: a.ctx?.deviceInfo }); } catch { /* audit never blocks */ }
  }
  private async alert(tenantId: string, severity: 'info' | 'warning' | 'critical', code: string, message: string, meta?: Record<string, unknown>) {
    try { await this.alerts?.raise({ tenantId, severity, code, message, meta }); } catch { /* alerts never block */ }
  }

  // ---- §3/§5 settings: per-tenant override resolves over the global default ----
  async getGlobalSettings(): Promise<RevenueSplitSettings> { return this.strip(await this.repo.getGlobalDefaultSettings()); }
  async getTenantSettings(tenantId: string): Promise<{ effective: RevenueSplitSettings; hasOverride: boolean }> {
    const t = await this.repo.getTenantSettings(tenantId);
    return { effective: t ? this.strip(t) : this.strip(await this.repo.getGlobalDefaultSettings()), hasOverride: !!t };
  }
  /** The figures any reconciliation must use for a tenant. */
  async effectiveSettings(tenantId: string): Promise<RevenueSplitSettings> {
    const t = await this.repo.getTenantSettings(tenantId);
    return t ? this.strip(t) : this.strip(await this.repo.getGlobalDefaultSettings());
  }
  async updateGlobalSettings(input: Partial<RevenueSplitSettings>, ctx?: ActorCtx): Promise<RevenueSplitSettings> {
    const merged = { ...this.strip(await this.repo.getGlobalDefaultSettings()), ...this.coerce(input) };
    this.validate(merged);
    const saved = await this.repo.upsertGlobalDefaultSettings(this.withNetMargin(merged));
    await this.audited({ tenantId: '*', action: 'hardware_revenue_split_settings_changed', ctx, newValue: merged });
    return this.strip(saved);
  }
  async updateTenantSettings(tenantId: string, input: Partial<RevenueSplitSettings>, ctx?: ActorCtx): Promise<RevenueSplitSettings> {
    const base = await this.effectiveSettings(tenantId);
    const merged = { ...base, ...this.coerce(input) };
    this.validate(merged);
    const saved = await this.repo.upsertTenantSettings(tenantId, this.withNetMargin(merged));
    await this.audited({ tenantId, action: 'hardware_revenue_split_settings_changed', ctx, oldValue: base, newValue: merged });
    return this.strip(saved);
  }

  // ---- §6 plans ----
  async createPlan(tenantId: string, input: Partial<HardwarePaymentPlan>, ctx?: ActorCtx): Promise<HardwarePaymentPlan> {
    const financed = Math.max(0, (input.totalHardwareCostCents ?? 0) - (input.downPaymentCents ?? 0));
    const plan = await this.repo.createPlan({
      tenantId, branchId: input.branchId ?? null, hardwarePackageId: input.hardwarePackageId ?? null,
      status: (input.status as HardwarePaymentPlan['status']) ?? 'draft',
      totalHardwareCostCents: input.totalHardwareCostCents ?? 0, downPaymentCents: input.downPaymentCents ?? 0,
      financedAmountCents: input.financedAmountCents ?? financed, monthlyPaymentCents: input.monthlyPaymentCents ?? 0,
      remainingBalanceCents: input.remainingBalanceCents ?? financed, startDate: input.startDate ?? null,
      endDate: input.endDate ?? null, dueDayOfMonth: input.dueDayOfMonth ?? 1,
      revenueSplitRecoveryEnabled: input.revenueSplitRecoveryEnabled ?? true,
      autoChargeShortfallEnabled: input.autoChargeShortfallEnabled ?? true,
      extraCreditHandling: input.extraCreditHandling ?? 'cap_at_monthly_due',
      carryForwardCreditCents: 0, savedPaymentMethodId: input.savedPaymentMethodId ?? null, createdByUserId: ctx?.userId ?? null,
    });
    await this.audited({ tenantId, action: 'hardware_payment_plan_created', ctx, newValue: plan });
    return plan;
  }
  async getPlan(tenantId: string, planId: string): Promise<HardwarePaymentPlan> { return this.mustPlan(tenantId, planId); }
  async updatePlan(tenantId: string, planId: string, patch: Partial<HardwarePaymentPlan>, ctx?: ActorCtx): Promise<HardwarePaymentPlan> {
    const before = await this.mustPlan(tenantId, planId);
    const updated = await this.repo.updatePlan(tenantId, planId, this.planPatch(patch));
    await this.audited({ tenantId, action: 'hardware_payment_plan_edited', ctx, oldValue: before, newValue: updated });
    return updated!;
  }
  async pausePlan(tenantId: string, planId: string, ctx?: ActorCtx) { await this.mustPlan(tenantId, planId); const p = await this.repo.updatePlan(tenantId, planId, { status: 'paused' }); await this.audited({ tenantId, action: 'hardware_payment_plan_paused', ctx, newValue: { planId } }); return p!; }
  async resumePlan(tenantId: string, planId: string, ctx?: ActorCtx) { await this.mustPlan(tenantId, planId); const p = await this.repo.updatePlan(tenantId, planId, { status: 'active' }); await this.audited({ tenantId, action: 'hardware_payment_plan_resumed', ctx, newValue: { planId } }); return p!; }

  // ---- §11 payment method (tokenized ONLY) + autopay consent ----
  /** The hardware plan is charged through the PLATFORM's own Fiserv merchant (processorFromEnv: CARDPOINTE_BASE_URL …), so
   *  the owner's card is tokenized on THAT gateway's CardSecure hosted iFrame — the card number never reaches our apps. */
  hardwareTokenizer(env: NodeJS.ProcessEnv = process.env): { available: boolean; url?: string; origin?: string; reason?: string } {
    const base = env.CARDPOINTE_BASE_URL || (env.CARDPOINTE_SITE ? `https://${env.CARDPOINTE_SITE}.cardconnect.com` : '');
    return tokenizerForGatewayBase(base);
  }

  async addPaymentMethod(tenantId: string, m: Partial<PaymentMethod> & { token?: string }, ctx?: ActorCtx): Promise<PaymentMethodView> {
    const token = m.gatewayPaymentMethodToken ?? m.token;
    if (!token) throw new HardwarePaymentError('no_token', 'A tokenized payment method is required (raw card data is never accepted).');
    // hard guard: refuse anything that looks like a raw PAN/CVV
    const raw = String(token);
    // (was /^\d{13,19}$/ — which also refused every CardSecure token, the only thing that should be accepted)
    if (looksLikeRawPan(raw) || (m as any).cvv || (m as any).pan || (m as any).cardNumber) {
      throw withCode(new HardwarePaymentError('raw_card_rejected', 'Refusing raw card data — provide a gateway token only.'), 'CARD_NUMBER_NOT_ACCEPTED');
    }
    const saved = await this.repo.addPaymentMethod({ tenantId, gatewayCustomerId: m.gatewayCustomerId ?? null, gatewayPaymentMethodToken: raw, brand: m.brand ?? null, last4: m.last4 ?? null, expMonth: m.expMonth ?? null, expYear: m.expYear ?? null, status: 'active' });
    await this.audited({ tenantId, action: 'hardware_payment_method_added', ctx, newValue: { id: saved.id, brand: saved.brand, last4: saved.last4 } });
    return toPaymentMethodView(saved);   // Phase 12 #19: the token stays server-side (it was echoed back to the owner's browser)
  }
  async recordAutopayConsent(tenantId: string, planId: string, ctx?: ActorCtx) {
    await this.mustPlan(tenantId, planId);
    const c = await this.repo.addConsent({ tenantId, planId, authorizedByUserId: ctx?.userId ?? 'unknown', authorizedAt: new Date().toISOString(), ipAddress: ctx?.ipAddress ?? null, deviceInfo: ctx?.deviceInfo ?? null, consentTextVersion: AUTOPAY_CONSENT_VERSION });
    await this.audited({ tenantId, action: 'hardware_autopay_consent_added', ctx, newValue: { planId, version: AUTOPAY_CONSENT_VERSION } });
    return c;
  }

  // ---- §8/§9/§10 monthly reconciliation (the heart) ----
  async reconcile(tenantId: string, planId: string, billingMonth: string, cardVolumeCents: number, ctx?: ActorCtx) {
    let plan = await this.mustPlan(tenantId, planId);
    const settings = await this.effectiveSettings(tenantId);
    const prior = await this.repo.findInvoice(planId, billingMonth);

    // Idempotency: a month already reconciled and successfully charged ('paid') must NOT be re-charged, re-ledgered, or
    // re-reduce loan principal on a re-run (scheduler retry / admin "recalculate month"). Return the settled invoice as-is.
    if (prior?.status === 'paid') {
      // Policy: a settled (paid) month is IMMUTABLE. A same-volume re-run (scheduler retry or an idempotent admin
      // "recalculate month") returns the settled invoice unchanged. A re-run with a DIFFERENT volume is REJECTED rather
      // than silently ignored: once the money is charged, quietly recomputing a corrected volume would diverge the
      // invoice/ledger from what was actually settled. A corrected volume after settlement must be handled as an explicit
      // adjustment, never a silent recompute. (prior.cardVolumeCents was stored already clamped, so this compares like-for-like.)
      const reqVolumeCents = Math.max(0, Math.trunc(cardVolumeCents));
      if (reqVolumeCents !== prior.cardVolumeCents) {
        await this.audited({ tenantId, action: 'hardware_recalc_rejected_month_settled', ctx, oldValue: { billingMonth, settledVolumeCents: prior.cardVolumeCents }, newValue: { requestedVolumeCents: reqVolumeCents } });
        throw withCode(new HardwarePaymentError('month_settled', `Billing month ${billingMonth} is already paid and settled (card volume $${(prior.cardVolumeCents / 100).toFixed(2)}). A corrected volume ($${(reqVolumeCents / 100).toFixed(2)}) can't silently recompute a settled month — record an adjustment instead.`, 409), 'HARDWARE_MONTH_SETTLED');
      }
      const rPaid = reconcileMonth({
        cardVolumeCents: Math.max(0, Math.trunc(cardVolumeCents)), hardwareMonthlyDueCents: plan.monthlyPaymentCents,
        settings, carryForwardCreditCents: plan.revenueSplitRecoveryEnabled ? plan.carryForwardCreditCents : 0,
        extraCreditHandling: plan.extraCreditHandling,
      });
      return { invoice: prior, decision: { charge: false, reason: 'no_shortfall', invoiceStatus: 'credit_applied' } as any, breakdown: rPaid.split, shortfallCents: rPaid.shortfallCents, extraCreditCents: rPaid.extraCreditCents, autoChargedCents: 0, carryForwardNextMonthCents: rPaid.carryForwardNextMonthCents };
    }

    // Idempotency for an UNPAID re-run (admin "recalculate month" after a corrected-volume import, or a scheduler retry):
    // reverse the prior reconciliation's effects on the plan before re-applying, so the ledger never accumulates duplicate
    // reconciliation rows and the loan principal is never reduced twice. The prior effect is recomputed deterministically
    // from the figures stored on the prior invoice (its card volume + the carry-forward credit it consumed).
    if (prior) {
      const priorR = reconcileMonth({
        cardVolumeCents: Math.max(0, Math.trunc(prior.cardVolumeCents)), hardwareMonthlyDueCents: plan.monthlyPaymentCents,
        settings, carryForwardCreditCents: plan.revenueSplitRecoveryEnabled ? prior.carryForwardCreditCents : 0,
        extraCreditHandling: plan.extraCreditHandling,
      });
      await this.repo.updatePlan(tenantId, planId, {
        remainingBalanceCents: plan.remainingBalanceCents + priorR.principalReductionCents, // restore principal reduced last run
        carryForwardCreditCents: prior.carryForwardCreditCents,                              // restore the carry-forward it consumed
      });
      if (prior.id) await this.repo.deleteLedgerBySource(tenantId, prior.id, 'reconciliation'); // drop the prior reconciliation rows
      await this.audited({ tenantId, action: 'hardware_recalc_month_reversed', ctx, oldValue: { billingMonth, priorVolumeCents: prior.cardVolumeCents, restoredPrincipalCents: priorR.principalReductionCents, restoredCarryForwardCents: prior.carryForwardCreditCents }, newValue: { newVolumeCents: Math.max(0, Math.trunc(cardVolumeCents)) } });
      plan = await this.mustPlan(tenantId, planId); // re-read the restored plan so the fresh computation below is correct
    }

    const r = reconcileMonth({
      cardVolumeCents: Math.max(0, Math.trunc(cardVolumeCents)), hardwareMonthlyDueCents: plan.monthlyPaymentCents,
      settings, carryForwardCreditCents: plan.revenueSplitRecoveryEnabled ? plan.carryForwardCreditCents : 0,
      extraCreditHandling: plan.extraCreditHandling,
    });

    // 1) invoice + ledger first (never charge before an invoice exists)
    let invoice = await this.repo.upsertInvoice({
      tenantId, planId, billingMonth, cardVolumeCents: r.split.cardVolumeCents, pricingRateBps: settings.pricingRateBps,
      expenseRateBps: settings.expenseRateBps, netMarginCents: r.split.netMarginCents, platformShareCents: r.split.platformShareCents,
      fiservShareCents: r.split.fiservShareCents, salonHardwareCreditCents: r.split.salonHardwareCreditCents,
      hardwareMonthlyDueCents: r.hardwareMonthlyDueCents, carryForwardCreditCents: r.carryForwardCreditCents,
      shortfallCents: r.shortfallCents, autoChargeAmountCents: 0, status: 'open', dueDate: null, paidAt: null,
    });
    await this.repo.addLedger(r.ledger.map((l) => ({ tenantId, planId, invoiceId: invoice.id, source: 'reconciliation', ...l })));

    // 2) extra-credit handling → carry-forward / principal
    const planPatch: Partial<HardwarePaymentPlan> = { carryForwardCreditCents: r.carryForwardNextMonthCents };
    if (r.principalReductionCents > 0) planPatch.remainingBalanceCents = Math.max(0, plan.remainingBalanceCents - r.principalReductionCents);
    await this.repo.updatePlan(tenantId, planId, planPatch);

    // 3) auto-charge decision (pure) then act
    const method = await this.repo.getActivePaymentMethod(tenantId);
    const consent = await this.repo.getActiveConsent(tenantId, planId);
    const decision = decideAutoCharge({
      shortfallCents: r.shortfallCents, autoChargeEnabled: plan.autoChargeShortfallEnabled && plan.revenueSplitRecoveryEnabled,
      hasAutopayConsent: !!consent, hasSavedPaymentMethod: !!method, planActive: plan.status === 'active',
    });

    let charged = 0;
    if (decision.charge) {
      invoice = await this.repo.upsertInvoice({ ...invoice, status: 'auto_charge_processing', autoChargeAmountCents: decision.amountCents });
      const res = this.chargePort
        ? await this.chargePort.charge({ tenantId, token: method!.gatewayPaymentMethodToken, amountCents: decision.amountCents, invoiceId: invoice.id })
        : { ok: false, respstat: 'C', respText: 'No charge processor configured' };
      if (res.ok) {
        await this.repo.addTransaction({ tenantId, planId, invoiceId: invoice.id, amountCents: decision.amountCents, status: 'succeeded', gatewayRetref: res.retref ?? null, gatewayRespStatus: res.respstat, gatewayRespText: res.respText, attempt: 1 });
        await this.repo.addLedger([{ tenantId, planId, invoiceId: invoice.id, entryType: 'shortfall_charge', amountCents: decision.amountCents, description: 'Shortfall auto-charged to saved card', source: 'auto_charge' }]);
        invoice = await this.repo.upsertInvoice({ ...invoice, status: 'paid', paidAt: new Date().toISOString() });
        charged = decision.amountCents;
        await this.audited({ tenantId, action: 'hardware_shortfall_charged', ctx, newValue: { invoiceId: invoice.id, amountCents: decision.amountCents } });
      } else {
        await this.repo.addTransaction({ tenantId, planId, invoiceId: invoice.id, amountCents: decision.amountCents, status: 'failed', gatewayRespStatus: res.respstat, gatewayRespText: res.respText, attempt: 1 });
        await this.repo.addLedger([{ tenantId, planId, invoiceId: invoice.id, entryType: 'payment_failed', amountCents: decision.amountCents, description: 'Shortfall auto-charge failed', source: 'auto_charge' }]);
        invoice = await this.repo.upsertInvoice({ ...invoice, status: 'payment_failed' });
        await this.alert(tenantId, 'critical', 'hardware_shortfall_charge_failed', `Hardware shortfall charge failed for tenant ${tenantId}`, { invoiceId: invoice.id, amountCents: decision.amountCents });
        await this.audited({ tenantId, action: 'hardware_payment_failed', ctx, newValue: { invoiceId: invoice.id, amountCents: decision.amountCents } });
      }
    } else {
      invoice = await this.repo.upsertInvoice({ ...invoice, status: decision.invoiceStatus });
      if (decision.invoiceStatus === 'payment_method_required') {
        await this.alert(tenantId, 'warning', 'hardware_payment_method_required', `Hardware shortfall pending but no consent/payment method for tenant ${tenantId}`, { invoiceId: invoice.id, reason: decision.reason });
      }
      if (decision.invoiceStatus === 'credit_applied') {
        await this.repo.addLedger([{ tenantId, planId, invoiceId: invoice.id, entryType: 'salon_hardware_credit', amountCents: Math.min(r.hardwareMonthlyDueCents, r.split.salonHardwareCreditCents + r.carryForwardCreditCents), description: 'Credit covered the monthly due in full', source: 'reconciliation' }]);
      }
    }

    return {
      invoice, decision, breakdown: r.split, shortfallCents: r.shortfallCents, extraCreditCents: r.extraCreditCents,
      autoChargedCents: charged, carryForwardNextMonthCents: r.carryForwardNextMonthCents,
    };
  }

  /** §12/§14 "Charge Shortfall Now" — retry a pending/failed shortfall on an existing invoice. */
  async chargeShortfallNow(tenantId: string, planId: string, billingMonth: string, ctx?: ActorCtx) {
    const inv = await this.repo.findInvoice(planId, billingMonth);
    if (!inv) throw withCode(new HardwarePaymentError('no_invoice', 'No invoice for that month.', 404), 'INVOICE_NOT_FOUND');
    if (inv.shortfallCents <= 0) throw withCode(new HardwarePaymentError('no_shortfall', 'Nothing to charge — no shortfall on this invoice.'), 'NOTHING_TO_CHARGE');
    if (inv.status === 'paid') throw withCode(new HardwarePaymentError('already_paid', 'This month is already paid — nothing more to charge.'), 'NOTHING_TO_CHARGE');
    // re-run the same gated path by reconciling the same volume is unnecessary; act on the recorded shortfall directly
    const plan = await this.mustPlan(tenantId, planId);
    const method = await this.repo.getActivePaymentMethod(tenantId);
    const consent = await this.repo.getActiveConsent(tenantId, planId);
    const decision = decideAutoCharge({ shortfallCents: inv.shortfallCents, autoChargeEnabled: true, hasAutopayConsent: !!consent, hasSavedPaymentMethod: !!method, planActive: plan.status === 'active' });
    if (!decision.charge) { await this.repo.upsertInvoice({ ...inv, status: decision.invoiceStatus }); throw withCode(new HardwarePaymentError(decision.reason, `Cannot charge: ${decision.reason}`), 'HARDWARE_CHARGE_REFUSED'); }
    const res = this.chargePort ? await this.chargePort.charge({ tenantId, token: method!.gatewayPaymentMethodToken, amountCents: decision.amountCents, invoiceId: inv.id }) : { ok: false, respstat: 'C', respText: 'No charge processor configured' };
    const attempt = 2;
    if (res.ok) {
      await this.repo.addTransaction({ tenantId, planId, invoiceId: inv.id, amountCents: decision.amountCents, status: 'succeeded', gatewayRetref: res.retref ?? null, gatewayRespStatus: res.respstat, gatewayRespText: res.respText, attempt });
      const paid = await this.repo.upsertInvoice({ ...inv, status: 'paid', autoChargeAmountCents: decision.amountCents, paidAt: new Date().toISOString() });
      await this.audited({ tenantId, action: 'hardware_shortfall_charged', ctx, newValue: { invoiceId: inv.id, amountCents: decision.amountCents, manual: true } });
      return { ok: true as const, invoice: paid };
    }
    await this.repo.addTransaction({ tenantId, planId, invoiceId: inv.id, amountCents: decision.amountCents, status: 'failed', gatewayRespStatus: res.respstat, gatewayRespText: res.respText, attempt });
    const failed = await this.repo.upsertInvoice({ ...inv, status: 'payment_failed' });
    await this.alert(tenantId, 'critical', 'hardware_shortfall_charge_failed', `Manual hardware shortfall charge failed for tenant ${tenantId}`, { invoiceId: inv.id });
    return { ok: false as const, invoice: failed };
  }

  // ---- §15 owner views ----
  async ownerPlan(tenantId: string) {
    const plan = await this.repo.getActivePlan(tenantId) ?? this.firstPlan(tenantId, await this.repo.listInvoices(tenantId));
    const method = await this.repo.getActivePaymentMethod(tenantId);
    return { plan, savedPaymentMethod: method ? { brand: method.brand, last4: method.last4, status: method.status } : null };
  }
  async ownerInvoices(tenantId: string) {
    // owner view hides Fiserv-internal figures (§15)
    return (await this.repo.listInvoices(tenantId)).map((i) => ({ billingMonth: i.billingMonth, hardwareMonthlyDueCents: i.hardwareMonthlyDueCents, salonHardwareCreditCents: i.salonHardwareCreditCents, shortfallCents: i.shortfallCents, autoChargeAmountCents: i.autoChargeAmountCents, status: i.status }));
  }
  async ownerLedger(tenantId: string) { return this.repo.listLedger(tenantId); }
  async adminInvoices(tenantId: string) { return this.repo.listInvoices(tenantId); }
  async reportMonthlyTotals() {
    const rows = await this.repo.reportMonthlyTotals();
    return rows.map((r) => ({ ...r, collectedCents: r.chargedCents, outstandingCents: Math.max(0, r.shortfallCents - r.chargedCents), collectionRatePct: r.shortfallCents > 0 ? Math.round((r.chargedCents / r.shortfallCents) * 100) : 100 }));
  }

  async adminLedger(tenantId: string, invoiceId?: string) { return this.repo.listLedger(tenantId, invoiceId); }

  // ---- helpers ----
  private firstPlan(_t: string, _i: unknown) { return (this.repo as any).plans?.find?.((p: HardwarePaymentPlan) => p.tenantId === _t) ?? null; }
  private async mustPlan(tenantId: string, planId: string): Promise<HardwarePaymentPlan> {
    const p = await this.repo.getPlan(tenantId, planId);
    if (!p) throw withCode(new HardwarePaymentError('plan_not_found', 'Hardware payment plan not found.', 404), 'HARDWARE_PLAN_NOT_FOUND');
    return p;
  }
  private coerce(input: Partial<RevenueSplitSettings>): Partial<RevenueSplitSettings> {
    const out: Partial<RevenueSplitSettings> = {};
    for (const k of ['pricingRateBps', 'expenseRateBps', 'platformSharePercent', 'fiservSharePercent', 'salonHardwareCreditPercentOfPlatformShare'] as const) {
      if (input[k] != null) out[k] = Math.trunc(Number(input[k]));
    }
    return out;
  }
  private validate(s: RevenueSplitSettings) { const issues = validateSplitSettings(s); if (issues.length) throw new HardwarePaymentError('invalid_settings', issues.map((i) => `${i.field}: ${i.message}`).join('; ')); }
  private withNetMargin(s: RevenueSplitSettings) { return { ...s, netMarginBps: s.pricingRateBps - s.expenseRateBps } as RevenueSplitSettings; }
  private strip(s: RevenueSplitSettings): RevenueSplitSettings {
    return { pricingRateBps: s.pricingRateBps, expenseRateBps: s.expenseRateBps, platformSharePercent: s.platformSharePercent, fiservSharePercent: s.fiservSharePercent, salonHardwareCreditPercentOfPlatformShare: s.salonHardwareCreditPercentOfPlatformShare };
  }
  private planPatch(patch: Partial<HardwarePaymentPlan>): Partial<HardwarePaymentPlan> {
    const allow: (keyof HardwarePaymentPlan)[] = ['status', 'monthlyPaymentCents', 'remainingBalanceCents', 'dueDayOfMonth', 'revenueSplitRecoveryEnabled', 'autoChargeShortfallEnabled', 'extraCreditHandling', 'savedPaymentMethodId', 'endDate', 'totalHardwareCostCents', 'downPaymentCents', 'financedAmountCents'];
    const out: Partial<HardwarePaymentPlan> = {};
    for (const k of allow) if (patch[k] !== undefined) (out as any)[k] = patch[k];
    return out;
  }
}
