// BUILD_PLAN Phase 12 (#17): super-admin ai routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { AiAdminController } from './super-admin-ai/ai-admin.controller';
import { AiPlansAdminController } from './super-admin-ai/ai-plans-admin.controller';
import { AiInsightsController } from './super-admin-ai-insights/super-admin-ai-insights.module';
import { NarrativeModelVersionController, NarrativeCommitController } from './super-admin-ai-reports/narrative-provenance.controller';
import { ReportDeliveryController } from './super-admin-ai-reports/report-delivery.controller';
import { ReportRunController } from './super-admin-ai-reports/report-run.controller';
import { ReportScheduleController } from './super-admin-ai-reports/report-schedule.controller';
import { ReportTemplateController } from './super-admin-ai-reports/report-template.controller';
import { SuperAdminAiSchedulingOptimizerController } from './super-admin-ai-scheduling-optimizer/super-admin-ai-scheduling-optimizer.controller';
import { AiUsageConfigController } from './super-admin-ai-usage/super-admin-ai-usage.module';
import { TenantAiController } from './tenant-ai/tenant-ai.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/ai/tenants/:tenantId/subscriptions", ctl: AiAdminController, handler: 'assign', today: [{"packageCode":"ai_booking_assistant","trial":false,"overageEnabled":false},{"packageCode":"ai_booking_assistant","trial":true,"overageEnabled":true,"usageLimit":500}], bad: [{"packageCode":"x","usageLimit":"lots"}, "usageLimit"] },
  { route: "PATCH /super-admin/ai/tenants/:tenantId/subscriptions/:code", ctl: AiAdminController, handler: 'update', today: [{"usageLimit":250},{"status":"paused"}], bad: [{"usageLimit":{"n":1}}, "usageLimit"] },
  { route: "POST /super-admin/ai-plans/:code/assign", ctl: AiPlansAdminController, handler: 'assign', today: [{"tenantId":"t-1","trial":false,"billingPeriod":"monthly"},{"tenantId":"t-1","trial":true,"billingPeriod":"yearly"}], bad: [{"tenantId":["t"]}, "tenantId"] },
  { route: "POST /super-admin/ai-plans/:code/convert", ctl: AiPlansAdminController, handler: 'convert', today: [{"tenantId":"t-1","billingPeriod":"yearly"},{"tenantId":"t-1"}], bad: [{"tenantId":{}}, "tenantId"] },
  { route: "PATCH /super-admin/ai-plans/:code", ctl: AiPlansAdminController, handler: 'update', today: [{"priceCentsOverride":4900,"discountType":"percent","discountValue":10,"active":true,"annualMonths":10},{"priceCentsOverride":null,"discountType":null,"discountValue":0}], bad: [{"discountValue":{"x":1}}, "discountValue"] },
  { route: "PATCH /super-admin/ai-plans/:code/unassign", ctl: AiPlansAdminController, handler: 'unassign', today: [{"tenantId":"t-1"}], bad: [{"tenantId":[1]}, "tenantId"] },
  { route: "POST /super-admin/ai-insights/bulk-review", ctl: AiInsightsController, handler: 'bulkReview', today: [{"ids":["i-1","i-2"]}], bad: [{"ids":"i-1"}, "ids"] },
  { route: "POST /super-admin/ai-insights/bulk-assign", ctl: AiInsightsController, handler: 'bulkAssign', today: [{"ids":["i-1"]}], bad: [{"ids":[{"id":1}]}, "ids[0]"] },
  { route: "POST /super-admin/ai-insights/:id/dismiss", ctl: AiInsightsController, handler: 'dismiss', today: [{"reason":"not relevant"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/ai-insights/:id/feedback", ctl: AiInsightsController, handler: 'feedback', today: [{"verdict":"helpful","comment":"nice"},{"verdict":"incorrect"}], bad: [{"verdict":true}, "verdict"] },
  { route: "POST /super-admin/ai-narrative-model-versions", ctl: NarrativeModelVersionController, handler: 'register', today: [{"modelName":"claude","promptVersion":"v3","promptText":"Summarise…","notes":"tuned"}], bad: [{"modelName":["x"]}, "modelName"] },
  { route: "POST /super-admin/ai-reports/runs/:runId/narrative/commit", ctl: NarrativeCommitController, handler: 'commit', today: [{"modelName":"default"},{}], bad: [{"modelName":5}, "modelName"] },
  { route: "POST /super-admin/ai-reports/runs/:runId/deliver", ctl: ReportDeliveryController, handler: 'deliver', today: [{"recipients":[{"id":"u-1","type":"user","tenantId":"t-1"},{"id":"ops@x.co","external":true}],"allowExternal":true,"channel":"email"}], bad: [{"recipients":"u-1"}, "recipients"] },
  { route: "POST /super-admin/ai-reports/generate", ctl: ReportRunController, handler: 'generate', today: [{"reportKey":"weekly_revenue","scopeType":"tenant","tenantId":"t-1","start":"2026-10-01","end":"2026-10-07","source":"manual"}], bad: [{"reportKey":{"k":1}}, "reportKey"] },
  { route: "POST /super-admin/ai-report-schedules", ctl: ReportScheduleController, handler: 'create', today: [{"name":"Weekly","reportKey":"weekly_revenue","frequency":"weekly","runAtTime":"08:00","timezone":"America/New_York","scopeType":"platform","owner":"ops"}], bad: [{"name":"x","frequency":7}, "frequency"] },
  { route: "POST /super-admin/ai-report-templates", ctl: ReportTemplateController, handler: 'create', today: [{"reportKey":"weekly_revenue","name":"Weekly v2","sections":[{"id":"s1","title":"Revenue","metricKeys":["revenue_cents"],"text":"…"}]}], bad: [{"reportKey":"r","sections":[{"id":"s1","metricKeys":"x"}]}, "sections[0].metricKeys"] },
  { route: "POST /super-admin/ai-scheduling-optimizer/tenants/:tenantId/recommendations/:id/retry", ctl: SuperAdminAiSchedulingOptimizerController, handler: 'retry', today: [{"reason":"transient"}], bad: [{"reason":["x"]}, "reason"] },
  { route: "POST /super-admin/ai-scheduling-optimizer/tenants/:tenantId/recommendations/:id/rollback", ctl: SuperAdminAiSchedulingOptimizerController, handler: 'rollback', today: [{"reason":"bad plan"}], bad: [{"reason":{"x":1}}, "reason"] },
  { route: "POST /super-admin/ai-scheduling-optimizer/tenants/:tenantId/disable", ctl: SuperAdminAiSchedulingOptimizerController, handler: 'disable', today: [{"reason":"tenant asked"}], bad: [{"reason":7}, "reason"] },
  { route: "PUT /super-admin/ai-scheduling-optimizer/platform-switch", ctl: SuperAdminAiSchedulingOptimizerController, handler: 'platformSwitch', today: [{"killed":true,"reason":"incident"}], bad: [{"killed":{"x":1},"reason":"r"}, "killed"] },
  { route: "POST /super-admin/ai-usage/providers", ctl: AiUsageConfigController, handler: 'saveProvider', today: [{"providerKey":"anthropic","displayName":"Anthropic","apiKey":"placeholder-not-a-key","defaultModel":"claude","status":"active"},{"providerKey":"openai","displayName":"OpenAI"}], bad: [{"providerKey":["x"],"displayName":"d"}, "providerKey"] },
  { route: "POST /super-admin/ai-usage/providers/status", ctl: AiUsageConfigController, handler: 'setStatus', today: [{"providerKey":"anthropic","status":"disabled"}], bad: [{"providerKey":"a","status":{}}, "status"] },
  { route: "POST /super-admin/ai-usage/prompts", ctl: AiUsageConfigController, handler: 'savePrompt', today: [{"promptKey":"summary","name":"Summary","body":"You are…","status":"active"}], bad: [{"promptKey":"p","body":["x"]}, "body"] },
  { route: "POST /tenant/ai/subscriptions", ctl: TenantAiController, handler: 'subscribe', today: [{"packageCode":"ai_booking_assistant"}], bad: [{"packageCode":{"x":1}}, "packageCode"] },
];

describe('super-admin ai — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
