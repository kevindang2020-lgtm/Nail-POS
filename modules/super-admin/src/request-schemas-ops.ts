// request-schemas-ops.ts — BUILD_PLAN Phase 12 (#17): super-admin product catalog, promotions, live queue actions,
// report builder, scheduled reports, general settings, settlements, tenant presets, ticket removal. Clients: admin-web
// superAdminApi.ts, superAdminQueueApi.ts, superAdminReportBuilderApi.ts, superAdminScheduledReportsApi.ts,
// superAdminSettlementsApi.ts; fields from the services that read each body.
import { S, blob, centsish, flag, id, ids, money, numish, obj, scalar, str, strs, type BodySchema } from './request-schemas-fields';

// ── product catalog ────────────────────────────────────────────────────────────────────────────────────────────────
export const PC_IMPORT_BODY: BodySchema = obj({ source: str(40), filename: str(300), rows: S.nullable(S.array(S.freeObject(), { maxItems: 50000 })), requireBarcode: flag, idempotencyKey: str(200) });
export const PC_DISTRIBUTE_BODY: BodySchema = obj({ masterProductId: id, tenantIds: ids(5000), reason: str(2000), skipExisting: flag });
export const PC_BARCODE_BODY: BodySchema = obj({ barcode: scalar(64), reason: str(2000), isPrimary: flag, source: str(40), requireChecksum: flag });
export const PC_MASTER_BODY: BodySchema = obj({
  name: str(200), code: str(80), brandName: str(200), sku: str(80), manufacturerSku: str(80), upc: scalar(32), barcode: scalar(64),
  categoryName: str(200), productType: str(40), description: str(5000), costCents: centsish, suggestedRetailCents: centsish,
  currency: str(3), taxCategory: str(40), inventoryUnit: str(40), vendorName: str(200), confirmDuplicates: flag,
});
export const PC_RETIRE_BODY: BodySchema = obj({ reason: str(2000) });
// ── promotions ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const PROMO_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const PROMO_TRANSITION_BODY: BodySchema = obj({ status: str(30) });
// ── live queue actions (LQ*Input) ──────────────────────────────────────────────────────────────────────────────────
export const LQ_INCIDENT_BODY: BodySchema = obj({ tenantId: id, branchId: id, queueIds: ids(500), deviceIds: ids(500), category: str(60), severity: str(20), description: str(5000), idempotencyKey: str(200) });
export const LQ_NOTIFY_BODY: BodySchema = obj({ tenantId: id, branchId: id, queueIds: ids(500), severity: str(20), message: str(2000) });
export const LQ_SUPPORT_SESSION_BODY: BodySchema = obj({ tenantId: id, branchId: id, reason: str(2000), ticketId: id });
// ── report builder + scheduled reports (RunSpec / CreateScheduleBody) ──────────────────────────────────────────────
const spec = { dimension: str(60), measure: str(60), visualization: str(30), range: str(10), tenantId: id, limit: numish, filters: blob };
export const RB_RUN_BODY: BodySchema = obj(spec);
export const RB_DEFINITION_BODY: BodySchema = obj({ ...spec, name: str(200) });
export const SR_SCHEDULE_BODY: BodySchema = obj({ name: str(200), source: str(30), reportDefinitionId: id, format: str(10), range: str(10), tenantId: id, frequency: str(20), recipients: strs(254, 100), enabled: flag, nextRunAt: str(40) });
// ── general settings ───────────────────────────────────────────────────────────────────────────────────────────────
/** each change's value is the setting's own JSON (its shape varies by key; the settings service validates it) */
const change: BodySchema = obj({ key: str(200), value: S.any(), expectedVersion: numish, reason: str(2000) });
export const SETTINGS_SAVE_BODY: BodySchema = obj({ changes: S.nullable(S.array(change, { maxItems: 500 })) });
export const SETTINGS_RESET_BODY: BodySchema = obj({ confirm: scalar(100) });
export const SETTINGS_OPERATION_BODY: BodySchema = obj({ op: scalar(60) });
// ── settlements (the matched deposit is the processor's figure; the settlement status is derived, never sent) ───────
export const STL_NOTE_BODY: BodySchema = obj({ category: str(60), body: str(10000), supportCaseId: id });
export const STL_MATCH_DEPOSIT_BODY: BodySchema = money({ actualCents: centsish, actualDate: str(40), depositRef: str(200) });
export const STL_RESOLVE_BODY: BodySchema = obj({ resolutionCategory: str(60), reason: str(2000) });
export const STL_PROCESSOR_CASE_BODY: BodySchema = obj({ category: str(60), severity: str(20), description: str(5000) });
// ── tenant presets ─────────────────────────────────────────────────────────────────────────────────────────────────
export const PRESET_CREATE_BODY: BodySchema = obj({ name: str(200), scope: str(30), categorySlug: str(80), description: str(2000), settings: S.any(), makeDefault: flag });
export const PRESET_UPDATE_BODY: BodySchema = obj({ name: str(200), description: str(2000), categorySlug: str(80), settings: S.any(), active: flag });
// ── ticket removal (deletion code + reason) ────────────────────────────────────────────────────────────────────────
export const TICKET_REMOVE_BODY: BodySchema = obj({ code: scalar(40), reason: str(2000) });
