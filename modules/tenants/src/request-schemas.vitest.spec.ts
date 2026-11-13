// BUILD_PLAN Phase 12 (#17): the tenants routes' body validation, route by route on the real controllers — the bodies
// pos-web / owner-web / admin-web send today (copied from POSSettingsScreen saveCat / posDevicesApi / posLocationsApi /
// posSocialApi / OwnerSalonContext / superAdminApi) pass intact, unknown fields are stripped, a bad body is a 400
// VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { PosSettingsController as S } from './settings/settings.controller';
import { TenantLocationsController as L } from './tenant-locations/tenant-locations.controller';
import { SuperAdminLocationsController as SL } from './tenant-locations/super-admin-locations.controller';
import { SuperAdminBrandingController as B } from './branding/branding.controller';
import { OwnerPortfolioController as OP } from './owner-portfolio/owner-portfolio.controller';
import { SocialController as SO } from './pos-social/pos-social.controller';
import { TenantNavigationController as NAV } from './tenant-navigation/tenant-navigation.controller';

const U = '11111111-1111-4111-8111-111111111111';
const CASES: RouteBodyCase[] = [
  { route: 'PATCH /pos/settings/business-branch', ctl: S, handler: 'pBiz', today: [{ salonName: 'Luxe', legalName: 'Luxe LLC', businessType: 'Nail Salon', website: '', email: 'a@b.co', phone: '6095551234', branchName: 'Main', address: '1 Main', city: 'Merchantville', state: 'NJ', zip: '08109', currency: 'USD', timezone: 'America/New_York', dateFormat: 'MMM DD, YYYY', multiBranchEnabled: false, perBranchOverrides: true }], bad: [{ timezone: { tz: 'x' } }, 'timezone'] },
  { route: 'PATCH /pos/settings/store-hours-auto-logout', ctl: S, handler: 'pHours', today: [{ autoLogoutEnabled: true, gracePeriodMinutes: 0, afterCloseExtensionMinutes: 30, warningMinutes: [30, 15, 5] }, { storeHours: { monday: { isOpen: true, openTime: '09:00', closeTime: '19:30' }, sunday: { isOpen: false, openTime: null, closeTime: null } } }], bad: [{ warningMinutes: 30 }, 'warningMinutes'] },
  { route: 'PATCH /pos/settings/payments-checkout', ctl: S, handler: 'pPay', today: [{ methods: { card: true, cash: true, giftCard: true, split: false }, creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3 }], bad: [{ methods: 'card' }, 'methods'] },
  { route: 'PATCH /pos/settings/gift-card-settings', ctl: S, handler: 'pGift', today: [{ enabled: true }, { presetAmountsCents: [2500, 5000], minAmountCents: 1000, maxAmountCents: 50000, deliveryChannels: { sms: true, email: false, inApp: true }, expirationPolicy: 'none' }], bad: [{ presetAmountsCents: [{ c: 1 }] }, 'presetAmountsCents[0]'] },
  { route: 'PATCH /pos/settings/tips', ctl: S, handler: 'pTips', today: [{ defaultTipPercents: [15, 18, 20], maxTipPercent: 100, allowCustomTip: true, allowNoTip: true }], bad: [{ allowNoTip: 'maybe' }, 'allowNoTip'] },
  { route: 'PATCH /pos/settings/tax', ctl: S, handler: 'pTax', today: [{ enabled: true, taxRatePercent: 6.625, taxLabel: 'NJ Sales Tax', mode: 'exclusive', appliesToServices: true, appliesToProducts: true }], bad: [{ taxLabel: 'x'.repeat(81) }, 'taxLabel'] },
  { route: 'PATCH /pos/settings/booking-appointments', ctl: S, handler: 'pBook', today: [{ slotIntervalMinutes: 15, bufferMinutes: 10, cleanupMinutes: 5, defaultDurationMinutes: 45, minLeadTimeMinutes: 120, maxAdvanceDays: 60, cancellationWindowHours: 24, noShowPolicy: 'charge_fee', noShowFeeCents: 2500, depositRequired: false, depositPercent: 20, noDoubleBooking: true, overbookingAllowance: 0, overbookingPolicy: 'BLOCK' }], bad: [{ depositRequired: [] }, 'depositRequired'] },
  { route: 'PATCH /pos/settings/online-google-ai-booking', ctl: S, handler: 'pOnline', today: [{ onlineBookingEnabled: true, tenantSlug: 'luxe', googleBookingLink: '', aiPhoneEnabled: true, aiActions: { findAvailability: true, create: true, reschedule: true, cancel: false, sendReminder: true } }], bad: [{ aiActions: { create: 'yes' } }, 'aiActions.create'] },
  { route: 'PATCH /pos/settings/notifications-reminders', ctl: S, handler: 'pNotif', today: [{ smsConfirmation: true, emailConfirmation: true, pushConfirmation: false, reminderHours: [24, 2], noShowFollowUp: true, receiptDelivery: ['SMS', 'Email'], senderBrand: 'Luxe', marketingOptInRequired: true }, { senderBrand: 'Luxe', emailConfirmation: true, receiptDelivery: ['Email'] }], bad: [{ receiptDelivery: 'SMS' }, 'receiptDelivery'] },
  { route: 'PATCH /pos/settings/queue-workflow', ctl: S, handler: 'pQueue', today: [{ avgServiceMinutes: 45, showWaitToGuest: true, autoFlowToCheckout: true, manualApprovalBeforeCheckout: false, allowReopenService: true, vipPriority: true, appointmentOverWalkIn: true }], bad: [{ vipPriority: { on: true } }, 'vipPriority'] },
  { route: 'PATCH /pos/settings/services-pricing', ctl: S, handler: 'pSvc', today: [{ defaultDurationMinutes: 45, newServicesTaxable: true, showOnOnlineBooking: true, allowAiBooking: true, enforceSkillMapping: true }], bad: [{ defaultDurationMinutes: [45] }, 'defaultDurationMinutes'] },
  { route: 'PATCH /pos/settings/technicians-staff', ctl: S, handler: 'pStaff', today: [{ commissionBasis: 'per_service', defaultCommissionPercent: 45, payrollPeriod: 'biweekly', techCanProcessPayment: false, techCanEditServiceLines: true, techCanMarkDone: true }], bad: [{ payrollPeriod: 7 }, 'payrollPeriod'] },
  { route: 'PATCH /pos/settings/security', ctl: S, handler: 'pSecurity', today: [{ mfaForOwner: true, rememberTrustedDevices: true, passkeyEnabled: true, pinLogin: true, auditRetention: '90d' }, { mfaForOwner: false, rememberTrustedDevices: true, passkeyEnabled: true, pinLogin: true, auditRetention: '90d', autoLockEnabled: true, autoLockMinutes: 60 }], bad: [{ pinLogin: 'on' }, 'pinLogin'] },
  { route: 'PATCH /pos/settings/roles-permissions-security', ctl: S, handler: 'pRoles', today: [{ matrix: [{ permission: 'checkout.refund', roles: ['OWNER', 'MANAGER'] }] }], bad: [{ matrix: [{ permission: 'checkout.refund', roles: 'OWNER' }] }, 'matrix[0].roles'] },
  { route: 'PATCH /pos/settings/loyalty-memberships', ctl: S, handler: 'pLoy', today: [{ earnRatePerDollar: 1, redemption: '100 pts = $5', pointsExpiration: '1 year', vipSilverCents: 50000, vipGoldCents: 120000, vipPlatinumCents: 300000, membershipEnabled: true, memberDiscountPercent: 10, birthdayReward: true, referralReward: true, giftCardsEnabled: true }], bad: [{ redemption: { pts: 100 } }, 'redemption'] },
  { route: 'PATCH /pos/settings/customer-display-devices', ctl: S, handler: 'pDev', today: [{ enabled: true, displayMode: 'tip_only', stationNumber: '1', idleMessage: 'Welcome', sessionTimeoutMinutes: 5, tipPromptEnabled: true, receiptPromptEnabled: true, displayBranding: true, tagline: 'Nails & more', showBranchName: false }], bad: [{ tagline: 'x'.repeat(201) }, 'tagline'] },
  { route: 'PATCH /pos/settings/receipts-branding', ctl: S, handler: 'pRcpt', today: [{ showLogo: true, header: '', footer: 'Thanks', businessAddress: '', thankYouMessage: 'See you', showSurchargeLine: true, showTechnicianLines: true, showServiceNotes: false, showDiscountLine: true, showLoyaltyPoints: true, showTips: true, defaultDelivery: ['SMS'], brandStyle: 'cream-gold' }], bad: [{ defaultDelivery: [1] }, 'defaultDelivery[0]'] },
  { route: 'POST …/terminals/pair', ctl: S, handler: 'termPair', today: [{ code: 'ABC123', label: 'Station 1', stationId: 'reg-1', hsn: 'HSN1' }, { code: 'ABC123', label: 'Station' }], bad: [{ code: ['x'] }, 'code'] },
  { route: 'POST …/terminals/:id/register', ctl: S, handler: 'termRegister', today: [{ stationId: 'reg-1' }, { stationId: null }], bad: [{ stationId: { id: 1 } }, 'stationId'] },
  { route: 'POST …/connect-google', ctl: S, handler: 'bkConnect', today: [{ link: 'https://g.page/r/x' }], bad: [{ link: 5 }, 'link'] },
  { route: 'POST …/online-google-ai-booking/ai', ctl: S, handler: 'bkAi', today: [{ enabled: true }, { enabled: true, actions: { create: true, cancel: false } }], bad: [{ enabled: true, actions: { create: 'y' } }, 'actions.create'] },
  { route: 'POST …/a2p-register', ctl: S, handler: 'a2pRegister', today: [{ brand: 'Luxe Nails' }], bad: [{ brand: ['x'] }, 'brand'] },
  { route: 'POST …/notifications-reminders/templates', ctl: S, handler: 'tplUpsert', today: [{ channel: 'sms', name: 'Reminder', body: 'See you soon' }, { id: 'tpl_1', channel: 'email', name: 'Thanks', body: 'Hi' }], bad: [{ channel: 'sms', name: 'x', body: 'x'.repeat(2001) }, 'body'] },
  { route: 'POST …/receipts-branding/send-test', ctl: S, handler: 'rcptSend', today: [{ to: '6095551234', channel: 'SMS' }], bad: [{ to: {} }, 'to'] },
  { route: 'POST …/receipts-branding/logo', ctl: S, handler: 'rcptLogo', today: [{ logo: 'data:image/png;base64,iVBORw0KGgo=' }], bad: [{ logo: 'x'.repeat(1_400_000) }, 'logo'] },
  { route: 'POST /tenant/locations', ctl: L, handler: 'create', today: [{ name: 'Cherry Hill' }], bad: [{ name: { n: 1 } }, 'name'] },
  { route: 'POST /tenant/locations/geocode', ctl: L, handler: 'geocode', today: [{ query: '1 Main St Merchantville' }], bad: [{ query: ['x'] }, 'query'] },
  { route: 'PATCH /tenant/locations/:id', ctl: L, handler: 'update', today: [{ name: 'Main', public_display_name: null, salon_code: 'LUX1', description: null, phone: '6095551234', public_email: null, website: null, address: '1 Main', address_line2: null, suite_unit: null, city: 'Merchantville', state: 'NJ', zip: '08109', timezone: 'America/New_York', manager_name: null, manager_phone: null, manager_email: null, internal_notes: null, is_online_booking_enabled: true, accepts_walk_ins: true, show_phone_publicly: true, show_address_publicly: true, show_prices_publicly: false }], bad: [{ accepts_walk_ins: 'yes' }, 'accepts_walk_ins'] },
  { route: 'POST /tenant/locations/:id/apply-address', ctl: L, handler: 'applyAddress', today: [{ hit: { formattedAddress: '1 Main St', latitude: 39.9, longitude: -75.0, placeId: 'p1', accuracy: 'rooftop', city: 'Merchantville', state: 'NJ', zip: '08109', country: 'US' } }], bad: [{ hit: { latitude: '39.9' } }, 'hit.latitude'] },
  { route: 'PATCH /tenant/locations/:id/map-pin', ctl: L, handler: 'mapPin', today: [{ latitude: 39.9, longitude: -75.0, source: 'manual_drag' }], bad: [{ latitude: [39.9] }, 'latitude'] },
  { route: 'POST /super-admin/tenant-locations/:id/reject', ctl: SL, handler: 'reject', today: [{ reason: 'duplicate listing' }], bad: [{ reason: { r: 1 } }, 'reason'] },
  { route: 'POST /super-admin/tenant-locations/:id/suspend', ctl: SL, handler: 'suspend', today: [{ reason: 'fraud review' }], bad: [{ reason: 'x'.repeat(2001) }, 'reason'] },
  { route: 'PATCH /super-admin/tenant-locations/:id/map-pin', ctl: SL, handler: 'mapPin', today: [{ latitude: 39.9, longitude: -75.0 }], bad: [{ longitude: {} }, 'longitude'] },
  { route: 'PATCH /super-admin/settings/branding', ctl: B, handler: 'update', today: [{ primary_color: '#AABBCC', tagline: 'Run your salon' }], bad: [{ primary_color: 123456 }, 'primary_color'] },
  { route: 'POST /owner/context/switch', ctl: OP, handler: 'switchSalon', today: [{ salonId: U, branchId: null }, { salonId: U, branchId: U }], bad: [{ salonId: { id: U } }, 'salonId'] },
  { route: 'POST /pos/social-posts', ctl: SO, handler: 'create', today: [{ platform: 'instagram', caption: 'Fall colors', scheduledAt: '2026-10-10T15:00:00Z' }, { platform: 'facebook', caption: 'x', scheduledAt: null }], bad: [{ platform: 'instagram', caption: 'x'.repeat(5001) }, 'caption'] },
  { route: 'POST /pos/social-posts/:id/status', ctl: SO, handler: 'setStatus', today: [{ status: 'posted' }], bad: [{ status: ['posted'] }, 'status'] },
  // extras round 9 (pos-web shell/alertReads.ts): my alert reads + this session's badge sync
  { route: 'POST /tenant/notifications/alerts/read', ctl: NAV, handler: 'markAlertsRead', today: [{ alertIds: [U] }], bad: [{ alertIds: 'x' }, 'alertIds'] },
  { route: 'POST /tenant/navigation/badges/sync', ctl: NAV, handler: 'recordBadgeSync', today: [{ unread: 3, surface: 'pos' }, { unread: 0 }], bad: [{ unread: -1 }, 'unread'] },
];

describe('tenants — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => { expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]); });
  it('a settings section keeps only its own keys: an unknown key is REFUSED (strict, S-A14), so it can never be written into the salon blob', () => {
    const pipe: any = bodyPipeOf(S, 'pTax');
    expect(pipe.transform({ taxRatePercent: 6 })).toEqual({ taxRatePercent: 6 });
    let err: any = null; try { pipe.transform({ taxRatePercent: 6, injected: { evil: true }, permissionsOverride: true }); } catch (e) { err = e; }
    expect(err?.getStatus?.()).toBe(400);
    expect(JSON.stringify(err?.getResponse?.())).toMatch(/injected/);
  });
});
