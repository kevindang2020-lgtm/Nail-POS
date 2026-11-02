// BUILD_PLAN Phase 12 (#17): super-admin audit routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminAlertsController } from './super-admin-alerts/alerts.controller';
import { AuditLogsOverviewController } from './super-admin-audit-logs/audit-logs.module';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/alerts/:id/notes", ctl: SuperAdminAlertsController, handler: 'note', today: [{"note":"looking into it"}], bad: [{"note":{"n":1}}, "note"] },
  { route: "PATCH /super-admin/alerts/:id/status", ctl: SuperAdminAlertsController, handler: 'setStatus', today: [{"status":"acknowledged"}], bad: [{"status":["x"]}, "status"] },
  { route: "POST /super-admin/audit-logs/legal-holds", ctl: AuditLogsOverviewController, handler: 'placeHold', today: [{"scopeType":"tenant","scopeValue":"t-1","reason":"litigation","legalAuthority":"subpoena 12","reviewDate":"2027-01-01","expirationDate":"2028-01-01"},{"scopeType":"all","reason":"audit"}], bad: [{"scopeType":"tenant","reason":{"x":1}}, "reason"] },
  { route: "POST /super-admin/audit-logs/legal-holds/:id/release", ctl: AuditLogsOverviewController, handler: 'releaseHold', today: [{"reason":"matter closed"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/audit-logs/investigations", ctl: AuditLogsOverviewController, handler: 'openInvestigation', today: [{"title":"Odd refunds","severity":"high","tenantId":"t-1","assignee":"ops@x.co","description":"spike","eventRefs":["e-1","e-2"]},{"title":"x"}], bad: [{"title":"x","eventRefs":"e-1"}, "eventRefs"] },
  { route: "POST /super-admin/audit-logs/investigations/:id/events", ctl: AuditLogsOverviewController, handler: 'linkEvent', today: [{"eventRef":"e-9"}], bad: [{"eventRef":{"e":1}}, "eventRef"] },
  { route: "POST /super-admin/audit-logs/investigations/:id/notes", ctl: AuditLogsOverviewController, handler: 'addNote', today: [{"note":"called owner"}], bad: [{"note":["x"]}, "note"] },
  { route: "POST /super-admin/audit-logs/investigations/:id/status", ctl: AuditLogsOverviewController, handler: 'setStatus', today: [{"status":"closed","reason":"resolved"},{"status":"open"}], bad: [{"status":7}, "status"] },
  { route: "POST /super-admin/audit-logs/exports", ctl: AuditLogsOverviewController, handler: 'exportEvidence', today: [{},{"tenantId":"t-1"}], bad: [{"tenantId":["t"]}, "tenantId"] },
  { route: "POST /super-admin/audit-logs/tamper-controls", ctl: AuditLogsOverviewController, handler: 'setControl', today: [{"controlKey":"hash_chain","value":"on","status":"enabled","detail":"weekly"}], bad: [{"controlKey":"k","value":{"v":1}}, "value"] },
  { route: "POST /super-admin/audit-logs/export-flags/:id/review", ctl: AuditLogsOverviewController, handler: 'reviewFlag', today: [{"status":"cleared","note":"expected"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "POST /super-admin/audit-logs/retention-policies", ctl: AuditLogsOverviewController, handler: 'setPolicy', today: [{"category":"auth","hotDays":90,"archiveDays":2555,"reason":"policy"}], bad: [{"category":"auth","hotDays":[90]}, "hotDays"] },
];

describe('super-admin audit — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
