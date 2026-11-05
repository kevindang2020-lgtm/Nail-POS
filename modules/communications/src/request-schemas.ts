// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the communications module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from each handler + service (the fields actually read: campaigns, threads,
// Super Admin announcements / limits / templates / providers, follow-ups, notifications, reminders, push, SMS packages
// and tenant plans, A2P, tenant messaging) and from the clients that call them (pos-web posCampaignsApi /
// posCommunicationsApi / posFollowUpApi / posNotificationsApi / posRemindersApi / posSmsPlanApi / POSMessagingSetupScreen,
// tech-web techFollowUpApi + techApi, owner-web + customer-web pushApi, customer-web customerFollowUpApi, admin-web
// superAdminApi / superAdminCommunicationsApi / superAdminSmsApi / superAdminAiApi). Unknown fields are stripped.
//
// Super Admin routes may name a tenant in the body (the tenant-context middleware keeps `tenantId` for SUPER_ADMIN only):
// the two handlers that READ one declare it. Provider credentials are accepted only where the route takes a secret
// (create / rotate) — never on the config PATCH. The Twilio webhooks keep EVERY form field the provider sends: Twilio
// signs the full parameter set, so a stripped field would break the signature check (additionalProperties: true).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
const num: BodySchema = S.nullable(S.number());
const looseNum: BodySchema = { type: ['number', 'string', 'null'], maxLength: 32 };
const bool: BodySchema = S.nullable(S.boolean());
const strs = (n = 100, max = 200): BodySchema => S.nullable(S.array(S.text(max), { maxItems: n }));

/** a route whose handler reads no field (kept as a declared, empty shape) */
export const EMPTY_BODY: BodySchema = S.object({});

// campaigns (pos-web posCampaignsApi) + Super Admin campaign oversight (admin-web superAdminApi)
const campaign = { name: str(200), offer: str(500), channel: str(20), audienceLabel: str(200), audienceSize: num, scheduledAt: str(40), costCents: num };
export const CAMPAIGN_CREATE_BODY: BodySchema = S.object(campaign, [], { 'x-forbidden': ['status'] });
export const CAMPAIGN_UPDATE_BODY: BodySchema = S.object(campaign, [], { 'x-forbidden': ['status'] });
/** wave 3 PAYI §81: POST /pos/campaigns/:id/activate — { confirmEstimate?: boolean } (required true for a large SMS campaign) */
export const CAMPAIGN_ACTIVATE_BODY: BodySchema = S.object({ confirmEstimate: bool });
export const MC_ANNOUNCEMENT_BODY: BodySchema = S.object({ title: str(200), body: str(5000), channel: str(20), audienceScope: str(40), tenantIds: strs(5000, 64), scheduledAt: str(40) });
export const MC_CANCEL_BODY: BodySchema = S.object({ reason: str(1000) });
export const MC_PAUSE_BODY: BodySchema = S.object({ subjectType: str(40), subjectId: scalar(64), subjectName: str(200), tenantId: str(64), currentStatus: str(32), reason: str(1000) });
export const MC_LIMITS_BODY: BodySchema = S.object({ maxSendsPerDay: num, maxCampaignsPerDay: num, quietHoursStart: num, quietHoursEnd: num, minHoursBetween: num });
export const MC_TEMPLATE_BODY: BodySchema = S.object({
  name: str(200), campaignType: str(40), channel: str(20), subject: str(500), body: str(10000), smsContent: str(2000), pushTitle: str(200), pushContent: str(2000),
  suggestedAudience: str(500), suggestedOffer: str(500), complianceNote: str(2000),
});
export const MC_TEMPLATE_VERSION_BODY: BodySchema = S.object({ subject: str(500), body: str(10000), channel: str(20), notes: str(2000) });

// threads (pos-web posCommunicationsApi)
export const THREAD_CREATE_BODY: BodySchema = S.object({ customerId: str(64), customerName: str(200), customerContact: str(254), channel: str(20), subject: str(500), initialInbound: str(5000) });
export const THREAD_REPLY_BODY: BodySchema = S.object({ body: str(5000) });
export const THREAD_ASSIGN_BODY: BodySchema = S.object({ userId: str(64), userName: str(200) });
export const THREAD_STATUS_BODY: BodySchema = S.object({ status: str(20) });

