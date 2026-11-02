import { stashExportBytes, loadExportBytes, type ExportArtifactStore } from '../export-artifact-store';
import { systemContext } from '@aipowersalon/tenant-context';
import { createHash } from 'node:crypto';
import { randomUUID } from 'crypto';
// billing.kysely.repository.ts — Postgres adapter. Facts come from `tenants` LEFT-joined to each tenant's latest
// `tenant_subscriptions` row, `tenant_payment_config`, and `tenant_hardware_payoff`. Plan prices come from env
// PLAN_PRICES_JSON (planTier→cents) — MRR is 0 until configured. The raw merchant_id is never returned (only last 4).
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { BillingFact, SubscriptionStatus, PaymentConfigStatus, HardwareStatus, SubscriptionUpdate } from './billing.dto';
import type { BillingDataPort, AuditActor, BillingSubscriptionsOverview, CreateInvoiceInput } from './billing.repository';
import { planPricesFromEnv } from './billing.repository';
import { computeInvoiceTotals, nextInvoiceNumber, invoiceSeq, validateNewInvoice, applyCreditToRemaining, BillingValidationError } from './billing-invoice-core';
import { computeProration, computeTrialExtension } from './billing-proration-core';
import { resolveCancellation, resolvePause, canResume } from './billing-lifecycle-core';
import { recoveredRate, trialConversionRate, weeklyFailedRecovered } from './billing-analytics-core';
import { toCsv, REPORTS as EXPORT_REPORTS, ExportColumnError } from './billing-export-core';
import { computeTrend, KPI_POLARITY } from './billing-trend-core';
import { canMoveToSql, assertTransition, InvalidStateTransitionError } from '@aipowersalon/database';
import { TENANT_SUBSCRIPTION, SUBSCRIPTION_CHANGE, TENANT_ADD_ON } from '@aipowersalon/platform';
import { BILLING_INVOICE, BILLING_CREDIT, BILLING_EXPORT_JOB } from '../lifecycles';

const SUB = new Set(['active', 'trialing', 'past_due', 'expired', 'cancelled']);
const PAY = new Set(['pending', 'active', 'error', 'disabled']);
const HW = new Set(['active', 'paid_off', 'none']);

// Constitution 12 M7: the export download token is a bearer credential — only its SHA-256 is stored.
const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** audit_logs.user_id is a person's id — a system job ('system:<job>') keeps NULL there and is named in the metadata (B-14). */
const uuidOrNull = (v: string | null | undefined): string | null => (v && UUID_RE.test(v) ? v : null);
const systemActorOf = (v: string | null | undefined): { systemActor?: string } => (v && !UUID_RE.test(v) ? { systemActor: String(v).replace(/^system:/, '') } : {});

export class KyselyBillingRepository implements BillingDataPort {
  // B-18: export bytes go to the private store when one is bound (content_key); the legacy content_b64 column is still read
  constructor(private db: Kysely<DB>, private readonly store: ExportArtifactStore | null = null) {}

  private async writeBillingAudit(actor: AuditActor, tenantId: string | null, action: string, entityId: string | null, meta: unknown) {
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, ${action}, 'billing', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
  }

  // Create a DRAFT invoice with backend-computed totals and a unique invoice number. Lines are stored immutably; a
  // finalize step opens the invoice. The client never supplies a total.
  async createInvoice(actor: AuditActor, input: CreateInvoiceInput): Promise<{ invoiceNumber: string; totalCents: number; status: string }> {
    validateNewInvoice(input);
    const year = new Date().getFullYear();
    return await this.db.transaction().execute(async (trx) => {
      const maxRow: any = await sql`SELECT invoice_number FROM billing_invoices WHERE invoice_number LIKE ${'INV-' + year + '-%'} ORDER BY invoice_number DESC LIMIT 1`.execute(trx);
      const maxSeq = maxRow.rows[0] ? invoiceSeq(String(maxRow.rows[0].invoice_number), year) : 0;
      const invoiceNumber = nextInvoiceNumber(year, maxSeq);
      const lines = input.lines.map((l) => ({ ...l, quantity: Math.round(l.quantity), unitPriceCents: Math.round(l.unitPriceCents), amountCents: Math.round(l.quantity) * Math.round(l.unitPriceCents) }));
      const totals = computeInvoiceTotals(lines as any, { discountCents: input.discountCents, creditCents: input.creditCents, taxCents: input.taxCents });
      const inv: any = await sql`
        INSERT INTO billing_invoices (invoice_number, tenant_id, plan_code, currency, subtotal_cents, discount_total_cents, credit_total_cents, tax_total_cents, total_cents, amount_due_cents, status, due_date, period_start, period_end, last_action)
        VALUES (${invoiceNumber}, ${input.tenantId}, ${input.planCode ?? null}, ${input.currency ?? 'USD'}, ${totals.subtotalCents}, ${totals.discountTotalCents}, ${totals.creditTotalCents}, ${totals.taxTotalCents}, ${totals.totalCents}, ${totals.amountDueCents}, 'draft', ${input.dueDate ?? null}, ${input.periodStart ?? null}, ${input.periodEnd ?? null}, 'draft_created')
        RETURNING id`.execute(trx);
      const invoiceId = inv.rows[0].id;
      let sort = 0;
      for (const l of lines) {
        await sql`INSERT INTO billing_invoice_lines (invoice_id, tenant_id, kind, description, quantity, unit_price_cents, amount_cents, sort_order)
                  VALUES (${invoiceId}, ${input.tenantId}, ${l.kind}, ${l.description}, ${l.quantity}, ${l.unitPriceCents}, ${l.amountCents}, ${sort++})`.execute(trx);
      }
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.invoice.created', 'billing', ${invoiceNumber}, ${JSON.stringify({ invoiceNumber, totalCents: totals.totalCents, lineCount: lines.length })}::jsonb)`.execute(trx);
      return { invoiceNumber, totalCents: totals.totalCents, status: 'draft' };
    });
  }

  // Finalize: draft → open, set finalized_at. After this the line items are immutable (no edit path exists).
  async finalizeInvoice(actor: AuditActor, invoiceNumber: string): Promise<{ invoiceNumber: string; status: string }> {
    const row: any = await sql`SELECT id, tenant_id, status FROM billing_invoices WHERE invoice_number=${invoiceNumber}`.execute(this.db);
    if (!row.rows[0]) throw new BillingValidationError('Invoice not found');
    if (row.rows[0].status !== 'draft') throw new BillingValidationError('Only draft invoices can be finalized');
    const fin: any = await sql`UPDATE billing_invoices SET status='open', finalized_at=now(), last_action='finalized' WHERE id=${row.rows[0].id} AND ${canMoveToSql(BILLING_INVOICE, 'open')} RETURNING id`.execute(this.db);
    if (!fin.rows.length) throw new BillingValidationError('Only draft invoices can be finalized');   // finalized concurrently
    await this.writeBillingAudit(actor, row.rows[0].tenant_id, 'billing.invoice.finalized', invoiceNumber, { invoiceNumber });
    return { invoiceNumber, status: 'open' };
  }

