// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the customers module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from each handler + service + repository (the fields actually read) and from the
// clients that call the routes today (pos-web posCustomersApi and its screens: Customers, Customer Profile, Customer
// Notes, the offline drafts panel). Unknown fields are stripped; tenantId / permissions sent where undeclared are refused.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
const bool: BodySchema = S.nullable(S.boolean());
const ids = (max = 200): BodySchema => S.nullable(S.array(S.text(64), { maxItems: max }));

/** POST /pos/customers — CreateCustomerRequest (customers.dto.ts) */
export const CREATE_CUSTOMER_BODY: BodySchema = S.object({
  firstName: str(100), lastName: str(100), phone: str(40), email: str(254), birthday: str(32), address: str(500),
  preferredTechnicianId: str(64), preferredServiceIds: ids(), tags: S.nullable(S.array(S.text(200), { maxItems: 100 })), notes: str(5000),
  marketingOptIn: bool, smsOptIn: bool, emailOptIn: bool, source: str(40), isVip: bool,
});
/** PATCH /pos/customers/:id — EditCustomerRequest (the phone is NOT editable here; the phone flow owns it) */
export const EDIT_CUSTOMER_BODY: BodySchema = S.object({
  ...(CREATE_CUSTOMER_BODY.properties as Record<string, BodySchema>),
  status: str(20), expectedVersion: S.nullable(S.integer({ minimum: 0 })),
  preferredName: str(60), preferredLanguage: str(40), preferredBranchId: str(64),
});
/** PATCH /pos/customers/:id/notes — CustomerNotes, stored whole as notes_json: declared fields typed; any other short
 *  text / flag a stored copy already carries is KEPT (a save must not drop a key an older screen wrote) */
export const CUSTOMER_NOTES_BODY: BodySchema = S.object({
  salonNotes: str(5000), allergyNotes: str(5000), preferredStyle: str(2000), preferredTechnician: str(200), servicePreferences: str(5000),
  warnings: str(5000), customerVisible: bool, preferredLanguage: str(40), preferredBranch: str(200), preferredName: str(60),
  preferredNailShapeColor: str(500), favoriteProducts: str(2000), appointmentPreferences: str(2000),
}, [], { additionalProperties: { type: ['string', 'boolean', 'number', 'null'], maxLength: 5000 } });
/** PATCH /pos/customers/:id/tags — { tags } */
export const CUSTOMER_TAGS_BODY: BodySchema = S.object({ tags: S.nullable(S.array(S.text(200), { maxItems: 100 })) });
/** PATCH /pos/customers/:id/loyalty — CustomerLoyalty + reason (the screen sends the loaded loyalty object back) */
export const CUSTOMER_LOYALTY_BODY: BodySchema = S.object({
  points: S.nullable(S.number()), earned: S.nullable(S.number()), redeemed: S.nullable(S.number()), tier: str(60), tierThresholdPoints: S.nullable(S.number()),
  birthdayReward: bool, referralReward: bool, expiresAt: str(40), reason: scalar(500),
});
/** POST /pos/customers/:id/loyalty-adjust — { amount, reason } (the service requires a number) */
export const LOYALTY_ADJUST_BODY: BodySchema = S.object({ amount: S.nullable(S.number()), reason: scalar(500) });
/** PATCH /pos/customers/:id/membership — CustomerMembership (no screen sends it today; the dto shape) */
export const CUSTOMER_MEMBERSHIP_BODY: BodySchema = S.object({
  plan: str(100), status: str(20), startDate: str(40), renewalDate: str(40), benefits: S.nullable(S.array(S.text(200), { maxItems: 50 })), billingStatus: str(40),
});
/** POST /pos/customers/duplicates/:id/decision — { decision } (keep_separate | not_sure) */
export const DUPLICATE_DECISION_BODY: BodySchema = S.object({ decision: scalar(32) });
/** POST /pos/customers/duplicates/:id/merge — { primaryCustomerId } */
export const DUPLICATE_MERGE_BODY: BodySchema = S.object({ primaryCustomerId: scalar(64) });
/** POST /pos/customers/import, /import/preview, /import/commit — { csv, updateExisting } */
export const CUSTOMER_IMPORT_BODY: BodySchema = S.object({ csv: S.nullable(S.text(10_000_000)), updateExisting: { type: ['boolean', 'string', 'number', 'null'], maxLength: 10 } });

// ── Phase 12 round 2: referrals (pos-web posReferralsApi) and review visibility (pos-web posReviewsApi) ────────────────
/** the reward amount is Number()-coerced by the handler; a `status` is refused (REFERRAL_REDEMPTION moves it, once) */
export const REFERRAL_RECORD_BODY: BodySchema = S.object({ code: scalar(64), referredCustomerId: scalar(64) }, [], { 'x-forbidden': ['status'] });
export const REFERRAL_REWARD_BODY: BodySchema = S.object({ rewardCents: { type: ['number', 'string', 'null'], maxLength: 16 } }, [], { 'x-forbidden': ['status'] });
export const REVIEW_VISIBILITY_BODY: BodySchema = S.object({ hidden: bool, reason: str(1000) });
