// BUILD_PLAN Phase 12 (#17): super-admin tenants routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminTenantsController } from './super-admin-tenants/super-admin-tenants.controller';
import { TechMembershipAdminController } from './super-admin-staff/global-tech-admin.controller';
import { SuperAdminVoiceController } from './super-admin-voice/super-admin-voice.controller';
import { WebsiteLeadsController } from './super-admin-website-leads/super-admin-website-leads.module';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/tenants/:id/payment-gateway", ctl: SuperAdminTenantsController, handler: 'setGateway', today: [{"processorType":"processor_b","environment":"sandbox","status":"configured","onboardingStatus":"approved","merchantId":"MID-1","apiUsername":"user","apiPassword":"placeholder-value","boltBaseUrl":"https://bolt.example/api","boltApiKey":"placeholder-value"}], bad: [{"processorType":"processor_b","merchantId":{"m":1}}, "merchantId"] },
  { route: "PATCH /super-admin/tenants/:id/payment-gateway", ctl: SuperAdminTenantsController, handler: 'patchGateway', today: [{"processorType":"processor_a","environment":"production","status":"active","onboardingStatus":"approved"}], bad: [{"environment":["x"]}, "environment"] },
  { route: "POST /super-admin/tenants/bulk-status", ctl: SuperAdminTenantsController, handler: 'bulkStatus', today: [{"tenantIds":["t-1","t-2"],"status":"paused","reason":"non-payment","reasonCode":"billing"}], bad: [{"tenantIds":"t-1","status":"paused"}, "tenantIds"] },
  { route: "POST /super-admin/tenants", ctl: SuperAdminTenantsController, handler: 'create', today: [{"displayName":"Nails","code":"NAIL1","plan":"pro","aiPackage":"basic","city":"Merchantville","state":"NJ","initialCommissionPercent":50,"owner":{"firstName":"Mai","lastName":"Tran","email":"m@x.co","phone":"6095551234","initialCommissionPercent":50}},{"legalName":"Nails LLC","displayName":"Nails","tenantCode":"NAIL2","ownerName":"Mai Tran","ownerEmail":"m@x.co","branch":{"name":"Nails","city":"Merchantville","state":"NJ","phone":"6095551234"},"plan":"starter"}], bad: [{"displayName":"x","owner":"Mai"}, "owner"] },
  { route: "POST /super-admin/tenants/:id/suspend", ctl: SuperAdminTenantsController, handler: 'suspend', today: [{"reason":"chargebacks"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/tenants/:id/lifecycle", ctl: SuperAdminTenantsController, handler: 'changeLifecycle', today: [{"state":"active","reason":"onboarded"},{"state":"churned","reason":"closed","reasonCode":"closed_business"}], bad: [{"state":{"s":1}}, "state"] },
  { route: "POST /super-admin/tenants/:id/warning", ctl: SuperAdminTenantsController, handler: 'sendWarning', today: [{"warningType":"payment_issue","severity":"medium","subject":"Payment failed","message":"Please update your card","sendEmail":true,"sendSms":false,"showInTenantDashboard":true,"internalNote":""}], bad: [{"warningType":"x","subject":["s"]}, "subject"] },
  { route: "POST /super-admin/tenants/:id/support-access", ctl: SuperAdminTenantsController, handler: 'supportAccess', today: [{"reason":"owner asked for help","source":"tenants_salons_quick_actions"},{}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/tenants/import", ctl: SuperAdminTenantsController, handler: 'import', today: [{"rows":[{"displayName":"Nails","ownerEmail":"m@x.co","ownerName":"Mai","plan":"starter","state":"NJ"}]}], bad: [{"rows":[{"displayName":{"d":1}}]}, "rows[0].displayName"] },
  { route: "POST /super-admin/commission-auth-code/generate", ctl: SuperAdminTenantsController, handler: 'generateCommissionAuthCode', today: [{},{"tenantId":"11111111-1111-4111-8111-111111111112","reason":"owner requested change"}], bad: [{"tenantId":{"t":1}}, "tenantId"] },
  { route: "PATCH /super-admin/tenants/:id/status", ctl: SuperAdminTenantsController, handler: 'changeStatus', today: [{"status":"active","reason":"paid"},{"status":"suspended","reason":"fraud","reasonCode":"risk"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "PATCH /super-admin/tenants/:id/commission", ctl: SuperAdminTenantsController, handler: 'updateTenantCommission', today: [{"initialCommissionPercent":55}], bad: [{"initialCommissionPercent":{"p":1}}, "initialCommissionPercent"] },
  { route: "PATCH /super-admin/technician-memberships/:membershipId", ctl: TechMembershipAdminController, handler: 'update', today: [{"action":"pause","reason":"investigation"},{"action":"reactivate"},{"action":"reject_destination","reason":"no"}], bad: [{"action":{"a":1}}, "action"] },
  { route: "POST /super-admin/voice/keys", ctl: SuperAdminVoiceController, handler: 'issueKey', today: [{"tenantId":"t-1","branchId":"b-1","label":"Front desk","provider":"twilio","environment":"live"}], bad: [{"tenantId":"t-1","branchId":"b-1","label":{"l":1}}, "label"] },
  { route: "POST /super-admin/voice/suggestions/:id/approve", ctl: SuperAdminVoiceController, handler: 'approve', today: [{"newPromptBody":"You are a friendly receptionist","scope":"branch"},{}], bad: [{"newPromptBody":{"p":1}}, "newPromptBody"] },
  { route: "POST /super-admin/voice/prompts/:id/activate", ctl: SuperAdminVoiceController, handler: 'activate', today: [{"scope":"tenant"},{}], bad: [{"scope":["x"]}, "scope"] },
  { route: "POST /super-admin/voice/prompts/rollback", ctl: SuperAdminVoiceController, handler: 'rollback', today: [{"scope":"tenant"},{}], bad: [{"scope":{"s":1}}, "scope"] },
  { route: "POST /super-admin/website-leads", ctl: WebsiteLeadsController, handler: 'create', today: [{"salonName":"Nails","contactName":"Mai","phone":"6095551234","email":"m@x.co","city":"Merchantville","state":"NJ","source":"manual","technicianCount":4}], bad: [{"salonName":{"n":1}}, "salonName"] },
  { route: "POST /super-admin/website-leads/:id/notes", ctl: WebsiteLeadsController, handler: 'note', today: [{"text":"called"}], bad: [{"text":{"t":1}}, "text"] },
  { route: "POST /super-admin/website-leads/:id/follow-ups", ctl: WebsiteLeadsController, handler: 'followUp', today: [{"dueAt":"2026-10-12T15:00:00Z","notes":"demo"},{"assignedToUserId":"u-1","dueAt":"2026-10-13T15:00:00Z"}], bad: [{"dueAt":{"d":1}}, "dueAt"] },
  { route: "PATCH /super-admin/website-leads/:id", ctl: WebsiteLeadsController, handler: 'update', today: [{"salonName":"Nails 2","leadScore":70}], bad: [{"leadScore":"high"}, "leadScore"] },
  { route: "PATCH /super-admin/website-leads/:id/status", ctl: WebsiteLeadsController, handler: 'status', today: [{"status":"contacted"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "PATCH /super-admin/website-leads/:id/assign", ctl: WebsiteLeadsController, handler: 'assign', today: [{"assignedToUserId":"u-1"},{"assignedToUserId":null}], bad: [{"assignedToUserId":[1]}, "assignedToUserId"] },
];

describe('super-admin tenants — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
