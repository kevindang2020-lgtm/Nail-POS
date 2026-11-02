// BUILD_PLAN Phase 12 (#17): super-admin catalog routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminBookingCheckinController } from './super-admin-booking-checkin/super-admin-booking-checkin.controller';
import { BusinessCategoriesController } from './super-admin-business-categories/business-categories.controller';
import { ServiceTemplatesController } from './super-admin-catalog/service-templates.controller';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/booking-checkin/failed-events/:id/retry", ctl: SuperAdminBookingCheckinController, handler: 'retry', today: [{},{"reason":"processor back","idempotencyKey":"k-1","tenantId":"t-1"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/settings/general/business-categories", ctl: BusinessCategoriesController, handler: 'create', today: [{"name":"Nail Salon","description":"Nails"},{"name":"Spa"}], bad: [{"name":["x"]}, "name"] },
  { route: "POST /super-admin/settings/general/business-categories/reorder", ctl: BusinessCategoriesController, handler: 'reorder', today: [{"orderedIds":["a","b","c"]}], bad: [{"orderedIds":"a,b"}, "orderedIds"] },
  { route: "POST /super-admin/settings/general/business-categories/:id/rename", ctl: BusinessCategoriesController, handler: 'rename', today: [{"name":"Nail Bar"}], bad: [{"name":{"n":1}}, "name"] },
  { route: "POST /super-admin/catalog/categories", ctl: ServiceTemplatesController, handler: 'createCategory', today: [{"name":"Pedicure","iconKey":"foot"},{"name":"Waxing","iconKey":null}], bad: [{"name":5}, "name"] },
  { route: "POST /super-admin/catalog/service-templates", ctl: ServiceTemplatesController, handler: 'create', today: [{"name":"Gel Manicure","categoryCode":"manicure","description":null,"durationMinutes":45,"priceMinCents":3500,"priceMaxCents":4500,"taxSetting":"taxable","commissionEligible":true,"isCustomizable":true,"resources":[{"label":"Station","quantity":1}],"addons":[{"name":"French tip","priceCents":500}]}], bad: [{"name":"x","durationMinutes":"45"}, "durationMinutes"] },
  { route: "POST /super-admin/catalog/service-templates/:id/retire", ctl: ServiceTemplatesController, handler: 'retire', today: [{"reason":"discontinued"}], bad: [{"reason":["x"]}, "reason"] },
  { route: "POST /super-admin/catalog/service-templates/:id/deploy", ctl: ServiceTemplatesController, handler: 'deploy', today: [{"tenantIds":["t-1","t-2"],"allowOverwrite":false,"customizable":true},{"allowOverwrite":true}], bad: [{"tenantIds":"t-1"}, "tenantIds"] },
  { route: "PATCH /super-admin/catalog/categories/:code", ctl: ServiceTemplatesController, handler: 'updateCategory', today: [{"name":"Pedi"},{"status":"inactive"},{"displayOrder":3}], bad: [{"displayOrder":"3"}, "displayOrder"] },
  { route: "PATCH /super-admin/catalog/service-templates/:id", ctl: ServiceTemplatesController, handler: 'update', today: [{"durationMinutes":50,"changeNote":"Suggested duration adjusted"},{"name":"Gel Mani","categoryCode":"manicure","description":"x","durationMinutes":45,"priceMinCents":3500,"priceMaxCents":4500,"taxSetting":"taxable","commissionEligible":true,"isCustomizable":false,"resources":[],"addons":[],"changeNote":"price"}], bad: [{"resources":[{"label":{"l":1}}]}, "resources[0].label"] },
  { route: "PATCH /super-admin/catalog/deployments/:deploymentId/customizable", ctl: ServiceTemplatesController, handler: 'setCustomizable', today: [{"customizable":true}], bad: [{"customizable":{"c":1}}, "customizable"] },
];

describe('super-admin catalog — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
