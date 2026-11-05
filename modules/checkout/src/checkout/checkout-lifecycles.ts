// checkout-lifecycles.ts — BUILD_PLAN Phase 12 (#27): checkout-owned lifecycles as state machines (the payment attempt has
// its own file, payment-attempt-machine.ts).
import { defineStateMachine } from '@aipowersalon/database';

/** loyalty_redemptions.status — defined with the loyalty ledger in @aipowersalon/customers (one machine per lifecycle,
 *  shared by both writers: checkout's apply / release / settle and the Loyalty & Rewards void). Re-exported here so the
 *  checkout code keeps importing it from its lifecycles file. */
export { LOYALTY_REDEMPTION } from '@aipowersalon/customers';

/** cash_drawer_sessions.status — a register's day: opened (the float can be re-set, and a cancelled day reopened), then
 *  counted: reconciled when the count matches, discrepancy when it does not; a recount may flip between the two. The
 *  repository's upserts carry canMoveToSql(CASH_DRAWER_SESSION, to) — exactly the moves they have always made (re-opening
 *  a counted drawer keeps its result; nothing writes 'cancelled' today). */
export const CASH_DRAWER_SESSION = defineStateMachine({
  name: 'cash_drawer_session', table: 'cash_drawer_sessions', column: 'status',
  states: ['open', 'reconciled', 'discrepancy', 'cancelled'],
  transitions: { open: ['open', 'reconciled', 'discrepancy'], reconciled: ['reconciled', 'discrepancy'], discrepancy: ['reconciled', 'discrepancy'], cancelled: ['open', 'reconciled', 'discrepancy'] },
  initial: ['open', 'reconciled', 'discrepancy'],
});

/** payment_refunds.status — a refund is reserved (or pending / processing) until the processor answers: refunded, failed,
 *  cancelled or voided; a finished refund is never re-opened. */
/** payment_refunds.status — defined in @aipowersalon/payments (the gateway webhook moves it too); re-exported here. */
export { PAYMENT_REFUND } from '@aipowersalon/payments';

/** mobile_pay_devices.status — a Tap-to-Pay phone registers pending; a manager approves (active) or revokes it, and may
 *  re-approve a revoked one. A device can never self-approve (re-registering does not touch the status). */
export const MOBILE_PAY_DEVICE = defineStateMachine({
  name: 'mobile_pay_device', table: 'mobile_pay_devices', column: 'status',
  // Owner & Manager Payment App mandate §13 (migration 660): 'compromised' (risk signal / attestation failure — needs
  // re-registration, never re-activated in place) and 'disabled' (owner switched it off; may be re-activated).
  states: ['pending', 'active', 'revoked', 'compromised', 'disabled'],
  transitions: {
    pending: ['pending', 'active', 'revoked', 'compromised', 'disabled'],
    active: ['active', 'pending', 'revoked', 'compromised', 'disabled'],   // → pending: reassigned to another user (§17), approved again
    revoked: ['revoked'],   // Secure Tap to Pay §18 (Oct 23 2026): revoked is final — a found or replacement phone registers as a new device
    compromised: ['compromised', 'revoked'],
    disabled: ['disabled', 'pending', 'active', 'revoked', 'compromised'],
  },
  initial: ['pending'],
});

/** mobile_pay_devices.attestation_status — Secure Tap to Pay §5 (Oct 26 2026): the last VERIFIED attestation verdict. 'none' until
 *  a verifier checked the phone; a new verdict replaces the old one; it never goes back to 'none' (an unverifiable attempt
 *  stores nothing). An integrity signal, never the only control. */
export const MOBILE_PAY_DEVICE_ATTESTATION = defineStateMachine({
  name: 'mobile_pay_device_attestation', table: 'mobile_pay_devices', column: 'attestation_status',
  states: ['none', 'passed', 'failed'],
  transitions: { none: ['none', 'passed', 'failed'], passed: ['passed', 'failed'], failed: ['failed', 'passed'] },
  initial: ['none'],
});

/** tenant_tap_to_pay_onboarding.apple_entitlement_status — the platform's record of Apple's answer (an admin form). */
export const TTP_APPLE_ENTITLEMENT = defineStateMachine({
  name: 'ttp_apple_entitlement', table: 'tenant_tap_to_pay_onboarding', column: 'apple_entitlement_status',
  states: ['not_started', 'requested', 'approved', 'rejected'],
  transitions: { not_started: ['not_started', 'requested', 'approved', 'rejected'], requested: ['not_started', 'requested', 'approved', 'rejected'], approved: ['not_started', 'requested', 'approved', 'rejected'], rejected: ['not_started', 'requested', 'approved', 'rejected'] },
  initial: ['not_started', 'requested'],
});

/** tenant_tap_to_pay_onboarding.commercehub_status — the platform's record of the processor onboarding (an admin form). */
export const TTP_COMMERCEHUB = defineStateMachine({
  name: 'ttp_commercehub', table: 'tenant_tap_to_pay_onboarding', column: 'commercehub_status',
  states: ['not_started', 'onboarding', 'active', 'suspended'],
  transitions: { not_started: ['not_started', 'onboarding', 'active', 'suspended'], onboarding: ['not_started', 'onboarding', 'active', 'suspended'], active: ['not_started', 'onboarding', 'active', 'suspended'], suspended: ['not_started', 'onboarding', 'active', 'suspended'] },
  initial: ['not_started', 'onboarding'],
});