// Super Admin communications (admin-web superAdminCommunicationsApi)
export const SA_ANNOUNCEMENT_BODY: BodySchema = S.object({
  title: str(200), subject: str(500), body: str(10000), channel: str(20), priority: str(20), recipientRoles: strs(50, 40), targetScope: str(40),
  targetTenantIds: strs(5000, 64), scheduledAt: str(40), idempotencyKey: str(200),
});
export const SA_TENANT_LIMIT_BODY: BodySchema = S.object({
  monthlySms: num, monthlyEmail: num, monthlyPush: num, dailyLimit: num, enforcement: str(20), optOutRateThresholdBps: num, failureRateThresholdBps: num, status: str(20),
});
/** a platform template may be scoped to one salon: `tenantId` is read (Super Admin only) */
export const SA_TEMPLATE_BODY: BodySchema = S.object({ name: str(200), channel: str(20), subject: str(500), body: str(10000), pushTitle: str(200), category: str(80), tenantId: str(64) });
export const SA_TEMPLATE_VERSION_BODY: BodySchema = S.object({ body: str(10000), subject: str(500), pushTitle: str(200) });
export const SA_TEMPLATE_PREVIEW_BODY: BodySchema = S.object({ body: str(10000), values: S.nullable({ type: 'object', additionalProperties: scalar(2000) }) });
export const SA_PROVIDER_CREATE_BODY: BodySchema = S.object({ name: str(200), channel: str(20), credential: str(4096), region: str(64), accountReference: str(200), apiEndpoint: str(2000), webhookEndpoint: str(2000), priority: looseNum });
/** config only — a secret on this route is refused (rotation is its own route) */
export const SA_PROVIDER_UPDATE_BODY: BodySchema = S.object({ name: str(200), region: str(64), apiEndpoint: str(2000), webhookEndpoint: str(2000), priority: looseNum, status: str(20) }, [], { 'x-forbidden': ['credential'] });
export const SA_PROVIDER_ROTATE_BODY: BodySchema = S.object({ credential: str(4096) });

// end-of-day follow-ups (pos-web posFollowUpApi, tech-web techFollowUpApi, customer-web customerFollowUpApi)
export const FOLLOWUP_CUSTOMER_REPLY_BODY: BodySchema = S.object({ text: str(2000), message: str(2000) });
export const FOLLOWUP_MESSAGE_BODY: BodySchema = S.object({ message: str(2000) });
export const FOLLOWUP_SKIP_BODY: BodySchema = S.object({ reason: str(1000) });
export const FOLLOWUP_PREVIEW_BODY: BodySchema = S.object({ templateKey: str(80) });
export const FOLLOWUP_SETTINGS_BODY: BodySchema = S.object({
  enabled: bool, generationTime: str(5), timezone: str(64), allowTechEditMessage: bool, allowCustomerReplies: bool, requireManagerApproval: bool,
  reminderToTech: bool, createMode: str(20), autoExpirePendingHours: num, defaultMessageTemplate: str(2000),
});

// Twilio webhooks — the provider's form; the fields the handler reads are typed, every other field is KEPT (signature)
/** a Twilio callback (form-encoded, flat): Twilio adds parameters without notice, so the form stays open — a reviewed §40
 *  exception, bounded to 2 levels and 500 parameters; the X-Twilio-Signature over the posted parameters is the authentication */
const twilioForm = (props: Record<string, BodySchema>): BodySchema => S.object(props, [], { additionalProperties: true });
export const TWILIO_INBOUND_BODY: BodySchema = twilioForm({ From: str(64), To: str(64), Body: str(4000), AccountSid: str(64), MessageSid: str(64) });
export const TWILIO_STATUS_BODY: BodySchema = twilioForm({ MessageSid: str(64), SmsSid: str(64), MessageStatus: str(32), SmsStatus: str(32), AccountSid: str(64), ErrorCode: scalar(16) });

