// settings.dto.ts — AIPowerSalon POS Settings Center (tenant-scoped, 17 categories).
// One GET /pos/settings/state to load; PATCH /pos/settings/:category to save one category.
// Context (tenant/branch/role/permissions) is resolved from the session — NEVER trust a frontend tenantId.

import { AUTO_LOCK_DEFAULT } from '@aipowersalon/api-contracts';   // Oct 12 2026: the POS auto-lock default (on, 60)
export type Role = "OWNER" | "MANAGER" | "FRONT_DESK" | "RECEPTION" | "TECHNICIAN";
export type SettingsCategory =
  | "business-branch" | "store-hours-auto-logout" | "payments-checkout" | "tips" | "tax"
  | "booking-appointments" | "online-google-ai-booking" | "notifications" | "queue-workflow" | "technician-app"
  | "services-pricing" | "technicians-staff" | "roles-permissions" | "security"
  | "loyalty-memberships" | "customer-display-devices" | "receipts-branding"
  | "gift-card-settings"
  | "subscription-plan" | "audit-logs";

export interface SettingsContext { tenantId: string; branchId: string; userId: string; role: Role; permissions: string[]; }

// ---- category shapes (kept lean; each maps to a settings card group) ----
export interface BusinessBranchSettings { salonName: string; legalName: string; businessType: string; website?: string; email?: string; phone?: string; branchName: string; address?: string; city?: string; state?: string; zip?: string; currency: string; timezone: string; dateFormat: string; multiBranchEnabled: boolean; perBranchOverrides: boolean;
  /** the salon's POS language for staff who never chose one (Oct 21 2026): 'en' | 'vi' — a user's own choice (users.preferred_language) wins */
  defaultLanguage?: 'en' | 'vi'; }
export interface DayHour { isOpen: boolean; openTime: string | null; closeTime: string | null; }
export interface StoreHoursAutoLogoutSettings { storeHours: Record<string, DayHour>; autoLogoutEnabled: boolean; warningMinutes: number[]; gracePeriodMinutes: number; afterCloseExtensionMinutes: number; exemptRoles: Role[]; timezone: string; }
export interface PaymentsCheckoutSettings { methods: { card: boolean; cash: boolean; giftCard: boolean; split: boolean }; creditCardSurchargeEnabled: boolean; creditCardSurchargePercent: number; surchargeLabel: string; cashDiscountEnabled: boolean; whoCanRefund: string; whoCanOverride: string; managerApprovalOverCents: number; customerDisplayMode: "review_only" | "tip_only" | "customer_pays";
  /** Card Payment Capture Routing (Payment Terminals mandate §15): 'terminal' = the customer display's Pay starts the charge on the
   *  register's paired terminal; 'front_desk' (default) = the front desk completes the card payment at the POS. */
  customerDisplayCaptureMode?: "front_desk" | "terminal"; }
export interface TipSettings { defaultTipPercents: number[]; allowCustomTip: boolean; allowNoTip: boolean; maxTipPercent: number; tipBase: "service_subtotal" | "pre_tax_subtotal"; assignToPrimaryTech: boolean;
  /** G4 Split Tips (Nov 5 2026): the customer tips each performing technician on the display (default off) */
  perTechnicianTips?: boolean; }
export interface TaxSettings { enabled: boolean; taxRatePercent: number; taxLabel: string; mode: "exclusive" | "inclusive"; appliesToServices: boolean; appliesToProducts: boolean; exemptCustomers: boolean; exemptServices: boolean; exemptCategories: string[]; roundingRule: "half_up" | "bankers" | "none"; }
export interface BookingAppointmentSettings { slotIntervalMinutes: number; bufferMinutes: number; cleanupMinutes: number; defaultDurationMinutes: number; minLeadTimeMinutes: number; maxAdvanceDays: number; cancellationWindowHours: number; noShowPolicy: string; noShowFeeCents: number; depositRequired: boolean; depositPercent: number; noDoubleBooking: boolean; overbookingAllowance: number; /** Smooth Refresh spec §11 — how the booking engine treats a technician double-booking. Default BLOCK. */ overbookingPolicy?: 'BLOCK' | 'WARN_REQUIRE_CONFIRMATION' | 'ALLOW_AUTHORIZED_ROLE'; }
export interface OnlineGoogleAiBookingSettings { onlineBookingEnabled: boolean; tenantSlug: string; googleBookingLink?: string; aiPhoneEnabled: boolean; aiActions: { findAvailability: boolean; create: boolean; reschedule: boolean; cancel: boolean; sendReminder: boolean }; }
export interface NotificationSettings { smsConfirmation: boolean; emailConfirmation: boolean; pushConfirmation: boolean; reminderHours: number[]; noShowFollowUp: boolean; receiptDelivery: string[]; senderBrand: string; a2pStatus: string; marketingOptInRequired: boolean;
  /** Email guide (Oct 31 2026): the salon's EMAIL display name and reply-to — separate from `senderBrand`, which a read replaces
   *  with the SMS (A2P) brand. Absent on older rows: the send path falls back to the stored senderBrand, then the salon name. */
  emailSenderName?: string; emailReplyTo?: string; }
