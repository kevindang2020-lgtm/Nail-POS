// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the team-permissions request bodies (who may do what in a salon),
// applied with @Body(ValidatedBody(SCHEMA)). Written from TeamAccessService (preview / assignRole / setBranchAccess /
// grantOverride / revokeOverride / transferOwnership — the fields read) and the api-contracts request types pos-web's
// posAccessApi sends (TeamAssignRoleRequest, TeamBranchAccessRequest, TeamOverrideRequest, TeamOverrideRevoke,
// TeamPreviewRequest, OwnershipTransferRequest). The service keeps every authority rule (step-up, last owner, caps);
// this refuses malformed input before it gets there.
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const reason = str(1000);
const key = (max = 120): BodySchema => S.nullable(S.text(max));
const override: BodySchema = S.object({ permission: key(), effect: str(8), scopeBranchId: str(64), reason, expiresAt: str(40) });

export const TEAM_ASSIGN_ROLE_BODY: BodySchema = S.object({ templateKey: key(80), reason });
export const TEAM_BRANCH_ACCESS_BODY: BodySchema = S.object({ branchIds: S.nullable(S.array(S.text(64), { maxItems: 500 })), accessLevel: str(16), reason });
export const TEAM_OVERRIDE_BODY: BodySchema = override;
export const TEAM_OVERRIDE_REVOKE_BODY: BodySchema = S.object({ reason });
export const TEAM_PREVIEW_BODY: BodySchema = S.object({
  userId: str(64), templateKey: key(80),
  customRole: S.nullable(S.object({ baseRole: str(40), scope: str(40), permissions: S.nullable(S.array(S.text(120), { maxItems: 500 })) })),
  overrides: S.nullable(S.array(override, { maxItems: 200 })),
});
export const OWNERSHIP_TRANSFER_BODY: BodySchema = S.object({ toUserId: str(64), reason, keepPreviousOwnerAs: key(80) });
/** B-13 (Oct 20 2026): POST /pos/access/members/:userId/end-employment — the reason is the audit row's reason (required by the service). */
export const END_EMPLOYMENT_BODY: BodySchema = S.object({ reason });

// ── Phase 12 round 2: every other workforce route ─────────────────────────────────────────────────────────────────
// Written from each handler + the service / repository fields it actually reads, and from the clients (pos-web
// posTechniciansApi / POSTechniciansScreen / TechnicianAccessPanel / posPayrollApi / posTimeClockApi /
// posCashHandoffApi / posApprovalsApi / posNailShowcaseApi, owner-web ownerApi + ownerApprovalRequestsApi, tech-web
// techApi, customer-web customerApi / customerNailShowcaseApi / customerSocialApi, admin-web superAdminTechProfileApi
// / superAdminNailShowcaseApi). Numbers the service runs through Number() accept a numeric string (forms send them);
// nested settings blobs the service cleans itself stay free objects. Unknown fields are stripped.
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
const num: BodySchema = S.nullable(S.number());
/** a number the service coerces with Number() — a form may send it as a string */
const looseNum: BodySchema = { type: ['number', 'string', 'null'], maxLength: 32 };
const bool: BodySchema = S.nullable(S.boolean());
const strs = (n = 100, max = 200): BodySchema => S.nullable(S.array(S.text(max), { maxItems: n }));
const free: BodySchema = S.nullable(S.freeObject());
const hhmm = (): BodySchema => str(16);
const window_: BodySchema = S.nullable(S.object({ startTime: hhmm(), endTime: hhmm() }));

