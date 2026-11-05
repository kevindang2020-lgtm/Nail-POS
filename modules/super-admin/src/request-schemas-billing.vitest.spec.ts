// BUILD_PLAN Phase 12 (#17): super-admin billing routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { BillingCycleController } from './super-admin-billing/billing-cycle.controller';
import { SuperAdminBillingController } from './super-admin-billing/billing.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/billing/cycle/run", ctl: BillingCycleController, handler: 'run', today: [{"dryRun":false},{"dryRun":true}], bad: [{"dryRun":{"x":1}}, "dryRun"] },
  { route: "POST /super-admin/billing/invoices", ctl: SuperAdminBillingController, handler: 'createInvoice', today: [{"tenantId":"t-1","planCode":"pro","lines":[{"kind":"plan","description":"Pro plan","quantity":1,"unitPriceCents":9900}],"discountCents":0,"dueDate":"2026-11-01"}], bad: [{"tenantId":"t-1","lines":[{"kind":"plan","quantity":1,"unitPriceCents":-5}]}, "lines[0].unitPriceCents"] },
  { route: "POST /super-admin/billing/credits/apply", ctl: SuperAdminBillingController, handler: 'applyCredit', today: [{"creditId":"c-1","invoiceNumber":"INV-2026-0001","amountCents":2500}], bad: [{"creditId":"c-1","invoiceNumber":"I","amountCents":25.5}, "amountCents"] },
  { route: "POST /super-admin/billing/payments/retry", ctl: SuperAdminBillingController, handler: 'retryPayment', today: [{"invoiceNumber":"INV-2026-0001","idempotencyKey":"k-1"}], bad: [{"invoiceNumber":"I","idempotencyKey":"k","status":"paid"}, "status"] },
  { route: "POST /super-admin/billing/subscriptions/change-plan", ctl: SuperAdminBillingController, handler: 'changePlan', today: [{"tenantId":"t-1","toPlanCode":"pro","preview":true},{"tenantId":"t-1","toPlanCode":"pro","strategy":"immediate"}], bad: [{"tenantId":"t-1","toPlanCode":{"p":1}}, "toPlanCode"] },
  { route: "POST /super-admin/billing/subscriptions/add-ons", ctl: SuperAdminBillingController, handler: 'changeAddOn', today: [{"tenantId":"t-1","addOnCode":"sms_pack","action":"add","quantity":2}], bad: [{"tenantId":"t-1","addOnCode":"x","action":"add","quantity":"2"}, "quantity"] },
  { route: "POST /super-admin/billing/subscriptions/extend-trial", ctl: SuperAdminBillingController, handler: 'extendTrial', today: [{"tenantId":"t-1","days":14}], bad: [{"tenantId":"t-1","days":{"d":1}}, "days"] },
  { route: "POST /super-admin/billing/discounts", ctl: SuperAdminBillingController, handler: 'createDiscount', today: [{"tenantId":"t-1","code":"FALL10","discountType":"percent","percent":10,"cycles":3},{"code":"FLAT5","discountType":"fixed","amountCents":500}], bad: [{"code":"X","discountType":"fixed","amountCents":-1}, "amountCents"] },
  { route: "POST /super-admin/billing/subscriptions/pause", ctl: SuperAdminBillingController, handler: 'pause', today: [{"tenantId":"t-1","resumeDate":"2026-12-01","reason":"seasonal"}], bad: [{"tenantId":"t-1","reason":["x"]}, "reason"] },
  { route: "POST /super-admin/billing/subscriptions/resume", ctl: SuperAdminBillingController, handler: 'resume', today: [{"tenantId":"t-1"}], bad: [{"tenantId":{"t":1}}, "tenantId"] },
  { route: "POST /super-admin/billing/subscriptions/cancel", ctl: SuperAdminBillingController, handler: 'cancel', today: [{"tenantId":"t-1","strategy":"end_of_period","preview":true},{"tenantId":"t-1","strategy":"immediate","reason":"closing"}], bad: [{"tenantId":"t-1","preview":{"p":1}}, "preview"] },
  { route: "POST /super-admin/billing/exports/jobs", ctl: SuperAdminBillingController, handler: 'createExportJob', today: [{"report":"invoices","format":"csv","tenantId":"t-1","status":"open"}], bad: [{"report":["invoices"]}, "report"] },
  { route: "POST /super-admin/billing/exports/jobs/process", ctl: SuperAdminBillingController, handler: 'processExportJobs', today: [{"limit":10},{}], bad: [{"limit":"ten"}, "limit"] },
  { route: "POST /super-admin/billing/exports", ctl: SuperAdminBillingController, handler: 'exportReport', today: [{"report":"invoices","format":"csv"},{"report":"subscriptions","tenantId":"t-1","status":"active","format":"xlsx"}], bad: [{"report":{"r":1}}, "report"] },
  { route: "POST /super-admin/billing/webhooks/ingest", ctl: SuperAdminBillingController, handler: 'ingestWebhook', today: [{"providerEventId":"evt_1","eventType":"invoice.paid","invoiceNumber":"INV-2026-0001"}], bad: [{"providerEventId":{"id":1},"eventType":"x"}, "providerEventId"] },
  { route: "POST /super-admin/billing/change-requests/:changeId/review", ctl: SuperAdminBillingController, handler: 'reviewRequest', today: [{"decision":"approve","note":"ok"},{"decision":"reject"}], bad: [{"decision":true}, "decision"] },
  { route: "PATCH /super-admin/billing/:tenantId/subscription", ctl: SuperAdminBillingController, handler: 'updateSubscription', today: [{"plan":"pro"},{"status":"active"},{"plan":"basic","status":"past_due"}], bad: [{"plan":{"p":1}}, "plan"] },
];

describe('super-admin billing — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
