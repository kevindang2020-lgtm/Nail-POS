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
  // preferredLanguage: the customer's communication language — 'en' / 'vi' or a typed name of one ("Vietnamese", "Tiếng Việt");
  // the service stores the code and refuses any other language (WP-I, column CHECK 697)
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
  // the loaded detail's loyalty is echoed back whole (POSCustomersScreen saveLoyalty): its read-only lists — accepted, ignored
  availableRewards: S.nullable(S.array(S.object({ id: str(64), title: str(500), description: str(5000), pointsCost: S.nullable(S.number()) }), { maxItems: 1000 })),
  redemptions: S.nullable(S.array(S.object({ id: str(64), title: str(500), pointsSpent: S.nullable(S.number()), createdAt: str(40) }), { maxItems: 5000 })),
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

// ── Loyalty & Rewards mandate (Oct 29 2026): the POS loyalty program writes (loyalty-program.controller.ts) ─────────────
/** POST /pos/loyalty/enroll — { customerId } */
export const LOYALTY_ENROLL_BODY: BodySchema = S.object({ customerId: S.uuid() }, ['customerId']);
/** POST /pos/loyalty/adjust — { customerId, delta, reason, idempotencyKey } (one ledger entry per key) */
export const LOYALTY_PROGRAM_ADJUST_BODY: BodySchema = S.object({ customerId: S.uuid(), delta: S.integer(), reason: S.text(300), idempotencyKey: S.uuid() }, ['customerId', 'delta', 'reason', 'idempotencyKey']);
/** POST /pos/loyalty/bonus-requests — Customer Profile & Global Loyalty Protection (Nov 4 2026): a POSITIVE bonus for the owner to approve */
export const LOYALTY_BONUS_REQUEST_BODY: BodySchema = S.object({ customerId: S.uuid(), points: S.integer({ minimum: 1, maximum: 5000 }), reason: S.text(300) }, ['customerId', 'points', 'reason']);
/** POST /pos/loyalty/redeem — { customerId, rewardId, idempotencyKey } (the key becomes the redemption id) */
export const LOYALTY_REDEEM_BODY: BodySchema = S.object({ customerId: S.uuid(), rewardId: S.uuid(), idempotencyKey: S.uuid() }, ['customerId', 'rewardId', 'idempotencyKey']);
/** POST /pos/loyalty/redemptions/:id/void — { reason } */
export const LOYALTY_VOID_BODY: BodySchema = S.object({ reason: S.text(300) }, ['reason']);
/** POST /pos/loyalty/tiers (create) and POST /pos/loyalty/tiers/:tierId (edit) — Manage Tiers (Loyalty guide Nov 4 2026) */
export const LOYALTY_TIER_BODY: BodySchema = S.object({ name: S.text(40), rank: S.nullable(S.integer({ minimum: 0 })), minPoints: S.nullable(S.integer({ minimum: 0 })), benefits: str(500), active: bool }, ['name']);
/** POST /pos/loyalty/members/:customerId/tier — { tier, reason } */
export const LOYALTY_MEMBER_TIER_BODY: BodySchema = S.object({ tier: S.text(40), reason: S.text(300) }, ['tier', 'reason']);

// ── Customer Retention mandate (Oct 29 2026): consent-checked win-back SMS (retention.controller.ts) ──────────────────
/** POST /pos/retention/sms/preview — exact customer ids OR the active filters (server-resolved "select all matching") */
export const RETENTION_SMS_PREVIEW_BODY: BodySchema = S.object({
  customerIds: S.nullable(S.array(S.uuid(), { maxItems: 5000 })),
  selection: S.nullable(S.object({ segment: str(32), q: str(120), excludeIds: S.nullable(S.array(S.uuid(), { maxItems: 5000 })),
    preset: str(16), from: str(10), to: str(10), basis: str(24), band: str(12), sms: str(16), minVisits: S.nullable(S.integer()), sort: str(24), branch: str(40),
    email: str(16), future: str(8), minDays: S.nullable(S.integer()),
    scope: str(16), category: str(40), technician: str(40), spend: str(8), areaCode: str(3), phoneCheck: str(12) })),   // A19 Nov 6 filters · Win-Back §01 area code   // listFilters() reads these too
  body: S.text(600), label: str(120), audience: S.nullable(S.enumOf(['win_back', 'first_visit'])),
}, ['body']);
/** PUT /pos/retention/settings — the salon's thresholds (Complete Build Guide §05), optimistic version */
export const RETENTION_SETTINGS_BODY: BodySchema = S.object({ riskDays: S.integer(), approachingDays: S.integer(), observationWindowDays: S.nullable(S.integer()), expectedVersion: S.integer() },
  ['riskDays', 'approachingDays', 'expectedVersion']);
