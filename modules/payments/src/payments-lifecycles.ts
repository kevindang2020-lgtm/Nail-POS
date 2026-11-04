// payments-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the payments lifecycles as state machines (ONE per table.column;
// checkout and super-admin import them from @aipowersalon/payments).
import { defineStateMachine } from '@aipowersalon/database';

const AUTHORISED = ['approved', 'captured', 'completed', 'succeeded', 'partial'] as const;
const AFTER_AUTH = [...AUTHORISED, 'settled', 'voided', 'refunded', 'partially_refunded'] as const;
/** payments.status — a charge is in flight (created / pending / processing / open / requires action), then authorised
 *  or declined / failed / cancelled / expired; an authorised charge settles, is voided or refunded. REFUNDED / VOIDED /
 *  DECLINED / FAILED are final: a late or out-of-order processor callback ("settled" after a refund) used to overwrite a
 *  refunded or voided payment back to settled — refused now (the row keeps its state). */
export const PAYMENT = defineStateMachine({
  name: 'payment', table: 'payments', column: 'status',
  states: ['created', 'pending', 'processing', 'open', 'requires_action', 'approved', 'captured', 'completed', 'succeeded', 'partial', 'settled', 'partially_refunded', 'refunded', 'voided', 'declined', 'failed', 'cancelled', 'expired', 'not_configured'],
  transitions: {
    created: ['processing', 'requires_action', ...AFTER_AUTH, 'declined', 'failed', 'cancelled', 'expired', 'not_configured'],
    pending: ['processing', 'requires_action', ...AFTER_AUTH, 'declined', 'failed', 'cancelled', 'expired', 'not_configured'],
    processing: ['processing', 'requires_action', ...AFTER_AUTH, 'declined', 'failed', 'cancelled', 'expired', 'not_configured'],
    open: ['processing', 'requires_action', ...AFTER_AUTH, 'declined', 'failed', 'cancelled', 'expired'],
    requires_action: ['processing', 'requires_action', ...AFTER_AUTH, 'declined', 'failed', 'cancelled', 'expired'],
    approved: [...AFTER_AUTH], captured: [...AFTER_AUTH], completed: [...AFTER_AUTH], succeeded: [...AFTER_AUTH], partial: [...AFTER_AUTH],
    settled: ['settled', 'voided', 'refunded', 'partially_refunded'],
    partially_refunded: ['partially_refunded', 'refunded', 'voided'],
    refunded: ['refunded'], voided: ['voided'],
  },
  initial: ['created', 'pending', 'processing', 'approved', 'completed', 'settled'],
});

const CB_OPEN = ['open', 'needs_response', 'needs_evidence', 'evidence_collecting', 'under_review', 'submitted', 'escalated', 'reopened'] as const;
const CB_DECIDED = ['won', 'lost', 'refunded', 'expired', 'closed', 'withdrawn', 'cancelled'] as const;
/** chargebacks.status — an open dispute moves freely between its working states until it is decided; a decided dispute
 *  can be re-decided by the processor or reopened, but a late "needs response" never silently re-opens it. */
export const CHARGEBACK = defineStateMachine({
  name: 'chargeback', table: 'chargebacks', column: 'status',
  states: ['open', 'needs_response', 'needs_evidence', 'evidence_collecting', 'under_review', 'submitted', 'escalated', 'reopened', 'won', 'lost', 'refunded', 'expired', 'closed', 'withdrawn', 'cancelled'],
  transitions: {
    open: [...CB_OPEN, ...CB_DECIDED], needs_response: [...CB_OPEN, ...CB_DECIDED], needs_evidence: [...CB_OPEN, ...CB_DECIDED],
    evidence_collecting: [...CB_OPEN, ...CB_DECIDED], under_review: [...CB_OPEN, ...CB_DECIDED], submitted: [...CB_OPEN, ...CB_DECIDED],
    escalated: [...CB_OPEN, ...CB_DECIDED], reopened: [...CB_OPEN, ...CB_DECIDED],
    won: ['reopened', ...CB_DECIDED], lost: ['reopened', ...CB_DECIDED], refunded: ['reopened', ...CB_DECIDED], expired: ['reopened', ...CB_DECIDED],
    closed: ['reopened', ...CB_DECIDED], withdrawn: ['reopened', ...CB_DECIDED], cancelled: ['reopened', ...CB_DECIDED],
  },
  initial: ['open', 'needs_response'],
});

/** tenant_payment_config.status — the gateway flag (gatewayStatusTransition's pause / disable / resume, the admin form). */
export const PAYMENT_GATEWAY = defineStateMachine({
  name: 'payment_gateway', table: 'tenant_payment_config', column: 'status',
  states: ['pending', 'active', 'paused', 'disabled', 'error'],
  transitions: {
    pending: ['pending', 'active', 'paused', 'disabled', 'error'], active: ['pending', 'active', 'paused', 'disabled', 'error'],
    paused: ['pending', 'active', 'paused', 'disabled', 'error'], disabled: ['pending', 'active', 'paused', 'disabled', 'error'],
    error: ['pending', 'active', 'paused', 'disabled', 'error'],
  },
  initial: ['pending', 'active'],
});

