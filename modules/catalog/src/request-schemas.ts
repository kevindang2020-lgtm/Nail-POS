// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the catalog module's request-body schemas (services, categories,
// add-ons, technician mapping, commission, tax, CSV import), applied with @Body(ValidatedBody(SCHEMA)). Written from
// ServicesService / ServiceAddOnsService (+ the repositories' create / update) and pos-web (posServicesApi +
// POSServicesScreen, posServiceAddOnsApi + POSServiceAddOnsScreen) — every body sent today passes; unknown fields are
// stripped; tenantId / permissions sent where undeclared are refused. A service's own active / inactive `status` is a
// declared field (it is the catalog row's flag, not a money state).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const id: BodySchema = str(64);
const flag: BodySchema = S.nullable(S.boolean());
const cents: BodySchema = S.nullable(S.integer({ minimum: 0 }));
const minutes: BodySchema = S.nullable(S.integer({ minimum: -1440, maximum: 1440 }));
const rate: BodySchema = S.nullable(S.number({ minimum: 0 }));
const ids: BodySchema = S.nullable(S.array(S.text(64), { maxItems: 500 }));

const service = {
  name: str(200), categoryId: id, description: str(4000), durationMinutes: minutes, priceCents: cents,
  commissionType: str(16), commissionValue: rate, technicianIds: ids, skillTags: S.nullable(S.array(S.text(64), { maxItems: 50 })),
  onlineBookingEnabled: flag, customerAppBookingEnabled: flag, aiBookingEnabled: flag, colorKey: str(32), iconKey: str(64), status: str(16),
};
export const SERVICE_CREATE_BODY: BodySchema = S.object(service);
export const SERVICE_UPDATE_BODY: BodySchema = S.object(service);
export const CATEGORY_CREATE_BODY: BodySchema = S.object({ name: str(120), colorKey: str(32) });
export const CATEGORY_UPDATE_BODY: BodySchema = S.object({ name: str(120), colorKey: str(32), status: str(16) });
export const CATEGORY_REORDER_BODY: BodySchema = S.object({ order: S.nullable(S.array(S.text(64), { maxItems: 500 })) });
export const CATEGORY_ARCHIVE_BODY: BodySchema = S.object({ confirm: flag });
/** a CSV pasted / uploaded on the services screen — bounded (2 MB) */
export const SERVICE_IMPORT_BODY: BodySchema = S.object({ csv: str(2_000_000) });
export const SERVICE_ADD_ONS_BODY: BodySchema = S.object({ addOns: S.nullable(S.array(S.object({ addOnId: id, name: str(200), priceCents: cents, durationDeltaMinutes: minutes, isTaxable: flag, isActive: flag }), { maxItems: 200 })) });
export const SERVICE_MAPPING_BODY: BodySchema = S.object({ mapping: S.nullable(S.array(S.object({ technicianId: id, displayName: str(200), skillLevel: str(32), commissionOverrideValue: rate, isActive: flag }), { maxItems: 500 })) });
export const SERVICE_COMMISSION_BODY: BodySchema = S.object({ type: str(16), value: rate, byTechnician: S.nullable(S.array(S.object({ technicianId: id, type: str(16), value: rate }), { maxItems: 500 })) });
export const SERVICE_TAX_BODY: BodySchema = S.object({ isTaxable: flag, taxCategory: str(64), overridePercent: S.nullable(S.number({ minimum: 0, maximum: 100 })), exemptAllowed: flag });
export const ADD_ON_CREATE_BODY: BodySchema = S.object({ name: str(200), priceCents: cents, durationDeltaMinutes: minutes, isTaxable: flag, serviceIds: ids });
export const ADD_ON_UPDATE_BODY: BodySchema = ADD_ON_CREATE_BODY;
// Services & Products / Categories / Pricing / Add-Ons rebuilds (Oct 30 2026) — the audited catalog-screens writes.
export const CATALOG_PRICING_BODY: BodySchema = S.object({ priceCents: cents, durationMinutes: minutes, reason: str(500), expectedUpdatedAt: str(40) });
export const CATALOG_REASSIGN_BODY: BodySchema = S.object({ serviceIds: ids, toCategoryId: id, reason: str(500), confirm: flag });
export const CATALOG_ADD_ON_CREATE_BODY: BodySchema = S.object({ name: str(200), priceCents: cents, durationMinutes: minutes, taxable: flag, serviceIds: ids, confirmDuplicate: flag });
export const CATALOG_ADD_ON_UPDATE_BODY: BodySchema = S.object({ scope: str(16), serviceId: id, name: str(200), priceCents: cents, durationMinutes: minutes, taxable: flag, addServiceIds: ids, removeServiceIds: ids, reason: str(500) });
export const CATALOG_ADD_ON_STATE_BODY: BodySchema = S.object({ serviceId: id, reason: str(500) });
