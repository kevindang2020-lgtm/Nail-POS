// request-schemas.ts — the finance module's request bodies (BUILD_PLAN Phase 12 #17), applied with @Body(ValidatedBody(…)).
// Money is integer cents; dates YYYY-MM-DD; unknown fields are stripped; tenantId / status / approvedBy are refused — a
// status moves only through its own route and state machine, the salon comes from the session.
import { S, type BodySchema } from '@aipowersalon/permissions';

const txt = (max = 200): BodySchema => S.nullable(S.text(max));
const cents: BodySchema = S.nullable(S.cents({ maximum: 10_000_000_000 }));
const date: BodySchema = S.nullable(S.date());
const NO_STATE = { 'x-forbidden': ['tenantId', 'status', 'approvedBy', 'approvedAt', 'billStatus', 'paidCents', 'reimbursementStatus', 'duplicateStatus', 'version_'] } as const;
const PAYMENT = S.nullable(S.enumOf(['business_card', 'cash', 'check', 'ach', 'bank_transfer', 'personal_card', 'other']));
const LINE: BodySchema = S.object({ description: S.text(300), quantity: S.nullable(S.number({ minimum: 0, maximum: 1_000_000 })), unitPriceCents: S.nullable(S.integer()), totalCents: S.integer(), categoryKey: txt(40), confidence: S.nullable(S.number({ minimum: 0, maximum: 1 })) }, ['description', 'totalCents']);
const ALLOC: BodySchema = S.object({ branchId: S.uuid(), amountCents: cents, basisPoints: S.nullable(S.integer({ minimum: 0, maximum: 10000 })) }, ['branchId']);

