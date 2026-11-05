// request-schemas-oversight.ts — BUILD_PLAN Phase 12 (#17): super-admin customer-data oversight (identity sync, legal
// holds, imports, deletions), database operations, chargebacks/disputes, gift-card programs + settlement, hardware
// packages. Clients: admin-web superAdminApi.ts (customer data, disputes), superAdminGiftCardProgramsApi.ts,
// superAdminGiftCardSettlementApi.ts, superAdminHardwarePackagesApi.ts (HardwarePackagesScreen); fields from the
// services that read each body.
import { S, cents, centsish, flag, id, ids, money, num, numish, obj, scalar, str, type BodySchema } from './request-schemas-fields';

// ── customer data oversight ───────────────────────────────────────────────────────────────────────────────────────
export const CD_SYNC_MERGE_BODY: BodySchema = obj({ sourceGlobalCustomerId: scalar(128), targetGlobalCustomerId: scalar(128), confirm: flag });
export const CD_CONFLICT_STATUS_BODY: BodySchema = obj({ status: str(30) });
export const CD_SYNC_RUN_BODY: BodySchema = obj({ tenantId: scalar(128), customerId: scalar(128) });
export const CD_LEGAL_HOLD_BODY: BodySchema = obj({ tenantId: id, customerId: id, branchId: id, matterRef: str(200), reason: str(2000), scope: str(40), reviewAt: str(40), internalNotes: str(5000), approvedByUserId: id });
export const CD_RELEASE_HOLD_BODY: BodySchema = obj({ reason: str(2000) });
/** an import job: the CSV rows as parsed objects (the import service validates each row's columns) */
export const CD_IMPORT_BODY: BodySchema = obj({ tenantId: id, branchId: id, source: str(40), filename: str(300), rows: S.nullable(S.array(S.freeObject(), { maxItems: 50000 })) });
export const CD_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const CD_PROCESS_IMPORTS_BODY: BodySchema = obj({ batch: numish });
export const CD_DELETION_BODY: BodySchema = obj({ tenantId: id, customerId: id, reason: str(2000) });
export const CD_EXECUTE_DELETION_BODY: BodySchema = obj({ typedConfirmation: str(300) });

// ── database operations (DbActionRequest) ─────────────────────────────────────────────────────────────────────────
export const DB_ACTION_BODY: BodySchema = obj({ reason: str(2000) });

// ── disputes / chargebacks ────────────────────────────────────────────────────────────────────────────────────────
/** the export's filters (merged with the query string) — every one is a filter value, strings as the list screen sends */
export const DISPUTE_EXPORT_BODY: BodySchema = obj({
  page: numish, pageSize: numish, search: str(200), tenantId: id, branchId: id, reasonCode: str(60), currentStatus: str(40), evidenceStatus: str(40),
  processorDecision: str(40), riskLevel: str(20), processor: str(60), deadlineStart: str(40), deadlineEnd: str(40), amountMinCents: numish, amountMaxCents: numish,
  sort: str(60), direction: str(4), bucket: str(40), columns: { anyOf: [S.text(2000), S.array(S.text(80), { maxItems: 100 }), { type: 'null' }] },
});
export const DISPUTE_FLAG_RISK_BODY: BodySchema = obj({ riskLevel: str(20), riskReason: str(2000), recommendedAction: str(1000), nextReviewAt: str(40), merchantAccountId: id });
export const DISPUTE_REQUEST_EVIDENCE_BODY: BodySchema = obj({ note: str(2000) });
/** evidence upload: base64 content (the service enforces the size / type policy and stores it privately) */
export const DISPUTE_UPLOAD_EVIDENCE_BODY: BodySchema = obj({ evidenceType: str(60), fileName: str(300), mimeType: str(120), sizeBytes: num, contentBase64: str(20_000_000), description: str(2000), source: str(60) });
export const DISPUTE_REVIEW_EVIDENCE_BODY: BodySchema = obj({ decision: str(20), reason: str(2000) });
export const DISPUTE_SUBMIT_BODY: BodySchema = obj({ idempotencyKey: str(200) });
export const DISPUTE_NOTIFY_BODY: BodySchema = obj({ channel: str(20), recipient: str(254), subject: str(300), body: str(10000), idempotencyKey: str(200) });
/** the processor's decision on a chargeback — the resulting dispute status is derived by the service, never sent */
export const DISPUTE_OUTCOME_BODY: BodySchema = money({ result: str(20), fundsRecoveredCents: cents, amountWonCents: cents, amountLostCents: cents, processorFeeCents: cents, decisionReason: str(2000), overrideReason: str(2000) });

// ── gift-card programs + settlement ───────────────────────────────────────────────────────────────────────────────
export const GC_PROGRAM_CREATE_BODY: BodySchema = obj({ name: str(200), ownerTenantId: id, scope: str(30), sharedLiability: flag });
export const GC_PROGRAM_UPDATE_BODY: BodySchema = obj({ name: str(200), scope: str(30), status: str(20), sharedLiability: flag });
export const GC_PROGRAM_MEMBER_BODY: BodySchema = obj({ tenantId: id });
export const GC_MEMBER_STATUS_BODY: BodySchema = obj({ status: str(20) });
/** a settlement batch over clearing entries — the totals are computed server-side, never sent */
export const GC_SETTLEMENT_BATCH_BODY: BodySchema = S.object({ programId: id, entryIds: ids(5000) }, [], { 'x-forbidden': ['status', 'totalCents', 'feeCents', 'netCents'] });
export const GC_SETTLEMENT_STATUS_BODY: BodySchema = obj({ status: str(20) });

// ── hardware packages ─────────────────────────────────────────────────────────────────────────────────────────────
const device: BodySchema = obj({ deviceType: str(60), deviceName: str(200), serialNumber: str(120), assetTag: str(120), quantity: numish });
const shipping = { financingTerms: str(2000), shippingAddress: str(500), shippingCity: str(120), shippingState: str(60), shippingZip: str(20) };
export const HW_CREATE_BODY: BodySchema = obj({
  tenantId: id, applicationId: id, packageName: str(200), packageType: str(40), status: str(40), paymentStatus: str(40),
  hardwareCostCents: centsish, depositCents: centsish, ...shipping, shippingCarrier: str(40), trackingNumber: str(120),
  confirmDuplicate: flag, force: flag, devices: S.nullable(S.array(device, { maxItems: 200 })), notes: str(5000),
});
export const HW_UPDATE_BODY: BodySchema = obj({ packageName: str(200), packageType: str(40), ...shipping, hardwareCostCents: centsish, depositCents: centsish, amountPaidCents: centsish });
/** `{ devices: [...] }` (admin-web) — the handler also accepts a bare device; that form is still a device object */
export const HW_DEVICES_BODY: BodySchema = { anyOf: [obj({ devices: S.array(device, { maxItems: 200 }) }, ['devices']), S.array(device, { maxItems: 200 }), device] };
export const HW_NOTE_BODY: BodySchema = obj({ note: scalar(5000), isInternal: flag });
export const HW_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const HW_STATUS_BODY: BodySchema = obj({ status: scalar(40), force: flag });
export const HW_PAYMENT_STATUS_BODY: BodySchema = obj({ paymentStatus: scalar(40) });
export const HW_TRACKING_BODY: BodySchema = obj({ carrier: str(40), trackingNumber: str(120), trackingUrl: str(1000), shippedDate: str(40), deliveredDate: str(40) });