export interface TechnicianAppSettings { enabled: boolean; techCanAddService: boolean; techCanChangeService: boolean; techCanRemoveLine: boolean; requireApprovalForChangeService: boolean; requireApprovalForRemoveLine: boolean; }
// BUILD_PLAN Phase 6 (audit "three auto-assign switches", "rotation configured twice"): `autoAssign` (default TRUE,
// read by nothing) and `assignBy` are RETIRED. Auto-assignment and the rotation policy have ONE home: the AI
// queue-assignment settings (pos/ai-queue-assignment — salon defaults, branch overrides, kill switches, versions).
export interface QueueWorkflowSettings { avgServiceMinutes: number; showWaitToGuest: boolean; autoFlowToCheckout: boolean; manualApprovalBeforeCheckout: boolean; allowReopenService: boolean; vipPriority: boolean; appointmentOverWalkIn: boolean; }
export interface ServicesPricingSettings { defaultDurationMinutes: number; newServicesTaxable: boolean; showOnOnlineBooking: boolean; allowAiBooking: boolean; enforceSkillMapping: boolean; }
// defaultCommissionPercent was a DUPLICATE of tenants.default_commission_percent (the ONE salon default the commission
// resolver reads — PATCH /pos/technicians/salon-commission, admin-code gated). It is no longer seeded and is ignored by
// pricing; kept optional only so an old client payload still deserialises (Oct 12 2026 merge).
export interface TechniciansStaffSettings { commissionBasis: "per_technician" | "per_service" | "hybrid"; /** @deprecated use tenants.default_commission_percent */ defaultCommissionPercent?: number; payrollPeriod: "weekly" | "biweekly" | "monthly"; techCanProcessPayment: boolean; techCanEditServiceLines: boolean; techCanMarkDone: boolean; }
export interface RolePermissionEntry { permission: string; roles: Role[]; }
export interface RolesPermissionsSettings { matrix: RolePermissionEntry[]; }
export interface SecuritySettings { pinLogin: boolean; passkeyEnabled: boolean; mfaForOwner: boolean; rememberTrustedDevices: boolean; auditRetention: "30d" | "90d" | "1y" | "forever";
  /** Kevin, Oct 12 2026: the POS auto-lock — on by default at 60 minutes, enforced by the server on POS sessions (the maximum for every device). */
  autoLockEnabled: boolean; autoLockMinutes: number; }
export interface LoyaltyMembershipSettings { earnRatePerDollar: number; redemption: string; pointsExpiration: string; vipSilverCents: number; vipGoldCents: number; vipPlatinumCents: number; membershipEnabled: boolean; memberDiscountPercent: number; birthdayReward: boolean; referralReward: boolean; giftCardsEnabled: boolean; }
// Server-enforced digital gift-card program config (spec: Payments & Money → Gift Card Settings). All money in
// integer cents. Enforced on the backend at sale/redemption — never trusted from the client.
export interface GiftCardSettings {
  enabled: boolean;
  posSalesEnabled: boolean;
  customerAppSalesEnabled: boolean;
  sendToFriendEnabled: boolean;
  presetAmountsCents: number[];
  customAmountEnabled: boolean;
  minAmountCents: number;
  maxAmountCents: number;
  crossBranchRedemption: boolean;
  expirationPolicy: "none" | "12_months" | "24_months" | "36_months";
  partialRedemption: boolean;
  multiplePerCheckout: boolean;
  refundToCardDefault: boolean;
  transferable: boolean;
  scheduledDeliveryEnabled: boolean;
  deliveryChannels: { sms: boolean; email: boolean; inApp: boolean };
  barcodeFormat: "qr" | "code128";
  presentationTokenTtlSeconds: number;
  managerApprovalOverCents: number;
  dailyPurchaseLimitCents: number;
  // AI PowerSalon Network Gift Card (cross-tenant) participation. Network redemption is gated behind platform
  // program approval + clearing (a later phase); these express tenant intent and the UI shows an honest
  // "pending program approval — not yet active" state until that infrastructure is live.
  networkGiftCardsEnabled: boolean;
  sellNetworkGiftCards: boolean;
  redeemNetworkGiftCards: boolean;
  termsVersion: string;
}
/** displayBranding / tagline / showBranchName / idleMessage drive the header and footer of the salon's 23-inch customer
 *  display (spec §13); the logo itself is the salon logo (Receipts & Branding). */
