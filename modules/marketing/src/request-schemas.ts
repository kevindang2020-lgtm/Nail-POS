// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the marketing module's request-body schemas (Customer Display
// Advertising), applied with @Body(ValidatedBody(SCHEMA)). Written from DisplayAdsService + display-ads-core
// (applyAdInput / applySettingsInput / setDevice / uploadMedia — the keys each one reads) and from pos-web
// (posDisplayAdsApi + adImagePipeline). The schema declares the SHAPE (types, sizes); the service keeps the domain rules
// (text cleaning, https-only QR, date order, branch targeting) and answers them with its own field-named 400.
// Unknown fields are stripped; a `status` / `version` on an ad body is refused (the lifecycle moves only through
// publish / pause / archive / restore, and the version only through the conditional update).
import { S, type BodySchema } from '@aipowersalon/permissions';

const text = (max: number): BodySchema => S.nullable(S.text(max));
const AD_FORBIDDEN: BodySchema['x-forbidden'] = ['status', 'version', 'publishedAt', 'pausedAt', 'archivedAt', 'createdBy'];

const AD_FIELDS: Record<string, BodySchema> = {
  name: text(500),
  headline: text(2000), subheadline: text(2000), description: text(4000), ctaText: text(500),
  mediaId: text(64), fullscreenMediaId: text(64),
  qr: S.nullable(S.object({ kind: text(32), url: text(4000) })),
  fitMode: S.text(32),
  focalX: S.number(), focalY: S.number(),
  startDate: text(32), endDate: text(32),
  daysOfWeek: S.nullable(S.array(S.number(), { maxItems: 14 })),
  dailyStartTime: text(16), dailyEndTime: text(16),
  displayDurationSeconds: S.nullable(S.number()),
  priority: S.number(),
  allBranches: S.boolean(),
  branchIds: S.array(S.text(64), { maxItems: 500 }),
};

/** POST /pos/marketing/display-ads — a new draft (name required by the service). */
export const DISPLAY_AD_CREATE_BODY: BodySchema = S.object(AD_FIELDS, [], { 'x-forbidden': AD_FORBIDDEN });
/** PATCH /pos/marketing/display-ads/:id — the fields to change + expectedVersion (the service answers a missing one). */
export const DISPLAY_AD_UPDATE_BODY: BodySchema = S.object({ ...AD_FIELDS, expectedVersion: S.number() }, [], { 'x-forbidden': AD_FORBIDDEN });
/** POST …/:id/publish|pause|archive|restore — only the version the client read. */
export const DISPLAY_AD_ACTION_BODY: BodySchema = S.object({ expectedVersion: S.number() }, [], { 'x-forbidden': ['status', 'version'] });
/** PATCH …/settings and …/branches/:branchId/settings (the branch scope refuses the salon-wide keys in the service). */
export const DISPLAY_ADS_SETTINGS_BODY: BodySchema = S.object({
  enabled: S.nullable(S.boolean()), fullScreenIdleAdsEnabled: S.nullable(S.boolean()),
  defaultDurationSeconds: S.number(), fullScreenIdleAfterSeconds: S.number(),
});
/** PATCH …/devices/:deviceId */
export const DISPLAY_ADS_DEVICE_BODY: BodySchema = S.object({ adsEnabled: S.boolean() });
/** POST …/media — the multipart text fields (every multipart field arrives as a string; the files are separate). */
export const DISPLAY_AD_MEDIA_BODY: BodySchema = S.object({ focalX: { type: ['string', 'number', 'null'], maxLength: 16 }, focalY: { type: ['string', 'number', 'null'], maxLength: 16 } });