/** POST /pos/retention/snapshots/backfill — Four-Module Completion Guide CR-01: a bounded range of past salon days */
export const RETENTION_SNAPSHOT_BACKFILL_BODY: BodySchema = S.object({ from: S.text(10), to: S.text(10) }, ['from', 'to']);
/** PUT /pos/retention/sms/pricing — CR-03: a new effective-dated SMS price (decimal strings; blank fee / tax = unknown) */
export const RETENTION_SMS_PRICING_BODY: BodySchema = S.object({ retailPricePerSegment: scalar(20), carrierFeePerSegment: scalar(20), taxRatePercent: scalar(20),
  currency: str(3), effectiveFrom: str(40), note: str(200) }, ['retailPricePerSegment']);
/** POST /pos/retention/sms/campaigns — confirm a preview (idempotent per key) */
export const RETENTION_SMS_CONFIRM_BODY: BodySchema = S.object({ previewId: S.uuid(), idempotencyKey: S.uuid(), acceptChanges: bool, label: str(120) }, ['previewId', 'idempotencyKey']);
/** Customer Segments guide §10 C — POST /pos/marketing/segments/audience-drafts: an UNSENT audience (idempotent per key) */
export const SEGMENT_AUDIENCE_DRAFT_BODY: BodySchema = S.object({
  channel: S.enumOf(['sms', 'email']), purpose: S.nullable(S.enumOf(['general', 'win_back'])), selectionMode: S.enumOf(['page', 'selected', 'all_matching']),
  customerIds: S.nullable(S.array(S.uuid(), { maxItems: 5000 })),
  filters: S.nullable(S.object({ segment: str(16), q: str(100), sort: str(16), branch: str(40), preset: str(16), from: str(10), to: str(10), basis: str(24),
    minVisits: S.nullable(S.integer()), maxVisits: S.nullable(S.integer()), minSpend: S.nullable(S.integer()), maxSpend: S.nullable(S.integer()), tier: str(40), service: str(60), sms: str(16), email: str(16),
    page: S.nullable(S.integer()), pageSize: S.nullable(S.integer()) })),   // filtersOf() reads them; the POS always sends its page
  message: str(1000), idempotencyKey: S.text(80),
}, ['channel', 'selectionMode', 'idempotencyKey']);
/** POST …/audience-drafts/:id/recheck and /discard — no body */
export const SEGMENT_EMPTY_BODY: BodySchema = S.object({});
/** Win-Back guide §09 / §10 (pos/retention/health-check · winback/plan · winback/audience) */
export const WINBACK_EMPTY_BODY: BodySchema = S.object({});
/** C5 audit (Nov 4 2026): cancel a queued / sending campaign — a reason is required (it is audited) */
export const RETENTION_SMS_CANCEL_BODY: BodySchema = S.object({ reason: str(300) }, ['reason']);
export const WINBACK_PLAN_BODY: BodySchema = S.object({
  goal: S.enumOf(['inactive_risk', 'inactive_90', 'repeat_visits', 'slow_weekdays', 'promote_service']), channel: S.nullable(S.enumOf(['sms', 'email'])), service: str(60),
}, ['goal']);
/** A19 Nov 6: POST /pos/retention/winback/audience/picked — the customers staff picked in the list */
export const WINBACK_PICKED_BODY: BodySchema = S.object({ customerIds: S.array(S.uuid(), { maxItems: 500 }), channel: S.nullable(S.enumOf(['sms', 'email'])), idempotencyKey: S.text(120) }, ['customerIds', 'idempotencyKey']);
export const WINBACK_AUDIENCE_BODY: BodySchema = S.object({
  goal: S.enumOf(['inactive_risk', 'inactive_90', 'repeat_visits', 'slow_weekdays', 'promote_service']), channel: S.nullable(S.enumOf(['sms', 'email'])), service: str(60),
  message: str(1000), idempotencyKey: S.text(80),
}, ['goal', 'idempotencyKey']);
/** POST …/audience-drafts/:id/campaign — the Campaign Center draft this audience is handed to */
export const SEGMENT_DRAFT_CAMPAIGN_BODY: BodySchema = S.object({ campaignId: S.uuid() }, ['campaignId']);