export interface CustomerDisplayDeviceSettings { enabled: boolean; displayMode: "review_only" | "tip_only" | "customer_pays"; stationNumber?: string; idleMessage: string; sessionTimeoutMinutes: number; tipPromptEnabled: boolean; receiptPromptEnabled: boolean; displayBranding: boolean; tagline: string; showBranchName: boolean; }
export interface ReceiptsBrandingSettings { showLogo: boolean; logoRef?: string; /** batch 8 decision 5: #RRGGBB, unset = no brand colour */ brandPrimary?: string | null; brandAccent?: string | null; header: string; footer: string; businessAddress?: string; thankYouMessage: string; showSurchargeLine: boolean; showTechnicianLines: boolean; showServiceNotes: boolean; showDiscountLine: boolean; showLoyaltyPoints: boolean; showTips: boolean; defaultDelivery: string[]; brandStyle: string; }
export interface SubscriptionPlanSettings { plan: string; tier: string; billingStatus: string; aiPackageIncluded: boolean; aiPackage: string; aiFeatures: Record<string, boolean>; customerCount: number | null; technicianCount: number | null; smsThisMonth: number | null; readOnly: true; }

export interface POSSettingsState {
  context: SettingsContext;
  businessBranch: BusinessBranchSettings;
  storeHoursAutoLogout: StoreHoursAutoLogoutSettings;
  paymentsCheckout: PaymentsCheckoutSettings;
  tips: TipSettings; tax: TaxSettings;
  bookingAppointments: BookingAppointmentSettings;
  onlineGoogleAiBooking: OnlineGoogleAiBookingSettings;
  notifications: NotificationSettings; queueWorkflow: QueueWorkflowSettings; technicianApp: TechnicianAppSettings;
  servicesPricing: ServicesPricingSettings; techniciansStaff: TechniciansStaffSettings;
  rolesPermissions: RolesPermissionsSettings; security: SecuritySettings;
  loyaltyMemberships: LoyaltyMembershipSettings; customerDisplayDevices: CustomerDisplayDeviceSettings;
  receiptsBranding: ReceiptsBrandingSettings; subscriptionPlan: SubscriptionPlanSettings;
  giftCardSettings: GiftCardSettings;
  auditLogs: { recentItems: POSSettingsAuditLogRow[] };
  sectionStatuses: { sectionKey: SettingsCategory; label: string; completionPercent: number; status: ModuleStatusLevel; missingReasons: string[] }[];
  moduleStatus?: POSSettingsModuleStatus;
}

// permission key required to EDIT each category (view governed by settings.view)
export const CATEGORY_EDIT_PERMISSION: Record<SettingsCategory, string | null> = {
  "business-branch": "settings.business_edit", "store-hours-auto-logout": "settings.hours_edit",
  "payments-checkout": "settings.payments_edit", "tips": "settings.tips_edit", "tax": "settings.tax_edit",
  "technician-app": "settings.workflow_edit",
  "booking-appointments": "settings.booking_edit", "online-google-ai-booking": "settings.booking_edit",
  "notifications": "settings.notifications_edit", "queue-workflow": "settings.workflow_edit",
  "services-pricing": "settings.services_edit", "technicians-staff": "settings.staff_edit",
  "roles-permissions": "settings.roles_edit", "security": "settings.security_edit",
  "loyalty-memberships": "settings.loyalty_edit", "customer-display-devices": "settings.devices_edit",
  "receipts-branding": "settings.receipts_edit",
  "gift-card-settings": "settings.gift_cards_edit",
  "subscription-plan": null, "audit-logs": null, // read-only for tenants
};

