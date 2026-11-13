// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the request-body schemas of the tenants module's mutating routes (POS
// Settings sections + their actions, Salon Locations, the Super Admin location review, platform branding, the owner
// salon switch, the social planner), applied with @Body(ValidatedBody(SCHEMA)). Each was written from the handler and
// the service it calls AND from every client that calls the route today (pos-web posSettingsApi / POSSettingsScreen /
// POSGiftCardSettingsScreen / AuthSecurityPanels / posDevicesApi / posMessageTemplatesApi / posLocationsApi /
// posSocialApi, owner-web OwnerSalonContext, admin-web superAdminApi) — so every body sent today still passes.
//
// The POS Settings PATCH routes MERGE the body into the stored section ({ ...before, ...patch }) — before this schema a
// client could write ANY key into a salon's settings blob. Each section now declares exactly the keys of its settings
// DTO (settings.dto.ts); other keys are stripped (the stored value is kept, never deleted). The service's own
// validate() still checks ranges and vocabularies, so the scalar types here stay as loose as the screens send them.
import { S, type BodySchema } from '@aipowersalon/permissions';

const bool: BodySchema = { type: ['boolean', 'null'] };
const num: BodySchema = { type: ['number', 'string', 'null'], maxLength: 40 };
const text = (max = 500): BodySchema => ({ type: ['string', 'null'], maxLength: max });
const nums = (max = 50): BodySchema => S.nullable(S.array({ type: ['number', 'string'], maxLength: 40 }, { maxItems: max }));
const texts = (max = 50, len = 80): BodySchema => S.nullable(S.array(S.text(len), { maxItems: max }));
const flags = (keys: string[]): BodySchema => S.nullable(S.object(Object.fromEntries(keys.map((k) => [k, bool]))));
const section = (props: Record<string, BodySchema>): BodySchema => S.object(props);