// notifications / reminders / push
export const NOTIFICATION_SEND_BODY: BodySchema = S.object({ channel: str(10), to: str(254), subject: str(500), body: str(5000), customerId: str(64) });
export const NOTIFICATION_OPT_BODY: BodySchema = S.object({ channel: str(10), address: str(254), reason: str(1000) });
/** ladderMinutes (Oct 21 2026): the reminder ladder, minutes before the start (e.g. [1440, 120, 30]); null = the single leadMinutes */
export const REMINDERS_BODY: BodySchema = S.object({ enabled: bool, leadMinutes: num, windowMinutes: num, channel: str(10), ladderMinutes: S.nullable(S.array({ type: ['number', 'string'], maxLength: 8 }, { maxItems: 5 })) });
export const PUSH_REGISTER_BODY: BodySchema = S.object({ platform: str(16), token: str(4096), app: str(20) });
export const PUSH_UNREGISTER_BODY: BodySchema = S.object({ token: str(4096) });

// SMS packages / tenant plans (admin-web superAdminSmsApi, pos-web posSmsPlanApi)
export const SMS_CONTROL_BODY: BodySchema = S.object({ key: str(80), enabled: { type: ['boolean', 'string', 'null'], maxLength: 8 }, reason: str(1000) });
export const SMS_DEFAULT_PACKAGE_BODY: BodySchema = S.object({ code: str(64), reason: str(1000) });
/** the service type-checks each editable column itself (and answers bad_value) — the schema declares the columns */
const anyScalar: BodySchema = { type: ['string', 'number', 'boolean', 'null'], maxLength: 2000 };
export const SMS_PACKAGE_UPDATE_BODY: BodySchema = S.object({
  name: anyScalar, description: anyScalar, monthly_price_cents: anyScalar, included_verification_count: anyScalar, overage_enabled: anyScalar,
  overage_unit_price_cents: anyScalar, hard_limit_enabled: anyScalar, warning_threshold_percent: anyScalar, critical_threshold_percent: anyScalar,
  self_service_available: anyScalar, display_order: anyScalar,
});
export const SMS_FINDING_RESOLVE_BODY: BodySchema = S.object({ disposition: str(16) });
export const SMS_ASSIGN_BODY: BodySchema = S.object({ packageId: scalar(64), effective: str(20), reason: str(1000) });
export const SMS_CREDIT_BODY: BodySchema = S.object({ amount: looseNum, reason: str(1000) }, [], { 'x-forbidden': ['status'] });
export const SMS_UPGRADE_BODY: BodySchema = S.object({ packageId: scalar(64) });

// A2P + tenant messaging numbers / credentials (admin-web superAdminAiApi, pos-web POSMessagingSetupScreen)
export const A2P_NUMBER_BODY: BodySchema = S.object({ phoneNumberSid: str(64) });
/** stored whole as the TrustHub business identity: known fields typed, other scalar fields kept (the screen owns the form) */
export const A2P_BUSINESS_INFO_BODY: BodySchema = S.object({
  businessName: str(200), einTaxId: str(40), businessType: str(80), businessIndustry: str(80), businessRegistrationIdentifier: str(80), websiteUrl: str(2000),
  regionsOfOperation: str(200), street: str(200), city: str(100), region: str(100), postalCode: str(20), isoCountry: str(4),
  repFirstName: str(100), repLastName: str(100), repEmail: str(254), repPhone: str(40), repBusinessTitle: str(100), repJobPosition: str(100),
}, [], { additionalProperties: { type: ['string', 'number', 'boolean', 'null'], maxLength: 2000 } });
export const A2P_INPUTS_BODY: BodySchema = S.object({
  customerProfileBundleSid: str(64), a2pProfileBundleSid: str(64), brandType: str(32), isMock: bool, campaignUsecase: str(64), campaignDescription: str(4000),
  messageSamples: strs(10, 1024), messageFlow: str(4000), optInMessage: str(1024), optOutMessage: str(1024), helpMessage: str(1024),
  privacyPolicyUrl: str(2000), termsAndConditionsUrl: str(2000), hasEmbeddedLinks: bool, hasEmbeddedPhone: bool,
});
export const PHONE_NUMBER_BODY: BodySchema = S.object({ phoneNumber: str(32) });
/** B-16: provision a platform-managed salon's texting (Super Admin; the reason is required, the number / area code optional) */
export const PLATFORM_PROVISION_BODY: BodySchema = S.object({ reason: str(1000), areaCode: str(3), phoneNumber: str(32) });
/** §149: shut down a cancelled salon's platform-managed texting (release the number, close the subaccount) — a reason */
export const PLATFORM_OFFBOARD_BODY: BodySchema = S.object({ reason: str(1000) });
export const MESSAGING_TEST_BODY: BodySchema = S.object({ to: str(32) });
export const MESSAGING_CREDS_BODY: BodySchema = S.object({ accountSid: str(64), authToken: str(256), fromNumber: str(32), verifyServiceSid: str(64), apiKeySid: str(64), apiKeySecret: str(256) });