// technicians (/pos/technicians/*)
export const TECH_LOOKUP_BODY: BodySchema = S.object({ phone: str(40), email: str(254) });
/** §112 technician import: the CSV text (≤ 200 rows, ~256 KB) + preview/commit flag. */
export const TECH_IMPORT_BODY: BodySchema = S.object({ csv: str(262144), dryRun: bool });
export const TECH_CREATE_BODY: BodySchema = S.object({
  firstName: str(100), lastName: str(100), displayName: str(200), phone: str(40), email: str(254), status: str(20),
  skillGroups: strs(40, 80), serviceIds: strs(500, 64), defaultCommissionPercent: num, techAppEnabled: bool, canProcessPayment: bool, pin: scalar(16),
});
export const TECH_UPDATE_BODY: BodySchema = S.object({
  fullName: str(200), phone: str(40), email: str(254), roleLabel: str(80), avatarUrl: str(2000), specialties: strs(40, 80), serviceIds: strs(500, 64),
  commissionSplitPercent: num, workingHours: window_, lunchBreak: window_, status: str(20), pin: scalar(16),
});
export const TECH_SUSPEND_BODY: BodySchema = S.object({ status: str(20), reason: str(1000), managerPin: scalar(32) });
export const TECH_SALON_COMMISSION_BODY: BodySchema = S.object({ defaultCommissionPercent: num, adminAuthCode: scalar(64) });
const daySchedule: BodySchema = S.object({
  isWorking: bool, startTime: hhmm(), endTime: hhmm(), lunchStart: hhmm(), lunchEnd: hhmm(),
  shifts: S.nullable(S.array(S.object({ startTime: hhmm(), endTime: hhmm() }), { maxItems: 12 })),
  breaks: S.nullable(S.array(S.object({ startTime: hhmm(), endTime: hhmm(), type: str(16) }), { maxItems: 12 })),
});
export const TECH_SCHEDULE_BODY: BodySchema = S.object({
  weekly: S.nullable({ type: 'object', additionalProperties: daySchedule }), unavailableDates: strs(366, 10), branchId: str(64),
  version: num, expectedVersion: num,
});
export const TECH_SHIFT_BODY: BodySchema = S.object({ shiftStatus: str(20), clockedInAt: str(40), onBreak: bool, note: str(500) });
export const TECH_SKILLS_BODY: BodySchema = S.object({ skillGroups: strs(100, 80) });
export const TECH_SERVICES_BODY: BodySchema = S.object({ serviceIds: S.array(S.text(64), { maxItems: 500 }) }, ['serviceIds']);
export const TECH_COMMISSION_BODY: BodySchema = S.object({
  defaultPercent: num, adminAuthCode: scalar(64),
  byService: S.nullable(S.array(S.object({ serviceId: str(64), percent: num }), { maxItems: 500 })),
  byCategory: S.nullable(S.array(S.object({ category: str(80), percent: num }), { maxItems: 100 })),
  fixedCents: num, tipHandling: str(16), helperPercent: num, payrollPeriod: str(16),
});
export const TECH_APP_ACCESS_BODY: BodySchema = S.object({
  enabled: bool, loginEmail: str(254), pinEnabled: bool, allowedBranches: strs(200, 64), allowedSections: strs(50, 64),
  canAcceptTicket: bool, canStartService: bool, canMarkDone: bool, canRequestBreak: bool, canViewEarnings: bool, canEditNotes: bool, canProcessPayment: bool,
});
export const TECH_PERMISSIONS_BODY: BodySchema = S.object({ matrix: S.nullable(S.array(S.object({ permission: str(120), allowed: bool }), { maxItems: 200 })) });

// compensation (/owner/compensation/*)
const versionPayload: BodySchema = S.object({
  commissionType: str(16), commissionValue: num, supplyMethod: str(16), supplyValue: num, discountFunding: str(32), effectiveStart: str(40), effectiveEnd: str(40),
});
export const COMP_AGREEMENT_BODY: BodySchema = S.object({ technicianId: str(64), title: str(200), terms: free, effectiveStart: str(40) });
export const COMP_CLASSIFICATION_BODY: BodySchema = S.object({ classification: str(40) });
export const COMP_WAGE_CONFIG_BODY: BodySchema = S.object({ minHourlyWageCents: looseNum, overtimeThresholdHours: looseNum });
export const COMP_COMPLIANCE_PREVIEW_BODY: BodySchema = S.object({ technicianId: str(64), periodPayCents: looseNum, hoursWorked: looseNum });
export const COMP_PERIOD_REVIEW_BODY: BodySchema = S.object({ periodId: str(64) });
export const COMP_BONUS_RULE_BODY: BodySchema = S.object({ metric: str(40), target: looseNum, amountCents: looseNum, label: str(200), technicianId: str(64), branchId: str(64) });
export const COMP_BONUS_PREVIEW_BODY: BodySchema = S.object({ technicianId: str(64), fromIso: str(40), toIso: str(40) });
export const COMP_BONUS_APPROVE_BODY: BodySchema = S.object({ technicianId: str(64), periodId: str(64), amountCents: looseNum, label: str(200) }, [], { 'x-forbidden': ['status'] });
export const COMP_RETAIL_POLICY_BODY: BodySchema = S.object({ method: str(16), value: looseNum });
export const COMP_TIP_POLICY_BODY: BodySchema = S.object({ manyTechTipMethod: str(32) });
/** manual per-technician tip allocation for one ticket (POST /pos/tickets/:id/tip-allocation): Σ tipCents must equal the ticket tip (the service checks) */
/** activating a rule version: the one-time Super Admin commission authorization code (SUPER_ADMIN sessions omit it) */
export const COMP_RULE_ACTIVATE_BODY: BodySchema = S.object({ adminAuthCode: str(64) });
export const COMP_TIP_ALLOCATION_BODY: BodySchema = S.object({
  allocations: S.array(S.object({ technicianId: S.text(64), tipCents: S.cents() }, ['technicianId', 'tipCents']), { maxItems: 50 }), reason: str(500),
}, ['allocations']);
/** D15/D19 gaps (Nov 5 2026): a free-form tip adjustment — one technician, a signed amount, a reason (never the card charge) */
export const COMP_TIP_ADJUSTMENT_BODY: BodySchema = S.object({
  technicianId: S.uuid(), amountCents: S.integer({ minimum: -100000, maximum: 100000 }), reason: S.text(500, { minLength: 3 }),
}, ['technicianId', 'amountCents', 'reason']);
/** pure-compute previews: the engine input (service lines + tip are engine objects the calculator validates) */
export const COMP_PREVIEW_BODY: BodySchema = S.object({
  ticketId: str(64), branchId: str(64), serviceLines: S.nullable(S.array(S.freeObject(), { maxItems: 200 })), tip: free,
  policyId: str(64), policyVersion: num, engineVersion: str(40),
});
export const COMP_SUPPLY_PREVIEW_BODY: BodySchema = S.object({ config: free, priceCents: looseNum });
export const COMP_GUARANTEE_PREVIEW_BODY: BodySchema = S.object({ policy: free, facts: free, earnings: free, manualProratedCents: num });
export const COMP_VALIDATE_BODY: BodySchema = S.object({ rule: free, supply: free });
export const COMP_RULE_CREATE_BODY: BodySchema = S.object({
  scope: S.nullable(S.object({ branchId: str(64), technicianId: str(64), serviceId: str(64), serviceCategory: str(80), ticketId: str(64) })),
  label: str(200), version: S.nullable(versionPayload),
});
export const COMP_SEED_DEFAULT_BODY: BodySchema = S.object({ technicianPercent: num });
// Extras · Deals & Offers 12: approving a deal's commission impact carries an optional note
export const COMP_DEAL_REVIEW_APPROVE_BODY: BodySchema = S.object({ note: str(500) });
/** owner-web sends { version }; the handler also takes a bare version payload (b?.version ?? b) */
export const COMP_RULE_VERSION_BODY: BodySchema = S.object({ ...versionPayload.properties!, version: S.nullable(versionPayload) });
const band: BodySchema = S.freeObject();
export const COMP_TIER_PLAN_BODY: BodySchema = S.object({ technicianId: str(64), branchId: str(64), mode: str(16), bands: S.nullable(S.array(band, { maxItems: 50 })) });
export const COMP_TIER_PREVIEW_BODY: BodySchema = S.object({ productionCents: looseNum, bands: S.nullable(S.array(band, { maxItems: 50 })) });

