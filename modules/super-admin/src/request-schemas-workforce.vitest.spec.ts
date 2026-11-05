// BUILD_PLAN Phase 12 (#17): super-admin workforce routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SmartRemindersController } from './super-admin-smart-reminders/smart-reminders.module';
import { GlobalTechAdminController } from './super-admin-staff/global-tech-admin.controller';
import { SuperAdminStaffController } from './super-admin-staff/super-admin-staff.controller';
import { SuperAdminSupportController } from './super-admin-support/super-admin-support.module';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/smart-reminders/templates", ctl: SmartRemindersController, handler: 'createTemplate', today: [{"name":"Appt reminder","reminderType":"appointment_reminder","sms":"Hi {{first_name}}","emailSubject":"Reminder","emailBody":"See you","pushTitle":"Reminder","pushBody":"Tomorrow"},{"name":"x","reminderType":"rebook","sms":"Book again"}], bad: [{"name":"x","sms":{"s":1}}, "sms"] },
  { route: "POST /super-admin/smart-reminders/templates/:id/versions", ctl: SmartRemindersController, handler: 'addVersion', today: [{"sms":"Hi {{first_name}} v2"}], bad: [{"sms":["x"]}, "sms"] },
  { route: "POST /super-admin/smart-reminders/templates/preview", ctl: SmartRemindersController, handler: 'previewTemplate', today: [{"sms":"Hi {{first_name}}","values":{"first_name":"Mai"}}], bad: [{"sms":"x","values":"first_name=Mai"}, "values"] },
  { route: "POST /super-admin/smart-reminders/timing", ctl: SmartRemindersController, handler: 'setTiming', today: [{"reminderType":"appointment_reminder","direction":"before","offsetMinutes":1440,"minOffsetMinutes":60,"maxOffsetMinutes":2880,"quietHoursStart":21,"quietHoursEnd":8,"quietHoursPolicy":"defer","timezoneSource":"branch"}], bad: [{"reminderType":"r","offsetMinutes":{"m":1}}, "offsetMinutes"] },
  { route: "POST /super-admin/smart-reminders/tenant-customizations/:tenantId", ctl: SmartRemindersController, handler: 'setOverride', today: [{"reminderType":"appointment_reminder","enabled":true,"direction":"before","offsetMinutes":120,"channels":["sms","email"],"quietHoursPolicy":"defer"},{"reminderType":"rebook","offsetMinutes":null}], bad: [{"reminderType":"r","channels":"sms"}, "channels"] },
  { route: "POST /super-admin/smart-reminders/flows/disable", ctl: SmartRemindersController, handler: 'disableFlow', today: [{"reminderType":"rebook","reason":"carrier issue"},{"reminderType":"rebook","reason":"x","status":"paused"}], bad: [{"reminderType":{"r":1},"reason":"x"}, "reminderType"] },
  { route: "POST /super-admin/smart-reminders/flows/enable", ctl: SmartRemindersController, handler: 'enableFlow', today: [{"reminderType":"rebook"}], bad: [{"reminderType":["r"]}, "reminderType"] },
  { route: "POST /super-admin/smart-reminders/channels", ctl: SmartRemindersController, handler: 'setChannels', today: [{"reminderType":"appointment_reminder","primaryChannel":"sms","fallbackChannels":["email","push"],"fallbackOn":"failure","stopOnSuccess":true}], bad: [{"reminderType":"r","primaryChannel":"sms","fallbackChannels":"email"}, "fallbackChannels"] },
  { route: "POST /super-admin/smart-reminders/channels/preview-fallback", ctl: SmartRemindersController, handler: 'previewFallback', today: [{"primaryChannel":"sms","fallbackChannels":["email"],"attempts":[{"channel":"sms","outcome":"failed"}]}], bad: [{"primaryChannel":{"c":1}}, "primaryChannel"] },
  { route: "POST /super-admin/smart-reminders/plan-features", ctl: SmartRemindersController, handler: 'setPlanFeature', today: [{"planCode":"pro","featureKey":"smart_reminders.fallback","state":"enabled"}], bad: [{"planCode":"pro","featureKey":"f","state":{"s":1}}, "state"] },
  { route: "POST /super-admin/smart-reminders/exports", ctl: SmartRemindersController, handler: 'exportCsv', today: [{"dataset":"tenant-usage"},{"dataset":"deliveries","tenantId":"t-1"}], bad: [{"dataset":["x"]}, "dataset"] },
  { route: "POST /super-admin/technicians/:profileId/suspend", ctl: GlobalTechAdminController, handler: 'suspend', today: [{"reason":"policy violation"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/technicians/:profileId/pause", ctl: GlobalTechAdminController, handler: 'pause', today: [{"reason":"investigation"},{"reason":"x","expiresAt":"2026-11-01T00:00:00Z"}], bad: [{"reason":"x","expiresAt":{"e":1}}, "expiresAt"] },
  { route: "POST /super-admin/technicians/:profileId/lock", ctl: GlobalTechAdminController, handler: 'lock', today: [{"reason":"account takeover"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/technicians/:profileId/scoped-pause", ctl: GlobalTechAdminController, handler: 'scopedPause', today: [{"scope":"messaging","paused":true,"reason":"spam"},{"scope":"deals","paused":false}], bad: [{"scope":{"s":1},"paused":true}, "scope"] },
  { route: "POST /super-admin/technicians/:profileId/delete-request", ctl: GlobalTechAdminController, handler: 'requestDeletion', today: [{"reason":"tech asked","requesterKind":"technician","legalHold":false}], bad: [{"reason":"x","legalHold":{"l":1}}, "legalHold"] },
  { route: "POST /super-admin/technicians/delete-requests/:requestId/decision", ctl: GlobalTechAdminController, handler: 'decideDeletion', today: [{"decision":"approve"},{"decision":"reject","note":"legal hold"}], bad: [{"decision":{"d":1}}, "decision"] },
  { route: "POST /super-admin/technicians/:profileId/merge", ctl: GlobalTechAdminController, handler: 'merge', today: [{"duplicateId":"tp-2","reason":"same person"}], bad: [{"duplicateId":{"d":1},"reason":"r"}, "duplicateId"] },
  { route: "POST /super-admin/staff/workforce/:userId/access-support", ctl: SuperAdminStaffController, handler: 'accessSupport', today: [{"action":"reset_password","reason":"locked out"}], bad: [{"action":{"a":1},"reason":"r"}, "action"] },
  { route: "POST /super-admin/staff/workforce/:userId/deactivate-access", ctl: SuperAdminStaffController, handler: 'deactivateAccess', today: [{"reason":"left salon"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/staff/workforce-duplicates/review", ctl: SuperAdminStaffController, handler: 'reviewDuplicate', today: [{"canonicalId":"u-1","memberIds":["u-2","u-3"],"reason":"same email"}], bad: [{"canonicalId":"u-1","memberIds":"u-2"}, "memberIds"] },
  { route: "POST /super-admin/staff/workforce/:userId/transfer", ctl: SuperAdminStaffController, handler: 'requestTransfer', today: [{"toBranchId":"b-2","reason":"moving"}], bad: [{"toBranchId":{"b":1},"reason":"r"}, "toBranchId"] },
  { route: "POST /super-admin/staff/workforce-transfers/:id/decision", ctl: SuperAdminStaffController, handler: 'decideTransfer', today: [{"decision":"approve"},{"decision":"reject","note":"no"}], bad: [{"decision":["x"]}, "decision"] },
  { route: "POST /super-admin/staff/workforce/:userId/cross-transfer", ctl: SuperAdminStaffController, handler: 'requestCrossTransfer', today: [{"toTenantId":"t-2","toBranchId":"b-9","effectiveDate":"2026-11-01","reason":"new salon"},{"toTenantId":"t-2","reason":"x"}], bad: [{"toTenantId":{"t":1},"reason":"r"}, "toTenantId"] },
  { route: "POST /super-admin/staff/workforce-cross-transfers/:id/decision", ctl: SuperAdminStaffController, handler: 'decideCrossTransfer', today: [{"decision":"approve","note":"ok"}], bad: [{"decision":{"d":1}}, "decision"] },
  { route: "POST /super-admin/staff/workforce-payroll-sync/:id/retry", ctl: SuperAdminStaffController, handler: 'retryPayrollSync', today: [{"reason":"provider back up"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/staff/workforce-security-activity/review", ctl: SuperAdminStaffController, handler: 'reviewSecurity', today: [{"alertKey":"impossible_travel:u-1","resolution":"benign","reason":"vpn"}], bad: [{"alertKey":"k","resolution":{"r":1},"reason":"x"}, "resolution"] },
  { route: "POST /super-admin/staff/workforce-views", ctl: SuperAdminStaffController, handler: 'saveView', today: [{"name":"Suspended techs","filters":{"role":"technician","status":"suspended","sort":"name","dir":"asc","pageSize":50},"isDefault":true}], bad: [{"name":"x","filters":"role=tech"}, "filters"] },
  { route: "POST /super-admin/support/tickets", ctl: SuperAdminSupportController, handler: 'createTicket', today: [{"tenantId":"t-1","branchId":null,"subject":"Printer offline","description":"since 9am","category":"hardware","priority":"high"}], bad: [{"tenantId":"t-1","subject":{"s":1}}, "subject"] },
  { route: "POST /super-admin/support/tickets/:id/reply", ctl: SuperAdminSupportController, handler: 'reply', today: [{"body":"We are on it"}], bad: [{"body":{"b":1}}, "body"] },
  { route: "POST /super-admin/support/tickets/:id/status", ctl: SuperAdminSupportController, handler: 'setTicketStatus', today: [{"to":"resolved","note":"fixed"},{"to":"open"}], bad: [{"to":["x"]}, "to"] },
  { route: "POST /super-admin/support/tickets/:id/internal-note", ctl: SuperAdminSupportController, handler: 'addInternalNote', today: [{"body":"escalated"}], bad: [{"body":[1]}, "body"] },
];

describe('super-admin workforce — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