/** Keys a stored queue-workflow row may still carry from before BUILD_PLAN Phase 6. Never returned, never saved. */
export const RETIRED_QUEUE_WORKFLOW_KEYS = ["autoAssign", "assignBy"] as const;
/** The queue-workflow category without the retired switches (for a stored row read back, or a client still sending them). */
export function withoutRetiredQueueWorkflowKeys<T extends Record<string, unknown>>(v: T): Omit<T, (typeof RETIRED_QUEUE_WORKFLOW_KEYS)[number]> {
  const out: Record<string, unknown> = { ...v };
  for (const k of RETIRED_QUEUE_WORKFLOW_KEYS) delete out[k];
  return out as Omit<T, (typeof RETIRED_QUEUE_WORKFLOW_KEYS)[number]>;
}

// ---- pure helpers (unit-tested) ----
export function can(permissions: string[], key: string): boolean { return permissions.indexOf(key) >= 0; }
export function canEditCategory(category: SettingsCategory, permissions: string[]): boolean {
  const need = CATEGORY_EDIT_PERMISSION[category];
  if (need === null) return false;            // read-only categories never editable by tenant
  return can(permissions, "settings.edit") || can(permissions, need);
}
// never return raw secrets to the client
// maskSecret: the one display form lives in @aipowersalon/security (maskSecretTail) — re-exported under its old name.
export { maskSecretTail as maskSecret } from '@aipowersalon/security';
// dirty-state diff: shallow keys that changed between saved and edited
export function changedKeys<T extends object>(before: T, after: T): string[] {
  const out: string[] = []; const keys = Object.keys(after) as (keyof T)[];
  for (const k of keys) { if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(String(k)); }
  return out;
}
export function isDirty<T extends object>(before: T, after: T): boolean { return changedKeys(before, after).length > 0; }