// tech profile (tech-web, customer-web, pos-web, admin-web)
export const TECH_PROFILE_UPDATE_BODY: BodySchema = S.object({
  displayName: str(200), title: str(200), bio: str(4000), yearsExperience: looseNum, specialties: strs(50, 100), certifications: strs(50, 200),
  styleTags: strs(50, 100), languages: strs(30, 60), profileLinks: free, profileLinkVisibility: free,
  isPublic: bool, marketplaceDiscoveryEnabled: bool, acceptsMessages: bool, isBookable: bool, careerHistoryPublic: bool,
});
export const TECH_MEMBERSHIP_REQUEST_BODY: BodySchema = S.object({ salonCode: scalar(64), message: str(1000), transfer: bool });
export const TECH_REVIEW_RESPOND_BODY: BodySchema = S.object({ response: str(2000) });
export const DM_SEND_BODY: BodySchema = S.object({ body: str(4000) });
export const DM_REPORT_BODY: BodySchema = S.object({ reason: str(1000) });
/** multipart: every form field arrives as a string */
export const TECH_PHOTOS_FORM_BODY: BodySchema = S.object({ caption: str(500) });
export const TECH_PHOTO_CONSENT_BODY: BodySchema = S.object({ approvedUses: strs(20, 40), customerId: str(64), ticketId: str(64), consentVersion: str(40), device: str(200), session: str(200) });
export const TECH_BEFORE_AFTER_FORM_BODY: BodySchema = S.object({ servicePerformed: str(200), designNotes: str(1000), productsUsed: str(500), durationMinutes: looseNum, customerConsent: { type: ['boolean', 'string', 'null'], maxLength: 8 } });
export const TECH_BEFORE_AFTER_UPDATE_BODY: BodySchema = S.object({ servicePerformed: str(200), designNotes: str(1000), productsUsed: str(500), durationMinutes: looseNum, customerConsent: bool, isPublic: bool });
export const TECH_PHOTO_REORDER_BODY: BodySchema = S.object({ photoIds: S.nullable(S.array(scalar(64), { maxItems: 500 })) });
export const TECH_PHOTO_UPDATE_BODY: BodySchema = S.object({
  caption: str(500), tags: strs(30, 60), serviceCategory: str(80), nailShape: str(40), nailLength: str(40), designStyle: str(40), complexity: str(40),
  brand: str(80), colorName: str(80), isPublic: bool, isFeatured: bool,
});
export const TECH_SA_VERIFICATION_BODY: BodySchema = S.object({ status: str(20), note: str(1000) });
export const TECH_SA_DM_REPORT_BODY: BodySchema = S.object({ action: str(20) });
/** tenantId as the target salon was a legacy alias of salonId; the tenant-context middleware strips it, so only salonId is declared */
export const TECH_SWITCH_SALON_BODY: BodySchema = S.object({ salonId: str(64) });
export const POS_TECH_PROFILE_BODY: BodySchema = S.object({ displayName: str(200), title: str(200), bio: str(4000), specialties: strs(50, 100) });
export const POS_TECH_FEATURE_BODY: BodySchema = S.object({ featured: bool });
/** Technician Profile §95: the salon's approval switch, and a decision on a held public-profile edit (optimistic version). */
export const POS_TECH_PROFILE_POLICY_BODY: BodySchema = S.object({ publicProfileChangesRequireApproval: bool });
export const POS_TECH_PROFILE_CHANGE_DECISION_BODY: BodySchema = S.object({ version: num, note: str(300) });
export const POS_TECH_RATING_HIDE_BODY: BodySchema = S.object({ hidden: bool, reason: str(1000) });
export const POS_TECH_PHOTO_HIDE_BODY: BodySchema = S.object({ reason: str(500) });   // merge Oct 12 2026: a per-salon portfolio hide (574) carries an optional reason
export const CUSTOMER_TECH_FAVORITE_BODY: BodySchema = S.object({ publicSlug: str(120), technicianId: str(64) });
export const CUSTOMER_TECH_EVENT_BODY: BodySchema = S.object({ type: str(40), ref: str(500) });
export const CUSTOMER_TECH_RATING_BODY: BodySchema = S.object({ technicianId: str(64), rating: looseNum, reviewText: str(4000), tags: strs(20, 60), isPublic: bool });

