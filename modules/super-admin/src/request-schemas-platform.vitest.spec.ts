// BUILD_PLAN Phase 12 (#17): super-admin platform routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminPlatformController } from './super-admin-platform/super-admin-platform.controller';
import { PlatformStaffController } from './super-admin-platform-staff/platform-staff.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/platform/applications", ctl: SuperAdminPlatformController, handler: 'createApplication', today: [{"salon_name":"Nails","owner_name":"Mai","phone":"6095551234","email":"m@x.co","city":"Merchantville","state":"NJ","technicians_count":"4","source":"manual"}], bad: [{"salon_name":{"n":1}}, "salon_name"] },
  { route: "POST /super-admin/platform/applications/:id/status", ctl: SuperAdminPlatformController, handler: 'appStatus', today: [{"status":"contacted"},{"status":"on_hold","note":"waiting","reason":"docs"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "POST /super-admin/platform/applications/:id/assign", ctl: SuperAdminPlatformController, handler: 'appAssign', today: [{"userId":"u-1"},{"userId":null}], bad: [{"userId":{"u":1}}, "userId"] },
  { route: "POST /super-admin/platform/applications/:id/priority", ctl: SuperAdminPlatformController, handler: 'appPriority', today: [{"priority":"high"}], bad: [{"priority":["x"]}, "priority"] },
  { route: "POST /super-admin/platform/applications/:id/follow-up", ctl: SuperAdminPlatformController, handler: 'appFollowUp', today: [{"at":"2026-10-12T15:00:00Z"},{"at":null}], bad: [{"at":{"a":1}}, "at"] },
  { route: "POST /super-admin/platform/applications/:id/contact-log", ctl: SuperAdminPlatformController, handler: 'appContact', today: [{"channel":"phone","note":"left vm"},{"channel":"email"}], bad: [{"channel":5}, "channel"] },
  { route: "POST /super-admin/platform/applications/:id/approve", ctl: SuperAdminPlatformController, handler: 'appApprove', today: [{"note":"looks good"}], bad: [{"note":["x"]}, "note"] },
  { route: "POST /super-admin/platform/applications/:id/reject", ctl: SuperAdminPlatformController, handler: 'appReject', today: [{"reason":"out of area"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/platform/applications/:id/duplicate", ctl: SuperAdminPlatformController, handler: 'appDuplicate', today: [{"reason":"dupe of 12"},{}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/platform/applications/:id/spam", ctl: SuperAdminPlatformController, handler: 'appSpam', today: [{"reason":"bot"},{}], bad: [{"reason":7}, "reason"] },
  { route: "POST /super-admin/platform/applications/:id/notes", ctl: SuperAdminPlatformController, handler: 'appNote', today: [{"text":"called back"}], bad: [{"text":{"t":1}}, "text"] },
  { route: "POST /super-admin/platform/applications/:id/converted", ctl: SuperAdminPlatformController, handler: 'appConverted', today: [{"tenantId":"t-1"}], bad: [{"tenantId":["t"]}, "tenantId"] },
  { route: "POST /super-admin/platform/leads", ctl: SuperAdminPlatformController, handler: 'createLead', today: [{"kind":"contact"},{"kind":"demo","name":"Mai","salon_name":"Nails","phone":"6095551234","email":"m@x.co","city":"Merchantville","state":"NJ"}], bad: [{"kind":{"k":1}}, "kind"] },
  { route: "POST /super-admin/platform/leads/:id/status", ctl: SuperAdminPlatformController, handler: 'leadStatus', today: [{"status":"qualified"}], bad: [{"status":[1]}, "status"] },
  { route: "POST /super-admin/platform/hardware", ctl: SuperAdminPlatformController, handler: 'createHardware', today: [{},{"tenant_id":"t-1"}], bad: [{"tenant_id":{"t":1}}, "tenant_id"] },
  { route: "POST /super-admin/platform/hardware/:id", ctl: SuperAdminPlatformController, handler: 'updateHardware', today: [{"status":"delivered"},{"agreement_status":"signed","payment_setup_status":"complete","tenant_id":"t-1","imac_color":"blue"}], bad: [{"status":["x"]}, "status"] },
  { route: "POST /super-admin/platform/ai-packages/:tenantId", ctl: SuperAdminPlatformController, handler: 'setAiPackage', today: [{"package":"pro"}], bad: [{"package":{"p":1}}, "package"] },
  { route: "POST /super-admin/platform/ai-packages/:tenantId/features", ctl: SuperAdminPlatformController, handler: 'setAiFeature', today: [{"feature":"ai_booking","enabled":true},{"feature":"ai_booking","enabled":null}], bad: [{"feature":"f","enabled":{"e":1}}, "enabled"] },
  { route: "POST /super-admin/platform/usage-limits/:tenantId", ctl: SuperAdminPlatformController, handler: 'setUsageLimit', today: [{"metric":"sms","limitValue":5000}], bad: [{"metric":"sms","limitValue":{"v":1}}, "limitValue"] },
  { route: "POST /super-admin/platform/branches/bulk-status", ctl: SuperAdminPlatformController, handler: 'bulkBranchStatus', today: [{"branchIds":["b-1","b-2"],"status":"paused","reason":"winter closure"}], bad: [{"branchIds":"b-1","status":"paused","reason":"r"}, "branchIds"] },
  { route: "POST /super-admin/platform/branches", ctl: SuperAdminPlatformController, handler: 'createBranch', today: [{"tenantId":"t-1","name":"Nails 2","city":"Merchantville","state":"NJ","address":"1 Main","latitude":39.95,"longitude":-75.05,"managerName":"","managerEmail":"","managerPhone":"","timezone":"America/New_York","openingStatus":"planned","reason":"expansion"}], bad: [{"tenantId":"t-1","name":{"n":1}}, "name"] },
  { route: "POST /super-admin/platform/branches/:id/status", ctl: SuperAdminPlatformController, handler: 'changeBranchStatus', today: [{"status":"closed","reason":"lease ended","confirmName":"Nails 2"}], bad: [{"status":{"s":1},"reason":"r"}, "status"] },
  { route: "POST /super-admin/platform/branches/:id/manager", ctl: SuperAdminPlatformController, handler: 'assignBranchManager', today: [{"managerUserId":"u-1","reason":"promotion","effectiveDate":"2026-10-15"}], bad: [{"managerUserId":{"u":1},"reason":"r"}, "managerUserId"] },
  { route: "POST /super-admin/platform/branches/:id/transfer", ctl: SuperAdminPlatformController, handler: 'requestBranchTransfer', today: [{"destinationTenantId":"t-2","reason":"sale","confirmName":"Nails 2"}], bad: [{"destinationTenantId":["t"],"reason":"r"}, "destinationTenantId"] },
  { route: "POST /super-admin/platform/branches/:id/hours", ctl: SuperAdminPlatformController, handler: 'setBranchHours', today: [{"days":[{"dayOfWeek":1,"isClosed":false,"opensAt":"09:00","closesAt":"19:00"},{"dayOfWeek":0,"isClosed":true,"opensAt":null,"closesAt":null}]}], bad: [{"days":[{"dayOfWeek":1,"opensAt":{"h":9}}]}, "days[0].opensAt"] },
  { route: "POST /super-admin/platform/branches/:id/devices/allocate", ctl: SuperAdminPlatformController, handler: 'allocateDevice', today: [{"deviceId":"d-1","category":"terminal"}], bad: [{"deviceId":{"d":1}}, "deviceId"] },
  { route: "POST /super-admin/platform/customers/merge", ctl: SuperAdminPlatformController, handler: 'mergeCustomers', today: [{"sessionId":"s-1","tenantId":"t-1","sourceCustomerId":"c-1","targetCustomerId":"c-2","reason":"duplicate profile"}], bad: [{"sessionId":"s","sourceCustomerId":{"c":1}}, "sourceCustomerId"] },
  { route: "POST /super-admin/platform/service-categories/merge", ctl: SuperAdminPlatformController, handler: 'mergeServiceCategories', today: [{"sessionId":"s-1","tenantId":"t-1","sourceCategoryId":"sc-1","targetCategoryId":"sc-2","reason":"same thing"}], bad: [{"sessionId":"s","targetCategoryId":[1]}, "targetCategoryId"] },
  { route: "POST /super-admin/platform/product-categories/merge", ctl: SuperAdminPlatformController, handler: 'mergeProductCategories', today: [{"sessionId":"s-1","tenantId":"t-1","sourceCategoryId":"pc-1","targetCategoryId":"pc-2","reason":"same"}], bad: [{"sessionId":{"s":1}}, "sessionId"] },
  { route: "POST /super-admin/platform/privacy-requests", ctl: SuperAdminPlatformController, handler: 'createPrivacyRequest', today: [{"tenantId":"t-1","customerId":"c-1","requestType":"access","requesterName":"Mai","requesterContact":"m@x.co","scope":"all","legalBasis":"CCPA"}], bad: [{"tenantId":"t-1","requestType":{"r":1}}, "requestType"] },
  { route: "POST /super-admin/platform/privacy-requests/:id/status", ctl: SuperAdminPlatformController, handler: 'advancePrivacyRequest', today: [{"sessionId":"s-1","tenantId":"t-1","status":"in_progress","note":"gathering"}], bad: [{"status":["x"]}, "status"] },
  { route: "POST /super-admin/platform/users", ctl: SuperAdminPlatformController, handler: 'createSuperAdmin', today: [{"email":"ops@x.co","fullName":"Ops"}], bad: [{"email":{"e":1},"fullName":"x"}, "email"] },
  { route: "POST /super-admin/platform/users/invite", ctl: SuperAdminPlatformController, handler: 'inviteUser', today: [{"email":"m@x.co","fullName":"Mai","role":"manager","tenantId":"t-1","branchId":"b-1"},{"phone":"6095551234","fullName":"Mai","role":"technician","tenantId":"t-1","branchId":null}], bad: [{"fullName":"x","role":{"r":1}}, "role"] },
  { route: "POST /super-admin/platform/invitations", ctl: SuperAdminPlatformController, handler: 'createInvitation', today: [{"email":"m@x.co","fullName":"Mai","role":"owner","tenantId":"t-1","branchId":null,"channel":"email"},{"email":"ops@x.co","role":"platform","platformRole":"support_agent"}], bad: [{"role":"owner","channel":{"c":1}}, "channel"] },
  { route: "POST /super-admin/platform/scheduled-reports", ctl: SuperAdminPlatformController, handler: 'createScheduledReport', today: [{"name":"Weekly","reportKey":"tenants","cadence":"weekly","recipientEmail":"ops@x.co","filters":{"status":"active"}},{"name":"Daily","cadence":"daily","recipientEmail":null}], bad: [{"name":"x","filters":"status=active"}, "filters"] },
  { route: "POST /super-admin/platform/scheduled-reports/:id/toggle", ctl: SuperAdminPlatformController, handler: 'toggleScheduledReport', today: [{"enabled":true},{"enabled":false}], bad: [{"enabled":{"e":1}}, "enabled"] },
  { route: "POST /super-admin/platform/access-requests", ctl: SuperAdminPlatformController, handler: 'createAccessRequest', today: [{"requestingUserId":"u-1","requestedRole":"manager","reason":"coverage","requestedDurationDays":7,"tenantId":"t-1","requestedBranchIds":["b-1"]}], bad: [{"requestedRole":"manager","requestedBranchIds":"b-1"}, "requestedBranchIds"] },
  { route: "POST /super-admin/platform/access-requests/:id/review", ctl: SuperAdminPlatformController, handler: 'reviewAccessRequest', today: [{}], bad: [{"notes":{"n":1}}, "notes"] },
  { route: "POST /super-admin/platform/access-requests/:id/approve", ctl: SuperAdminPlatformController, handler: 'approveAccessRequest', today: [{},{"notes":"ok","durationDays":7,"confirmHighRisk":true},{"durationDays":null}], bad: [{"durationDays":"7"}, "durationDays"] },
  { route: "POST /super-admin/platform/access-requests/:id/reject", ctl: SuperAdminPlatformController, handler: 'rejectAccessRequest', today: [{},{"notes":"no"}], bad: [{"notes":["x"]}, "notes"] },
  { route: "POST /super-admin/platform/users/branch-access", ctl: SuperAdminPlatformController, handler: 'assignUserBranch', today: [{"sessionId":"s-1","tenantId":"t-1","userId":"u-1","branchId":"b-1","reason":"covering shifts","accessLevel":"staff"}], bad: [{"sessionId":"s","userId":{"u":1}}, "userId"] },
  { route: "POST /super-admin/platform/users/branch-access/revoke", ctl: SuperAdminPlatformController, handler: 'revokeUserBranch', today: [{"sessionId":"s-1","tenantId":"t-1","userId":"u-1","branchId":"b-1","reason":"left the salon"}], bad: [{"branchId":[1]}, "branchId"] },
  { route: "POST /super-admin/platform/users/:id/role", ctl: SuperAdminPlatformController, handler: 'setUserRole', today: [{"role":"manager"}], bad: [{"role":{"r":1}}, "role"] },
  { route: "POST /super-admin/platform/users/:id/mfa", ctl: SuperAdminPlatformController, handler: 'setUserMfa', today: [{"required":true},{"required":false}], bad: [{"required":{"r":1}}, "required"] },
  { route: "POST /super-admin/platform/support-sessions", ctl: SuperAdminPlatformController, handler: 'startSupport', today: [{"tenantId":"t-1","reason":"billing issue","minutes":30,"scope":"read_only"}], bad: [{"tenantId":"t-1","minutes":{"m":1}}, "minutes"] },
  { route: "POST /super-admin/platform/support-sessions/:id/extend", ctl: SuperAdminPlatformController, handler: 'extendSupport', today: [{"minutes":15,"reason":"still fixing"}], bad: [{"minutes":[15],"reason":"r"}, "minutes"] },
  { route: "POST /super-admin/platform/support-sessions/:id/action", ctl: SuperAdminPlatformController, handler: 'supportAction', today: [{"tenantId":"t-1","appointmentId":"a-1","action":"reschedule","reason":"owner asked","before":{"startsAt":"2026-10-09T15:00:00Z"},"after":{"startsAt":"2026-10-09T16:00:00Z"}}], bad: [{"tenantId":"t-1","action":{"a":1}}, "action"] },
  { route: "POST /super-admin/platform/support-sessions/:id/customer-action", ctl: SuperAdminPlatformController, handler: 'customerSupportAction', today: [{"tenantId":"t-1","customerId":"c-1","action":"update_contact","reason":"owner asked","before":{"phone":"1"},"after":{"phone":"2"}}], bad: [{"tenantId":"t-1","customerId":[1]}, "customerId"] },
  { route: "POST /super-admin/platform/app-flags/:tenantId", ctl: SuperAdminPlatformController, handler: 'setAppFlag', today: [{"flag":"public_listing","enabled":true},{"flag":"public_listing","enabled":null}], bad: [{"flag":{"f":1}}, "flag"] },
  { route: "POST /super-admin/platform-staff/:userId/role", ctl: PlatformStaffController, handler: 'changeRole', today: [{"platformRole":"support_agent","reason":"moved teams"}], bad: [{"platformRole":{"r":1},"reason":"r"}, "platformRole"] },
  { route: "POST /super-admin/platform-staff/:userId/status", ctl: PlatformStaffController, handler: 'changeStatus', today: [{"status":"suspended","reason":"left"},{"status":"active","reason":"back"}], bad: [{"status":[1],"reason":"r"}, "status"] },
  { route: "POST /super-admin/platform-staff/:userId/revoke-sessions", ctl: PlatformStaffController, handler: 'revokeSessions', today: [{"reason":"lost laptop"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/platform-staff/:userId/reset-mfa", ctl: PlatformStaffController, handler: 'resetMfa', today: [{"reason":"new phone"}], bad: [{"reason":[1]}, "reason"] },
];

describe('super-admin platform — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