// ---- safe defaults: created ONCE per tenant/branch, then persisted (no frontend-only settings) ----
export const DEFAULT_SETTINGS: Omit<POSSettingsState, "context" | "auditLogs" | "moduleStatus" | "sectionStatuses"> = {
  businessBranch: { salonName: "", legalName: "", businessType: "Nail Salon", branchName: "Main", currency: "USD", timezone: "America/New_York", dateFormat: "MMM DD, YYYY", multiBranchEnabled: false, perBranchOverrides: true, defaultLanguage: "en" },
  storeHoursAutoLogout: { storeHours: { monday:{isOpen:true,openTime:"09:00",closeTime:"19:30"}, tuesday:{isOpen:true,openTime:"09:00",closeTime:"19:30"}, wednesday:{isOpen:true,openTime:"09:00",closeTime:"19:30"}, thursday:{isOpen:true,openTime:"09:00",closeTime:"19:30"}, friday:{isOpen:true,openTime:"09:00",closeTime:"19:30"}, saturday:{isOpen:true,openTime:"09:00",closeTime:"19:30"}, sunday:{isOpen:false,openTime:null,closeTime:null} }, autoLogoutEnabled: true, warningMinutes: [30,15,5], gracePeriodMinutes: 0, afterCloseExtensionMinutes: 30, exemptRoles: ["OWNER","MANAGER"], timezone: "America/New_York" },
  paymentsCheckout: { methods: { card:true, cash:true, giftCard:true, split:true }, creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3.0, surchargeLabel: "Card Surcharge", cashDiscountEnabled: false, whoCanRefund: "Owner & Manager", whoCanOverride: "Owner & Manager", managerApprovalOverCents: 10000, customerDisplayMode: "tip_only" },
  tips: { defaultTipPercents: [15,18,20], allowCustomTip: true, allowNoTip: true, maxTipPercent: 100, tipBase: "service_subtotal", assignToPrimaryTech: true, perTechnicianTips: false },
  tax: { enabled: true, taxRatePercent: 7.75, taxLabel: "Sales Tax", mode: "exclusive", appliesToServices: true, appliesToProducts: true, exemptCustomers: true, exemptServices: true, exemptCategories: ["Gift Cards"], roundingRule: "half_up" },
  bookingAppointments: { slotIntervalMinutes: 15, bufferMinutes: 10, cleanupMinutes: 5, defaultDurationMinutes: 45, minLeadTimeMinutes: 120, maxAdvanceDays: 60, cancellationWindowHours: 24, noShowPolicy: "charge_fee", noShowFeeCents: 2500, depositRequired: false, depositPercent: 20, noDoubleBooking: true, overbookingAllowance: 0, overbookingPolicy: "BLOCK" },
  onlineGoogleAiBooking: { onlineBookingEnabled: true, tenantSlug: "", aiPhoneEnabled: true, aiActions: { findAvailability:true, create:true, reschedule:true, cancel:false, sendReminder:true } },
  notifications: { smsConfirmation: true, emailConfirmation: true, pushConfirmation: true, reminderHours: [24,2], noShowFollowUp: true, receiptDelivery: ["SMS","Email"], senderBrand: "AIPowerSalon", a2pStatus: "registered", marketingOptInRequired: true },
  queueWorkflow: { avgServiceMinutes: 45, showWaitToGuest: true, autoFlowToCheckout: true, manualApprovalBeforeCheckout: false, allowReopenService: true, vipPriority: true, appointmentOverWalkIn: true },
  technicianApp: { enabled: true, techCanAddService: true, techCanChangeService: true, techCanRemoveLine: false, requireApprovalForChangeService: true, requireApprovalForRemoveLine: true },
  servicesPricing: { defaultDurationMinutes: 45, newServicesTaxable: true, showOnOnlineBooking: true, allowAiBooking: true, enforceSkillMapping: true },
  techniciansStaff: { commissionBasis: "per_service", payrollPeriod: "biweekly", techCanProcessPayment: false, techCanEditServiceLines: true, techCanMarkDone: true },
  rolesPermissions: { matrix: [
    { permission: "checkout.take_payment", roles: ["OWNER","MANAGER","FRONT_DESK","RECEPTION"] },
    { permission: "checkout.refund", roles: ["OWNER","MANAGER"] },
    { permission: "checkout.override_total", roles: ["OWNER","MANAGER"] },
    { permission: "checkout.reopen_service", roles: ["OWNER","MANAGER","FRONT_DESK"] },
    { permission: "checkout.manage_customer_display", roles: ["OWNER","MANAGER","FRONT_DESK","RECEPTION"] },
    { permission: "appointments.move", roles: ["OWNER","MANAGER","FRONT_DESK","RECEPTION"] },
    { permission: "appointments.cancel", roles: ["OWNER","MANAGER","FRONT_DESK"] },
    { permission: "reports.view", roles: ["OWNER","MANAGER"] },
    { permission: "reports.export", roles: ["OWNER"] },
    { permission: "settings.edit", roles: ["OWNER"] },
    { permission: "settings.payments_edit", roles: ["OWNER"] },
    { permission: "settings.staff_edit", roles: ["OWNER","MANAGER"] },
  ] },
  // passkeyEnabled defaults ON (Oct 3 2026): it is now enforced, and Face ID availability is the platform flag's decision
  // until a salon turns it off — a false default would switch Face ID off for any salon that saved any security setting.
  security: { pinLogin: true, passkeyEnabled: true, mfaForOwner: false, rememberTrustedDevices: true, auditRetention: "90d", autoLockEnabled: AUTO_LOCK_DEFAULT.enabled, autoLockMinutes: AUTO_LOCK_DEFAULT.minutes },
  loyaltyMemberships: { earnRatePerDollar: 1, redemption: "100 pts = $5", pointsExpiration: "1 year", vipSilverCents: 50000, vipGoldCents: 120000, vipPlatinumCents: 300000, membershipEnabled: true, memberDiscountPercent: 10, birthdayReward: true, referralReward: true, giftCardsEnabled: true },
  customerDisplayDevices: { enabled: true, displayMode: "tip_only", idleMessage: "Ready for next guest", sessionTimeoutMinutes: 5, tipPromptEnabled: true, receiptPromptEnabled: true, displayBranding: true, tagline: "", showBranchName: false },
  receiptsBranding: { showLogo: true, header: "", footer: "Thank you for visiting!", businessAddress: "", thankYouMessage: "See you next time", showSurchargeLine: true, showTechnicianLines: true, showServiceNotes: false, showDiscountLine: true, showLoyaltyPoints: true, showTips: true, defaultDelivery: ["SMS","Email"], brandStyle: "cream-gold" },
  // batch 8 decision 8 (Nov 9 2026): no sample plan — plan / tier / status / counts are read LIVE (settings.kysely.repository); empty = "—"
  subscriptionPlan: { plan: "", tier: "", billingStatus: "", aiPackageIncluded: false, aiPackage: "None", aiFeatures: {}, customerCount: null, technicianCount: null, smsThisMonth: null, readOnly: true },
  giftCardSettings: { enabled: true, posSalesEnabled: true, customerAppSalesEnabled: true, sendToFriendEnabled: true, presetAmountsCents: [2500,5000,7500,10000,15000], customAmountEnabled: true, minAmountCents: 1000, maxAmountCents: 50000, crossBranchRedemption: true, expirationPolicy: "none", partialRedemption: true, multiplePerCheckout: true, refundToCardDefault: true, transferable: true, scheduledDeliveryEnabled: true, deliveryChannels: { sms: true, email: true, inApp: true }, barcodeFormat: "qr", presentationTokenTtlSeconds: 90, managerApprovalOverCents: 50000, dailyPurchaseLimitCents: 200000, networkGiftCardsEnabled: false, sellNetworkGiftCards: false, redeemNetworkGiftCards: false, termsVersion: "v1" },
};