// nail showcase + social (customer-web, pos-web, admin-web)
const nsPhoto: BodySchema = S.object({ imageUrl: str(2000), thumbnailUrl: str(2000), caption: str(500), metadata: free });
export const NS_POST_BODY: BodySchema = S.object({
  caption: str(2000), tags: strs(30, 60), visibility: str(20), allowComments: bool, isAnonymous: bool, displayName: str(200),
  technicianId: str(64), serviceId: str(64), salonTenantId: str(64), branchId: str(64), photos: S.nullable(S.array(nsPhoto, { maxItems: 20 })),
});
export const NS_POST_UPDATE_BODY: BodySchema = S.object({ caption: str(2000), tags: strs(30, 60), visibility: str(20), allowComments: bool });
/** multipart (files) or JSON { photos: [...] } */
export const NS_PHOTOS_BODY: BodySchema = S.object({ caption: str(500), photos: S.nullable(S.array(nsPhoto, { maxItems: 20 })) });
export const NS_REACTION_BODY: BodySchema = S.object({ reactionType: str(16) });
export const NS_COMMENT_BODY: BodySchema = S.object({ commentText: str(2000), text: str(2000) });
export const NS_REPORT_BODY: BodySchema = S.object({ reason: str(64), details: str(2000) });
export const NS_RESOLVE_REPORT_BODY: BodySchema = S.object({ status: str(20) });
export const SOCIAL_PROFILE_BODY: BodySchema = S.object({ publicDisplayName: str(200), bio: str(2000), profileVisibility: str(20), showRankOnProfile: bool, showPostsOnProfile: bool, allowFollowers: bool });
/** multipart file, or JSON { avatarUrl } */
export const SOCIAL_AVATAR_BODY: BodySchema = S.object({ avatarUrl: str(2000) });

// approvals (pos-web posApprovalsApi, owner-web ownerApprovalRequestsApi) — cleanCreate / cleanDecision / cleanPolicyChange keep every rule
const MONEY_STATUS: BodySchema['x-forbidden'] = ['status', 'decidedByUserId', 'approvedByUserId'];
export const APPROVAL_CREATE_BODY: BodySchema = S.object({ kind: str(40), subjectType: str(60), subjectId: scalar(100), amountCents: looseNum, reason: str(2000), payload: free, branchId: str(64), title: str(200) }, [], { 'x-forbidden': MONEY_STATUS });
export const APPROVAL_DECIDE_BODY: BodySchema = S.object({ decision: str(16), note: str(2000), expectedVersion: looseNum }, [], { 'x-forbidden': MONEY_STATUS });
export const APPROVAL_CANCEL_BODY: BodySchema = S.object({ reason: str(1000) });
export const APPROVAL_ESCALATE_BODY: BodySchema = S.object({ reason: str(1000) });   // round 10 (Approvals 01 point 2)
export const APPROVAL_POLICY_BODY: BodySchema = S.object({
  kind: str(40), expectedVersion: looseNum, reason: str(2000), enabled: { type: ['boolean', 'string', 'number', 'null'], maxLength: 8 },
  thresholdCents: looseNum, cashThresholdCents: looseNum, approverLimitCents: looseNum,
  requireDifferentApprover: { type: ['boolean', 'string', 'number', 'null'], maxLength: 8 }, expiresAfterHours: looseNum,
});