// ── POS Settings sections (PATCH /pos/settings/<section>) ──────────────────────────────────────────────────────────
export const SETTINGS_BUSINESS_BRANCH_BODY = section({
  salonName: text(120), legalName: text(160), businessType: text(80), website: text(300), email: text(254), phone: text(40),
  branchName: text(120), address: text(300), city: text(120), state: text(80), zip: text(20), currency: text(8),
  timezone: text(64), dateFormat: text(40), multiBranchEnabled: bool, perBranchOverrides: bool,
  defaultLanguage: S.enumOf(['en', 'vi']),   // the salon's POS language (Oct 21 2026)
});
const DAY: BodySchema = S.nullable(S.object({ isOpen: bool, openTime: text(8), closeTime: text(8) }));
export const SETTINGS_STORE_HOURS_BODY = section({
  storeHours: S.nullable({ type: 'object', additionalProperties: DAY }),
  autoLogoutEnabled: bool, warningMinutes: nums(10), gracePeriodMinutes: num, afterCloseExtensionMinutes: num,
  exemptRoles: texts(10, 32), timezone: text(64),
});
export const SETTINGS_PAYMENTS_CHECKOUT_BODY = section({
  methods: flags(['card', 'cash', 'giftCard', 'split']), creditCardSurchargeEnabled: bool, creditCardSurchargePercent: num,
  surchargeLabel: text(80), cashDiscountEnabled: bool, whoCanRefund: text(80), whoCanOverride: text(80),
  managerApprovalOverCents: num, customerDisplayMode: text(32),
  customerDisplayCaptureMode: S.enumOf(['front_desk', 'terminal']),   // Payment Terminals: who captures the card (read by checkout)
});
export const SETTINGS_GIFT_CARD_BODY = section({
  enabled: bool, posSalesEnabled: bool, customerAppSalesEnabled: bool, sendToFriendEnabled: bool, presetAmountsCents: nums(20),
  customAmountEnabled: bool, minAmountCents: num, maxAmountCents: num, crossBranchRedemption: bool, expirationPolicy: text(32),
  partialRedemption: bool, multiplePerCheckout: bool, refundToCardDefault: bool, transferable: bool, scheduledDeliveryEnabled: bool,
  deliveryChannels: flags(['sms', 'email', 'inApp']), barcodeFormat: text(16), presentationTokenTtlSeconds: num,
  managerApprovalOverCents: num, dailyPurchaseLimitCents: num, networkGiftCardsEnabled: bool, sellNetworkGiftCards: bool,
  redeemNetworkGiftCards: bool, termsVersion: text(32),
});
export const SETTINGS_TIPS_BODY = section({
  defaultTipPercents: nums(10), allowCustomTip: bool, allowNoTip: bool, maxTipPercent: num, tipBase: text(32), assignToPrimaryTech: bool, perTechnicianTips: bool,
});
export const SETTINGS_TAX_BODY = section({
  enabled: bool, taxRatePercent: num, taxLabel: text(80), mode: text(16), appliesToServices: bool, appliesToProducts: bool,
  exemptCustomers: bool, exemptServices: bool, exemptCategories: texts(100, 120), roundingRule: text(16),
});
export const SETTINGS_BOOKING_BODY = section({
  slotIntervalMinutes: num, bufferMinutes: num, cleanupMinutes: num, defaultDurationMinutes: num, minLeadTimeMinutes: num,
  maxAdvanceDays: num, cancellationWindowHours: num, noShowPolicy: text(80), noShowFeeCents: num, depositRequired: bool,
  depositPercent: num, noDoubleBooking: bool, overbookingAllowance: num, overbookingPolicy: text(40),
});
export const SETTINGS_ONLINE_BOOKING_BODY = section({
  onlineBookingEnabled: bool, tenantSlug: text(80), googleBookingLink: text(500), aiPhoneEnabled: bool,
  aiActions: flags(['findAvailability', 'create', 'reschedule', 'cancel', 'sendReminder']),
});
export const SETTINGS_NOTIFICATIONS_BODY = section({
  smsConfirmation: bool, emailConfirmation: bool, pushConfirmation: bool, reminderHours: nums(10), noShowFollowUp: bool,
  receiptDelivery: texts(5, 16), senderBrand: text(80), a2pStatus: text(32), marketingOptInRequired: bool, emailSenderName: text(80), emailReplyTo: text(254),
});
export const SETTINGS_QUEUE_WORKFLOW_BODY = section({
  avgServiceMinutes: num, showWaitToGuest: bool, autoFlowToCheckout: bool, manualApprovalBeforeCheckout: bool,
  allowReopenService: bool, vipPriority: bool, appointmentOverWalkIn: bool,
  // the retired switches (BUILD_PLAN Phase 6) — accepted from an old screen, then dropped by the service before saving
  autoAssign: S.any(), assignBy: S.any(),
});
export const SETTINGS_SERVICES_PRICING_BODY = section({
  defaultDurationMinutes: num, newServicesTaxable: bool, showOnOnlineBooking: bool, allowAiBooking: bool, enforceSkillMapping: bool,
});
export const SETTINGS_TECHNICIANS_STAFF_BODY = section({
  commissionBasis: text(32), defaultCommissionPercent: num, payrollPeriod: text(16), techCanProcessPayment: bool,
  techCanEditServiceLines: bool, techCanMarkDone: bool,
});
export const SETTINGS_SECURITY_BODY = section({ pinLogin: bool, passkeyEnabled: bool, mfaForOwner: bool, rememberTrustedDevices: bool, auditRetention: text(16),
  autoLockEnabled: bool, autoLockMinutes: num });   // Oct 12 2026: POS auto-lock (server-enforced); the service checks the listed minutes