// ── Platform Announcements on the POS top bar (Oct 22 2026) ──────────────────────────────────────────────────────────
// The service re-validates everything (plain text, audience, window, versions); these refuse malformed input first and
// forbid fields only the server may set (status, version, publishedBy, the stats).
const noticeEnum = (v: readonly string[]) => S.enumOf([...v]);
export const PLATFORM_NOTICE_WRITE_BODY: BodySchema = S.object({
  title: str(120), message: S.text(4000), type: noticeEnum(['info', 'update', 'maintenance', 'warning', 'urgent']), priority: noticeEnum(['low', 'normal', 'high', 'critical']),
  audience: noticeEnum(['all_tenants', 'selected_tenants', 'selected_branches']), tenantIds: strs(5000, 64), branchIds: strs(5000, 64),
  startsAt: str(40), endsAt: str(40), dismissible: bool, requiresAcknowledgement: bool, expectedVersion: S.nullable(S.integer({ minimum: 1 })),
  titleVi: str(120), messageVi: S.nullable(S.text(4000)), viReviewed: bool, englishOnly: bool,   // WP-F (§56–§57)
}, ['message', 'type', 'priority', 'audience'], { 'x-forbidden': ['status', 'lifecycleStatus', 'version', 'publishedBy', 'publishedAt', 'stats', 'viReviewedBy', 'viReviewedAt'] });
export const PLATFORM_NOTICE_PATCH_BODY: BodySchema = S.object({
  title: str(120), message: S.nullable(S.text(4000)), type: S.nullable(noticeEnum(['info', 'update', 'maintenance', 'warning', 'urgent'])), priority: S.nullable(noticeEnum(['low', 'normal', 'high', 'critical'])),
  audience: S.nullable(noticeEnum(['all_tenants', 'selected_tenants', 'selected_branches'])), tenantIds: strs(5000, 64), branchIds: strs(5000, 64),
  startsAt: str(40), endsAt: str(40), dismissible: bool, requiresAcknowledgement: bool, expectedVersion: S.integer({ minimum: 1 }),
  titleVi: str(120), messageVi: S.nullable(S.text(4000)), viReviewed: bool, englishOnly: bool,   // WP-F (§56–§57)
}, ['expectedVersion'], { 'x-forbidden': ['status', 'lifecycleStatus', 'version', 'publishedBy', 'publishedAt', 'stats', 'viReviewedBy', 'viReviewedAt'] });
export const PLATFORM_NOTICE_PUBLISH_BODY: BodySchema = S.object({ expectedVersion: S.nullable(S.integer({ minimum: 1 })), publishNow: bool, startsAt: str(40), confirm: bool });
export const PLATFORM_NOTICE_ACTION_BODY: BodySchema = S.object({ expectedVersion: S.nullable(S.integer({ minimum: 1 })) });
export const POS_NOTICE_RECEIPT_BODY: BodySchema = S.object({ contentVersion: S.integer({ minimum: 1 }) }, ['contentVersion']);