// access governance, payroll, time clock, cash handoff (pos-web / tech-web)
export const ACCESS_REVIEW_START_BODY: BodySchema = S.object({ dueAt: str(40) });
export const ACCESS_REVIEW_DECISION_BODY: BodySchema = S.object({ userId: str(64), decision: str(16), note: str(1000), templateKey: str(80) });
export const PAYROLL_PERIOD_BODY: BodySchema = S.object({ label: str(200), periodStart: str(40), periodEnd: str(40), technicianId: str(64) }, [], { 'x-forbidden': ['status'] });
/** reopening a finalized period (POST /pos/payroll/periods/:id/reopen): the written reason is mandatory (the service checks ≥ 3 chars) */
export const PAYROLL_REOPEN_BODY: BodySchema = S.object({ reason: str(500), expectedVersion: S.nullable(S.integer({ minimum: 1 })) });
// Payroll mandate wave 2 (Oct 12 2026): the review / approval / payout / export / adjustment / exception / inquiry /
// pay-plan bodies. Money is integer cents (S.integer — never a float); amounts the server derives are never accepted.
const version = S.nullable(S.integer({ minimum: 1 }));
export const PAYROLL_PREPARE_BODY: BodySchema = S.object({ expectedVersion: version });
export const PAYROLL_SEND_BACK_BODY: BodySchema = S.object({ reason: str(500), expectedVersion: version });
export const PAYROLL_APPROVE_BODY: BodySchema = S.object({ expectedVersion: version, calculationHash: S.nullable(S.text(64)) }, [], { 'x-forbidden': ['status', 'payableCents', 'approvalHash'] });
export const PAYROLL_PAY_BODY: BodySchema = S.object({ expectedVersion: version, method: S.nullable(S.enumOf(['cash', 'check', 'direct_deposit', 'external_provider', 'other'])), reference: str(120) });
export const PAYROLL_PAYOUT_BODY: BodySchema = S.object({
  technicianId: S.text(64), amountCents: S.integer({ minimum: 1 }), method: S.enumOf(['cash', 'check', 'direct_deposit', 'external_provider', 'other']),
  status: S.nullable(S.enumOf(['pending', 'paid'])), reference: str(120), note: str(500), idempotencyKey: str(120),
}, ['technicianId', 'amountCents', 'method']);
export const PAYROLL_PAYOUT_STATUS_BODY: BodySchema = S.object({ status: S.enumOf(['processing', 'paid', 'failed', 'canceled']), failureReason: str(300), reference: str(120) }, ['status']);
export const PAYROLL_EXPORT_BODY: BodySchema = S.object({ format: S.enumOf(['csv', 'xlsx']) }, ['format']);
export const PAYROLL_ADJUSTMENT_BODY: BodySchema = S.object({
  technicianId: S.text(64), category: S.enumOf(['bonus', 'commission_correction', 'guarantee_correction', 'payroll_correction', 'deduction']),
  amountCents: S.integer(), reasonCode: S.text(40), reason: S.text(500), deductionType: str(40), idempotencyKey: str(120),
}, ['technicianId', 'category', 'amountCents', 'reasonCode', 'reason']);
export const PAYROLL_ADJUSTMENT_DECISION_BODY: BodySchema = S.object({ decision: S.enumOf(['approve', 'reject']), reason: str(500) }, ['decision']);
export const PAYROLL_EXCEPTION_ACTION_BODY: BodySchema = S.object({ action: S.enumOf(['resolve', 'dismiss', 'retry']), note: str(500) }, ['action']);
export const PAYROLL_INQUIRY_RESPOND_BODY: BodySchema = S.object({ response: S.text(1000), privateNote: str(1000), close: bool }, ['response']);
export const PAY_PLAN_BODY: BodySchema = S.object({
  technicianId: S.text(64), branchId: str(64), payType: S.enumOf(['commission', 'hourly', 'salary', 'hybrid']),
  hourlyRateCents: S.nullable(S.cents()), salaryCentsPerPeriod: S.nullable(S.cents()), breaksPaid: bool, overtimeWeeklyMinutes: S.nullable(S.integer({ minimum: 1 })),
  effectiveStart: S.text(10), effectiveEnd: str(10), note: str(300),
}, ['technicianId', 'payType', 'effectiveStart']);
export const DEDUCTION_TYPE_BODY: BodySchema = S.object({ key: S.text(40), label: S.text(80), enabled: bool, maxCentsPerPeriod: S.nullable(S.integer({ minimum: 1 })) }, ['key', 'label']);

