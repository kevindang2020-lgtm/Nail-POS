// BUILD_PLAN Phase 12 (#17): super-admin programs routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { IntegrationLifecycleController } from './super-admin-integrations/integration-lifecycle.controller';
import { IntegrationSchedulerController } from './super-admin-integrations/integration-scheduler.controller';
import { IntegrationSyncController } from './super-admin-integrations/integration-sync.controller';
import { IntegrationWebhookAdminController } from './super-admin-integrations/integration-webhook.controller';
import { ProviderReliabilityController } from './super-admin-integrations/provider-reliability.controller';
import { SuperAdminIntegrationsController } from './super-admin-integrations/super-admin-integrations.controller';
import { KillSwitchController } from './super-admin-kill-switches/kill-switches';
import { LegalDocumentsController } from './super-admin-legal/legal-documents.controller';
import { SuperAdminLoyaltyController } from './super-admin-loyalty/super-admin-loyalty.controller';
import { MaintenanceController } from './super-admin-maintenance/maintenance.controller';
import { MembershipProgramsController } from './super-admin-membership-programs/membership-programs.controller';
import { SuperAdminMerchantAccountsController } from './super-admin-merchant-accounts/super-admin-merchant-accounts.controller';
import { SuperAdminOwnersController } from './super-admin-owners/super-admin-owners.module';
import { MyAccessRequestsController } from './super-admin-platform/my-access-requests.controller';
import { PublicWebsiteController } from './super-admin-platform/public-website.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/integrations/connections", ctl: IntegrationLifecycleController, handler: 'create', today: [{"providerKey":"google_calendar","ownershipType":"tenant","tenantId":"t-1","branchId":null,"authMethod":"oauth2"}], bad: [{"providerKey":{"p":1},"ownershipType":"tenant"}, "providerKey"] },
  { route: "POST /super-admin/integrations/connections/:id/oauth/begin", ctl: IntegrationLifecycleController, handler: 'oauthBegin', today: [{"redirectUri":"https://admin.example/cb","scopes":["calendar.read"]},{"redirectUri":"https://admin.example/cb"}], bad: [{"redirectUri":"x","scopes":"calendar.read"}, "scopes"] },
  { route: "POST /super-admin/integrations/connections/:id/oauth/complete", ctl: IntegrationLifecycleController, handler: 'oauthComplete', today: [{"state":"s-1","code":"c-1"}], bad: [{"state":"s","code":{"c":1}}, "code"] },
  { route: "POST /super-admin/integrations/connections/:id/credentials", ctl: IntegrationLifecycleController, handler: 'credentials', today: [{"apiKey":"placeholder-value"}], bad: [{"apiKey":["x"]}, "apiKey"] },
  { route: "POST /super-admin/integrations/connections/:id/credentials/rotate", ctl: IntegrationLifecycleController, handler: 'rotate', today: [{"kind":"api_key","newSecret":"placeholder-value","reason":"rotation"},{"newSecret":"placeholder-value","reason":"leak"}], bad: [{"newSecret":{"s":1},"reason":"r"}, "newSecret"] },
  { route: "POST /super-admin/integrations/connections/:id/lifecycle-disable", ctl: IntegrationLifecycleController, handler: 'disable', today: [{"reason":"tenant left"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/integrations/scheduler/tick", ctl: IntegrationSchedulerController, handler: 'tick', today: [{"limit":25}], bad: [{"limit":{"l":1}}, "limit"] },
  { route: "POST /super-admin/integrations/connections/:id/sync", ctl: IntegrationSyncController, handler: 'enqueue', today: [{},{"syncType":"full","idempotencyKey":"k-1"}], bad: [{"syncType":["full"]}, "syncType"] },
  { route: "POST /super-admin/integrations/sync/drain", ctl: IntegrationSyncController, handler: 'drain', today: [{"limit":10}], bad: [{"limit":[10]}, "limit"] },
  { route: "POST /super-admin/integrations/webhook/drain", ctl: IntegrationWebhookAdminController, handler: 'drain', today: [{"limit":20}], bad: [{"limit":true}, "limit"] },
  { route: "POST /super-admin/integrations/connections/:id/circuit/reset", ctl: ProviderReliabilityController, handler: 'reset', today: [{"reason":"provider recovered"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/integrations/connections/:id/disable", ctl: SuperAdminIntegrationsController, handler: 'disable', today: [{"reason":"abuse"}], bad: [{"reason":{"x":1}}, "reason"] },
  { route: "POST /super-admin/integrations/connections/:id/enable", ctl: SuperAdminIntegrationsController, handler: 'enable', today: [{"reason":"cleared"}], bad: [{"reason":5}, "reason"] },
  { route: "POST /super-admin/kill-switches/:key", ctl: KillSwitchController, handler: 'set', today: [{"active":true,"reason":"incident"},{"active":false,"reason":"resolved"}], bad: [{"active":true,"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/settings/general/legal-documents", ctl: LegalDocumentsController, handler: 'create', today: [{"docType":"terms","version":"2.1","title":"Terms","content":"…","summary":"updates","requiredAcceptance":true},{"docType":"privacy","version":"3"}], bad: [{"docType":"terms","version":{"v":1}}, "version"] },
  { route: "POST /super-admin/loyalty/templates", ctl: SuperAdminLoyaltyController, handler: 'createTemplate', today: [{"name":"Points basic","programType":"points","structure":{"pointsPerDollar":1}},{"name":"Visits"}], bad: [{"name":{"n":1}}, "name"] },
  { route: "POST /super-admin/loyalty/suspicious/:id/transition", ctl: SuperAdminLoyaltyController, handler: 'suspiciousTransition', today: [{"to":"reviewing"},{"to":"dismissed","note":"false alarm"}], bad: [{"to":["x"]}, "to"] },
  { route: "POST /super-admin/loyalty/corrections/:id/review", ctl: SuperAdminLoyaltyController, handler: 'correctionsReview', today: [{"to":"proposed","proposedAdjustment":-50,"rootCause":"double earn","reason":"fix"},{"to":"approved"}], bad: [{"to":"approved","proposedAdjustment":"fifty"}, "proposedAdjustment"] },
  { route: "PUT /super-admin/loyalty/config", ctl: SuperAdminLoyaltyController, handler: 'putConfig', today: [{"limits":{"maxPointsPerTxn":500,"maxRedemptionPerTxn":1000,"minRedemptionThreshold":100,"maxPointsPerDayPerMember":2000}},{"expiration":{"enabled":true,"pointExpiryDays":365,"rewardValidityDays":90},"programTypes":{"points":true,"tiered":false,"visit_based":true,"spend_based":false},"planFeatures":{"pro":true},"valuation":{"centsPerPoint":1}}], bad: [{"limits":{"maxPointsPerTxn":{"x":1}}}, "limits.maxPointsPerTxn"] },
  { route: "POST /super-admin/settings/general/maintenance/enable", ctl: MaintenanceController, handler: 'enable', today: [{"reason":"db upgrade","mode":"read_only","message":"Back soon","expectedRestoration":"2026-10-09T03:00:00Z","allowedRoles":["super_admin"]},{"reason":"x"}], bad: [{"reason":"x","allowedRoles":"super_admin"}, "allowedRoles"] },
  { route: "POST /super-admin/settings/general/maintenance/schedule", ctl: MaintenanceController, handler: 'schedule', today: [{"title":"Upgrade","reason":"pg 17","startsAt":"2026-10-10T03:00:00Z","endsAt":"2026-10-10T04:00:00Z","mode":"full","timezone":"America/New_York"}], bad: [{"reason":"x","startsAt":{"t":1}}, "startsAt"] },
  { route: "POST /super-admin/settings/general/maintenance/banner", ctl: MaintenanceController, handler: 'banner', today: [{"text":"Maintenance tonight"},{"text":""}], bad: [{"text":{"t":1}}, "text"] },
  { route: "POST /super-admin/membership-programs/exports", ctl: MembershipProgramsController, handler: 'exportCsv', today: [{"report":"programs"},{"report":"members","tenantId":"t-1","status":"active","columns":"id,name"}], bad: [{"report":{"r":1}}, "report"] },
  { route: "POST /super-admin/membership-programs/support-sessions", ctl: MembershipProgramsController, handler: 'openSupport', today: [{"tenantId":"t-1","reason":"billing question","durationMinutes":30,"accessLevel":"read_only"}], bad: [{"tenantId":"t-1","durationMinutes":{"m":1}}, "durationMinutes"] },
  { route: "POST /super-admin/membership-programs/programs/:id/disable", ctl: MembershipProgramsController, handler: 'disableProgram', today: [{"reason":"non-compliant"}], bad: [{"reason":["x"]}, "reason"] },
  { route: "POST /super-admin/membership-programs/corrections", ctl: MembershipProgramsController, handler: 'correction', today: [{"membershipId":"m-1","direction":"credit","quantity":1,"amountCents":2500,"reason":"missed visit"}], bad: [{"membershipId":"m-1","amountCents":2500,"status":"applied"}, "status"] },
  { route: "POST /super-admin/membership-programs/enabled", ctl: MembershipProgramsController, handler: 'setEnabled', today: [{"enabled":true},{"enabled":false}], bad: [{"enabled":{"e":1}}, "enabled"] },
  { route: "POST /super-admin/membership-programs/plan-gating", ctl: MembershipProgramsController, handler: 'setGating', today: [{"planGating":{"basic":false,"pro":true}}], bad: [{"planGating":{"pro":{"x":1}}}, "planGating.pro"] },
  { route: "POST /super-admin/membership-programs/limits", ctl: MembershipProgramsController, handler: 'setLimits', today: [{"limits":{"maxProgramsPerTenant":10,"maxActiveMembersPerTenant":5000,"maxBenefitsPerProgram":20,"maxTrialDays":30}}], bad: [{"limits":{"maxTrialDays":[30]}}, "limits.maxTrialDays"] },
  { route: "POST /super-admin/membership-programs/rules", ctl: MembershipProgramsController, handler: 'setRules', today: [{"rules":{"allowedBillingIntervals":["monthly","yearly"],"maxDiscountPercent":50,"allowTrials":true,"allowFamily":false,"requireAutoRenewConsent":true}}], bad: [{"rules":{"allowedBillingIntervals":"monthly"}}, "rules.allowedBillingIntervals"] },
  { route: "POST /super-admin/membership-programs/templates", ctl: MembershipProgramsController, handler: 'createTemplate', today: [{"name":"Mani club","description":"2 manis / mo","productType":"membership","billingInterval":"monthly","priceCents":4900,"trialDays":0,"status":"draft","benefits":[]},{"name":"Pedi club","productType":"membership","billingInterval":"monthly","priceCents":5900,"trialDays":7,"status":"published","benefits":[{"benefitType":"service_credit","label":"Pedicure","creditsPerCycle":1,"valueCents":4500,"percent":0}]}], bad: [{"name":"x","benefits":[{"benefitType":["x"]}]}, "benefits[0].benefitType"] },
  { route: "PATCH /super-admin/membership-programs/templates/:id", ctl: MembershipProgramsController, handler: 'updateTemplate', today: [{"name":"Mani club","productType":"membership","billingInterval":"monthly","priceCents":4900,"trialDays":0,"status":"archived","benefits":[]}], bad: [{"name":"x","priceCents":{"c":1}}, "priceCents"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/rates", ctl: SuperAdminMerchantAccountsController, handler: 'configureRates', today: [{"percentageBasisPoints":265,"perTxnFeeMinor":10,"monthlyFeeMinor":0,"changeReason":"renewal","effectiveAt":"2026-11-01"}], bad: [{"percentageBasisPoints":"265","perTxnFeeMinor":10,"changeReason":"r"}, "percentageBasisPoints"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/activation", ctl: SuperAdminMerchantAccountsController, handler: 'activate', today: [{"reason":"underwriting done"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/deactivation", ctl: SuperAdminMerchantAccountsController, handler: 'deactivate', today: [{"reason":"closed"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/suspension", ctl: SuperAdminMerchantAccountsController, handler: 'suspend', today: [{"reason":"risk"}], bad: [{"reason":5}, "reason"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/funding-update", ctl: SuperAdminMerchantAccountsController, handler: 'updateFunding', today: [{"stepUpConfirmed":true,"accountNumber":"000123456789","routingNumber":"021000021","bankName":"Test Bank","accountType":"checking","fundingSchedule":"daily","reason":"new bank"}], bad: [{"stepUpConfirmed":true,"accountNumber":{"n":1},"reason":"r"}, "accountNumber"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/mid-assignment", ctl: SuperAdminMerchantAccountsController, handler: 'assignMid', today: [{"merchantId":"MID-1","reason":"boarding"},{"merchantId":"MID-2","branchId":"b-1","reason":"2nd location"}], bad: [{"merchantId":["M"],"reason":"r"}, "merchantId"] },
  { route: "POST /super-admin/merchant-accounts/:tenantId/terminals", ctl: SuperAdminMerchantAccountsController, handler: 'assignTerminal', today: [{"terminalId":"T-1","branchId":"b-1","reason":"install"}], bad: [{"terminalId":{"t":1},"branchId":"b","reason":"r"}, "terminalId"] },
  { route: "POST /super-admin/owners/:ownerId/salons", ctl: SuperAdminOwnersController, handler: 'createSalon', today: [{"name":"Nails 2","city":"Merchantville","state":"NJ","address":"1 Main","accessLevel":"owner","isPrimaryOwner":true,"switchPin":"1234"},{"name":"Nails 3"}], bad: [{"name":{"n":1}}, "name"] },
  { route: "POST /super-admin/owners/:ownerId/branches", ctl: SuperAdminOwnersController, handler: 'assign', today: [{"branchId":"b-1","accessLevel":"manager","isPrimaryOwner":false}], bad: [{"branchId":{"b":1}}, "branchId"] },
  { route: "POST /super-admin/owners/:ownerId/branches/:branchId/pin", ctl: SuperAdminOwnersController, handler: 'setPin', today: [{"pin":"1234"}], bad: [{"pin":{"p":1}}, "pin"] },
  { route: "PATCH /super-admin/owners/:ownerId/branches/:branchId", ctl: SuperAdminOwnersController, handler: 'update', today: [{"accessLevel":"owner","isPrimaryOwner":true},{"isPrimaryOwner":false}], bad: [{"accessLevel":["x"]}, "accessLevel"] },
  { route: "POST /me/access-requests", ctl: MyAccessRequestsController, handler: 'create', today: [{"requestedRole":"manager","reason":"covering","requestedDurationDays":7},{"requestedRole":"manager","reason":"x","requestedDurationDays":null}], bad: [{"requestedRole":"manager","requestedDurationDays":"7"}, "requestedDurationDays"] },
  { route: "POST /public/website/leads", ctl: PublicWebsiteController, handler: 'lead', today: [{"kind":"contact","salonName":"Nails","name":"Mai","email":"m@x.co","phone":"6095551234","message":"hi","sourcePage":"owner_app_request_access"},{"kind":"demo","salon_name":"Nails","email":"m@x.co","website":""}], bad: [{"kind":"contact","message":{"m":1}}, "message"] },
  { route: "POST /public/website/applications", ctl: PublicWebsiteController, handler: 'application', today: [{"ownerFirstName":"Mai","ownerLastName":"Tran","salonName":"Nails","email":"m@x.co","phone":"6095551234","smsEmailConsent":true,"consentText":"I agree","zip":"08109","technicianCount":"4","locationCount":1,"utm":{"utm_source":"google"},"idempotencyKey":"k-1","formVersion":"3"},{"owner_first_name":"Mai","salon_name":"Nails","email":"m@x.co","sms_email_consent":"yes","monthly_card_volume_cents":5000000}], bad: [{"email":{"$gt":""}}, "email"] },
  { route: "POST /public/website/invitations/accept", ctl: PublicWebsiteController, handler: 'acceptInvite', today: [{"token":"tok","password":"placeholder-pass","fullName":"Mai Tran"},{"token":"tok","password":"placeholder-pass"}], bad: [{"token":{"t":1},"password":"p"}, "token"] },
];

describe('super-admin programs — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
