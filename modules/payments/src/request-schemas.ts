// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the payments module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from each handler / service (the fields read) and from the clients that call the
// routes today: customer-web (customerApi addPaymentMethod / topUp), owner-web (hardware payment method + autopay
// consent), pos-web (posInvoicesApi, posDepositReconApi). Raw card data (pan / cardNumber / cvv) is REFUSED, never
// silently dropped — the services refuse it too, and stripping it would have turned that refusal into an accept.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
const num: BodySchema = { type: ['number', 'string', 'null'], maxLength: 16 };
const RAW_CARD = ['pan', 'cardNumber', 'card_number', 'cvv', 'cvc', 'securityCode', 'track1', 'track2'];
const MONEY = ['status', 'state', 'capturedCents', 'refundedCents', ...RAW_CARD];

/** POST /customer/payment-methods — { token, brand, last4, expMonth, expYear, isDefault } (a provider TOKEN only). The
 *  expiry is bounded loosely on purpose: customer-web PayScreen sends parseInt of a typed 'MM/YY', i.e. a 2-digit year. */
export const ADD_CUSTOMER_PAYMENT_METHOD_BODY: BodySchema = S.object({
  token: scalar(4096), brand: str(32), last4: scalar(4), expMonth: S.nullable(S.integer({ minimum: 0, maximum: 99 })), expYear: S.nullable(S.integer({ minimum: 0, maximum: 9999 })), isDefault: S.nullable(S.boolean()),
  cardholderName: str(200), zipCode: str(32), cardType: str(32),
}, [], { 'x-forbidden': RAW_CARD });
/** POST /customer/wallet/top-up — { amountCents, paymentMethodId } */
export const WALLET_TOP_UP_BODY: BodySchema = S.object({ amountCents: S.nullable(S.number()), paymentMethodId: scalar(64) }, [], { 'x-forbidden': MONEY });
/** POST /owner/hardware-payment/payment-method — { gatewayPaymentMethodToken | token, brand, last4, expMonth, expYear } */
export const HARDWARE_PAYMENT_METHOD_BODY: BodySchema = S.object({
  gatewayPaymentMethodToken: scalar(4096), token: scalar(4096), gatewayCustomerId: str(200), brand: str(32), last4: scalar(4),
  expMonth: S.nullable(S.integer({ minimum: 0, maximum: 99 })), expYear: S.nullable(S.integer({ minimum: 0, maximum: 9999 })),
}, [], { 'x-forbidden': RAW_CARD });
/** POST /owner/hardware-payment/autopay-consent — { planId } */
export const AUTOPAY_CONSENT_BODY: BodySchema = S.object({ planId: scalar(64) });
/** POST /pos/invoices — { customerId, dueDate, notes, taxCents, lines[{ description, quantity, unitPriceCents }] } */
export const CREATE_INVOICE_BODY: BodySchema = S.object({
  customerId: str(64), dueDate: str(32), notes: str(5000), taxCents: num,
  lines: S.nullable(S.array(S.object({ description: str(500), quantity: num, unitPriceCents: num }), { maxItems: 500 })),
}, [], { 'x-forbidden': MONEY });
/** POST /pos/invoices/:id/status — { status } (the status IS this route's input; the service checks the transition) */
export const INVOICE_STATUS_BODY: BodySchema = S.object({ status: scalar(32) });
// ── deposit reconciliation (pos-web posDepositReconApi) ────────────────────────────────────────────────────────────
export const BANK_ACCOUNT_BODY: BodySchema = S.object({ nickname: str(120), bankName: str(120), accountType: str(32), accountLast4: scalar(4), currency: str(3) }, [], { 'x-forbidden': ['accountNumber', 'routingNumber', 'account_number', 'routing_number'] });
export const DEPOSIT_BODY: BodySchema = S.object({
  bankAccountId: scalar(64), branchId: str(64), amountCents: num, currency: str(3), depositDate: str(32), description: str(1000), reference: str(200), externalBankTxnId: str(200), source: str(32),
}, [], { 'x-forbidden': MONEY });
export const DEPOSIT_LINK_BODY: BodySchema = S.object({ settlementId: str(64) });
export const FEE_SCHEDULE_BODY: BodySchema = S.object({
  processorType: str(40), label: str(120), effectiveFrom: str(32), percentageBps: num, perTransactionCents: num, batchCents: num, monthlyCents: num, notes: str(2000),
});
export const RECON_EXCEPTION_BODY: BodySchema = S.object({
  kind: str(40), severity: str(16), title: str(300), detail: str(5000), amountCents: num, currency: str(3), sourceRef: str(200), branchId: str(64),
});
export const RECON_ASSIGN_BODY: BodySchema = S.object({ assigneeUserId: str(64) });
/** the exception queue's own lifecycle — the status IS the input; the service's state machine decides */
export const RECON_TRANSITION_BODY: BodySchema = S.object({ status: str(32) });
export const RECON_NOTE_BODY: BodySchema = S.object({ note: str(5000) });
export const RECON_PERIOD_BODY: BodySchema = S.object({ label: str(120), periodStart: str(32), periodEnd: str(32), notes: str(5000) });
export const RECON_PERIOD_CLOSE_BODY: BodySchema = S.object({ notes: str(5000) });

// ── Phase 12 round 2: the hardware payment program (admin-web HardwarePaymentsScreen + the monthly cron) ──────────────
// Super Admin owns a plan's status here (create / edit; pause / resume move it through their own routes) — declared.
const flag: BodySchema = S.nullable(S.boolean());
const cents: BodySchema = S.nullable(S.integer({ minimum: 0 }));
const month: BodySchema = { type: ['string', 'null'], maxLength: 7 };
const plan = {
  branchId: str(64), hardwarePackageId: str(64), status: str(16), totalHardwareCostCents: cents, downPaymentCents: cents, financedAmountCents: cents,
  monthlyPaymentCents: cents, remainingBalanceCents: cents, startDate: str(32), endDate: str(32), dueDayOfMonth: S.nullable(S.integer({ minimum: 1, maximum: 31 })),
  revenueSplitRecoveryEnabled: flag, autoChargeShortfallEnabled: flag, extraCreditHandling: str(32), savedPaymentMethodId: str(64),
};
export const HW_PLAN_CREATE_BODY: BodySchema = S.object(plan, [], { 'x-forbidden': RAW_CARD });
export const HW_PLAN_UPDATE_BODY: BodySchema = S.object(plan, [], { 'x-forbidden': RAW_CARD });
const split = { pricingRateBps: num, expenseRateBps: num, netMarginBps: num, platformSharePercent: num, fiservSharePercent: num, salonHardwareCreditPercentOfPlatformShare: num };
export const HW_SETTINGS_BODY: BodySchema = S.object(split);
export const HW_MONTH_PLAN_BODY: BodySchema = S.object({ planId: scalar(64), billingMonth: month, cardVolumeCents: num });
export const HW_IMPORT_VOLUME_BODY: BodySchema = S.object({ billingMonth: month, cardVolumeCents: num, source: str(32) });
export const HW_RUN_MONTHLY_BODY: BodySchema = S.object({ billingMonth: month });
export const HW_PLAN_ID_BODY: BodySchema = S.object({ planId: scalar(64) });