// ── Weekly Paycheck mandate (Oct 21 2026): schedule / payout plan / submit / owner decision / check + cash payouts ──────
const methodKey = S.enumOf(['check', 'cash', 'ach', 'direct_deposit', 'external_transfer', 'payroll_provider']);
export const PAYCHECK_SCHEDULE_BODY: BodySchema = S.object({
  frequency: S.nullable(S.enumOf(['weekly', 'biweekly', 'semimonthly', 'monthly'])), weekStartDay: S.nullable(S.integer({ minimum: 0, maximum: 6 })), payDayOffsetDays: S.nullable(S.integer({ minimum: 0, maximum: 31 })),
  timezone: str(64), active: bool, autoPrepare: bool, defaultPolicy: S.nullable(S.enumOf(['split_check_cash', 'all_check', 'all_cash'])), defaultCheckBp: S.nullable(S.integer({ minimum: 0, maximum: 10000 })),
  primaryMethod: S.nullable(S.enumOf(['check', 'cash'])), cashEnabled: bool, maxCashBp: S.nullable(S.integer({ minimum: 0, maximum: 10000 })), allowedMethods: S.nullable(S.array(methodKey, { maxItems: 6 })),
  manualSplitAllowed: bool, cashTipsAlreadyPaid: bool, cashPaidOn: S.nullable(S.enumOf(['acknowledged', 'handed_off'])), version: S.nullable(S.integer({ minimum: 0 })),
});
export const PAYCHECK_PLAN_BODY: BodySchema = S.object({
  policyType: S.enumOf(['split_check_cash', 'all_check', 'all_cash', 'manual_percent', 'manual_amount']),
  entries: S.nullable(S.array(S.object({ method: methodKey, basisPoints: S.nullable(S.integer({ minimum: 0, maximum: 10000 })), amountCents: S.nullable(S.integer({ minimum: 0 })) }, ['method']), { maxItems: 6 })),
  overrideReason: str(500), expectedVersion: version,
}, ['policyType'], { 'x-forbidden': ['approvedPayableCents', 'payableCents', 'status'] });
export const PAYCHECK_SUBMIT_BODY: BodySchema = S.object({ expectedVersion: version });
export const PAYCHECK_APPROVE_BODY: BodySchema = S.object({ expectedVersion: version, calculationHash: S.nullable(S.text(64)), holdTechnicianIds: S.nullable(S.array(S.text(64), { maxItems: 500 })) }, [], { 'x-forbidden': ['status', 'payableCents'] });
export const PAYCHECK_DECISION_BODY: BodySchema = S.object({ note: S.text(1000), expectedVersion: version }, ['note']);
export const PAYCHECK_ISSUE_CHECK_BODY: BodySchema = S.object({ checkNumber: S.text(20) }, ['checkNumber'], { 'x-forbidden': ['amountCents'] });
export const PAYCHECK_VOID_CHECK_BODY: BodySchema = S.object({ reason: S.text(300), returned: bool, replacementCheckNumber: str(20) }, ['reason']);
export const PAYCHECK_PREPARE_CASH_BODY: BodySchema = S.object({ cashSource: S.enumOf(['register_drawer', 'safe', 'bank_withdrawal', 'other_recorded_source']), registerId: str(40), branchId: str(64) }, ['cashSource'], { 'x-forbidden': ['amountCents'] });
export const PAYCHECK_HANDOFF_BODY: BodySchema = S.object({ deviceId: str(80) });
export const PAYCHECK_PIN_ACK_BODY: BodySchema = S.object({ pin: S.text(8), deviceId: str(80) }, ['pin']);
// Weekly Paycheck close-out (Oct 27 2026, §11.5): the technician's PIN + signature strokes (SVG path data, never a bitmap); the dual
// confirmation carries the PIN (the manager's proof is the route's fresh step-up); the period cancel needs a reason
export const PAYCHECK_SIGNATURE_ACK_BODY: BodySchema = S.object({ pin: S.text(8), signature: S.text(16000), deviceId: str(80) }, ['pin', 'signature']);
export const PAYCHECK_CANCEL_PERIOD_BODY: BodySchema = S.object({ reason: S.text(500), expectedVersion: version }, ['reason']);
export const PAYCHECK_RESOLVE_CASH_BODY: BodySchema = S.object({ action: S.enumOf(['rehandoff', 'cancel']), reason: S.text(500) }, ['action', 'reason']);
export const PAYCHECK_ADD_PAYOUT_BODY: BodySchema = S.object({ method: S.enumOf(['check', 'cash']), amountCents: S.nullable(S.integer({ minimum: 1 })) }, ['method']);
// PAYROLL_LINE_BODY (manual payroll line) was REMOVED Oct 13 2026 (FLOW D7) with its route.
export const TIME_CLOCK_BODY: BodySchema = S.object({ technicianId: scalar(64) });
// 200-Technician 04: the opening-rush batch clock-in — at most 25 technicians per tap
export const TIME_CLOCK_BATCH_BODY: BodySchema = S.object({ technicianIds: S.array(S.text(64), { maxItems: 25 }) });
// Technician Profile merge (Oct 12 2026): breaks are part of the clock; the manager "not taking customers" flag.
export const TIME_CLOCK_BREAK_BODY: BodySchema = S.object({ technicianId: scalar(64), kind: str(16), reason: str(500) });
// Fair Turn Engine (wave 2): break interruption + the salon break policy (time-clock.controller.ts)
export const TIME_CLOCK_INTERRUPT_BODY: BodySchema = S.object({ technicianId: scalar(64), reason: str(500) });
export const BREAK_POLICY_BODY: BodySchema = S.object({ scope: str(16), policy: S.nullable(S.freeObject()), reason: str(500) });
export const WORKFORCE_UNAVAILABLE_BODY: BodySchema = S.object({ on: bool });
export const CLOCK_PIN_RESET_BODY: BodySchema = S.object({ pin: scalar(16) });
export const TIMECARD_ADJUST_BODY: BodySchema = S.object({ startTime: str(40), endTime: str(40), reason: str(1000) });
export const BREAK_ADJUST_BODY: BodySchema = S.object({ startedAt: str(40), endedAt: str(40), reason: str(1000) });   // Fair Turn §39 (break corrections)
// End-of-Day Cash (Oct 29 2026): mode 'add' = a partial hand-off; denominations = the optional count sheet; expectedVersion =
// optimistic concurrency; idempotencyKey = one event per submission; transferToDrawer = the custody movement into the register
export const CASH_HANDOFF_RECONCILE_BODY: BodySchema = S.object({ countedCents: looseNum, notes: str(2000), date: str(10), mode: str(8),
  denominations: S.nullable(S.array(S.object({ denominationCents: looseNum, quantity: looseNum }), { maxItems: 20 })), expectedVersion: looseNum, idempotencyKey: str(120), transferToDrawer: bool, registerId: str(64) },
  [], { 'x-forbidden': ['status', 'expectedCents', 'varianceCents'] });