/** tenant_payment_config.onboarding_status — the merchant application: submitted → under review → approved / declined; a
 *  declined merchant re-applies. A late "submitted" / "received" callback no longer demotes an approved merchant. */
export const MERCHANT_ONBOARDING = defineStateMachine({
  name: 'merchant_onboarding', table: 'tenant_payment_config', column: 'onboarding_status',
  states: ['not_started', 'submitted', 'under_review', 'approved', 'declined'],
  transitions: {
    not_started: ['not_started', 'submitted', 'under_review', 'approved', 'declined'],
    submitted: ['not_started', 'submitted', 'under_review', 'approved', 'declined'],
    under_review: ['under_review', 'approved', 'declined'],
    approved: ['approved', 'under_review', 'declined'],
    declined: ['declined', 'submitted', 'under_review', 'approved'],
  },
  initial: ['not_started', 'submitted'],
});

/** invoices.status — Invoices mandate (Oct 29 2026) §13: draft → sent (issued) or void; sent → partially_paid / paid
 *  (only through posted invoice_payments) or void; partially_paid → paid. Paid and void are FINAL — a correction is a
 *  refund / credit workflow, never a status reset. Overdue is DERIVED (due date passed with a balance), never stored.
 *  (sent → draft, the old "un-send", is gone: an issued invoice has been seen by its customer.) */
export const INVOICE = defineStateMachine({
  name: 'invoice', table: 'invoices', column: 'status',
  states: ['draft', 'sent', 'partially_paid', 'paid', 'credited', 'void'],
  // Invoices guide (Nov 4 2026): an issued invoice is corrected by a credit note (invoice_credits) — 'credited' once credited in full
  transitions: { draft: ['draft', 'sent', 'void'], sent: ['sent', 'partially_paid', 'paid', 'credited', 'void'], partially_paid: ['partially_paid', 'paid', 'credited'], paid: ['paid', 'credited'], credited: ['credited'], void: ['void'] },
  initial: ['draft'],
});

/** bank_accounts.status — AI Deposit Reconciliation mandate (Oct 29 2026) §10: an account is deactivated (it stays on file —
 *  historical deposits reference it) and may be re-activated. A label change is not a payout-destination change. */
export const BANK_ACCOUNT = defineStateMachine({
  name: 'bank_account', table: 'bank_accounts', column: 'status',
  states: ['active', 'inactive'],
  transitions: { active: ['inactive'], inactive: ['active'] },
  initial: ['active'],
});

/** reconciliation_exceptions.status — the TRANSITIONS table deposit-reconciliation.exceptions.ts has always validated
 *  (plus the assign move open → in_review). */
export const RECONCILIATION_EXCEPTION = defineStateMachine({
  name: 'reconciliation_exception', table: 'reconciliation_exceptions', column: 'status',
  states: ['open', 'in_review', 'escalated', 'resolved', 'reopened'],
  transitions: { open: ['in_review', 'escalated', 'resolved'], in_review: ['open', 'escalated', 'resolved'], escalated: ['in_review', 'resolved'], resolved: ['reopened'], reopened: ['in_review', 'escalated', 'resolved'] },
  initial: ['open'],
});

/** reconciliation_periods.status — open ↔ closed (close once; reopen a closed period). */
export const RECONCILIATION_PERIOD = defineStateMachine({
  name: 'reconciliation_period', table: 'reconciliation_periods', column: 'status',
  states: ['open', 'closed'],
  transitions: { open: ['closed'], closed: ['open'] },
  initial: ['open'],
});

/** wallet_topup_intents.status — Remaining-work mandate P1-1 / B-79 (Oct 23 2026, migration 679). A top-up is CREATED,
 *  then PROCESSING while the card is at the processor; the answer settles it (APPROVED / DECLINED / FAILED = the host
 *  charged nothing) or leaves it UNKNOWN (lost / unsettled answer) for Verify / the stranded sweep. Only a FAILED intent
 *  may be charged again (nothing was charged); APPROVED, DECLINED and CANCELED are final, so a late answer can never
 *  re-open a credited top-up. */
export const WALLET_TOPUP_INTENT = defineStateMachine({
  name: 'wallet_topup_intent', table: 'wallet_topup_intents', column: 'status',
  states: ['CREATED', 'PROCESSING', 'APPROVED', 'DECLINED', 'UNKNOWN', 'FAILED', 'CANCELED'],
  transitions: {
    CREATED: ['PROCESSING', 'CANCELED'],
    PROCESSING: ['APPROVED', 'DECLINED', 'FAILED', 'UNKNOWN'],
    UNKNOWN: ['APPROVED', 'DECLINED', 'FAILED'],
    FAILED: ['PROCESSING', 'CANCELED'],
  },
  initial: ['CREATED'],
});

