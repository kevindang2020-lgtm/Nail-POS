// hardware-payment.kysely.repository.ts — Postgres persistence for Hardware Payment Recovery (migration 078).
// Tenant-scoped; integer cents (bigint columns come back as strings from pg, so every money read goes through num()).
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { HardwarePaymentDataPort, ReconciliationRunInput, ReconciliationRun, MonthlyReportRow } from './hardware-payment.repository';
import type { HardwarePaymentPlan, HardwareInvoice, LedgerRow, PaymentMethod, AutopayConsent, PaymentTxn, SplitSettingsRow } from './hardware-payment.dto';
import type { RevenueSplitSettings, LedgerLine } from './hardware-payment-core';
import { DEFAULT_SPLIT_SETTINGS } from './hardware-payment-core';

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());
const dstr = (v: unknown): string | null => (v == null ? null : String(v).slice(0, 10));

export class KyselyHardwarePaymentRepository implements HardwarePaymentDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  // ---- settings ----
  async getGlobalDefaultSettings(): Promise<SplitSettingsRow> {
    const r = await this.db.selectFrom('hardware_revenue_split_settings').selectAll().where('tenant_id', 'is', null).where('is_default', '=', true).executeTakeFirst();
    return r ? this.toSettings(r) : { id: 'global', tenantId: null, isDefault: true, ...DEFAULT_SPLIT_SETTINGS };
  }
  async getTenantSettings(tenantId: string): Promise<SplitSettingsRow | null> {
    const r = await this.db.selectFrom('hardware_revenue_split_settings').selectAll().where('tenant_id', '=', tenantId).orderBy('updated_at', 'desc').executeTakeFirst();
    return r ? this.toSettings(r) : null;
  }
  async upsertGlobalDefaultSettings(s: RevenueSplitSettings): Promise<SplitSettingsRow> {
    const existing = await this.db.selectFrom('hardware_revenue_split_settings').select('id').where('tenant_id', 'is', null).where('is_default', '=', true).executeTakeFirst();
    const vals = this.fromSettings(s);
    if (existing) await this.db.updateTable('hardware_revenue_split_settings').set({ ...vals, updated_at: sql`now()` } as any).where('id', '=', existing.id).execute();
    else await this.db.insertInto('hardware_revenue_split_settings').values({ tenant_id: null, is_default: true, ...vals } as any).execute();
    return this.getGlobalDefaultSettings();
  }
  async upsertTenantSettings(tenantId: string, s: RevenueSplitSettings): Promise<SplitSettingsRow> {
    const existing = await this.db.selectFrom('hardware_revenue_split_settings').select('id').where('tenant_id', '=', tenantId).executeTakeFirst();
    const vals = this.fromSettings(s);
    if (existing) await this.db.updateTable('hardware_revenue_split_settings').set({ ...vals, updated_at: sql`now()` } as any).where('id', '=', existing.id).execute();
    else await this.db.insertInto('hardware_revenue_split_settings').values({ tenant_id: tenantId, is_default: false, ...vals } as any).execute();
    return (await this.getTenantSettings(tenantId))!;
  }

  // ---- plans ----
  async createPlan(p: Omit<HardwarePaymentPlan, 'id'>): Promise<HardwarePaymentPlan> {
    const r = await this.db.insertInto('hardware_payment_plans').values(this.fromPlan(p) as any).returningAll().executeTakeFirstOrThrow();
    return this.toPlan(r);
  }
  async getPlan(tenantId: string, planId: string): Promise<HardwarePaymentPlan | null> {
    const r = await this.db.selectFrom('hardware_payment_plans').selectAll().where('tenant_id', '=', tenantId).where('id', '=', planId).executeTakeFirst();
    return r ? this.toPlan(r) : null;
  }
  async getActivePlan(tenantId: string): Promise<HardwarePaymentPlan | null> {
    const r = await this.db.selectFrom('hardware_payment_plans').selectAll().where('tenant_id', '=', tenantId).where('status', '=', 'active').orderBy('created_at', 'desc').executeTakeFirst();
    return r ? this.toPlan(r) : null;
  }
  async updatePlan(tenantId: string, planId: string, patch: Partial<HardwarePaymentPlan>): Promise<HardwarePaymentPlan | null> {
    const set = this.fromPlanPatch(patch);
    if (Object.keys(set).length) await this.db.updateTable('hardware_payment_plans').set({ ...set, updated_at: sql`now()` } as any).where('tenant_id', '=', tenantId).where('id', '=', planId).execute();
    return this.getPlan(tenantId, planId);
  }

  // ---- payment method + consent ----
  async getActivePaymentMethod(tenantId: string): Promise<PaymentMethod | null> {
    const r = await this.db.selectFrom('hardware_payment_methods').selectAll().where('tenant_id', '=', tenantId).where('status', '=', 'active').orderBy('created_at', 'desc').executeTakeFirst();
    return r ? this.toMethod(r) : null;
  }
  async addPaymentMethod(m: Omit<PaymentMethod, 'id'>): Promise<PaymentMethod> {
    const r = await this.db.insertInto('hardware_payment_methods').values({ tenant_id: m.tenantId, gateway_customer_id: m.gatewayCustomerId ?? null, gateway_payment_method_token: m.gatewayPaymentMethodToken, brand: m.brand ?? null, last4: m.last4 ?? null, exp_month: m.expMonth ?? null, exp_year: m.expYear ?? null, status: m.status } as any).returningAll().executeTakeFirstOrThrow();
    return this.toMethod(r);
  }
  async getActiveConsent(tenantId: string, planId: string): Promise<AutopayConsent | null> {
    const r = await this.db.selectFrom('hardware_autopay_consents').selectAll().where('tenant_id', '=', tenantId)
      .where((eb) => eb.or([eb('hardware_payment_plan_id', '=', planId), eb('hardware_payment_plan_id', 'is', null)]))
      .where('revoked_at', 'is', null).orderBy('authorized_at', 'desc').executeTakeFirst();
    return r ? this.toConsent(r) : null;
  }
  async addConsent(c: Omit<AutopayConsent, 'id'>): Promise<AutopayConsent> {
    const r = await this.db.insertInto('hardware_autopay_consents').values({ tenant_id: c.tenantId, hardware_payment_plan_id: c.planId ?? null, authorized_by_user_id: c.authorizedByUserId, ip_address: c.ipAddress ?? null, device_info: c.deviceInfo ?? null, consent_text_version: c.consentTextVersion } as any).returningAll().executeTakeFirstOrThrow();
    return this.toConsent(r);
  }

  // ---- invoices / ledger / transactions ----
  async findInvoice(planId: string, billingMonth: string): Promise<HardwareInvoice | null> {
    const r = await this.db.selectFrom('hardware_payment_invoices').selectAll().where('hardware_payment_plan_id', '=', planId).where('billing_month', '=', billingMonth).executeTakeFirst();
    return r ? this.toInvoice(r) : null;
  }
  async upsertInvoice(inv: Omit<HardwareInvoice, 'id'> & { id?: string }): Promise<HardwareInvoice> {
    const existing = await this.db.selectFrom('hardware_payment_invoices').select('id').where('hardware_payment_plan_id', '=', inv.planId).where('billing_month', '=', inv.billingMonth).executeTakeFirst();
    const vals = this.fromInvoice(inv);
    const r = existing
      ? await this.db.updateTable('hardware_payment_invoices').set({ ...vals, updated_at: sql`now()` } as any).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow()
      : await this.db.insertInto('hardware_payment_invoices').values(vals as any).returningAll().executeTakeFirstOrThrow();
    return this.toInvoice(r);
  }
  async addLedger(lines: Array<Omit<LedgerRow, 'id' | 'createdAt'>>): Promise<void> {
    if (!lines.length) return;
    await this.db.insertInto('hardware_payment_ledger').values(lines.map((l) => ({ tenant_id: l.tenantId, hardware_payment_plan_id: l.planId, invoice_id: l.invoiceId ?? null, entry_type: l.entryType, amount_cents: l.amountCents, description: l.description, source: l.source })) as any).execute();
  }
  async listInvoices(tenantId: string): Promise<HardwareInvoice[]> {
    const rows = await this.db.selectFrom('hardware_payment_invoices').selectAll().where('tenant_id', '=', tenantId).orderBy('billing_month', 'desc').execute();
    return rows.map((r) => this.toInvoice(r));
  }
  async listLedger(tenantId: string, invoiceId?: string): Promise<LedgerRow[]> {
    let q = this.db.selectFrom('hardware_payment_ledger').selectAll().where('tenant_id', '=', tenantId);
    if (invoiceId) q = q.where('invoice_id', '=', invoiceId);
    const rows = await q.orderBy('created_at', 'asc').execute();
    return rows.map((r) => this.toLedger(r));
  }
  async deleteLedgerBySource(tenantId: string, invoiceId: string, source: string): Promise<void> {
    await this.db.deleteFrom('hardware_payment_ledger').where('tenant_id', '=', tenantId).where('invoice_id', '=', invoiceId).where('source', '=', source).execute();
  }
  async addTransaction(tx: Omit<PaymentTxn, 'id'>): Promise<PaymentTxn> {
    const r = await this.db.insertInto('hardware_payment_transactions').values({ tenant_id: tx.tenantId, hardware_payment_plan_id: tx.planId, invoice_id: tx.invoiceId ?? null, amount_cents: tx.amountCents, status: tx.status, gateway_retref: tx.gatewayRetref ?? null, gateway_resp_status: tx.gatewayRespStatus ?? null, gateway_resp_text: tx.gatewayRespText ?? null, attempt: tx.attempt } as any).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, tenantId: r.tenant_id, planId: r.hardware_payment_plan_id, invoiceId: r.invoice_id, amountCents: num(r.amount_cents), status: r.status as PaymentTxn['status'], gatewayRetref: r.gateway_retref, gatewayRespStatus: r.gateway_resp_status, gatewayRespText: r.gateway_resp_text, attempt: num(r.attempt) };
  }

  // ---- monthly job + residual import ----
  async listActivePlans(): Promise<HardwarePaymentPlan[]> {
    const rows = await this.db.selectFrom('hardware_payment_plans').selectAll().where('status', '=', 'active').orderBy('tenant_id').execute();
    return rows.map((r) => this.toPlan(r));
  }
  async getCardVolume(tenantId: string, billingMonth: string): Promise<number | null> {
    const r = await this.db.selectFrom('hardware_card_volume').select('card_volume_cents').where('tenant_id', '=', tenantId).where('billing_month', '=', billingMonth).executeTakeFirst();
    return r ? num(r.card_volume_cents) : null;
  }
  async upsertCardVolume(tenantId: string, billingMonth: string, cents: number, source: string): Promise<void> {
    const existing = await this.db.selectFrom('hardware_card_volume').select('id').where('tenant_id', '=', tenantId).where('billing_month', '=', billingMonth).executeTakeFirst();
    if (existing) await this.db.updateTable('hardware_card_volume').set({ card_volume_cents: Math.max(0, Math.trunc(cents)), source, imported_at: sql`now()` } as any).where('id', '=', existing.id).execute();
    else await this.db.insertInto('hardware_card_volume').values({ tenant_id: tenantId, billing_month: billingMonth, card_volume_cents: Math.max(0, Math.trunc(cents)), source } as any).execute();
  }
  async addReconciliationRun(run: ReconciliationRunInput): Promise<ReconciliationRun> {
    const r = await this.db.insertInto('hardware_reconciliation_runs').values({ tenant_id: run.tenantId, billing_month: run.billingMonth, status: run.status, plans_processed: run.plansProcessed, invoices_created: run.invoicesCreated, shortfalls_charged_cents: run.shortfallsChargedCents, failures: run.failures, notes: run.notes ?? null } as any).returningAll().executeTakeFirstOrThrow();
    return { id: r.id, tenantId: r.tenant_id, billingMonth: r.billing_month, status: r.status as ReconciliationRun['status'], plansProcessed: num(r.plans_processed), invoicesCreated: num(r.invoices_created), shortfallsChargedCents: num(r.shortfalls_charged_cents), failures: num(r.failures), notes: r.notes, createdAt: iso(r.created_at)! };
  }

  async reportMonthlyTotals(): Promise<MonthlyReportRow[]> {
    const res: any = await sql`
      SELECT billing_month,
        count(*)::int AS invoice_count,
        coalesce(sum(card_volume_cents),0) AS volume,
        coalesce(sum(salon_hardware_credit_cents),0) AS credit,
        coalesce(sum(hardware_monthly_due_cents),0) AS due,
        coalesce(sum(shortfall_cents),0) AS shortfall,
        coalesce(sum(auto_charge_amount_cents),0) AS charged,
        count(*) FILTER (WHERE status='paid')::int AS paid_count,
        count(*) FILTER (WHERE status='payment_failed')::int AS failed_count
      FROM hardware_payment_invoices
      GROUP BY billing_month ORDER BY billing_month DESC
    `.execute(this.db);
    return (res.rows as any[]).map((r) => ({ billingMonth: r.billing_month, invoiceCount: num(r.invoice_count), cardVolumeCents: num(r.volume), hardwareCreditCents: num(r.credit), dueCents: num(r.due), shortfallCents: num(r.shortfall), chargedCents: num(r.charged), paidCount: num(r.paid_count), failedCount: num(r.failed_count) }));
  }

  // ---- mappers ----
  private toSettings(r: any): SplitSettingsRow {
    return { id: r.id, tenantId: r.tenant_id, isDefault: !!r.is_default, pricingRateBps: num(r.pricing_rate_bps), expenseRateBps: num(r.expense_rate_bps), platformSharePercent: num(r.platform_share_percent), fiservSharePercent: num(r.fiserv_share_percent), salonHardwareCreditPercentOfPlatformShare: num(r.salon_hardware_credit_percent_of_platform_share) };
  }
  private fromSettings(s: RevenueSplitSettings) {
    return { pricing_rate_bps: s.pricingRateBps, expense_rate_bps: s.expenseRateBps, net_margin_bps: s.pricingRateBps - s.expenseRateBps, platform_share_percent: s.platformSharePercent, fiserv_share_percent: s.fiservSharePercent, salon_hardware_credit_percent_of_platform_share: s.salonHardwareCreditPercentOfPlatformShare };
  }
  private toPlan(r: any): HardwarePaymentPlan {
    return { id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, hardwarePackageId: r.hardware_package_id, status: r.status, totalHardwareCostCents: num(r.total_hardware_cost_cents), downPaymentCents: num(r.down_payment_cents), financedAmountCents: num(r.financed_amount_cents), monthlyPaymentCents: num(r.monthly_payment_cents), remainingBalanceCents: num(r.remaining_balance_cents), startDate: dstr(r.start_date), endDate: dstr(r.end_date), dueDayOfMonth: num(r.due_day_of_month), revenueSplitRecoveryEnabled: !!r.revenue_split_recovery_enabled, autoChargeShortfallEnabled: !!r.auto_charge_shortfall_enabled, extraCreditHandling: r.extra_credit_handling, carryForwardCreditCents: num(r.carry_forward_credit_cents), savedPaymentMethodId: r.saved_payment_method_id, createdByUserId: r.created_by_user_id };
  }
  private fromPlan(p: Omit<HardwarePaymentPlan, 'id'>) {
    return { tenant_id: p.tenantId, branch_id: p.branchId ?? null, hardware_package_id: p.hardwarePackageId ?? null, status: p.status, total_hardware_cost_cents: p.totalHardwareCostCents, down_payment_cents: p.downPaymentCents, financed_amount_cents: p.financedAmountCents, monthly_payment_cents: p.monthlyPaymentCents, remaining_balance_cents: p.remainingBalanceCents, start_date: p.startDate ?? null, end_date: p.endDate ?? null, due_day_of_month: p.dueDayOfMonth, revenue_split_recovery_enabled: p.revenueSplitRecoveryEnabled, auto_charge_shortfall_enabled: p.autoChargeShortfallEnabled, extra_credit_handling: p.extraCreditHandling, carry_forward_credit_cents: p.carryForwardCreditCents, saved_payment_method_id: p.savedPaymentMethodId ?? null, created_by_user_id: p.createdByUserId ?? null };
  }
  private fromPlanPatch(patch: Partial<HardwarePaymentPlan>) {
    const m: Record<string, unknown> = {};
    const map: Record<string, string> = { status: 'status', monthlyPaymentCents: 'monthly_payment_cents', remainingBalanceCents: 'remaining_balance_cents', dueDayOfMonth: 'due_day_of_month', revenueSplitRecoveryEnabled: 'revenue_split_recovery_enabled', autoChargeShortfallEnabled: 'auto_charge_shortfall_enabled', extraCreditHandling: 'extra_credit_handling', carryForwardCreditCents: 'carry_forward_credit_cents', savedPaymentMethodId: 'saved_payment_method_id', endDate: 'end_date', totalHardwareCostCents: 'total_hardware_cost_cents', downPaymentCents: 'down_payment_cents', financedAmountCents: 'financed_amount_cents' };
    for (const [k, col] of Object.entries(map)) if ((patch as any)[k] !== undefined) m[col] = (patch as any)[k];
    return m;
  }
  private toInvoice(r: any): HardwareInvoice {
    return { id: r.id, tenantId: r.tenant_id, planId: r.hardware_payment_plan_id, billingMonth: r.billing_month, cardVolumeCents: num(r.card_volume_cents), pricingRateBps: num(r.pricing_rate_bps), expenseRateBps: num(r.expense_rate_bps), netMarginCents: num(r.net_margin_cents), platformShareCents: num(r.platform_share_cents), fiservShareCents: num(r.fiserv_share_cents), salonHardwareCreditCents: num(r.salon_hardware_credit_cents), hardwareMonthlyDueCents: num(r.hardware_monthly_due_cents), carryForwardCreditCents: num(r.carry_forward_credit_cents), shortfallCents: num(r.shortfall_cents), autoChargeAmountCents: num(r.auto_charge_amount_cents), status: r.status, dueDate: dstr(r.due_date), paidAt: iso(r.paid_at) };
  }
  private fromInvoice(inv: Omit<HardwareInvoice, 'id'> & { id?: string }) {
    return { tenant_id: inv.tenantId, hardware_payment_plan_id: inv.planId, billing_month: inv.billingMonth, card_volume_cents: inv.cardVolumeCents, pricing_rate_bps: inv.pricingRateBps, expense_rate_bps: inv.expenseRateBps, net_margin_cents: inv.netMarginCents, platform_share_cents: inv.platformShareCents, fiserv_share_cents: inv.fiservShareCents, salon_hardware_credit_cents: inv.salonHardwareCreditCents, hardware_monthly_due_cents: inv.hardwareMonthlyDueCents, carry_forward_credit_cents: inv.carryForwardCreditCents, shortfall_cents: inv.shortfallCents, auto_charge_amount_cents: inv.autoChargeAmountCents, status: inv.status, due_date: inv.dueDate ?? null, paid_at: inv.paidAt ?? null };
  }
  private toLedger(r: any): LedgerRow {
    return { id: r.id, tenantId: r.tenant_id, planId: r.hardware_payment_plan_id, invoiceId: r.invoice_id, entryType: r.entry_type, amountCents: num(r.amount_cents), description: r.description, source: r.source, createdAt: iso(r.created_at)! };
  }
  private toMethod(r: any): PaymentMethod {
    return { id: r.id, tenantId: r.tenant_id, gatewayCustomerId: r.gateway_customer_id, gatewayPaymentMethodToken: r.gateway_payment_method_token, brand: r.brand, last4: r.last4, expMonth: r.exp_month, expYear: r.exp_year, status: r.status };
  }
  private toConsent(r: any): AutopayConsent {
    return { id: r.id, tenantId: r.tenant_id, planId: r.hardware_payment_plan_id, authorizedByUserId: r.authorized_by_user_id, authorizedAt: iso(r.authorized_at)!, ipAddress: r.ip_address, deviceInfo: r.device_info, consentTextVersion: r.consent_text_version, revokedAt: iso(r.revoked_at) };
  }
}