  // Apply a credit to an invoice: ledger-based, transactional, cannot exceed remaining, never double-applies. Adds a
  // credit line, increases the invoice credit total, and recomputes amount due.
  async applyCredit(actor: AuditActor, input: { creditId: string; invoiceNumber: string; amountCents: number }): Promise<{ invoiceNumber: string; creditRemainingCents: number; amountDueCents: number }> {
    return await this.db.transaction().execute(async (trx) => {
      const cRow: any = await sql`SELECT id, tenant_id, remaining_cents, status FROM billing_credits WHERE id=${input.creditId} FOR UPDATE`.execute(trx);
      if (!cRow.rows[0]) throw new BillingValidationError('Credit not found');
      if (cRow.rows[0].status !== 'active') throw new BillingValidationError('Credit is not active');
      const iRow: any = await sql`SELECT id, tenant_id, total_cents, amount_paid_cents, credit_total_cents, status FROM billing_invoices WHERE invoice_number=${input.invoiceNumber} FOR UPDATE`.execute(trx);
      if (!iRow.rows[0]) throw new BillingValidationError('Invoice not found');
      if (String(iRow.rows[0].tenant_id) !== String(cRow.rows[0].tenant_id)) throw new BillingValidationError('Credit and invoice belong to different tenants');
      const newRemaining = applyCreditToRemaining(Number(cRow.rows[0].remaining_cents), input.amountCents);
      const apply = Math.round(input.amountCents);
      await sql`UPDATE billing_credits SET remaining_cents=${newRemaining}, status=${newRemaining === 0 ? 'applied' : 'active'}, related_invoice_id=${iRow.rows[0].id} WHERE id=${input.creditId} AND ${canMoveToSql(BILLING_CREDIT, newRemaining === 0 ? 'applied' : 'active')}`.execute(trx);
      const newCreditTotal = Number(iRow.rows[0].credit_total_cents) + apply;
      const newDue = Math.max(0, Number(iRow.rows[0].total_cents) - Number(iRow.rows[0].amount_paid_cents) - newCreditTotal);
      const newStatus = newDue === 0 && ['open', 'past_due', 'failed', 'partially_paid'].includes(iRow.rows[0].status) ? 'paid' : iRow.rows[0].status;
      await sql`UPDATE billing_invoices SET credit_total_cents=${newCreditTotal}, amount_due_cents=${newDue}, status=${newStatus}, last_action='credit_applied', paid_at=${newStatus === 'paid' ? sql`now()` : sql`paid_at`} WHERE id=${iRow.rows[0].id} AND ${newStatus === iRow.rows[0].status ? sql`status = ${newStatus}` : canMoveToSql(BILLING_INVOICE, newStatus)}`.execute(trx);
      await sql`INSERT INTO billing_invoice_lines (invoice_id, tenant_id, kind, description, quantity, unit_price_cents, amount_cents, sort_order)
                VALUES (${iRow.rows[0].id}, ${iRow.rows[0].tenant_id}, 'credit', ${'Credit applied'}, 1, ${-apply}, ${-apply}, 999)`.execute(trx);
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${iRow.rows[0].tenant_id}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.credit.applied', 'billing', ${input.invoiceNumber}, ${JSON.stringify({ creditId: input.creditId, amountCents: apply, creditRemainingCents: newRemaining })}::jsonb)`.execute(trx);
      return { invoiceNumber: input.invoiceNumber, creditRemainingCents: newRemaining, amountDueCents: newDue };
    });
  }

  // Retry a failed/past-due invoice payment. Idempotent on idempotency_key: a repeated key returns the prior result
  // without a second charge. On success (sandbox), the invoice is marked paid and the attempt records what it recovered.
  async retryPayment(actor: AuditActor, input: { invoiceNumber: string; idempotencyKey: string }): Promise<{ invoiceNumber: string; status: string; recovered: boolean; idempotent: boolean }> {
    const existing: any = await sql`SELECT bpa.status, bi.status AS inv_status FROM billing_payment_attempts bpa JOIN billing_invoices bi ON bi.id=bpa.invoice_id WHERE bpa.idempotency_key=${input.idempotencyKey}`.execute(this.db);
    if (existing.rows[0]) return { invoiceNumber: input.invoiceNumber, status: existing.rows[0].inv_status, recovered: existing.rows[0].status === 'succeeded', idempotent: true };
    return await this.db.transaction().execute(async (trx) => {
      const iRow: any = await sql`SELECT id, tenant_id, amount_due_cents, status FROM billing_invoices WHERE invoice_number=${input.invoiceNumber} FOR UPDATE`.execute(trx);
      if (!iRow.rows[0]) throw new BillingValidationError('Invoice not found');
      const inv = iRow.rows[0];
      if (!['past_due', 'failed', 'open', 'partially_paid'].includes(inv.status)) throw new BillingValidationError(`Invoice status ${inv.status} is not eligible for retry`);
      if (Number(inv.amount_due_cents) <= 0) throw new BillingValidationError('Invoice has no outstanding balance');
      const recoveredFrom = inv.status;
      const sandbox = process.env.PAYMENTS_SANDBOX === '1';
      const attemptStatus = sandbox ? 'succeeded' : 'pending';
      const cnt: any = await sql`SELECT COUNT(*)::int AS n FROM billing_payment_attempts WHERE invoice_id=${inv.id}`.execute(trx);
      await sql`INSERT INTO billing_payment_attempts (invoice_id, tenant_id, amount_cents, status, idempotency_key, recovered_from_status, attempt_number)
                VALUES (${inv.id}, ${inv.tenant_id}, ${inv.amount_due_cents}, ${attemptStatus}, ${input.idempotencyKey}, ${recoveredFrom}, ${Number(cnt.rows[0].n) + 1})`.execute(trx);
      let newStatus = inv.status;
      if (attemptStatus === 'succeeded') {
        newStatus = 'paid';
        await sql`UPDATE billing_invoices SET status='paid', amount_paid_cents=total_cents, amount_due_cents=0, retry_status='Recovered', paid_at=now(), last_action='payment_recovered' WHERE id=${inv.id} AND ${canMoveToSql(BILLING_INVOICE, 'paid')}`.execute(trx);
      }
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${inv.tenant_id}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.payment.retried', 'billing', ${input.invoiceNumber}, ${JSON.stringify({ idempotencyKey: input.idempotencyKey, recoveredFrom, result: attemptStatus })}::jsonb)`.execute(trx);
      return { invoiceNumber: input.invoiceNumber, status: newStatus, recovered: attemptStatus === 'succeeded', idempotent: false };
    });
  }

  // Change a tenant's plan. preview=true returns proration only (no writes). Otherwise records a subscription_changes
  // row and, for an immediate strategy, moves the tenant onto the new plan. Downgrades default to end_of_period.
  async changePlan(actor: AuditActor, input: { tenantId: string; toPlanCode: string; strategy?: string; preview?: boolean }): Promise<any> {
    const sub: any = await sql`SELECT plan_code, monthly_price_cents, current_period_start, current_period_end, status FROM tenant_subscriptions WHERE tenant_id=${input.tenantId}`.execute(this.db);
    if (!sub.rows[0]) throw new BillingValidationError('Tenant has no subscription');
    const plan: any = await sql`SELECT code, name, monthly_price_cents FROM subscription_plans WHERE code=${input.toPlanCode}`.execute(this.db);
    if (!plan.rows[0]) throw new BillingValidationError('Target plan not found');
    const s = sub.rows[0];
    const oldCents = Number(s.monthly_price_cents) || 0, newCents = Number(plan.rows[0].monthly_price_cents) || 0;
    const isUpgrade = newCents >= oldCents;
    const strategy = input.strategy || (isUpgrade ? 'immediate' : 'end_of_period');
    const pstart = s.current_period_start ?? new Date().toISOString();
    const pend = s.current_period_end ?? new Date(Date.now() + 30 * 86400000).toISOString();
    const pro = computeProration({ oldMonthlyCents: oldCents, newMonthlyCents: newCents, periodStart: pstart, periodEnd: pend });
    const changeType = isUpgrade ? 'upgrade' : 'downgrade';
    if (input.preview) return { preview: true, from: s.plan_code, to: input.toPlanCode, changeType, strategy, proration: pro };
    const planName = plan.rows[0].name || input.toPlanCode;
    await this.db.transaction().execute(async (trx) => {
      await sql`INSERT INTO subscription_changes (tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, proration_credit_cents, proration_charge_cents, net_cents, created_by)
                VALUES (${input.tenantId}, ${s.plan_code}, ${input.toPlanCode}, ${changeType}, ${strategy}, ${strategy === 'immediate' ? 'completed' : 'pending'}, ${strategy === 'immediate' ? sql`now()` : sql`(now() + interval '30 days')`}, ${pro.creditCents}, ${pro.chargeCents}, ${pro.netCents}, ${actor?.userId ?? null})`.execute(trx);
      if (strategy === 'immediate') await sql`UPDATE tenant_subscriptions SET plan=${planName}, plan_code=${input.toPlanCode}, monthly_price_cents=${newCents} WHERE tenant_id=${input.tenantId}`.execute(trx);
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.plan.changed', 'billing', ${input.tenantId}, ${JSON.stringify({ from: s.plan_code, to: input.toPlanCode, changeType, strategy, netCents: pro.netCents })}::jsonb)`.execute(trx);
    });
    return { ok: true, from: s.plan_code, to: input.toPlanCode, changeType, strategy, proration: pro };
  }

