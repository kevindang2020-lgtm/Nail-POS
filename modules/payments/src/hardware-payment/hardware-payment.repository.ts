// hardware-payment.repository.ts — data port + a seedable in-memory implementation (used for tests + as the dev default).
import { randomUUID } from 'crypto';
import type { HardwarePaymentPlan, HardwareInvoice, LedgerRow, PaymentMethod, AutopayConsent, PaymentTxn, SplitSettingsRow } from './hardware-payment.dto';
import type { RevenueSplitSettings, LedgerLine } from './hardware-payment-core';
import { DEFAULT_SPLIT_SETTINGS } from './hardware-payment-core';

export interface HardwarePaymentDataPort {
  // settings
  getGlobalDefaultSettings(): Promise<SplitSettingsRow>;
  getTenantSettings(tenantId: string): Promise<SplitSettingsRow | null>;
  upsertGlobalDefaultSettings(s: RevenueSplitSettings, userId?: string): Promise<SplitSettingsRow>;
  upsertTenantSettings(tenantId: string, s: RevenueSplitSettings, userId?: string): Promise<SplitSettingsRow>;
  // plans
  createPlan(p: Omit<HardwarePaymentPlan, 'id'>): Promise<HardwarePaymentPlan>;
  getPlan(tenantId: string, planId: string): Promise<HardwarePaymentPlan | null>;
  getActivePlan(tenantId: string): Promise<HardwarePaymentPlan | null>;
  updatePlan(tenantId: string, planId: string, patch: Partial<HardwarePaymentPlan>): Promise<HardwarePaymentPlan | null>;
  // payment method + consent
  getActivePaymentMethod(tenantId: string): Promise<PaymentMethod | null>;
  addPaymentMethod(m: Omit<PaymentMethod, 'id'>): Promise<PaymentMethod>;
  getActiveConsent(tenantId: string, planId: string): Promise<AutopayConsent | null>;
  addConsent(c: Omit<AutopayConsent, 'id'>): Promise<AutopayConsent>;
  // invoices + ledger + txns
  findInvoice(planId: string, billingMonth: string): Promise<HardwareInvoice | null>;
  upsertInvoice(inv: Omit<HardwareInvoice, 'id'> & { id?: string }): Promise<HardwareInvoice>;
  addLedger(lines: Array<Omit<LedgerRow, 'id' | 'createdAt'>>): Promise<void>;
  listInvoices(tenantId: string): Promise<HardwareInvoice[]>;
  listLedger(tenantId: string, invoiceId?: string): Promise<LedgerRow[]>;
  deleteLedgerBySource(tenantId: string, invoiceId: string, source: string): Promise<void>;
  addTransaction(t: Omit<PaymentTxn, 'id'>): Promise<PaymentTxn>;
  // monthly job + residual import
  listActivePlans(): Promise<HardwarePaymentPlan[]>;
  getCardVolume(tenantId: string, billingMonth: string): Promise<number | null>;
  upsertCardVolume(tenantId: string, billingMonth: string, cents: number, source: string): Promise<void>;
  addReconciliationRun(run: ReconciliationRunInput): Promise<ReconciliationRun>;
  reportMonthlyTotals(): Promise<MonthlyReportRow[]>;
}

export interface MonthlyReportRow { billingMonth: string; invoiceCount: number; cardVolumeCents: number; hardwareCreditCents: number; dueCents: number; shortfallCents: number; chargedCents: number; paidCount: number; failedCount: number; }

export interface ReconciliationRunInput { tenantId: string | null; billingMonth: string; status: 'running' | 'completed' | 'failed' | 'partial'; plansProcessed: number; invoicesCreated: number; shortfallsChargedCents: number; failures: number; notes?: string | null; }
export interface ReconciliationRun extends ReconciliationRunInput { id: string; createdAt: string; }

export class InMemoryHardwarePaymentRepository implements HardwarePaymentDataPort {
  private global: SplitSettingsRow = { id: 'global', tenantId: null, isDefault: true, ...DEFAULT_SPLIT_SETTINGS };
  private tenantSettings = new Map<string, SplitSettingsRow>();
  plans: HardwarePaymentPlan[] = [];
  methods: PaymentMethod[] = [];
  consents: AutopayConsent[] = [];
  invoices: HardwareInvoice[] = [];
  ledger: LedgerRow[] = [];
  txns: PaymentTxn[] = [];

  async getGlobalDefaultSettings() { return { ...this.global }; }
  async getTenantSettings(t: string) { const s = this.tenantSettings.get(t); return s ? { ...s } : null; }
  async upsertGlobalDefaultSettings(s: RevenueSplitSettings) { this.global = { ...this.global, ...s }; return { ...this.global }; }
  async upsertTenantSettings(t: string, s: RevenueSplitSettings) { const row: SplitSettingsRow = { id: 'tenant_' + t, tenantId: t, isDefault: false, ...s }; this.tenantSettings.set(t, row); return { ...row }; }

