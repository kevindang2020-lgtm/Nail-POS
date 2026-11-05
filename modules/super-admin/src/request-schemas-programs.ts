// request-schemas-programs.ts — BUILD_PLAN Phase 12 (#17): super-admin integrations lifecycle, kill switches, legal
// documents, loyalty, maintenance, membership programs, merchant accounts, owner portfolios, the staff self-service
// access request, and the PUBLIC website intake (leads / applications / invitation accept). Clients: admin-web
// superAdminIntegrationsApi.ts, KillSwitchesPanel.tsx, superAdminApi.ts, superAdminLoyaltyApi.ts,
// superAdminMembershipsApi.ts, superAdminMerchantAccountsApi.ts; pos-web posMeAccessRequestsApi.ts / posPublicApi.ts;
// owner-web ownerPublicApi.ts; the marketing site's application form (fields from publicCreateApplication, which
// accepts both camelCase and snake_case names).
import { S, centsish, flag, id, money, num, numish, obj, scalar, str, strs, type BodySchema } from './request-schemas-fields';

// ── integrations lifecycle (secrets are encrypted by the service and only ever returned masked) ────────────────────
export const INT_CREATE_CONNECTION_BODY: BodySchema = obj({ providerKey: str(80), ownershipType: str(20), tenantId: id, branchId: id, authMethod: str(30) });
export const INT_OAUTH_BEGIN_BODY: BodySchema = obj({ redirectUri: str(2000), scopes: strs(200, 100) });
export const INT_OAUTH_COMPLETE_BODY: BodySchema = obj({ state: str(500), code: str(4096) });
export const INT_API_KEY_BODY: BodySchema = obj({ apiKey: str(4096) });
export const INT_ROTATE_BODY: BodySchema = obj({ kind: str(40), newSecret: str(4096), reason: str(2000) });
export const INT_REASON_BODY: BodySchema = obj({ reason: str(2000) });
export const INT_LIMIT_BODY: BodySchema = obj({ limit: numish });
export const INT_SYNC_BODY: BodySchema = obj({ syncType: str(40), idempotencyKey: str(200) });

// ── kill switches / legal / maintenance ────────────────────────────────────────────────────────────────────────────
export const KILL_SWITCH_BODY: BodySchema = obj({ active: flag, reason: scalar(2000) });
export const LEGAL_DOC_BODY: BodySchema = obj({ docType: str(60), version: str(40), title: str(300), content: str(500_000), summary: str(5000), requiredAcceptance: flag, effectiveDate: str(40) });
export const MAINT_ENABLE_BODY: BodySchema = obj({ reason: str(2000), title: str(300), message: str(5000), mode: str(30), expectedRestoration: str(40), allowedRoles: strs(60, 50) });
export const MAINT_SCHEDULE_BODY: BodySchema = obj({ title: str(300), reason: str(2000), startsAt: str(40), endsAt: str(40), timezone: str(64), mode: str(30), affectedServices: strs(80, 100) });
export const MAINT_BANNER_BODY: BodySchema = obj({ text: scalar(2000) });

// ── loyalty ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const LOY_TEMPLATE_BODY: BodySchema = obj({ name: str(200), programType: str(40), structure: S.any() });
export const LOY_SUSPICIOUS_TRANSITION_BODY: BodySchema = obj({ to: str(20), note: str(2000) });
export const LOY_CORRECTION_REVIEW_BODY: BodySchema = obj({ to: str(20), proposedAdjustment: num, rootCause: str(500), reason: str(2000) });
const numMap: BodySchema = S.nullable({ type: 'object', additionalProperties: numish });
const boolMap: BodySchema = S.nullable({ type: 'object', additionalProperties: flag });
/** a partial SALoyaltyConfig — mergeConfig() keeps only the known keys of each section */
export const LOY_CONFIG_BODY: BodySchema = obj({
  limits: numMap,
  expiration: S.nullable(obj({ enabled: flag, pointExpiryDays: numish, rewardValidityDays: numish })),
  programTypes: boolMap, planFeatures: boolMap,
  valuation: S.nullable(obj({ centsPerPoint: numish })),
});

// ── membership programs ────────────────────────────────────────────────────────────────────────────────────────────
export const MP_EXPORT_BODY: BodySchema = obj({ report: str(60), tenantId: id, status: str(30), productType: str(40), columns: { anyOf: [S.text(2000), S.array(S.text(80), { maxItems: 100 }), { type: 'null' }] } });
export const MP_SUPPORT_SESSION_BODY: BodySchema = obj({ tenantId: id, reason: str(2000), durationMinutes: numish, accessLevel: str(30) });
export const MP_DISABLE_BODY: BodySchema = obj({ reason: str(2000) });
export const MP_CORRECTION_BODY: BodySchema = money({ membershipId: id, direction: str(10), quantity: numish, amountCents: centsish, reason: str(2000) });
export const MP_ENABLED_BODY: BodySchema = obj({ enabled: flag });
export const MP_GATING_BODY: BodySchema = obj({ planGating: boolMap });
const limits = { maxProgramsPerTenant: numish, maxActiveMembersPerTenant: numish, maxBenefitsPerProgram: numish, maxTrialDays: numish };
/** `{ limits }` (admin-web) or the bare limits object (the handler accepts both) */
export const MP_LIMITS_BODY: BodySchema = obj({ limits: S.nullable(obj(limits)), ...limits });
const rules = { allowedBillingIntervals: strs(20, 10), maxDiscountPercent: numish, allowTrials: flag, allowFamily: flag, requireAutoRenewConsent: flag };
export const MP_RULES_BODY: BodySchema = obj({ rules: S.nullable(obj(rules)), ...rules });
const benefit: BodySchema = obj({ benefitType: str(40), label: str(200), creditsPerCycle: numish, valueCents: numish, percent: numish });
/** a membership template — `status` here is the template's publish state (draft / published / archived) */
export const MP_TEMPLATE_BODY: BodySchema = obj({ name: str(200), description: str(2000), productType: str(40), billingInterval: str(20), intervalCount: numish, priceCents: centsish, trialDays: numish, benefits: S.nullable(S.array(benefit, { maxItems: 100 })), status: str(20) });