export const CASH_HANDOFF_RESOLVE_BODY: BodySchema = S.object({ reason: str(500), date: str(10), expectedVersion: looseNum }, ['reason'], { 'x-forbidden': ['status', 'expectedCents', 'varianceCents', 'countedCents'] });
export const CASH_HANDOFF_SUBMIT_BODY: BodySchema = S.object({ date: str(10) }, [], { 'x-forbidden': ['status', 'expectedCents'] });

// ── merge Oct 12 2026 (BK): time-off request workflow (technician-time-off.controller.ts) ─────────────────────────────
export const TIME_OFF_REQUEST_BODY: BodySchema = S.object({ startsAt: str(40), endsAt: str(40), kind: str(16), reason: str(500) }, [], { 'x-forbidden': ['status', 'technicianId', 'approvedBy', 'tenantId'] });
export const TIME_OFF_CREATE_BODY: BodySchema = S.object({ startsAt: str(40), endsAt: str(40), kind: str(16), reason: str(500), allBranches: bool }, [], { 'x-forbidden': ['status', 'approvedBy', 'tenantId'] });
export const TIME_OFF_DECISION_BODY: BodySchema = S.object({ decision: str(16), note: str(500) });

// ── Fair Turn Engine (wave 2): the technician turn queue (turn-queue.controller.ts) ───────────────────────────────────
const turnReason: BodySchema = str(500);
export const TURN_HOLD_BODY: BodySchema = S.object({ reason: turnReason });
export const TURN_RELEASE_BODY: BodySchema = S.object({ reason: turnReason, toBack: S.nullable(S.boolean()) });
export const TURN_REORDER_BODY: BodySchema = S.object({ setNext: S.nullable(S.boolean()), toBack: S.nullable(S.boolean()), beforeTechnicianId: str(64), toIndex: S.nullable(S.number()), reason: turnReason, expectedVersion: S.nullable(S.number()) });
export const TURN_ADJUST_BODY: BodySchema = S.object({ turns: S.oneOfTypes(['number', 'string', 'null'], { maxLength: 12 }), reason: turnReason, queueItemId: str(64) });
export const TURN_JOIN_BODY: BodySchema = S.object({ reason: turnReason });
export const TURN_CUSTOMER_DECLINED_BODY: BodySchema = S.object({ queueItemId: str(64), technicianId: str(64), reason: turnReason });
export const TURN_DAY_CLOSE_BODY: BodySchema = S.object({ businessDate: str(10), reason: turnReason });
export const TURN_SETTINGS_PREVIEW_BODY: BodySchema = S.object({ scope: str(16), assignmentMode: str(32), fairnessMode: str(40), turnPolicy: S.nullable(S.freeObject()) });
export const TURN_RULE_BODY: BodySchema = S.object({ ruleKey: str(64), scope: str(16), serviceId: str(64), category: str(120), maxDurationMinutes: S.nullable(S.number()), turns: S.oneOfTypes(['number', 'string', 'null'], { maxLength: 12 }), specialRotation: S.nullable(S.boolean()), reason: turnReason });
export const TURN_RULE_RETIRE_BODY: BodySchema = S.object({ reason: turnReason });