// ---- audit log + module/section status (Settings audit drawer + Super Admin project status) ----
export interface POSSettingsAuditLogRow {
  id: string; tenantId: string; branchId?: string; userId: string; role: Role;
  actionType: string; entityType: string; entityId?: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
  changedKeys?: string[]; ipAddress?: string; userAgent?: string; createdAt: string;
}
export type ModuleStatusLevel = "Complete" | "In Progress" | "Needs Review" | "Blocked" | "Not Started";
export interface POSSettingsSectionStatus {
  key: SettingsCategory; label: string; completionPercent: number; status: ModuleStatusLevel;
  editable: boolean; missingReasons: string[]; goLivePending?: string[];
}
export interface POSSettingsModuleStatus {
  moduleKey: "aipowersalon-pos-settings"; completionPercent: number; status: ModuleStatusLevel;
  missingReasons: string[]; sections: POSSettingsSectionStatus[]; goLivePending?: string[];
}
// the 18 settings categories with display labels (drives the rail + status report; order is the spec order)
export const SETTINGS_CATEGORY_LABELS: { key: SettingsCategory; label: string }[] = [
  { key: "business-branch", label: "Business & Branch" },
  { key: "store-hours-auto-logout", label: "Store Hours & Auto-Logout" },
  { key: "payments-checkout", label: "Payments & Checkout" },
  { key: "tips", label: "Tips" }, { key: "tax", label: "Tax" },
  { key: "booking-appointments", label: "Booking & Appointments" },
  { key: "online-google-ai-booking", label: "Online / Google / AI Booking" },
  { key: "notifications", label: "Notifications & Reminders" },
  { key: "queue-workflow", label: "Queue & Workflow" },
  { key: "technician-app", label: "Technician App" },
  { key: "services-pricing", label: "Services & Pricing" },
  { key: "technicians-staff", label: "Technicians & Staff" },
  { key: "roles-permissions", label: "Roles, Permissions & Security" },
  { key: "security", label: "Security" },
  { key: "loyalty-memberships", label: "Loyalty & Memberships" },
  { key: "customer-display-devices", label: "Customer Display & Devices" },
  { key: "receipts-branding", label: "Receipts & Branding" },
  { key: "gift-card-settings", label: "Gift Card Settings" },
  { key: "subscription-plan", label: "Subscription / Plan" },
  { key: "audit-logs", label: "Audit Logs" },
];
// honest roll-up: completion = mean of section percents; status from thresholds + blockers (never hardcoded 100%)
export function rollUpStatus(
  sections: POSSettingsSectionStatus[],
): { completionPercent: number; status: ModuleStatusLevel; missingReasons: string[] } {
  if (sections.length === 0) return { completionPercent: 0, status: "Not Started", missingReasons: ["no sections evaluated"] };
  const pct = Math.round(sections.reduce((s, x) => s + x.completionPercent, 0) / sections.length);
  const missing = sections.filter((s) => s.completionPercent < 100)
    .map((s) => `${s.label} — ${s.missingReasons[0] || "incomplete"}`);
  let status: ModuleStatusLevel;
  if (pct === 0) status = "Not Started";
  else if (sections.some((s) => s.status === "Blocked")) status = "Blocked";
  else if (pct >= 100) status = "Complete";
  else if (pct >= 60) status = "Needs Review";
  else status = "In Progress";
  return { completionPercent: pct, status, missingReasons: missing };
}
