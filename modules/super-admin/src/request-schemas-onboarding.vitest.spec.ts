// BUILD_PLAN Phase 12 (#17): super-admin onboarding routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { OnboardingController } from './onboarding/onboarding.module';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/onboarding/applications", ctl: OnboardingController, handler: 'create', today: [{"applicationId":"app-1","applicationType":"new_salon","parentTenantId":null,"branchCount":2,"specialistUserId":null,"priority":"high","targetActivationDate":"2026-11-01"},{"applicationId":"app-2"}], bad: [{"applicationId":"a","branchCount":"two"}, "branchCount"] },
  { route: "POST /super-admin/onboarding/:id/notes", ctl: OnboardingController, handler: 'note', today: [{"body":"called owner","noteType":"general","visibility":"internal","stage":null,"followUpDate":"2026-10-20"}], bad: [{"body":{"x":1}}, "body"] },
  { route: "POST /super-admin/onboarding/:id/request-info", ctl: OnboardingController, handler: 'requestInfo', today: [{"message":"need EIN letter","deadline":"2026-10-15"},{"message":"x","deadline":null}], bad: [{"message":["x"]}, "message"] },
  { route: "POST /super-admin/onboarding/:id/return-for-correction", ctl: OnboardingController, handler: 'returnForCorrection', today: [{"reason":"bad docs","corrections":"re-upload license"}], bad: [{"reason":"x","corrections":{}}, "corrections"] },
  { route: "POST /super-admin/onboarding/:id/approvals", ctl: OnboardingController, handler: 'queueApproval', today: [{"approvalType":"step","stage":"merchant"},{"approvalType":"activation","stage":null}], bad: [{"approvalType":7}, "approvalType"] },
  { route: "POST /super-admin/onboarding/:id/activate", ctl: OnboardingController, handler: 'activate', today: [{"note":"go live","activationType":"full"},{}], bad: [{"note":{"a":1}}, "note"] },
  { route: "PATCH /super-admin/onboarding/documents/:documentId", ctl: OnboardingController, handler: 'reviewDocument', today: [{"status":"approved"},{"status":"rejected","rejectionReason":"blurry"}], bad: [{"status":["approved"]}, "status"] },
  { route: "PATCH /super-admin/onboarding/:id/transition", ctl: OnboardingController, handler: 'transition', today: [{"toState":"merchant_setup","reason":null,"allowSkip":false},{"toState":"on_hold","reason":"waiting","resumeStage":"documents"}], bad: [{"toState":{"x":1}}, "toState"] },
  { route: "PATCH /super-admin/onboarding/:id/assign", ctl: OnboardingController, handler: 'assign', today: [{"specialistUserId":"22222222-2222-4222-8222-222222222222"},{"specialistUserId":null}], bad: [{"specialistUserId":42}, "specialistUserId"] },
  { route: "PATCH /super-admin/onboarding/approvals/:approvalId", ctl: OnboardingController, handler: 'decide', today: [{"status":"approved","reason":null},{"status":"rejected","reason":"incomplete"}], bad: [{"status":{"a":1}}, "status"] },
];

describe('super-admin onboarding — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