// Finish the Five (Oct 30 2026): commission discrepancy review actions, Run Check, refund-reversal policy, per-date
// shift overrides and composite-score snapshots. The repositories re-check every rule (state machine, version, own pay,
// conflicts); these refuse malformed input first.
export const CDR_ASSIGN_BODY: BodySchema = S.object({ assigneeUserId: S.text(64), expectedVersion: S.number(), note: str(2000) }, ['assigneeUserId', 'expectedVersion']);
export const CDR_NOTE_BODY: BodySchema = S.object({ note: S.text(2000), expectedVersion: S.number() }, ['note', 'expectedVersion']);
export const CDR_INVESTIGATE_BODY: BodySchema = S.object({ note: str(2000), expectedVersion: S.number() }, ['expectedVersion']);
export const CDR_RESOLVE_BODY: BodySchema = S.object({ resolutionCode: S.text(32), note: S.text(2000), expectedVersion: S.number() }, ['resolutionCode', 'note', 'expectedVersion']);
export const CDR_REASON_BODY: BodySchema = S.object({ reason: S.text(2000), expectedVersion: S.number() }, ['reason', 'expectedVersion']);
export const CDR_RUN_BODY: BodySchema = S.object({ preset: str(16), from: str(10), to: str(10) });
export const CDR_POLICY_BODY: BodySchema = S.object({ policy: S.text(20), expectedPolicy: S.nullable(S.text(20)) }, ['policy']);   // round 10: optimistic check on what the screen loaded
const overrideBreak: BodySchema = S.object({ type: S.text(16), startLocalTime: S.text(5), endLocalTime: S.text(5) }, ['type', 'startLocalTime', 'endLocalTime']);
export const SHIFT_OVERRIDE_BODY: BodySchema = S.object({
  technicianId: S.text(64), localDate: S.text(10), overrideType: S.text(20), startLocalTime: str(5), endLocalTime: str(5), endsNextDay: bool,
  breaks: S.nullable(S.array(overrideBreak, { maxItems: 6 })), reason: str(500), expectedVersion: num, acknowledgeConflicts: bool,
}, ['technicianId', 'localDate', 'overrideType']);
export const SCORE_SNAPSHOT_BODY: BodySchema = S.object({ technicianId: S.text(64), preset: str(16), from: str(10), to: str(10) }, ['technicianId']);

// Team Management Data Accuracy Alerts (30 Oct 2026, migration 722): review actions + Run Check. The repository re-checks
// the state machine, the version (409), the reason and the permission; these refuse malformed input first.
export const TDA_RUN_BODY: BodySchema = S.object({});
export const TDA_ASSIGN_BODY: BodySchema = S.object({ assigneeUserId: S.text(64), expectedVersion: S.number(), note: str(2000) }, ['assigneeUserId', 'expectedVersion']);
export const TDA_INVESTIGATE_BODY: BodySchema = S.object({ note: str(2000), expectedVersion: S.number() }, ['expectedVersion']);
export const TDA_NOTE_BODY: BodySchema = S.object({ note: S.text(2000), expectedVersion: S.number() }, ['note', 'expectedVersion']);
export const TDA_RESOLVE_BODY: BodySchema = S.object({ note: S.text(2000), expectedVersion: S.number() }, ['note', 'expectedVersion']);
export const TDA_REASON_BODY: BodySchema = S.object({ reason: S.text(2000), expectedVersion: S.number() }, ['reason', 'expectedVersion']);

// Technician Profile & Team Management guide (Nov 5 2026, G3, migration 816): repeating weekly days off + the Skills Catalog.
const ids = (n = 100): BodySchema => S.nullable(S.array(S.text(64), { maxItems: n }));
export const WEEKLY_OFF_BODY: BodySchema = S.object({
  technicianId: S.text(64), weekdays: S.array(S.integer(), { maxItems: 7 }), effectiveFrom: S.text(10), effectiveTo: str(10), reason: str(500), expectedVersion: num, acknowledgeConflicts: bool, allBranches: bool,
}, ['technicianId', 'weekdays', 'effectiveFrom']);
export const WEEKLY_OFF_END_BODY: BodySchema = S.object({ technicianId: S.text(64), ruleId: S.text(64), endFrom: S.text(10), reason: str(500), expectedVersion: num }, ['technicianId', 'ruleId', 'endFrom']);
export const SKILL_BODY: BodySchema = S.object({ id: str(64), name: S.text(80), category: str(60), description: str(500), requiredCertification: str(120), serviceIds: ids(), expectedVersion: num }, ['name']);
export const SKILL_ARCHIVE_BODY: BodySchema = S.object({ archived: bool, reason: str(500) });
export const SKILL_ASSIGN_BODY: BodySchema = S.object({ technicianId: S.text(64), skillIds: S.array(S.text(64), { maxItems: 50 }), proficiency: str(20), effectiveFrom: str(10), expiresOn: str(10) }, ['technicianId', 'skillIds']);
export const SKILL_REVOKE_BODY: BodySchema = S.object({ technicianId: S.text(64), assignmentId: S.text(64), reason: S.text(500), expectedVersion: num, acknowledgeBookings: bool }, ['technicianId', 'assignmentId', 'reason']);
