// BUILD_PLAN Phase 12 (#17): super-admin finance routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminRevenueResidualsController } from './super-admin-revenue-residuals/super-admin-revenue-residuals.controller';
import { GrantController } from './super-admin-security/grant.controller';
import { IncidentController } from './super-admin-security/incident.controller';
import { IpBlockController } from './super-admin-security/ip-block.controller';
import { LockdownController } from './super-admin-security/lockdown.controller';
import { PolicyController } from './super-admin-security/policy.controller';
import { RetentionController } from './super-admin-security/retention.controller';
import { SessionRevokeController } from './super-admin-security/session-revoke.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/revenue-residuals/agreements", ctl: SuperAdminRevenueResidualsController, handler: 'createAgreement', today: [{"name":"Metro split","agreementType":"layered","tenantId":"t-1","branchId":null,"processor":"processor_a","revenueSource":"processing","aiPct":30,"processorPct":40,"salonPct":30,"effectiveDate":"2026-11-01","expirationDate":null,"currency":"USD","roundingPolicy":"half_up","refundAllocation":"pro_rata","status":"draft","changeReason":"new deal"}], bad: [{"name":"x","aiPct":{"p":1}}, "aiPct"] },
  { route: "POST /super-admin/revenue-residuals/agreements/:id/versions", ctl: SuperAdminRevenueResidualsController, handler: 'createVersion', today: [{"aiPct":25,"processorPct":45,"salonPct":30,"effectiveDate":"2027-01-01","changeReason":"renewal"}], bad: [{"aiPct":25,"effectiveDate":{"d":1}}, "effectiveDate"] },
  { route: "POST /super-admin/revenue-residuals/residual-statements/import", ctl: SuperAdminRevenueResidualsController, handler: 'importStatement', today: [{"processor":"processor_a","statementRef":"ST-2026-09","merchantAccount":"MA-1","tenantId":null,"periodStart":"2026-09-01","periodEnd":"2026-09-30","currency":"USD","transactionVolumeCents":10000000,"processingResidualCents":45000,"processorCalculatedCents":45000,"lines":[{"merchantAccount":"MA-1","tenantId":"t-1","grossVolumeCents":5000000,"eligibleRevenueCents":4800000,"residualCents":22000,"note":null}]},{"processor":"processor_a","statementRef":"ST-2","periodStart":"2026-09-01","periodEnd":"2026-09-30","processorCalculatedCents":100,"costLines":[{"category":"interchange","amountCents":500}],"eligibilityOverrides":{"interchange":false}}], bad: [{"processor":"f","statementRef":"s","processorCalculatedCents":1,"status":"reconciled"}, "status"] },
  { route: "POST /super-admin/revenue-residuals/residual-statements/:id/review", ctl: SuperAdminRevenueResidualsController, handler: 'reviewStatement', today: [{"status":"reviewed","notes":"ok"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "POST /super-admin/revenue-residuals/residual-statements/:id/reconcile", ctl: SuperAdminRevenueResidualsController, handler: 'reconcile', today: [{},{"notes":"variance explained"}], bad: [{"notes":["x"]}, "notes"] },
  { route: "POST /super-admin/revenue-residuals/partner-payouts/calculate", ctl: SuperAdminRevenueResidualsController, handler: 'calculatePartnerPayout', today: [{"agreementId":"a-1","periodStart":"2026-09-01","periodEnd":"2026-09-30","priorBalanceCents":0}], bad: [{"agreementId":"a","priorBalanceCents":"0"}, "priorBalanceCents"] },
  { route: "POST /super-admin/revenue-residuals/tenant-incentives/calculate", ctl: SuperAdminRevenueResidualsController, handler: 'calculateTenantIncentive', today: [{"agreementId":"a-1","tenantId":"t-1","periodStart":"2026-09-01","periodEnd":"2026-09-30"}], bad: [{"agreementId":"a","tenantId":"t-1","periodStart":{"d":1}}, "periodStart"] },
  { route: "POST /super-admin/revenue-residuals/revenue-adjustments", ctl: SuperAdminRevenueResidualsController, handler: 'createAdjustment', today: [{"agreementId":"a-1","tenantId":"t-1","adjustmentType":"credit","amountCents":2500,"reason":"fee refund"}], bad: [{"adjustmentType":"credit","amountCents":2500,"reason":"r","status":"approved"}, "status"] },
  { route: "POST /super-admin/revenue-residuals/revenue-adjustments/:id/reject", ctl: SuperAdminRevenueResidualsController, handler: 'rejectAdjustment', today: [{},{"reason":"no evidence"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/revenue-residuals/revenue-adjustments/:id/reverse", ctl: SuperAdminRevenueResidualsController, handler: 'reverseAdjustment', today: [{},{"reason":"entered twice"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/revenue-residuals/accounting-periods", ctl: SuperAdminRevenueResidualsController, handler: 'createPeriod', today: [{"name":"Sep 2026","startDate":"2026-09-01","endDate":"2026-09-30","currency":"USD"}], bad: [{"name":"x","startDate":{"d":1}}, "startDate"] },
  { route: "POST /super-admin/revenue-residuals/accounting-periods/:id/lock", ctl: SuperAdminRevenueResidualsController, handler: 'lockPeriod', today: [{},{"reason":"month end"}], bad: [{"reason":5}, "reason"] },
  { route: "POST /super-admin/revenue-residuals/accounting-periods/:id/reopen", ctl: SuperAdminRevenueResidualsController, handler: 'reopenPeriod', today: [{"reason":"late statement"}], bad: [{"reason":{"x":1}}, "reason"] },
  { route: "POST /super-admin/revenue-residuals/export-jobs", ctl: SuperAdminRevenueResidualsController, handler: 'enqueueExportJob', today: [{},{"dataset":"payouts","format":"xlsx","agreementId":"a-1","status":"approved","startDate":"2026-09-01","endDate":"2026-09-30"}], bad: [{"dataset":["x"]}, "dataset"] },
  { route: "POST /super-admin/security/privileged-access/request", ctl: GrantController, handler: 'request', today: [{"userId":"u-1","privilege":"db_read","scope":"tenant","target":"t-1","reason":"incident 12","expiresAt":"2026-10-09T00:00:00Z"}], bad: [{"userId":"u-1","privilege":{"p":1}}, "privilege"] },
  { route: "POST /super-admin/security/privileged-access/:id/deny", ctl: GrantController, handler: 'deny', today: [{"reason":"not needed"},{}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/security/privileged-access/:id/revoke", ctl: GrantController, handler: 'revoke', today: [{"reason":"done"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/security/incidents", ctl: IncidentController, handler: 'create', today: [{"title":"Credential stuffing","description":"spike of failed logins","category":"auth","severity":"high","detectionSource":"alert","tenantId":null}], bad: [{"title":"x","severity":{"s":1}}, "severity"] },
  { route: "PATCH /super-admin/security/incidents/:id/transition", ctl: IncidentController, handler: 'transition', today: [{"toStatus":"contained","reason":"blocked IPs"}], bad: [{"toStatus":["x"]}, "toStatus"] },
  { route: "POST /super-admin/security/ip-blocks/preview", ctl: IpBlockController, handler: 'preview', today: [{"target":"203.0.113.0/24"}], bad: [{"target":{"t":1}}, "target"] },
  { route: "POST /super-admin/security/ip-blocks", ctl: IpBlockController, handler: 'create', today: [{"target":"203.0.113.7","threatType":"brute_force","source":"manual","reason":"attack","expiresAt":"2026-10-15T00:00:00Z"}], bad: [{"target":"1.2.3.4","reason":["x"]}, "reason"] },
  { route: "POST /super-admin/security/ip-blocks/allowlist", ctl: IpBlockController, handler: 'allow', today: [{"target":"198.51.100.4","reason":"office"}], bad: [{"target":{"t":1}}, "target"] },
  { route: "POST /super-admin/security/lockdowns/propose", ctl: LockdownController, handler: 'propose', today: [{"scope":"tenant","target":"t-1","reason":"compromise"}], bad: [{"scope":{"s":1}}, "scope"] },
  { route: "POST /super-admin/security/lockdowns/:id/confirm", ctl: LockdownController, handler: 'confirm', today: [{"confirmationPhrase":"LOCK t-1","stepUpVerified":true}], bad: [{"confirmationPhrase":["x"]}, "confirmationPhrase"] },
  { route: "POST /super-admin/security/lockdowns/:id/lift", ctl: LockdownController, handler: 'lift', today: [{"reason":"resolved"}], bad: [{"reason":7}, "reason"] },
  { route: "PATCH /super-admin/security/mfa-policy", ctl: PolicyController, handler: 'setMfa', today: [{"requiredRoles":["super_admin","owner"],"methods":["totp","webauthn"],"graceDays":7},{"config":{"requiredRoles":["super_admin"],"methods":["totp"],"graceDays":0}}], bad: [{"config":"x"}, "config"], keepsUnknown: true },
  { route: "PATCH /super-admin/security/password-policy", ctl: PolicyController, handler: 'setPw', today: [{"minLength":12,"maxLength":128,"historyCount":5,"lockoutThreshold":5,"compromisedCheck":true,"commonRejection":true}], bad: [{"minLength":{"n":12}}, "minLength"], keepsUnknown: true },
  { route: "PATCH /super-admin/security/session-policy", ctl: PolicyController, handler: 'setSess', today: [{"idleMinutes":30,"absoluteHours":12,"refreshDays":14,"privilegedIdleMinutes":15,"concurrentLimit":3,"reauthForSensitive":true}], bad: [{"idleMinutes":{"m":1}}, "idleMinutes"], keepsUnknown: true },
  { route: "PATCH /super-admin/security/retention-rules/:dataClass", ctl: RetentionController, handler: 'upsert', today: [{"retentionDays":365,"action":"delete"}], bad: [{"retentionDays":{"d":1}}, "retentionDays"] },
  { route: "POST /super-admin/security/sessions/revoke/preview", ctl: SessionRevokeController, handler: 'preview', today: [{"scope":"user","target":"u-1","reason":"compromised","includeCurrent":false}], bad: [{"scope":"user","target":{"t":1}}, "target"] },
  { route: "POST /super-admin/security/sessions/revoke", ctl: SessionRevokeController, handler: 'revoke', today: [{"scope":"tenant","target":"t-1","reason":"breach","includeCurrent":false}], bad: [{"scope":["x"]}, "scope"] },
];

describe('super-admin finance — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