/** the role matrix IS this section's payload: [{ permission, roles[] }] */
export const SETTINGS_ROLES_BODY = section({
  matrix: S.nullable(S.array(S.object({ permission: S.text(120), roles: texts(10, 32) }), { maxItems: 500 })),
});
export const SETTINGS_LOYALTY_BODY = section({
  earnRatePerDollar: num, redemption: text(120), pointsExpiration: text(80), vipSilverCents: num, vipGoldCents: num,
  vipPlatinumCents: num, membershipEnabled: bool, memberDiscountPercent: num, birthdayReward: bool, referralReward: bool, giftCardsEnabled: bool,
});
export const SETTINGS_CUSTOMER_DISPLAY_BODY = section({
  enabled: bool, displayMode: text(32), stationNumber: text(40), idleMessage: text(200), sessionTimeoutMinutes: num,
  tipPromptEnabled: bool, receiptPromptEnabled: bool, displayBranding: bool, tagline: text(200), showBranchName: bool,
});
export const SETTINGS_RECEIPTS_BODY = section({
  showLogo: bool, logoRef: text(500), header: text(500), footer: text(500), businessAddress: text(300), thankYouMessage: text(300),
  showSurchargeLine: bool, showTechnicianLines: bool, showServiceNotes: bool, showDiscountLine: bool, showLoyaltyPoints: bool,
  showTips: bool, defaultDelivery: texts(5, 16), brandStyle: text(40),
  // batch 8 decision 5 (Nov 9 2026): the salon's brand colours, #RRGGBB or null to clear
  brandPrimary: S.nullable(S.string({ pattern: '^#[0-9A-Fa-f]{6}$' })), brandAccent: S.nullable(S.string({ pattern: '^#[0-9A-Fa-f]{6}$' })),
});

// ── POS Settings actions ─────────────────────────────────────────────────────────────────────────────────────────
/** POST /pos/settings/payments-checkout/terminals/pair — { code, label, stationId?, hsn? } (posDevicesApi) */
export const TERMINAL_PAIR_BODY = S.object({ code: text(64), label: text(80), stationId: text(64), hsn: text(64), merchantAccountId: text(64), idempotencyKey: text(64) });   // + processor account and request key (Nov 4 2026)
/** POST …/terminals/:id/register — { stationId: a register of this location | null } */
export const TERMINAL_REGISTER_BODY = S.object({ stationId: text(64) });
/** wave 3 PAYI §52: POST …/terminals/:id/rename — { label, terminalType?, serialNumber?, connectionType? }; POST …/terminals/:id/disable — { reason } */
export const TERMINAL_RENAME_BODY = S.object({ label: text(80), terminalType: text(40), serialNumber: text(64), connectionType: text(20) });
export const TERMINAL_DISABLE_BODY = S.object({ reason: text(200) });
/** POST /pos/settings/online-google-ai-booking/connect-google — { link } */
export const CONNECT_GOOGLE_BODY = S.object({ link: text(1000) });
/** POST /pos/settings/online-google-ai-booking/ai — { enabled, actions? } */
export const BOOKING_AI_BODY = S.object({ enabled: { type: ['boolean', 'string', 'number', 'null'], maxLength: 10 }, actions: flags(['findAvailability', 'create', 'reschedule', 'cancel', 'sendReminder']) });
/** POST /pos/settings/notifications-reminders/a2p-register — { brand } */
export const A2P_REGISTER_BODY = S.object({ brand: text(120) });
/** POST /pos/settings/notifications-reminders/templates — a MessageTemplate { id?, channel, name, body } */
export const MESSAGE_TEMPLATE_BODY = S.object({ id: text(80), channel: text(16), name: text(120), body: text(2000) });
/** POST /pos/settings/receipts-branding/send-test — { to, channel? } */
export const RECEIPT_TEST_BODY = S.object({ to: text(320), channel: text(16) });
/** POST /pos/settings/receipts-branding/logo — { logo: data URL } (salon-logo.ts checks the bytes; ≤ 1 MB decoded) */
export const RECEIPT_LOGO_BODY = S.object({ logo: text(Math.ceil(1_000_000 * 4 / 3) + 256) });