  // Add or remove a tenant add-on (idempotent add; remove preserves history by marking cancelled).
  async changeAddOn(actor: AuditActor, input: { tenantId: string; addOnCode: string; action: 'add' | 'remove'; quantity?: number }): Promise<any> {
    const ao: any = await sql`SELECT id, name, unit_price_cents FROM plan_add_ons WHERE code=${input.addOnCode}`.execute(this.db);
    if (!ao.rows[0]) throw new BillingValidationError('Add-on not found');
    const addOnId = ao.rows[0].id, price = Number(ao.rows[0].unit_price_cents) || 0;
    await this.db.transaction().execute(async (trx) => {
      if (input.action === 'add') {
        const exists: any = await sql`SELECT id FROM tenant_add_ons WHERE tenant_id=${input.tenantId} AND add_on_id=${addOnId} AND status='active'`.execute(trx);
        if (!exists.rows[0]) await sql`INSERT INTO tenant_add_ons (tenant_id, add_on_id, quantity, price_cents, status, started_at) VALUES (${input.tenantId}, ${addOnId}, ${input.quantity ?? 1}, ${price}, 'active', now())`.execute(trx);
      } else {
        await sql`UPDATE tenant_add_ons SET status='cancelled', cancelled_at=now() WHERE tenant_id=${input.tenantId} AND add_on_id=${addOnId} AND status='active' AND ${canMoveToSql(TENANT_ADD_ON, 'cancelled')}`.execute(trx);
      }
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, ${input.action === 'add' ? 'billing.addon.added' : 'billing.addon.removed'}, 'billing', ${input.tenantId}, ${JSON.stringify({ addOnCode: input.addOnCode, quantity: input.quantity ?? 1 })}::jsonb)`.execute(trx);
    });
    return { ok: true, addOn: ao.rows[0].name, action: input.action };
  }

  // Extend a trial's end date, enforcing a cumulative-days cap. Recalculates the period end.
  async extendTrial(actor: AuditActor, input: { tenantId: string; days: number }): Promise<any> {
    const sub: any = await sql`SELECT current_period_end, status FROM tenant_subscriptions WHERE tenant_id=${input.tenantId}`.execute(this.db);
    if (!sub.rows[0]) throw new BillingValidationError('Tenant has no subscription');
    if (sub.rows[0].status !== 'trialing') throw new BillingValidationError('Subscription is not in a trial');
    const prior: any = await sql`SELECT COALESCE(SUM((metadata_json->>'days')::int),0) AS d FROM audit_logs WHERE entity_id=${input.tenantId} AND action_type='billing.trial.extended'`.execute(this.db);
    const newEnd = computeTrialExtension(sub.rows[0].current_period_end ?? new Date().toISOString(), input.days, Number(prior.rows[0].d) || 0);
    await this.db.transaction().execute(async (trx) => {
      await sql`UPDATE tenant_subscriptions SET current_period_end=${newEnd} WHERE tenant_id=${input.tenantId}`.execute(trx);
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.trial.extended', 'billing', ${input.tenantId}, ${JSON.stringify({ days: input.days, newEnd })}::jsonb)`.execute(trx);
    });
    return { ok: true, newTrialEnd: newEnd, days: input.days };
  }

  // Create a promotional discount (percent or fixed). Unique per (tenant, code).
  async createDiscount(actor: AuditActor, input: { tenantId?: string; code: string; discountType: 'percent' | 'fixed'; percent?: number; amountCents?: number; appliesTo?: string; cycles?: number }): Promise<any> {
    if (!input.code || input.code.trim().length < 2) throw new BillingValidationError('Discount code is required');
    if (input.discountType === 'percent' && (!input.percent || input.percent <= 0 || input.percent > 100)) throw new BillingValidationError('Percent must be 1–100');
    if (input.discountType === 'fixed' && (!input.amountCents || input.amountCents <= 0)) throw new BillingValidationError('Fixed amount must be positive');
    try {
      await sql`INSERT INTO billing_discounts (tenant_id, code, discount_type, percent, amount_cents, applies_to, starts_at, cycles, status)
                VALUES (${input.tenantId ?? null}, ${input.code}, ${input.discountType}, ${input.percent ?? null}, ${input.amountCents ?? null}, ${input.appliesTo ?? 'plan'}, now()::date, ${input.cycles ?? null}, 'active')`.execute(this.db);
    } catch (e: any) {
      if (String(e?.message || '').includes('uq_billing_discounts')) throw new BillingValidationError('A discount with this code already exists for the tenant');
      throw e;
    }
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${input.tenantId ?? null}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.discount.created', 'billing', ${input.code}, ${JSON.stringify({ code: input.code, discountType: input.discountType })}::jsonb)`.execute(this.db);
    return { ok: true, code: input.code };
  }

  // Impact preview for a cancellation/pause: outstanding invoices, remaining credits, add-ons that would deactivate.
  private async cancelImpact(tenantId: string) {
    const r: any = await sql`SELECT
      (SELECT COUNT(*) FROM billing_invoices WHERE tenant_id=${tenantId} AND status IN ('open','past_due','failed','partially_paid'))::int AS outstanding_invoices,
      (SELECT COALESCE(SUM(amount_due_cents),0) FROM billing_invoices WHERE tenant_id=${tenantId} AND status IN ('open','past_due','failed','partially_paid')) AS outstanding_cents,
      (SELECT COALESCE(SUM(remaining_cents),0) FROM billing_credits WHERE tenant_id=${tenantId} AND status='active') AS credit_remaining_cents,
      (SELECT COUNT(*) FROM tenant_add_ons WHERE tenant_id=${tenantId} AND status='active')::int AS active_add_ons`.execute(this.db);
    const row = r.rows[0] ?? {};
    return { outstandingInvoices: Number(row.outstanding_invoices) || 0, outstandingCents: Number(row.outstanding_cents) || 0, creditRemainingCents: Number(row.credit_remaining_cents) || 0, activeAddOns: Number(row.active_add_ons) || 0, dataRetentionDays: 90 };
  }

  async pauseSubscription(actor: AuditActor, input: { tenantId: string; resumeDate?: string; reason?: string; preview?: boolean }): Promise<any> {
    const sub: any = await sql`SELECT status, plan_code FROM tenant_subscriptions WHERE tenant_id=${input.tenantId}`.execute(this.db);
    if (!sub.rows[0]) throw new BillingValidationError('Tenant has no subscription');
    const plan = resolvePause(sub.rows[0].status, input.resumeDate);
    const impact = await this.cancelImpact(input.tenantId);
    if (input.preview) return { preview: true, action: 'pause', resultStatus: plan.status, pauseEnd: plan.pauseEnd, impact };
    await this.db.transaction().execute(async (trx) => {
      const moved: any = await sql`UPDATE tenant_subscriptions SET status='paused', pause_start=${plan.pauseStart}, pause_end=${plan.pauseEnd} WHERE tenant_id=${input.tenantId} AND status = ${sub.rows[0].status} AND ${canMoveToSql(TENANT_SUBSCRIPTION, 'paused')} RETURNING id`.execute(trx);
      if (!moved.rows.length) throw new InvalidStateTransitionError(TENANT_SUBSCRIPTION, sub.rows[0].status, 'paused', 'concurrent');
      await sql`INSERT INTO subscription_changes (tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, reason, created_by)
                VALUES (${input.tenantId}, ${sub.rows[0].plan_code}, ${sub.rows[0].plan_code}, 'pause', 'immediate', 'completed', now(), ${input.reason ?? null}, ${actor?.userId ?? null})`.execute(trx);
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.subscription.paused', 'billing', ${input.tenantId}, ${JSON.stringify({ pauseEnd: plan.pauseEnd, reason: input.reason ?? null })}::jsonb)`.execute(trx);
    });
    return { ok: true, action: 'pause', resultStatus: 'paused', pauseEnd: plan.pauseEnd };
  }

  async resumeSubscription(actor: AuditActor, input: { tenantId: string }): Promise<any> {
    const sub: any = await sql`SELECT status FROM tenant_subscriptions WHERE tenant_id=${input.tenantId}`.execute(this.db);
    if (!sub.rows[0]) throw new BillingValidationError('Tenant has no subscription');
    if (!canResume(sub.rows[0].status)) throw new BillingValidationError('Only a paused subscription can be resumed');
    await this.db.transaction().execute(async (trx) => {
      const moved: any = await sql`UPDATE tenant_subscriptions SET status='active', pause_start=NULL, pause_end=NULL WHERE tenant_id=${input.tenantId} AND status = 'paused' AND ${canMoveToSql(TENANT_SUBSCRIPTION, 'active')} RETURNING id`.execute(trx);
      if (!moved.rows.length) throw new InvalidStateTransitionError(TENANT_SUBSCRIPTION, sub.rows[0].status, 'active', 'concurrent');
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.subscription.resumed', 'billing', ${input.tenantId}, ${JSON.stringify({})}::jsonb)`.execute(trx);
    });
    return { ok: true, action: 'resume', resultStatus: 'active' };
  }

  // Cancel preserves ALL history (invoices/payments/changes/audit are never deleted). preview returns the impact.
  async cancelSubscription(actor: AuditActor, input: { tenantId: string; strategy?: string; reason?: string; preview?: boolean }): Promise<any> {
    const sub: any = await sql`SELECT status, plan_code, current_period_end FROM tenant_subscriptions WHERE tenant_id=${input.tenantId}`.execute(this.db);
    if (!sub.rows[0]) throw new BillingValidationError('Tenant has no subscription');
    const strategy = input.strategy || 'end_of_period';
    const res = resolveCancellation(strategy, sub.rows[0].current_period_end);
    const impact = await this.cancelImpact(input.tenantId);
    if (input.preview) return { preview: true, action: 'cancel', strategy, resultStatus: res.status, effectiveAt: res.effectiveAt, impact };
    await this.db.transaction().execute(async (trx) => {
      // Phase 12 (#27): through TENANT_SUBSCRIPTION — cancelling an already-cancelled (or expired) subscription is a 409 now
      assertTransition(TENANT_SUBSCRIPTION, sub.rows[0].status, res.status);
      const moved: any = await sql`UPDATE tenant_subscriptions SET status=${res.status}, cancel_at=${strategy === 'end_of_period' ? res.effectiveAt : null}, cancelled_at=${strategy === 'immediate' ? res.effectiveAt : null} WHERE tenant_id=${input.tenantId} AND status = ${sub.rows[0].status} AND ${canMoveToSql(TENANT_SUBSCRIPTION, res.status)} RETURNING id`.execute(trx);
      if (!moved.rows.length) throw new InvalidStateTransitionError(TENANT_SUBSCRIPTION, sub.rows[0].status, res.status, 'concurrent');
      await sql`INSERT INTO subscription_changes (tenant_id, from_plan_code, to_plan_code, change_type, strategy, status, effective_at, reason, created_by)
                VALUES (${input.tenantId}, ${sub.rows[0].plan_code}, ${sub.rows[0].plan_code}, 'cancel', ${strategy}, ${strategy === 'immediate' ? 'completed' : 'scheduled'}, ${res.effectiveAt}, ${input.reason ?? null}, ${actor?.userId ?? null})`.execute(trx);
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${input.tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.subscription.cancelled', 'billing', ${input.tenantId}, ${JSON.stringify({ strategy, effectiveAt: res.effectiveAt, reason: input.reason ?? null, historyPreserved: true })}::jsonb)`.execute(trx);
    });
    return { ok: true, action: 'cancel', strategy, resultStatus: res.status, effectiveAt: res.effectiveAt, impact };
  }

  // Approve/reject a pending subscription_changes request. Approving a cancel applies it; approving an upgrade/downgrade
  // marked pending moves the tenant onto the target plan. Rejecting just records the decision. Always audited.
  async reviewRequest(actor: AuditActor, input: { changeId: string; decision: 'approve' | 'reject'; note?: string }): Promise<any> {
    const row: any = await sql`SELECT id, tenant_id, change_type, to_plan_code, status FROM subscription_changes WHERE id=${input.changeId}`.execute(this.db);
    if (!row.rows[0]) throw new BillingValidationError('Request not found');
    if (!['pending', 'needs_information'].includes(row.rows[0].status)) throw new BillingValidationError(`Request is already ${row.rows[0].status}`);
    const c = row.rows[0];
    await this.db.transaction().execute(async (trx) => {
      if (input.decision === 'reject') {
        const moved: any = await sql`UPDATE subscription_changes SET status='rejected' WHERE id=${c.id} AND ${canMoveToSql(SUBSCRIPTION_CHANGE, 'rejected')} RETURNING id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(SUBSCRIPTION_CHANGE, c.status, 'rejected', 'concurrent');
      } else {
        const moved: any = await sql`UPDATE subscription_changes SET status='completed', effective_at=COALESCE(effective_at, now()) WHERE id=${c.id} AND ${canMoveToSql(SUBSCRIPTION_CHANGE, 'completed')} RETURNING id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(SUBSCRIPTION_CHANGE, c.status, 'completed', 'concurrent');
        if (c.change_type === 'cancel') {
          await sql`UPDATE tenant_subscriptions SET status='pending_cancellation', cancel_at=COALESCE(current_period_end, now()) WHERE tenant_id=${c.tenant_id} AND ${canMoveToSql(TENANT_SUBSCRIPTION, 'pending_cancellation')}`.execute(trx);
        } else if (['upgrade', 'downgrade'].includes(c.change_type) && c.to_plan_code) {
          const p: any = await sql`SELECT monthly_price_cents FROM subscription_plans WHERE code=${c.to_plan_code}`.execute(trx);
          if (p.rows[0]) await sql`UPDATE tenant_subscriptions SET plan_code=${c.to_plan_code}, monthly_price_cents=${Number(p.rows[0].monthly_price_cents) || 0} WHERE tenant_id=${c.tenant_id}`.execute(trx);
        }
      }
      await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${c.tenant_id}, ${actor?.userId ?? null}, ${actor?.role ?? null}, ${input.decision === 'approve' ? 'billing.request.approved' : 'billing.request.rejected'}, 'billing', ${c.id}, ${JSON.stringify({ changeType: c.change_type, note: input.note ?? null })}::jsonb)`.execute(trx);
    });
    return { ok: true, changeId: c.id, decision: input.decision, changeType: c.change_type };
  }

  // Idempotent webhook ingestion. Dedup by provider_event_id (UNIQUE). A duplicate event is a no-op (never double-pays).
  async ingestWebhook(event: { providerEventId: string; eventType: string; invoiceNumber?: string }): Promise<{ processed: boolean; duplicate: boolean; effect: string }> {
    if (!event?.providerEventId || !event?.eventType) throw new BillingValidationError('providerEventId and eventType are required');
    return await this.db.transaction().execute(async (trx) => {
      // Phase 14 (Constitution 12): CLAIM the provider event first. Concurrent deliveries of the same event wait on the
      // unique here until the first commits, then find it taken → duplicate (a racing loser used to fail with a unique
      // violation after the effect check, i.e. a 400 the provider would retry). If the first rolls back, the next owns it.
      const claim: any = await sql`INSERT INTO billing_webhook_events (provider_event_id, event_type, status, processed_at)
        VALUES (${event.providerEventId}, ${event.eventType}, 'processed', now()) ON CONFLICT (provider_event_id) DO NOTHING RETURNING id`.execute(trx);
      if (!claim.rows[0]) return { processed: false, duplicate: true, effect: 'already_processed' };
      let invoiceId: string | null = null; let effect = 'ignored';
      if (event.invoiceNumber) {
        const inv: any = await sql`SELECT id, status, total_cents FROM billing_invoices WHERE invoice_number=${event.invoiceNumber} FOR UPDATE`.execute(trx);
        if (inv.rows[0]) {
          invoiceId = inv.rows[0].id;
          if (event.eventType === 'invoice.payment_succeeded' && inv.rows[0].status !== 'paid') {
            // Phase 12 (#27): only an outstanding invoice becomes paid (a void / refunded / uncollectible one no longer does)
            const paid: any = await sql`UPDATE billing_invoices SET status='paid', amount_paid_cents=total_cents, amount_due_cents=0, paid_at=now(), last_action='webhook_paid' WHERE id=${invoiceId} AND ${canMoveToSql(BILLING_INVOICE, 'paid')} RETURNING id`.execute(trx);
            effect = paid.rows.length ? 'invoice_marked_paid' : 'no_change';
          } else if (event.eventType === 'invoice.payment_failed' && !['paid', 'void'].includes(inv.rows[0].status)) {
            const failed: any = await sql`UPDATE billing_invoices SET status='failed', last_action='webhook_failed' WHERE id=${invoiceId} AND ${canMoveToSql(BILLING_INVOICE, 'failed')} RETURNING id`.execute(trx);
            effect = failed.rows.length ? 'invoice_marked_failed' : 'no_change';
          } else effect = 'no_change';
        }
      }
      if (invoiceId) await sql`UPDATE billing_webhook_events SET invoice_id = ${invoiceId} WHERE id = ${claim.rows[0].id}`.execute(trx);
      return { processed: true, duplicate: false, effect };
    });
  }

  // Filter-aware, audited CSV export. Report data is drawn from the same tables as the overview; the export core enforces
  // formula-injection safety and rejects any card/credential/contact column. No payment credentials ever leave here.
  async exportReport(actor: AuditActor, input: { report: string; tenantId?: string; planCode?: string; status?: string; format?: string }): Promise<{ filename: string; csv?: string; base64?: string; contentType: string; rowCount: number }> {
    const def = EXPORT_REPORTS[input.report];
    if (!def) throw new BillingValidationError(`Unknown report "${input.report}"`);
    const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
    const many = async (q: any) => { const r: any = await q.execute(this.db).catch(() => ({ rows: [] })); return r.rows as any[]; };
    const tf = input.tenantId ? sql` AND t.id = ${input.tenantId}` : sql``;
    let records: Record<string, string>[] = [];
    if (input.report === 'subscriptions' || input.report === 'recurring-revenue') {
      const rows = await many(sql`SELECT COALESCE(t.display_name,t.legal_name) AS tenant, ts.plan_code AS plan, ts.status AS state, COALESCE(ts.monthly_price_cents,0) AS monthly_cents, ts.current_period_end AS renewal_date,
        (SELECT COUNT(*) FROM tenant_add_ons ta WHERE ta.tenant_id=t.id AND ta.status='active')::int AS add_ons
        FROM tenants t JOIN tenant_subscriptions ts ON ts.tenant_id=t.id WHERE 1=1 ${tf} ${input.report === 'recurring-revenue' ? sql` AND ts.status IN ('active','past_due')` : sql``} ORDER BY monthly_cents DESC`);
      records = rows.map((r) => def.map({ tenant: r.tenant, plan: r.plan, state: r.state, monthlyCents: N(r.monthly_cents), renewalDate: r.renewal_date, addOns: N(r.add_ons) }));
    } else if (input.report === 'invoices') {
      const sf = input.status ? sql` AND bi.status = ${input.status}` : sql``;
      const rows = await many(sql`SELECT bi.invoice_number, COALESCE(t.display_name,t.legal_name) AS tenant, bi.total_cents, bi.due_date, bi.status, bi.retry_status
        FROM billing_invoices bi JOIN tenants t ON t.id=bi.tenant_id WHERE 1=1 ${tf} ${sf} ORDER BY bi.invoice_date DESC`);
      records = rows.map((r) => def.map({ invoiceNumber: r.invoice_number, tenant: r.tenant, amountCents: N(r.total_cents), dueDate: r.due_date, status: r.status, retryStatus: r.retry_status }));
    } else if (input.report === 'credits') {
      const rows = await many(sql`SELECT COALESCE(t.display_name,t.legal_name) AS tenant, bc.amount_cents, bc.remaining_cents, bc.reason, bc.status
        FROM billing_credits bc JOIN tenants t ON t.id=bc.tenant_id WHERE 1=1 ${tf} ORDER BY bc.created_at DESC`);
      records = rows.map((r) => def.map({ tenant: r.tenant, amountCents: N(r.amount_cents), remainingCents: N(r.remaining_cents), reason: r.reason, status: r.status }));
    } else if (input.report === 'discounts') {
      const rows = await many(sql`SELECT COALESCE(t.display_name,t.legal_name) AS tenant, bd.code, bd.discount_type, bd.percent, bd.amount_cents, bd.status
        FROM billing_discounts bd LEFT JOIN tenants t ON t.id=bd.tenant_id WHERE 1=1 ${input.tenantId ? sql` AND bd.tenant_id = ${input.tenantId}` : sql``} ORDER BY bd.created_at DESC`);
      records = rows.map((r) => def.map({ tenant: r.tenant, code: r.code, discountType: r.discount_type, percent: N(r.percent), amountCents: N(r.amount_cents), status: r.status }));
    }
    const csv = toCsv(def.columns, records);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${input.tenantId ?? null}, ${uuidOrNull(actor?.userId)}, ${actor?.role ?? null}, 'billing.export.created', 'billing', ${input.report}, ${JSON.stringify({ ...systemActorOf(actor?.userId), report: input.report, format: input.format ?? 'csv', rowCount: records.length, filters: { tenantId: input.tenantId ?? null, planCode: input.planCode ?? null, status: input.status ?? null } })}::jsonb)`.execute(this.db);
    if (input.format === 'pdf') {
      const PDFDocument = (await import('pdfkit')).default;
      const buf: Buffer = await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
        const chunks: Uint8Array[] = [];
        doc.on('data', (c: Uint8Array) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.fontSize(14).text(def.label, { align: 'left' });
        doc.fontSize(8).fillColor('#666').text(`Generated ${new Date().toISOString().slice(0, 10)} · ${records.length} rows · software subscription billing`, { align: 'left' });
        doc.moveDown(0.5).fillColor('#000');
        const cols = def.columns, pageW = doc.page.width - 72, colW = pageW / cols.length;
        const drawRow = (vals: string[], bold: boolean) => {
          const y = doc.y; doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica');
          cols.forEach((c, i) => doc.text(String(vals[i] ?? '').slice(0, 40), 36 + i * colW, y, { width: colW - 4, ellipsis: true }));
          doc.moveDown(0.2); doc.moveTo(36, doc.y).lineTo(36 + pageW, doc.y).strokeColor('#eee').stroke();
        };
        drawRow(cols.map((c) => c.label), true);
        for (const rec of records) { if (doc.y > doc.page.height - 60) doc.addPage(); drawRow(cols.map((c) => String(rec[c.key] ?? '')), false); }
        doc.end();
      });
      return { filename: `billing-${input.report}-${stamp}.pdf`, base64: buf.toString('base64'), contentType: 'application/pdf', rowCount: records.length };
    }
    if (input.format === 'xlsx') {
      // assertSafeColumns already ran inside toCsv above, so the column set is guaranteed card/credential-free.
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(def.label.slice(0, 31));
      ws.columns = def.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
      // Values are pre-sanitized strings; exceljs writes them as text (a leading "=" is not treated as a formula).
      for (const rec of records) ws.addRow(rec);
      ws.getRow(1).font = { bold: true };
      const buf = await wb.xlsx.writeBuffer();
      return { filename: `billing-${input.report}-${stamp}.xlsx`, base64: Buffer.from(buf as ArrayBuffer).toString('base64'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', rowCount: records.length };
    }
    return { filename: `billing-${input.report}-${stamp}.csv`, csv, contentType: 'text/csv', rowCount: records.length };
  }

  private async latestPriorBillingSnapshot(): Promise<Record<string, number>> {
    const q: any = await sql`SELECT kpi_key, value_num FROM billing_kpi_snapshots WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM billing_kpi_snapshots WHERE snapshot_date < current_date)`.execute(this.db).catch(() => ({ rows: [] }));
    const out: Record<string, number> = {};
    for (const r of q.rows) out[String(r.kpi_key)] = Number(r.value_num) || 0;
    return out;
  }

  // Production job path: write today's KPI values (idempotent per day/key). Not called on read.
  async snapshotBillingToday(): Promise<void> {
    const ov = await this.subscriptionsOverview();
    for (const key of Object.keys(KPI_POLARITY)) {
      const v = (ov.kpis as any)[key] ?? 0;
      await sql`INSERT INTO billing_kpi_snapshots (snapshot_date, kpi_key, value_num) VALUES (current_date, ${key}, ${v})
        ON CONFLICT (snapshot_date, kpi_key) DO UPDATE SET value_num = EXCLUDED.value_num`.execute(this.db).catch(() => {});
    }
  }

  // Tenant billing profile (§27): subscription, add-ons, invoices, credits, discounts, outstanding balance, masked
  // payment method, and audit history. Never returns full PAN/CVV/token or provider secrets. Reading it is audited.
  async tenantBillingProfile(actor: AuditActor, tenantId: string): Promise<any> {
    const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
    const many = async (q: any) => { const r: any = await q.execute(this.db).catch(() => ({ rows: [] })); return r.rows as any[]; };
    const one = async (q: any) => { const r: any = await q.execute(this.db).catch(() => ({ rows: [{}] })); return r.rows[0] ?? {}; };
    const t: any = await sql`SELECT id, display_name, legal_name FROM tenants WHERE id=${tenantId}`.execute(this.db);
    if (!t.rows[0]) throw new BillingValidationError('Tenant not found');
    const sub = await one(sql`SELECT plan_code, status, billing_interval, current_period_start, current_period_end, cancel_at, cancelled_at, pause_start, pause_end, monthly_price_cents FROM tenant_subscriptions WHERE tenant_id=${tenantId}`);
    const addOns = await many(sql`SELECT pa.name, ta.quantity, ta.price_cents, ta.status FROM tenant_add_ons ta JOIN plan_add_ons pa ON pa.id=ta.add_on_id WHERE ta.tenant_id=${tenantId} ORDER BY ta.status, pa.name`);
    const invoices = await many(sql`SELECT invoice_number, total_cents, amount_due_cents, status, invoice_date, due_date, retry_status FROM billing_invoices WHERE tenant_id=${tenantId} ORDER BY invoice_date DESC LIMIT 25`);
    const credits = await many(sql`SELECT amount_cents, remaining_cents, reason, status, created_at FROM billing_credits WHERE tenant_id=${tenantId} ORDER BY created_at DESC`);
    const discounts = await many(sql`SELECT code, discount_type, percent, amount_cents, status FROM billing_discounts WHERE tenant_id=${tenantId} ORDER BY created_at DESC`);
    const outstanding = await one(sql`SELECT COALESCE(SUM(amount_due_cents),0) AS c FROM billing_invoices WHERE tenant_id=${tenantId} AND status IN ('open','past_due','failed','partially_paid')`);
    const audit = await many(sql`SELECT action_type, metadata_json, created_at FROM audit_logs WHERE entity_type='billing' AND (tenant_id=${tenantId} OR entity_id=${tenantId}) ORDER BY created_at DESC LIMIT 20`);
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.profile.accessed', 'billing', ${tenantId}, ${JSON.stringify({})}::jsonb)`.execute(this.db);
    return {
      tenantId, tenant: t.rows[0].display_name ?? t.rows[0].legal_name, legalName: t.rows[0].legal_name ?? null, currency: 'USD',
      subscription: { plan: sub.plan_code ?? null, status: sub.status ?? null, billingInterval: sub.billing_interval ?? null, monthlyCents: N(sub.monthly_price_cents), currentPeriodStart: sub.current_period_start ?? null, currentPeriodEnd: sub.current_period_end ?? null, trialEnd: sub.status === 'trialing' ? (sub.current_period_end ?? null) : null, cancelAt: sub.cancel_at ?? null, cancelledAt: sub.cancelled_at ?? null, pauseEnd: sub.pause_end ?? null },
      addOns: addOns.map((a) => ({ name: a.name, quantity: N(a.quantity), priceCents: N(a.price_cents), status: a.status })),
      invoices: invoices.map((i) => ({ invoiceNumber: i.invoice_number, totalCents: N(i.total_cents), amountDueCents: N(i.amount_due_cents), status: i.status, invoiceDate: i.invoice_date ?? null, dueDate: i.due_date ?? null, retryStatus: i.retry_status ?? null })),
      credits: credits.map((c) => ({ amountCents: N(c.amount_cents), remainingCents: N(c.remaining_cents), reason: c.reason, status: c.status })),
      discounts: discounts.map((d) => ({ code: d.code, discountType: d.discount_type, percent: N(d.percent), amountCents: N(d.amount_cents), status: d.status })),
      outstandingCents: N(outstanding.c),
      maskedPaymentMethod: null, // software billing methods are tokenized; brand/last4 only when on file (none modeled here)
      auditHistory: audit.map((a) => ({ action: a.action_type, at: a.created_at, meta: a.metadata_json ?? {} })),
    };
  }

  // ---- Async/background export jobs with expiring download links ----
  async createExportJob(actor: AuditActor, input: { report: string; format?: string; tenantId?: string; status?: string }): Promise<{ jobId: string; token: string; status: string }> {
    if (!EXPORT_REPORTS[input.report]) throw new BillingValidationError(`Unknown report "${input.report}"`);
    const token = randomUUID().replace(/-/g, '');
    const r: any = await sql`INSERT INTO billing_export_jobs (report, format, filters_json, status, download_token_hash, created_by_user_id)
      VALUES (${input.report}, ${input.format ?? 'csv'}, ${JSON.stringify({ tenantId: input.tenantId ?? null, status: input.status ?? null })}::jsonb, 'pending', ${sha256Hex(token)}, ${actor?.userId ?? null}) RETURNING id`.execute(this.db);
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${input.tenantId ?? null}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.export.job_created', 'billing', ${String(r.rows[0].id)}, ${JSON.stringify({ report: input.report, format: input.format ?? 'csv' })}::jsonb)`.execute(this.db);
    return { jobId: String(r.rows[0].id), token, status: 'pending' };
  }

  // Worker: claim pending jobs (skip-locked), generate the file, store bytes, set ready + a 24h expiry. Scheduler-compatible.
  async processPendingExportJobs(limit = 5): Promise<{ processed: number }> {
    const claim: any = await sql`UPDATE billing_export_jobs SET status='processing'
      WHERE ${canMoveToSql(BILLING_EXPORT_JOB, 'processing')} AND id IN (SELECT id FROM billing_export_jobs WHERE status='pending' ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
      RETURNING id, report, format, filters_json`.execute(this.db);
    let processed = 0;
    for (const job of claim.rows) {
      try {
        const f = job.filters_json ?? {};
        // B-14 remainder: the ONE system-context shape (it hand-built an undefined-user actor)
        const sys = systemContext({ tenantId: '', actor: 'billing-export' });
        const out = await this.exportReport({ userId: sys.userId, role: sys.role }, { report: job.report, format: job.format, tenantId: f.tenantId ?? undefined, status: f.status ?? undefined });
        const content = out.base64 ?? out.csv ?? '';
        const contentKey = this.store ? await stashExportBytes(this.store, 'billing-exports', String(job.id), out.filename, Buffer.from(content, out.base64 ? 'base64' : 'utf8'), out.contentType) : null;   // B-18
        await sql`UPDATE billing_export_jobs SET status='ready', row_count=${out.rowCount}, filename=${out.filename}, content_type=${out.contentType}, content_b64=${contentKey ? null : content}, content_key=${contentKey}, completed_at=now(), expires_at=now() + interval '24 hours' WHERE id=${job.id} AND ${canMoveToSql(BILLING_EXPORT_JOB, 'ready')}`.execute(this.db);
        await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                  VALUES (NULL, NULL, 'SYSTEM', 'billing.export.job_completed', 'billing', ${String(job.id)}, ${JSON.stringify({ report: job.report, rowCount: out.rowCount })}::jsonb)`.execute(this.db);
        processed++;
      } catch (e: any) {
        await sql`UPDATE billing_export_jobs SET status='failed', error=${String(e?.message || 'export failed').slice(0, 500)}, completed_at=now() WHERE id=${job.id} AND ${canMoveToSql(BILLING_EXPORT_JOB, 'failed')}`.execute(this.db);
      }
    }
    return { processed };
  }

  async getExportJob(token: string): Promise<any> {
    const r: any = await sql`SELECT id, report, format, status, row_count, filename, content_type, error, created_at, completed_at, expires_at,
      (expires_at IS NOT NULL AND expires_at < now()) AS is_expired FROM billing_export_jobs WHERE download_token_hash=${sha256Hex(token)}`.execute(this.db);
    if (!r.rows[0]) return null;
    const j = r.rows[0];
    const status = j.status === 'ready' && j.is_expired ? 'expired' : j.status;
    return { report: j.report, format: j.format, status, rowCount: j.row_count ?? null, filename: j.filename ?? null, error: j.error ?? null, createdAt: j.created_at, completedAt: j.completed_at ?? null, expiresAt: j.expires_at ?? null };
  }

  // Download via the expiring link. Ready + unexpired → returns the bytes; expired/not-ready → error (link is 410 Gone).
  async downloadExportJob(actor: AuditActor, token: string): Promise<{ filename: string; csv?: string; base64?: string; contentType: string }> {
    const r: any = await sql`SELECT id, status, filename, content_type, content_b64, content_key, format, (expires_at IS NOT NULL AND expires_at < now()) AS is_expired FROM billing_export_jobs WHERE download_token_hash=${sha256Hex(token)}`.execute(this.db);
    if (!r.rows[0]) throw new BillingValidationError('Export not found');
    const j = r.rows[0];
    if (j.status !== 'ready') throw new BillingValidationError(`Export is not ready (status ${j.status})`);
    if (j.is_expired) throw new BillingValidationError('Download link has expired');
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (NULL, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'billing.export.downloaded', 'billing', ${String(j.id)}, ${JSON.stringify({ filename: j.filename })}::jsonb)`.execute(this.db);
    const isText = j.content_type === 'text/csv';
    const bytes = await loadExportBytes(this.store, j.content_key, { base64: isText ? null : j.content_b64, text: isText ? j.content_b64 : null });   // B-18
    if (!bytes) throw new BillingValidationError('The export file is no longer available');
    return { filename: j.filename, contentType: j.content_type, ...(isText ? { csv: bytes.toString('utf8') } : { base64: bytes.toString('base64') }) };
  }

  // Sweep: mark ready-but-past-expiry jobs expired and drop their stored bytes.
  async expireStaleExportJobs(): Promise<{ expired: number }> {
    const r: any = await sql`UPDATE billing_export_jobs SET status='expired', content_b64=NULL WHERE ${canMoveToSql(BILLING_EXPORT_JOB, 'expired')} AND status='ready' AND expires_at IS NOT NULL AND expires_at < now() RETURNING id`.execute(this.db);
    return { expired: r.rows.length };
  }

  async subscriptionsOverview(): Promise<BillingSubscriptionsOverview> {
    const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
    const one = async (q: any) => { const r: any = await q.execute(this.db).catch(() => ({ rows: [{}] })); return r.rows[0] ?? {}; };
    const many = async (q: any) => { const r: any = await q.execute(this.db).catch(() => ({ rows: [] })); return r.rows as any[]; };

    const subs = await one(sql`SELECT
      COUNT(*) FILTER (WHERE status='active')::int AS active,
      COUNT(*) FILTER (WHERE status='trialing')::int AS trialing,
      COALESCE(SUM(monthly_price_cents) FILTER (WHERE status IN ('active','past_due')),0) AS mrr
      FROM tenant_subscriptions`);
    const invAgg = await one(sql`SELECT
      COUNT(*)::int AS invoices,
      COUNT(*) FILTER (WHERE status IN ('failed'))::int AS failed,
      COUNT(DISTINCT tenant_id) FILTER (WHERE status IN ('past_due','failed'))::int AS past_due_accounts
      FROM billing_invoices`);
    const credits = await one(sql`SELECT COALESCE(SUM(amount_cents),0) AS c FROM billing_credits WHERE status IN ('active','applied')`);
    const discounts = await one(sql`SELECT COUNT(*)::int AS n FROM billing_discounts WHERE status='active'`);
    const discountVal = await one(sql`
      SELECT COALESCE(SUM(CASE WHEN d.discount_type='fixed' THEN d.amount_cents ELSE ROUND(COALESCE(ts.monthly_price_cents,0) * d.percent / 100.0) END),0) AS c
      FROM billing_discounts d LEFT JOIN tenant_subscriptions ts ON ts.tenant_id=d.tenant_id WHERE d.status='active'`);
    const addons = await one(sql`SELECT COUNT(*)::int AS n FROM tenant_add_ons WHERE status='active'`);
    const changes = await one(sql`SELECT COUNT(*) FILTER (WHERE status='pending')::int AS changes, COUNT(*) FILTER (WHERE change_type='cancel' AND status='pending')::int AS cancels FROM subscription_changes`);
    const renewals = await one(sql`SELECT COUNT(*)::int AS n FROM tenant_subscriptions WHERE current_period_end IS NOT NULL AND current_period_end BETWEEN now() AND now() + interval '7 days'`);

    const planDist = await many(sql`SELECT plan_code AS plan, COUNT(*)::int AS count FROM tenant_subscriptions WHERE plan_code IS NOT NULL GROUP BY plan_code ORDER BY count DESC`);
    const statusBreak = await many(sql`SELECT status, COUNT(*)::int AS count FROM billing_invoices GROUP BY status ORDER BY count DESC`);
    const addonMix = await many(sql`SELECT pa.name AS add_on, COALESCE(SUM(ta.price_cents * ta.quantity),0) AS cents FROM tenant_add_ons ta JOIN plan_add_ons pa ON pa.id=ta.add_on_id WHERE ta.status='active' GROUP BY pa.name ORDER BY cents DESC`);
    const trend = await many(sql`SELECT to_char(date_trunc('day', paid_at),'Mon DD') AS date, COALESCE(SUM(amount_paid_cents),0) AS cents FROM billing_invoices WHERE status='paid' AND paid_at >= now() - interval '7 days' GROUP BY 1, date_trunc('day', paid_at) ORDER BY date_trunc('day', paid_at)`);

    const planCatalog = await many(sql`SELECT code, name, monthly_price_cents, status FROM subscription_plans ORDER BY display_order NULLS LAST, monthly_price_cents`);
    const addOnCatalog = await many(sql`SELECT code, name, unit_price_cents AS monthly_price_cents, status FROM plan_add_ons ORDER BY display_order NULLS LAST`);

    const tenantOverview = await many(sql`
      SELECT t.id AS tenant_id, COALESCE(t.display_name, t.legal_name) AS tenant, ts.plan_code AS plan, ts.status AS state,
        COALESCE(ts.monthly_price_cents,0) AS monthly_cents, ts.current_period_end AS renewal_date,
        (SELECT COUNT(*) FROM tenant_add_ons ta WHERE ta.tenant_id=t.id AND ta.status='active')::int AS addons,
        (SELECT COALESCE(SUM(remaining_cents),0) FROM billing_credits bc WHERE bc.tenant_id=t.id AND bc.status='active') AS credits,
        (SELECT COUNT(*) FROM billing_discounts bd WHERE bd.tenant_id=t.id AND bd.status='active')::int AS discounts,
        (SELECT status FROM billing_invoices bi WHERE bi.tenant_id=t.id ORDER BY invoice_date DESC LIMIT 1) AS billing_status
      FROM tenants t JOIN tenant_subscriptions ts ON ts.tenant_id=t.id ORDER BY monthly_cents DESC`);
    const invoices = await many(sql`
      SELECT bi.invoice_number, COALESCE(t.display_name,t.legal_name) AS tenant, bi.total_cents, bi.due_date, bi.status, bi.retry_status, bi.last_action
      FROM billing_invoices bi JOIN tenants t ON t.id=bi.tenant_id ORDER BY bi.invoice_date DESC LIMIT 50`);
    const changeRows = await many(sql`
      SELECT sc.id, COALESCE(t.display_name,t.legal_name) AS tenant, sc.change_type, sc.from_plan_code, sc.to_plan_code, sc.effective_at, sc.reason, sc.status
      FROM subscription_changes sc JOIN tenants t ON t.id=sc.tenant_id ORDER BY sc.created_at DESC LIMIT 50`);
    const upcoming = await many(sql`
      SELECT COALESCE(t.display_name,t.legal_name) AS tenant, ts.plan_code AS plan, ts.current_period_end AS renewal_date, COALESCE(ts.monthly_price_cents,0) AS amount, ts.status
      FROM tenant_subscriptions ts JOIN tenants t ON t.id=ts.tenant_id WHERE ts.current_period_end IS NOT NULL ORDER BY ts.current_period_end LIMIT 50`);
    const activity = await many(sql`
      SELECT bi.created_at AS at, COALESCE(t.display_name,t.legal_name) AS tenant, 'Invoice ' || bi.status AS action, bi.invoice_number AS details, bi.total_cents AS amount
      FROM billing_invoices bi JOIN tenants t ON t.id=bi.tenant_id ORDER BY bi.created_at DESC LIMIT 10`);

    // Trial → paid conversion (documented denominator): eligible = tenants with an invoice that are trialing or active;
    // converted = active tenants with at least one paid invoice.
    const conv = await one(sql`SELECT
      COUNT(DISTINCT ts.tenant_id) FILTER (WHERE ts.status IN ('trialing','active'))::int AS eligible,
      COUNT(DISTINCT ts.tenant_id) FILTER (WHERE ts.status='active' AND EXISTS (SELECT 1 FROM billing_invoices bi WHERE bi.tenant_id=ts.tenant_id AND bi.status='paid'))::int AS converted
      FROM tenant_subscriptions ts`);
    const trialConversion = trialConversionRate(N(conv.eligible), N(conv.converted));
    // Failed vs recovered: recovery links to a prior failed obligation via recovered_from_status.
    const recAgg = await one(sql`SELECT
      COUNT(*) FILTER (WHERE status='succeeded' AND recovered_from_status IS NOT NULL)::int AS recovered,
      COUNT(DISTINCT invoice_id) FILTER (WHERE status='failed')::int AS failed_obligations
      FROM billing_payment_attempts`);
    const attRows = await many(sql`SELECT created_at AS at, (status='failed')::int AS failed, (status='succeeded' AND recovered_from_status IS NOT NULL)::int AS recovered FROM billing_payment_attempts`);
    const recovered = N(recAgg.recovered);
    const failedVsRecovered = { recoveredRate: recoveredRate(recovered + N(recAgg.failed_obligations), recovered).rate, weekly: weeklyFailedRecovered(attRows.map((r) => ({ at: r.at, failed: N(r.failed), recovered: N(r.recovered) }))) };

    const glance = await one(sql`SELECT
      (SELECT COUNT(*) FROM billing_invoices WHERE date_trunc('day',created_at)=date_trunc('day',now()))::int AS new_invoices,
      (SELECT COALESCE(SUM(amount_cents),0) FROM billing_credits WHERE date_trunc('day',created_at)=date_trunc('day',now())) AS credits_today,
      (SELECT COUNT(*) FROM subscription_changes WHERE date_trunc('day',created_at)=date_trunc('day',now()))::int AS changes_today`);

    const kpis = {
      activeSubscriptions: N(subs.active), trialAccounts: N(subs.trialing), pastDueAccounts: N(invAgg.past_due_accounts),
      failedPayments: N(invAgg.failed), invoices: N(invAgg.invoices), creditsIssuedCents: N(credits.c),
      discountsAppliedCents: N(discountVal.c), addOnsActive: N(addons.n), subscriptionChanges: N(changes.changes),
      cancellationRequests: N(changes.cancels), upcomingRenewals: N(renewals.n), mrrCents: N(subs.mrr),
    };
    const prior = await this.latestPriorBillingSnapshot();
    const kpiTrends: Record<string, { deltaPct: number | null; favorable: boolean | null }> = {};
    for (const key of Object.keys(KPI_POLARITY)) kpiTrends[key] = computeTrend(key, (kpis as any)[key] ?? 0, prior[key]);

    return {
      kpis, kpiTrends,
      planDistribution: planDist.map((r) => ({ plan: String(r.plan), count: N(r.count) })),
      billingStatusBreakdown: statusBreak.map((r) => ({ status: String(r.status), count: N(r.count) })),
      addOnRevenueMix: addonMix.map((r) => ({ addOn: String(r.add_on), cents: N(r.cents) })),
      revenueTrend: trend.map((r) => ({ date: String(r.date), cents: N(r.cents) })),
      trialConversion, failedVsRecovered,
      planCatalog: planCatalog.map((r) => ({ code: String(r.code), name: String(r.name), monthlyPriceCents: N(r.monthly_price_cents), status: String(r.status) })),
      addOnCatalog: addOnCatalog.map((r) => ({ code: String(r.code), name: String(r.name), monthlyPriceCents: N(r.monthly_price_cents), status: String(r.status) })),
      tenantOverview: tenantOverview.map((r) => ({ tenantId: String(r.tenant_id), tenant: String(r.tenant), plan: r.plan ?? null, addOns: N(r.addons), billingStatus: String(r.billing_status ?? '—'), renewalDate: r.renewal_date ? new Date(r.renewal_date).toISOString() : null, monthlyCents: N(r.monthly_cents), discountsCents: 0, creditsCents: N(r.credits), state: String(r.state) })),
      invoices: invoices.map((r) => ({ invoiceNumber: String(r.invoice_number), tenant: String(r.tenant), amountCents: N(r.total_cents), dueDate: r.due_date ? new Date(r.due_date).toISOString() : null, status: String(r.status), retryStatus: r.retry_status ?? null, lastAction: r.last_action ?? null })),
      changes: changeRows.map((r) => ({ changeId: String(r.id), tenant: String(r.tenant), requested: r.change_type === 'cancel' ? 'Cancel subscription' : `${r.from_plan_code} → ${r.to_plan_code} (${r.change_type})`, effectiveAt: r.effective_at ? new Date(r.effective_at).toISOString() : null, reason: r.reason ?? null, status: String(r.status) })),
      upcomingRenewals: upcoming.map((r) => ({ tenant: String(r.tenant), plan: r.plan ?? null, renewalDate: r.renewal_date ? new Date(r.renewal_date).toISOString() : null, amountCents: N(r.amount), autoRenew: r.status !== 'cancelled', status: String(r.status) })),
      recentActivity: activity.map((r) => ({ at: new Date(r.at).toISOString(), tenant: String(r.tenant), action: String(r.action), details: String(r.details), amountCents: N(r.amount) })),
      atAGlance: { newInvoicesToday: N(glance.new_invoices), paymentsRecoveredCents: 0, creditsAppliedTodayCents: N(glance.credits_today), planChangesToday: N(glance.changes_today), trialsExtended: 0, renewalsDue: N(renewals.n) },
    };
  }

  async getFacts(): Promise<BillingFact[]> {
    const tenants = await this.db.selectFrom('tenants').select(['id', 'display_name', 'status']).execute();
    const subs = await this.db.selectFrom('tenant_subscriptions')
      .select(['tenant_id', 'plan', 'status', 'current_period_end', 'created_at']).execute();
    const pay = await this.db.selectFrom('tenant_payment_config')
      .select(['tenant_id', 'processor', 'merchant_id', 'fiserv_configured', 'status']).execute();
    const hw = await this.db.selectFrom('tenant_hardware_payoff')
      .select(['tenant_id', 'total_cents', 'remaining_cents', 'status']).execute();

    // latest subscription per tenant
    const latestSub = new Map<string, { plan: string; status: string; cpe: any }>();
    const subTs = new Map<string, number>();
    for (const s of subs as any[]) {
      const ts = new Date(s.created_at as any).getTime();
      if (!subTs.has(s.tenant_id) || ts >= (subTs.get(s.tenant_id) as number)) {
        latestSub.set(s.tenant_id, { plan: s.plan, status: s.status, cpe: s.current_period_end });
        subTs.set(s.tenant_id, ts);
      }
    }
    const payByTenant = new Map<string, any>(); for (const p of pay as any[]) payByTenant.set(p.tenant_id, p);
    const hwByTenant = new Map<string, any>(); for (const h of hw as any[]) hwByTenant.set(h.tenant_id, h);

    return (tenants as any[]).map((t) => {
      const s = latestSub.get(t.id);
      const p = payByTenant.get(t.id);
      const h = hwByTenant.get(t.id);
      const subStatus = (s && SUB.has(s.status) ? s.status : 'none') as SubscriptionStatus;
      const payStatus = (p && PAY.has(p.status) ? p.status : 'none') as PaymentConfigStatus;
      const hwStatus = (h && HW.has(h.status) ? h.status : 'none') as HardwareStatus;
      const mid: string | null = p?.merchant_id ?? null;
      const cpe = s?.cpe ?? null;
      return {
        tenantId: t.id,
        tenantName: t.display_name,
        tenantStatus: t.status,
        plan: s?.plan ?? 'Trial',
        subscriptionStatus: subStatus,
        currentPeriodEnd: cpe ? new Date(cpe).toISOString() : null,
        processor: p?.processor ?? 'none',
        merchantIdLast4: mid && mid.length >= 4 ? mid.slice(-4) : (mid ? mid : null),
        paymentConfigured: !!p?.fiserv_configured,
        paymentStatus: payStatus,
        hardwareTotalCents: Number(h?.total_cents ?? 0),
        hardwareRemainingCents: Number(h?.remaining_cents ?? 0),
        hardwareStatus: hwStatus,
      } as BillingFact;
    });
  }

  async getPlanPrices(): Promise<Record<string, number>> { return planPricesFromEnv(); }

  async updateSubscription(tenantId: string, patch: SubscriptionUpdate, actor?: AuditActor): Promise<boolean> {
    const tenant = await this.db.selectFrom('tenants').select('id').where('id', '=', tenantId).executeTakeFirst();
    if (!tenant) return false;

    const latest = await this.db.selectFrom('tenant_subscriptions').select(['id', 'status'])
      .where('tenant_id', '=', tenantId).orderBy('created_at', 'desc').limit(1).executeTakeFirst();

    if (latest) {
      const set: Record<string, unknown> = { updated_at: new Date() };
      if (patch.plan !== undefined) set.plan = patch.plan;
      // Phase 12 (#27): a status edit is a TENANT_SUBSCRIPTION move (re-saving the same status is not a move), conditional
      // on the status read above so a renewal / cancel that landed meanwhile is not silently overwritten
      const from = String(latest.status);
      const moves = patch.status !== undefined && patch.status !== from;
      if (moves) { assertTransition(TENANT_SUBSCRIPTION, from, patch.status as string); set.status = patch.status; }
      const r = await this.db.updateTable('tenant_subscriptions').set(set).where('id', '=', latest.id).where('status', '=', from).executeTakeFirst();
      if (moves && !Number(r.numUpdatedRows ?? 0)) throw new InvalidStateTransitionError(TENANT_SUBSCRIPTION, null, patch.status as string, 'concurrent');
    } else {
      // No subscription row yet — create one. Sensible defaults for whichever field wasn't provided.
      await this.db.insertInto('tenant_subscriptions').values({
        tenant_id: tenantId,
        plan: patch.plan ?? 'Trial',
        status: patch.status ?? 'trialing',
      }).execute();
    }

    // Audit (raw SQL so we don't need audit_logs in the typed registry). entity_type 'subscription' distinguishes this
    // from tenant-account actions written by the tenants module.
    await sql`INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              VALUES (${tenantId}, ${actor?.userId ?? null}, ${actor?.role ?? null}, 'super_admin_subscription_updated',
                      'subscription', ${tenantId}, ${JSON.stringify(patch)}::jsonb)`.execute(this.db);
    return true;
  }
}
