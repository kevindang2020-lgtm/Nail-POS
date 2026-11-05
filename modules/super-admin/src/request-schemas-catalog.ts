// request-schemas-catalog.ts — BUILD_PLAN Phase 12 (#17): super-admin service-template catalog, business categories and
// booking/check-in failed-event retry. Clients: admin-web superAdminApi.ts (TemplateModals, CatalogConfigModals) +
// superAdminBookingCheckinApi.ts; fields from template-mutations-core.ts / business-categories.service.ts.
import { S, flag, id, ids, num, obj, scalar, str, type BodySchema } from './request-schemas-fields';

export const BOOKING_RETRY_EVENT_BODY: BodySchema = obj({ reason: str(2000), idempotencyKey: str(200), tenantId: id });
export const BIZ_CATEGORY_CREATE_BODY: BodySchema = obj({ name: str(120), description: str(1000), icon: str(80) });
export const BIZ_CATEGORY_REORDER_BODY: BodySchema = obj({ orderedIds: ids(500) });
export const BIZ_CATEGORY_RENAME_BODY: BodySchema = obj({ name: scalar(120) });
export const CAT_CATEGORY_CREATE_BODY: BodySchema = obj({ name: str(120), iconKey: str(80) });
export const CAT_CATEGORY_UPDATE_BODY: BodySchema = obj({ name: str(120), iconKey: str(80), displayOrder: num, status: str(20) });
const resource: BodySchema = obj({ label: str(80), quantity: num });
const addon: BodySchema = obj({ name: str(80), priceCents: num });
const template = {
  name: str(200), categoryCode: str(80), description: str(2000), durationMinutes: num, priceMinCents: num, priceMaxCents: num,
  taxSetting: str(20), commissionEligible: flag, isCustomizable: flag,
  resources: S.nullable(S.array(resource, { maxItems: 50 })), addons: S.nullable(S.array(addon, { maxItems: 100 })),
};
export const CAT_TEMPLATE_CREATE_BODY: BodySchema = obj(template);
export const CAT_TEMPLATE_UPDATE_BODY: BodySchema = obj({ ...template, changeNote: str(1000) });
export const CAT_TEMPLATE_RETIRE_BODY: BodySchema = obj({ reason: str(2000) });
export const CAT_DEPLOY_BODY: BodySchema = obj({ tenantIds: ids(5000), allowOverwrite: flag, customizable: flag });
export const CAT_CUSTOMIZABLE_BODY: BodySchema = obj({ customizable: flag });
