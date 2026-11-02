// BUILD_PLAN Phase 12 (#17): super-admin ops routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminProductCatalogController } from './super-admin-product-catalog/super-admin-product-catalog.controller';
import { PromotionManagementController } from './super-admin-promotions/promotion-management.controller';
import { SuperAdminQueueController } from './super-admin-queue/super-admin-queue.controller';
import { SuperAdminReportBuilderController } from './super-admin-report-builder/super-admin-report-builder.controller';
import { SuperAdminScheduledReportsController } from './super-admin-scheduled-reports/super-admin-scheduled-reports.controller';
import { SuperAdminSettingsController } from './super-admin-settings/super-admin-settings.controller';
import { SuperAdminSettlementsController } from './super-admin-settlements/super-admin-settlements.controller';
import { TenantPresetsController } from './super-admin-tenant-presets/tenant-presets.controller';
import { TicketRemovalController } from './super-admin-ticket-removal/ticket-removal.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/product-catalog/imports", ctl: SuperAdminProductCatalogController, handler: 'createImport', today: [{"source":"csv","filename":"products.csv","rows":[{"name":"Gel polish","sku":"GP-1"}],"idempotencyKey":"k-1"}], bad: [{"source":"csv","rows":{"name":"x"}}, "rows"] },
  { route: "POST /super-admin/product-catalog/distributions", ctl: SuperAdminProductCatalogController, handler: 'distribute', today: [{"masterProductId":"mp-1","tenantIds":["t-1","t-2"],"reason":"rollout","skipExisting":true}], bad: [{"masterProductId":"mp","tenantIds":"t-1"}, "tenantIds"] },
  { route: "POST /super-admin/product-catalog/products/:id/barcodes", ctl: SuperAdminProductCatalogController, handler: 'addBarcode', today: [{"barcode":"012345678905","reason":"new pack","isPrimary":true,"source":"manual"}], bad: [{"barcode":{"b":1}}, "barcode"] },
  { route: "POST /super-admin/product-catalog/products", ctl: SuperAdminProductCatalogController, handler: 'createMaster', today: [{"name":"Gel polish","code":"GP","brandName":"OPI","sku":"GP-1","upc":"012345678905","categoryName":"Polish","productType":"retail","costCents":450,"suggestedRetailCents":1200,"currency":"USD","confirmDuplicates":false},{"name":"Top coat","costCents":"4.50","confirmDuplicates":"true"}], bad: [{"name":"x","costCents":{"c":1}}, "costCents"] },
  { route: "POST /super-admin/product-catalog/products/:id/retire", ctl: SuperAdminProductCatalogController, handler: 'retireMaster', today: [{"reason":"discontinued"}], bad: [{"reason":["x"]}, "reason"] },
  { route: "POST /super-admin/promotions/:id/reject", ctl: PromotionManagementController, handler: 'reject', today: [{"reason":"misleading"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/promotions/:id/disable", ctl: PromotionManagementController, handler: 'disable', today: [{"reason":"complaints"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/promotions/:id/transition", ctl: PromotionManagementController, handler: 'transition', today: [{"status":"paused"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "POST /super-admin/queue/incidents", ctl: SuperAdminQueueController, handler: 'openIncident', today: [{"tenantId":"t-1","branchId":"b-1","queueIds":["q-1"],"category":"stuck","severity":"high","description":"queue frozen","idempotencyKey":"k-1"}], bad: [{"tenantId":"t-1","queueIds":"q-1"}, "queueIds"] },
  { route: "POST /super-admin/queue/notify-branch", ctl: SuperAdminQueueController, handler: 'notifyBranch', today: [{"tenantId":"t-1","branchId":"b-1","severity":"info","message":"sync restored"}], bad: [{"tenantId":"t-1","message":{"m":1}}, "message"] },
  { route: "POST /super-admin/queue/support-session", ctl: SuperAdminQueueController, handler: 'supportSession', today: [{"tenantId":"t-1","branchId":"b-1","reason":"stuck ticket","ticketId":"tk-1"}], bad: [{"tenantId":"t-1","ticketId":{"t":1}}, "ticketId"] },
  { route: "POST /super-admin/report-builder/run", ctl: SuperAdminReportBuilderController, handler: 'run', today: [{"dimension":"tenant","measure":"revenue","visualization":"bar","range":"30d","tenantId":null,"limit":20}], bad: [{"dimension":"tenant","limit":{"l":1}}, "limit"] },
  { route: "POST /super-admin/report-builder/definitions", ctl: SuperAdminReportBuilderController, handler: 'create', today: [{"name":"Top salons","dimension":"tenant","measure":"revenue","visualization":"bar","range":"90d","limit":10}], bad: [{"name":["x"]}, "name"] },
  { route: "PATCH /super-admin/report-builder/definitions/:id", ctl: SuperAdminReportBuilderController, handler: 'update', today: [{"name":"Top salons v2"},{"range":"12m","visualization":"line"}], bad: [{"range":{"r":1}}, "range"] },
  { route: "POST /super-admin/scheduled-reports", ctl: SuperAdminScheduledReportsController, handler: 'create', today: [{"name":"Weekly revenue","source":"builder","reportDefinitionId":"rd-1","format":"csv","range":"7d","tenantId":null,"frequency":"weekly","recipients":["ops@x.co"]}], bad: [{"name":"x","recipients":"ops@x.co"}, "recipients"] },
  { route: "PATCH /super-admin/scheduled-reports/:id", ctl: SuperAdminScheduledReportsController, handler: 'update', today: [{"enabled":false},{"frequency":"daily","recipients":["a@x.co","b@x.co"]}], bad: [{"enabled":{"e":1}}, "enabled"] },
  { route: "POST /super-admin/settings/general/save", ctl: SuperAdminSettingsController, handler: 'save', today: [{"changes":[{"key":"platform.name","value":"AIPowerSalon","expectedVersion":3,"reason":"rename"},{"key":"booking.windowDays","value":60}]}], bad: [{"changes":[{"key":{"k":1},"value":1}]}, "changes[0].key"] },
  { route: "POST /super-admin/settings/general/reset", ctl: SuperAdminSettingsController, handler: 'reset', today: [{"confirm":"RESET"}], bad: [{"confirm":{"c":1}}, "confirm"] },
  { route: "POST /super-admin/settings/general/operations", ctl: SuperAdminSettingsController, handler: 'operations', today: [{"op":"clear_cache"}], bad: [{"op":["x"]}, "op"] },
  { route: "POST /super-admin/settlements/:id/notes", ctl: SuperAdminSettlementsController, handler: 'addNote', today: [{"category":"general","body":"called processor","supportCaseId":null},{"body":"x"}], bad: [{"body":{"b":1}}, "body"] },
  { route: "POST /super-admin/settlements/:id/match-deposit", ctl: SuperAdminSettlementsController, handler: 'matchDeposit', today: [{"actualCents":125000,"actualDate":"2026-10-07","depositRef":"DEP-1"}], bad: [{"actualCents":125000,"status":"matched"}, "status"] },
  { route: "POST /super-admin/settlements/:id/resolve", ctl: SuperAdminSettlementsController, handler: 'resolve', today: [{"resolutionCategory":"processor_fee","reason":"fee adjustment"}], bad: [{"resolutionCategory":{"c":1},"reason":"r"}, "resolutionCategory"] },
  { route: "POST /super-admin/settlements/:id/processor-case", ctl: SuperAdminSettlementsController, handler: 'processorCase', today: [{"category":"missing_deposit","severity":"high","description":"no deposit"},{}], bad: [{"severity":["x"]}, "severity"] },
  { route: "POST /super-admin/settings/general/tenant-presets", ctl: TenantPresetsController, handler: 'create', today: [{"name":"Nail salon default","scope":"tenant","description":"x","settings":{"booking":{"windowDays":30}},"makeDefault":true}], bad: [{"name":"x","scope":{"s":1}}, "scope"] },
  { route: "POST /super-admin/settings/general/tenant-presets/:id/update", ctl: TenantPresetsController, handler: 'update', today: [{"name":"Default v2","settings":{"a":1},"active":true}], bad: [{"name":{"n":1}}, "name"] },
  { route: "POST /super-admin/tickets/:ticketId/remove", ctl: TicketRemovalController, handler: 'remove', today: [{"code":"123456","reason":"test ticket"}], bad: [{"code":{"c":1},"reason":"r"}, "code"] },
];

describe('super-admin ops — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