const EXPENSE_FIELDS: Record<string, BodySchema> = {
  kind: S.nullable(S.enumOf(['expense', 'bill'])), category: txt(60), amountCents: cents, subtotalCents: cents, taxCents: cents, tipCents: cents, feeCents: cents, discountCents: cents,
  incurredOn: date, vendor: txt(200), vendorId: S.nullable(S.uuid()), description: txt(1000), branchId: S.nullable(S.uuid()), paymentMethod: PAYMENT,
  cardBrand: txt(20), cardLast4: S.nullable(S.string({ pattern: '^[0-9]{4}$' })), receiptNumber: txt(80), invoiceNumber: txt(80), referenceNumber: txt(80), dueDate: date,
  recurring: S.nullable(S.boolean()), reimburse: S.nullable(S.boolean()), lineItems: S.nullable(S.array(LINE, { maxItems: 200 })), allocations: S.nullable(S.array(ALLOC, { maxItems: 50 })),
  receiptDocumentId: S.nullable(S.uuid()), accountantNote: txt(2000), taxReviewStatus: S.nullable(S.enumOf(['not_reviewed', 'reviewed', 'question'])),
};
export const FIN_EXPENSE_CREATE_BODY: BodySchema = S.object({ ...EXPENSE_FIELDS, intent: S.nullable(S.enumOf(['draft', 'submit', 'approve'])), duplicateOverrideReason: txt(500), idempotencyKey: txt(120) }, ['amountCents', 'incurredOn'], NO_STATE);
export const FIN_EXPENSE_UPDATE_BODY: BodySchema = S.object({ ...EXPENSE_FIELDS, version: S.integer({ minimum: 1 }), reason: txt(500) }, ['version'], NO_STATE);
export const FIN_VERSION_BODY: BodySchema = S.object({ version: S.nullable(S.integer({ minimum: 1 })) });
export const FIN_REASON_BODY: BodySchema = S.object({ reason: S.text(500), version: S.nullable(S.integer({ minimum: 1 })) }, ['reason']);
export const FIN_DUPLICATE_BODY: BodySchema = S.object({ decision: S.enumOf(['not_duplicate', 'duplicate']), reason: S.text(500) }, ['decision', 'reason']);
export const FIN_BILL_PAYMENT_BODY: BodySchema = S.object({ amountCents: S.cents({ minimum: 1, maximum: 10_000_000_000 }), paidOn: date, paymentMethod: PAYMENT, reference: txt(80), idempotencyKey: txt(120) }, ['amountCents']);
export const FIN_REIMBURSEMENT_BODY: BodySchema = S.object({ action: S.enumOf(['request', 'approve', 'pay', 'reject', 'cancel']), reason: txt(500) }, ['action']);
export const FIN_ATTACH_BODY: BodySchema = S.object({ documentId: S.uuid(), role: S.nullable(S.enumOf(['receipt', 'invoice', 'supporting', 'replacement'])) }, ['documentId']);
export const FIN_IDS_BODY: BodySchema = S.object({ ids: S.array(S.uuid(), { minItems: 1, maxItems: 200 }), categoryKey: txt(60), threshold: S.nullable(S.number({ minimum: 0.5, maximum: 1 })) }, ['ids']);
export const FIN_CATEGORY_BODY: BodySchema = S.object({ label: txt(60), accountingCode: txt(60), active: S.nullable(S.boolean()) });
export const FIN_RULE_BODY: BodySchema = S.object({ vendor: S.text(200), categoryKey: S.text(60), keyword: txt(60), vendorId: S.nullable(S.uuid()) }, ['vendor', 'categoryKey']);
export const FIN_RULE_PREVIEW_BODY: BodySchema = S.object({ vendor: S.text(200), categoryKey: S.text(60) }, ['vendor', 'categoryKey']);
export const FIN_SETTINGS_BODY: BodySchema = S.object({
  requireApproval: S.nullable(S.boolean()), autoReady: S.nullable(S.boolean()), autoCategory: S.nullable(S.boolean()), learnFromCorrections: S.nullable(S.boolean()), duplicateDetection: S.nullable(S.boolean()),
  billReminderDays: S.nullable(S.integer({ minimum: 0, maximum: 60 })), defaultBranchId: S.nullable(S.uuid()), receptionistUpload: S.nullable(S.boolean()), technicianUpload: S.nullable(S.boolean()),
  // §177 / §83 (Oct 27 2026): notification preferences and the owner's low-risk auto-approval rules
  notifyNeedsReview: S.nullable(S.boolean()), notifyBillDue: S.nullable(S.boolean()), notifyDuplicate: S.nullable(S.boolean()), notifyWeeklySummary: S.nullable(S.boolean()), notifyMonthlySummary: S.nullable(S.boolean()),
  autoApprovalRules: S.nullable(S.array(S.object({ vendor: S.text(200), maxCents: S.integer({ minimum: 1, maximum: 10_000_000 }), categoryKey: txt(60), enabled: S.nullable(S.boolean()) }, ['vendor', 'maxCents']), { maxItems: 100 })),
  sharedCostPolicy: S.nullable(S.enumOf(['NONE', 'MANUAL_PERCENTAGE'])), sharedCostShares: S.nullable(S.array(S.object({ branchId: S.uuid(), basisPoints: S.integer({ minimum: 0, maximum: 10000 }) }, ['branchId', 'basisPoints']), { maxItems: 50 })),   // P2-3
  version: S.nullable(S.integer({ minimum: 0 })),
});
export const FIN_DUP_CHECK_BODY: BodySchema = S.object({ vendor: txt(200), vendorId: S.nullable(S.uuid()), incurredOn: S.date(), amountCents: S.cents(), invoiceNumber: txt(80), receiptNumber: txt(80), excludeId: S.nullable(S.uuid()) }, ['incurredOn', 'amountCents']);
export const FIN_RECOMMEND_BODY: BodySchema = S.object({ vendor: txt(200), lines: S.nullable(S.array(S.text(300), { maxItems: 50 })) });
export const FIN_IMPORT_BODY: BodySchema = S.object({
  rows: S.array(S.object({ date: txt(20), vendor: txt(200), amount: S.oneOfTypes(['string', 'number', 'null'], { maxLength: 20 }), category: txt(60), branch: txt(120), description: txt(1000) }), { maxItems: 2000 }),
  dryRun: S.nullable(S.boolean()),
}, ['rows']);
/** §62/§63: a person links / clears the payment behind an expense */
export const FIN_PAYMENT_LINK_BODY: BodySchema = S.object({ decision: S.enumOf(['confirm', 'clear']), paymentRef: txt(120), version: S.nullable(S.integer({ minimum: 0 })) }, ['decision']);