/** payment_intents.status — a skip-the-line payment: sent to the customer, charged (processing → succeeded / failed, a
 *  failed charge may be retried) or paid in cash to the technician (pending → confirmed / an issue for the front desk).
 *  SUCCEEDED / CASH CONFIRMED / CANCELLED / EXPIRED are final — re-processing a succeeded intent (a second charge) is
 *  refused. */
export const PAYMENT_INTENT = defineStateMachine({
  name: 'payment_intent', table: 'payment_intents', column: 'status',
  states: ['created', 'sent_to_customer', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'cash_pending_tech_confirmation', 'cash_confirmed_by_tech', 'cash_issue_needs_front_desk'],
  transitions: {
    created: ['sent_to_customer', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'cash_pending_tech_confirmation'],
    sent_to_customer: ['requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'expired', 'cash_pending_tech_confirmation'],
    requires_action: ['processing', 'succeeded', 'failed', 'cancelled', 'expired'],
    processing: ['processing', 'succeeded', 'failed', 'cancelled'],
    failed: ['processing', 'failed', 'cancelled'],
    cash_pending_tech_confirmation: ['cash_confirmed_by_tech', 'cash_issue_needs_front_desk', 'cancelled'],
    cash_issue_needs_front_desk: ['cash_confirmed_by_tech', 'cash_pending_tech_confirmation', 'cash_issue_needs_front_desk', 'cancelled'],
  },
  initial: ['created', 'sent_to_customer', 'cash_pending_tech_confirmation'],
});

/** cash_payment_confirmations.status — the technician confirms the cash (or reports the customer did not pay); a manager
 *  review decides a disputed one; a confirmed one is final. */
export const CASH_PAYMENT_CONFIRMATION = defineStateMachine({
  name: 'cash_payment_confirmation', table: 'cash_payment_confirmations', column: 'status',
  states: ['pending', 'confirmed', 'customer_did_not_pay', 'manager_review', 'cancelled'],
  transitions: {
    pending: ['confirmed', 'customer_did_not_pay', 'manager_review', 'cancelled'],
    manager_review: ['confirmed', 'customer_did_not_pay', 'cancelled'],
    customer_did_not_pay: ['customer_did_not_pay', 'confirmed', 'manager_review', 'cancelled'],
  },
  initial: ['pending'],
});

/** ai_checkout_upsell_recommendations.status — a generated / displayed suggestion is applied or dismissed once. */
export const UPSELL_RECOMMENDATION = defineStateMachine({
  name: 'ai_checkout_upsell_recommendation', table: 'ai_checkout_upsell_recommendations', column: 'status',
  states: ['GENERATED', 'DISPLAYED', 'ACCEPTED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'FAILED', 'INELIGIBLE', 'OUT_OF_STOCK'],
  transitions: { GENERATED: ['DISPLAYED', 'ACCEPTED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'FAILED', 'INELIGIBLE', 'OUT_OF_STOCK'], DISPLAYED: ['ACCEPTED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'FAILED', 'INELIGIBLE', 'OUT_OF_STOCK'], ACCEPTED: ['APPLIED', 'FAILED'] },
  initial: ['GENERATED'],
});

/** tickets.checkout_status — Round 2 C (Oct 12 2026, migration 572): the ticket's place on the checkout board while it
 *  is UNPAID, stored on the row so every API replica sees the same thing (it was a per-process Map). PAID is not a state
 *  here: tickets.status = 'paid' is the paid fact and wins on the board. NULL (a legacy / untouched row) reads as its
 *  tickets.status mapping and may move to any state but out of a payment. Every board move the POS has always made is
 *  listed; the one refusal is the reopen rule (canReopenService): a payment in progress cannot be reopened. Writers also
 *  condition on tickets.status <> 'paid' — a stale replica never writes a board state over a paid ticket. */
export const TICKET_CHECKOUT = defineStateMachine({
  name: 'ticket_checkout', table: 'tickets', column: 'checkout_status',
  states: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'failed', 'reopened'],
  transitions: {
    ready_for_payment: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'failed', 'reopened'],
    sent_to_customer_display: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'failed', 'reopened'],
    payment_in_progress: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'failed'],
    failed: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'failed', 'reopened'],
    reopened: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'failed', 'reopened'],
  },
  initial: ['ready_for_payment'],
});

/** G4 Split Tips (Nov 5 2026, migration 817): the customer's per-technician tip selection. A save always writes the
 *  draft / confirmed state (re-entry allowed until payment starts); payment LOCKS it; a decline unlocks to CONFIRMED;
 *  a front-desk total change or a performer change SUPERSEDES it (a new save starts again). */
export const CHECKOUT_TIP_SELECTION = defineStateMachine({
  name: 'checkout_tip_selection', table: 'checkout_tip_selections', column: 'state',
  states: ['DRAFT', 'CONFIRMED', 'LOCKED', 'SUPERSEDED'],
  transitions: {
    DRAFT: ['DRAFT', 'CONFIRMED', 'SUPERSEDED'],
    CONFIRMED: ['DRAFT', 'CONFIRMED', 'LOCKED', 'SUPERSEDED'],
    LOCKED: ['LOCKED', 'CONFIRMED', 'SUPERSEDED'],
    SUPERSEDED: ['DRAFT', 'CONFIRMED'],
  },
  initial: ['DRAFT', 'CONFIRMED'],
});
