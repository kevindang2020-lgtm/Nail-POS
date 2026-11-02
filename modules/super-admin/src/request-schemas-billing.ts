// request-schemas-billing.ts — BUILD_PLAN Phase 12 (#17): super-admin platform billing (invoices, credits, payment
// retry, subscription lifecycle, discounts, exports, the provider-webhook ingest, the cycle run). Clients: admin-web
// superAdminBillingApi.ts + superAdminApi.ts (updateSubscription); fields from billing.kysely.repository.ts. Money is
// integer cents (lines are Math.round()-ed by the repository, so a client's whole-number cents pass); a client may
// never set an invoice / payment status on a money body.
import { S, cents, flag, id, money, num, numish, obj, str, type BodySchema } from './request-schemas-fields';

const line: BodySchema = money({ kind: str(40), description: str(500), quantity: S.nullable(S.number({ minimum: 0 })), unitPriceCents: S.nullable(S.number({ minimum: 0 })) });
export const BILL_CREATE_INVOICE_BODY: BodySchema = money({
  tenantId: id, planCode: str(60), currency: str(3), lines: S.nullable(S.array(line, { maxItems: 200 })),
  discountCents: cents, creditCents: cents, taxCents: cents, dueDate: str(40), periodStart: str(40), periodEnd: str(40),
});
export const BILL_APPLY_CREDIT_BODY: BodySchema = money({ creditId: id, invoiceNumber: str(60), amountCents: cents });
export const BILL_RETRY_PAYMENT_BODY: BodySchema = money({ invoiceNumber: str(60), idempotencyKey: str(200) });
export const BILL_CHANGE_PLAN_BODY: BodySchema = obj({ tenantId: id, toPlanCode: str(60), strategy: str(40), preview: flag });
export const BILL_ADD_ON_BODY: BodySchema = obj({ tenantId: id, addOnCode: str(60), action: str(10), quantity: num });
export const BILL_EXTEND_TRIAL_BODY: BodySchema = obj({ tenantId: id, days: numish });
export const BILL_DISCOUNT_BODY: BodySchema = money({ tenantId: id, code: str(60), discountType: str(10), percent: num, amountCents: cents, appliesTo: str(60), cycles: num });
export const BILL_PAUSE_BODY: BodySchema = obj({ tenantId: id, resumeDate: str(40), reason: str(2000), preview: flag });
export const BILL_RESUME_BODY: BodySchema = obj({ tenantId: id });
export const BILL_CANCEL_BODY: BodySchema = obj({ tenantId: id, strategy: str(40), reason: str(2000), preview: flag });
/** `status` here is a FILTER on the exported rows (not a write) */
export const BILL_EXPORT_JOB_BODY: BodySchema = obj({ report: str(80), format: str(10), tenantId: id, status: str(30) });
export const BILL_EXPORT_BODY: BodySchema = obj({ report: str(80), format: str(10), tenantId: id, planCode: str(60), status: str(30) });
export const BILL_PROCESS_JOBS_BODY: BodySchema = obj({ limit: num });
/** the processor event the ingest dedupes on (providerEventId) — other provider fields are not read */
export const BILL_WEBHOOK_INGEST_BODY: BodySchema = obj({ providerEventId: str(200), eventType: str(100), invoiceNumber: str(60) });
export const BILL_REVIEW_REQUEST_BODY: BodySchema = obj({ decision: str(10), note: str(2000) });
/** the subscription plan / lifecycle status an operator sets (validated by the service's own vocabulary) */
export const BILL_SUBSCRIPTION_BODY: BodySchema = obj({ plan: str(60), status: str(30) });
export const BILL_CYCLE_RUN_BODY: BodySchema = obj({ dryRun: flag });