  async createPlan(p: Omit<HardwarePaymentPlan, 'id'>) { const row = { id: randomUUID(), ...p }; this.plans.push(row); return { ...row }; }
  async getPlan(t: string, id: string) { const p = this.plans.find((x) => x.tenantId === t && x.id === id); return p ? { ...p } : null; }
  async getActivePlan(t: string) { const p = this.plans.find((x) => x.tenantId === t && x.status === 'active'); return p ? { ...p } : null; }
  async updatePlan(t: string, id: string, patch: Partial<HardwarePaymentPlan>) { const p = this.plans.find((x) => x.tenantId === t && x.id === id); if (!p) return null; Object.assign(p, patch); return { ...p }; }

  async getActivePaymentMethod(t: string) { const m = this.methods.find((x) => x.tenantId === t && x.status === 'active'); return m ? { ...m } : null; }
  async addPaymentMethod(m: Omit<PaymentMethod, 'id'>) { const row = { id: randomUUID(), ...m }; this.methods.push(row); return { ...row }; }
  async getActiveConsent(t: string, planId: string) { const c = this.consents.find((x) => x.tenantId === t && (x.planId === planId || x.planId == null) && !x.revokedAt); return c ? { ...c } : null; }
  async addConsent(c: Omit<AutopayConsent, 'id'>) { const row = { id: randomUUID(), ...c }; this.consents.push(row); return { ...row }; }

  async findInvoice(planId: string, m: string) { const i = this.invoices.find((x) => x.planId === planId && x.billingMonth === m); return i ? { ...i } : null; }
  async upsertInvoice(inv: Omit<HardwareInvoice, 'id'> & { id?: string }) {
    const existing = this.invoices.find((x) => x.planId === inv.planId && x.billingMonth === inv.billingMonth);
    if (existing) { Object.assign(existing, inv); return { ...existing }; }
    const row = { id: inv.id ?? randomUUID(), ...inv } as HardwareInvoice; this.invoices.push(row); return { ...row };
  }
  async addLedger(lines: Array<Omit<LedgerRow, 'id' | 'createdAt'>>) { for (const l of lines) this.ledger.push({ id: randomUUID(), createdAt: new Date().toISOString(), ...l }); }
  async listInvoices(t: string) { return this.invoices.filter((x) => x.tenantId === t).map((x) => ({ ...x })); }
  async listLedger(t: string, invoiceId?: string) { return this.ledger.filter((x) => x.tenantId === t && (!invoiceId || x.invoiceId === invoiceId)).map((x) => ({ ...x })); }
  async deleteLedgerBySource(t: string, invoiceId: string, source: string) { this.ledger = this.ledger.filter((x) => !(x.tenantId === t && x.invoiceId === invoiceId && x.source === source)); }
  async addTransaction(tx: Omit<PaymentTxn, 'id'>) { const row = { id: randomUUID(), ...tx }; this.txns.push(row); return { ...row }; }
  volumes = new Map<string, number>();
  runs: ReconciliationRun[] = [];
  async listActivePlans() { return this.plans.filter((p) => p.status === 'active').map((p) => ({ ...p })); }
  async getCardVolume(t: string, m: string) { const v = this.volumes.get(t + '|' + m); return v == null ? null : v; }
  async upsertCardVolume(t: string, m: string, cents: number, _source: string) { this.volumes.set(t + '|' + m, Math.max(0, Math.trunc(cents))); }
  async addReconciliationRun(run: ReconciliationRunInput) { const row = { id: randomUUID(), createdAt: new Date().toISOString(), ...run }; this.runs.push(row); return { ...row }; }
  async reportMonthlyTotals(): Promise<MonthlyReportRow[]> {
    const m = new Map<string, MonthlyReportRow>();
    for (const i of this.invoices as any[]) {
      const r = m.get(i.billingMonth) || { billingMonth: i.billingMonth, invoiceCount: 0, cardVolumeCents: 0, hardwareCreditCents: 0, dueCents: 0, shortfallCents: 0, chargedCents: 0, paidCount: 0, failedCount: 0 };
      r.invoiceCount++; r.cardVolumeCents += i.cardVolumeCents || 0; r.hardwareCreditCents += i.salonHardwareCreditCents || 0; r.dueCents += i.hardwareMonthlyDueCents || 0; r.shortfallCents += i.shortfallCents || 0; r.chargedCents += i.autoChargeAmountCents || 0;
      if (i.status === 'paid') r.paidCount++; if (i.status === 'payment_failed') r.failedCount++;
      m.set(i.billingMonth, r);
    }
    return [...m.values()].sort((a, b) => b.billingMonth.localeCompare(a.billingMonth));
  }
}