// ── Salon Locations (/tenant/locations) ─────────────────────────────────────────────────────────────────────────
const LOCATION_FIELDS: Record<string, BodySchema> = {
  name: text(160), public_display_name: text(160), salon_code: text(64), description: text(2000), phone: text(40),
  public_email: text(254), website: text(300), address: text(300), address_line2: text(300), suite_unit: text(40),
  city: text(120), state: text(80), zip: text(20), country_code: text(4), formatted_address: text(500), timezone: text(64),
  is_online_booking_enabled: bool, accepts_walk_ins: bool, show_phone_publicly: bool, show_address_publicly: bool,
  show_prices_publicly: bool, booking_lead_minutes: { type: ['integer', 'number', 'string', 'null'], maxLength: 12 },
  manager_name: text(160), manager_phone: text(40), manager_email: text(254), internal_notes: text(4000),
};
/** POST /tenant/locations — { name, … } (the create also reads the duplicate-check hints) */
export const LOCATION_CREATE_BODY = S.object({
  ...LOCATION_FIELDS, google_place_id: text(300),
  latitude: { type: ['number', 'string', 'null'], maxLength: 40 }, longitude: { type: ['number', 'string', 'null'], maxLength: 40 },
});
/** PATCH /tenant/locations/:id — the writable columns (the service's WRITABLE set) */
export const LOCATION_UPDATE_BODY = S.object(LOCATION_FIELDS);
/** POST /tenant/locations/geocode — { query } */
export const GEOCODE_BODY = S.object({ query: text(500) });
const GEOCODE_HIT = S.object({
  formattedAddress: text(500), latitude: { type: ['number', 'null'] }, longitude: { type: ['number', 'null'] }, placeId: text(300),
  accuracy: text(40), city: text(120), state: text(80), zip: text(20), country: text(80),
});
/** POST /tenant/locations/:id/apply-address — { hit: GeocodeHit } (or the hit itself, which the handler also accepts) */
export const APPLY_ADDRESS_BODY: BodySchema = S.object({ hit: S.nullable(GEOCODE_HIT), ...(GEOCODE_HIT.properties ?? {}) });
/** PATCH /tenant/locations/:id/map-pin — { latitude, longitude, source } */
export const MAP_PIN_BODY = S.object({ latitude: { type: ['number', 'string', 'null'], maxLength: 40 }, longitude: { type: ['number', 'string', 'null'], maxLength: 40 }, source: text(40) });
/** PATCH /super-admin/tenant-locations/:id/map-pin — { latitude, longitude } */
export const SA_MAP_PIN_BODY = S.object({ latitude: { type: ['number', 'string', 'null'], maxLength: 40 }, longitude: { type: ['number', 'string', 'null'], maxLength: 40 } });
/** POST /super-admin/tenant-locations/:id/reject | suspend — { reason } */
export const SA_LOCATION_REASON_BODY = S.object({ reason: text(2000) });

// ── platform branding, owner switch, social planner ──────────────────────────────────────────────────────────────
/** PATCH /super-admin/settings/branding — the seven branding keys (branding.service COLOR_KEYS) */
export const BRANDING_BODY = S.object({
  platform_name: text(200), tagline: text(200), primary_color: text(16), secondary_color: text(16), accent_color: text(16),
  surface_color: text(16), text_color: text(16),
});
/** POST /owner/context/switch — { salonId, branchId } (owner-web): the salon the owner WANTS; the server decides */
export const OWNER_SWITCH_BODY = S.object({ salonId: text(64), branchId: text(64) });
/** POST /pos/social-posts — { platform, caption, scheduledAt? } */
export const SOCIAL_POST_BODY = S.object({ platform: text(40), caption: text(5000), scheduledAt: text(40) });
/** POST /pos/social-posts/:id/status — { status } (the post's lifecycle — SOCIAL_POST machine) */
export const SOCIAL_POST_STATUS_BODY = S.object({ status: text(20) });
/** POST /tenant/notifications/alerts/read — { alertIds } (pos-web bell panel / AI Alerts incidents): my read state only */
export const ALERT_READ_BODY = S.object({ alertIds: S.array(S.uuid(), { minItems: 1, maxItems: 200 }) }, ['alertIds']);
/** POST /tenant/navigation/badges/sync — { unread, surface? } (pos-web shell after a successful badge read) */
export const BADGE_SYNC_BODY = S.object({ unread: S.integer({ minimum: 0, maximum: 100000 }), surface: S.enumOf(['pos', 'owner_app', 'tech_app']) }, ['unread']);