// ── merchant accounts ──────────────────────────────────────────────────────────────────────────────────────────────
export const MA_RATES_BODY: BodySchema = money({ percentageBasisPoints: num, perTxnFeeMinor: num, monthlyFeeMinor: num, refundFeeMinor: num, chargebackFeeMinor: num, pricingPlanId: id, effectiveAt: str(40), changeReason: str(2000) });
export const MA_REASON_BODY: BodySchema = obj({ reason: str(2000) });
/** the one route that legitimately carries bank numbers (step-up confirmed; the service encrypts + masks them) */
export const MA_FUNDING_BODY: BodySchema = money({ stepUpConfirmed: flag, accountNumber: str(34), routingNumber: str(20), bankName: str(200), accountType: str(20), fundingSchedule: str(20), reason: str(2000) });
export const MA_MID_BODY: BodySchema = obj({ merchantId: str(64), branchId: id, reason: str(2000) });
export const MA_TERMINAL_BODY: BodySchema = obj({ terminalId: str(64), branchId: id, reason: str(2000) });
/** Fiserv master build §9.2: record (or withdraw) a merchant's Fiserv Merchant Surcharge Program enrollment — the rate is
 *  Fiserv's per-MID rate in basis points (100–300), the reference is Fiserv's written enrollment confirmation */
export const MA_SURCHARGE_BODY: BodySchema = obj({ enrolled: flag, rateBps: numish, reference: str(200), branchId: id, reason: str(2000) });

// ── owner portfolios ───────────────────────────────────────────────────────────────────────────────────────────────
export const OWNER_SALON_BODY: BodySchema = obj({ name: str(200), city: str(120), state: str(60), address: str(500), zip: str(20), phone: str(40), accessLevel: str(30), isPrimaryOwner: flag, switchPin: scalar(12) });
export const OWNER_ASSIGN_BRANCH_BODY: BodySchema = obj({ branchId: id, accessLevel: str(30), isPrimaryOwner: flag });
export const OWNER_UPDATE_BRANCH_BODY: BodySchema = obj({ accessLevel: str(30), isPrimaryOwner: flag });
export const OWNER_PIN_BODY: BodySchema = obj({ pin: scalar(12) });

// ── staff self-service access request (pos-web) ────────────────────────────────────────────────────────────────────
export const MY_ACCESS_REQUEST_BODY: BodySchema = obj({ requestedRole: str(60), reason: str(2000), requestedDurationDays: num });

// ── PUBLIC website intake (no session) ─────────────────────────────────────────────────────────────────────────────
const v = (max = 500): BodySchema => ({ type: ['string', 'number', 'boolean', 'null'], maxLength: max });
export const PUBLIC_LEAD_BODY: BodySchema = obj({ website: v(), kind: v(40), email: v(254), phone: v(40), name: v(200), salonName: v(200), salon_name: v(200), city: v(120), state: v(60), sourcePage: v(200), source_page: v(200), message: v(5000) });
const appFields = ['website', 'company_website', 'companyWebsite', 'ownerFirstName', 'owner_first_name', 'ownerLastName', 'owner_last_name', 'ownerName', 'owner_name', 'salonName', 'salon_name', 'email', 'phone', 'smsEmailConsent', 'sms_email_consent', 'idempotencyKey', 'idempotency_key', 'zip', 'ein', 'businessEin', 'business_ein', 'state', 'consentText', 'consent_text', 'address', 'city', 'technicianCount', 'technician_count', 'techniciansCount', 'technicians_count', 'locationCount', 'location_count', 'referralSource', 'referral_source', 'hearAbout', 'hear_about', 'currentPos', 'current_pos', 'currentProcessor', 'current_payment_processor', 'current_processor', 'cardVolumeBand', 'average_monthly_card_volume', 'card_volume_band', 'monthlyCardVolumeCents', 'monthly_card_volume_cents', 'bestTimeToContact', 'best_time_to_contact', 'preferredContactMethod', 'preferred_contact_method', 'formVersion', 'form_version', 'sourcePage', 'source_page', 'source', 'preferredImacColor', 'preferred_imac_color'];
export const PUBLIC_APPLICATION_BODY: BodySchema = obj({ ...Object.fromEntries(appFields.map((k) => [k, v(/consent/i.test(k) ? 5000 : 500)])), message: v(5000), utm: S.nullable({ anyOf: [S.freeObject(), S.text(2000)] }) });
export const PUBLIC_ACCEPT_INVITE_BODY: BodySchema = obj({ token: str(500), password: str(500), fullName: str(200) });
