// BUILD_PLAN Phase 12 (#17): super-admin oversight routes — validated bodies, route by route on the real controllers:
// the bodies admin-web sends today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming
// the field, an undeclared tenantId is refused. (Generated from the route review; bodies copied from the client calls.)
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { SuperAdminCustomerDataController } from './super-admin-customer-data/super-admin-customer-data.controller';
import { SuperAdminDatabaseController } from './super-admin-database/database.controller';
import { DisputesController } from './super-admin-disputes/disputes.controller';
import { GiftCardProgramsController } from './super-admin-gift-card-programs/gift-card-programs.controller';
import { GiftCardSettlementController } from './super-admin-gift-card-settlement/gift-card-settlement.controller';
import { HardwarePackagesController } from './super-admin-hardware-packages/super-admin-hardware-packages.module';

/** a route whose body DECLARES tenantId (a Super Admin action aimed at one salon): the harness's "undeclared tenantId is
 *  refused" probe does not apply — instead a non-string tenantId must be refused. */
const declaresTenant = (c: RouteBodyCase) => !!(bodyPipeOf(c.ctl, c.handler) as any)?.schema?.properties?.tenantId;
const CASES: RouteBodyCase[] = [
  { route: "POST /super-admin/customer-data-oversight/sync/merge", ctl: SuperAdminCustomerDataController, handler: 'syncMerge', today: [{"sourceGlobalCustomerId":"g-1","targetGlobalCustomerId":"g-2","confirm":true},{"sourceGlobalCustomerId":"g-1","targetGlobalCustomerId":"g-2","confirm":false}], bad: [{"sourceGlobalCustomerId":{"$ne":null},"targetGlobalCustomerId":"g"}, "sourceGlobalCustomerId"] },
  { route: "POST /super-admin/customer-data-oversight/sync/conflicts/:id/status", ctl: SuperAdminCustomerDataController, handler: 'syncResolveConflict', today: [{"status":"RESOLVED"}], bad: [{"status":["RESOLVED"]}, "status"] },
  { route: "POST /super-admin/customer-data-oversight/sync/run", ctl: SuperAdminCustomerDataController, handler: 'syncRun', today: [{},{"tenantId":"t-1"},{"tenantId":"t-1","customerId":"c-1"}], bad: [{"customerId":{"c":1}}, "customerId"] },
  { route: "POST /super-admin/customer-data-oversight/legal-holds", ctl: SuperAdminCustomerDataController, handler: 'applyHold', today: [{"tenantId":"t-1","customerId":null,"branchId":null,"matterRef":"M-12","reason":"litigation","scope":"tenant","reviewAt":"2027-01-01","internalNotes":null}], bad: [{"tenantId":"t-1","matterRef":["M"]}, "matterRef"] },
  { route: "POST /super-admin/customer-data-oversight/legal-holds/:id/release", ctl: SuperAdminCustomerDataController, handler: 'releaseHold', today: [{"reason":"closed"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/customer-data-oversight/imports", ctl: SuperAdminCustomerDataController, handler: 'createImport', today: [{"tenantId":"t-1","branchId":null,"source":"csv","filename":"clients.csv","rows":[{"firstName":"Mai","phone":"6095551234"}]}], bad: [{"tenantId":"t-1","rows":"a,b"}, "rows"] },
  { route: "POST /super-admin/customer-data-oversight/imports/:id/reject", ctl: SuperAdminCustomerDataController, handler: 'rejectImport', today: [{"reason":"bad file"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/customer-data-oversight/imports/process", ctl: SuperAdminCustomerDataController, handler: 'processImports', today: [{"batch":5},{}], bad: [{"batch":{"b":1}}, "batch"] },
  { route: "POST /super-admin/customer-data-oversight/deletions", ctl: SuperAdminCustomerDataController, handler: 'requestDeletion', today: [{"tenantId":"t-1","customerId":"c-1","reason":"GDPR request"}], bad: [{"tenantId":"t-1","customerId":{"c":1}}, "customerId"] },
  { route: "POST /super-admin/customer-data-oversight/deletions/:id/reject", ctl: SuperAdminCustomerDataController, handler: 'rejectDeletion', today: [{"reason":"legal hold"}], bad: [{"reason":{"x":1}}, "reason"] },
  { route: "POST /super-admin/customer-data-oversight/deletions/:id/execute", ctl: SuperAdminCustomerDataController, handler: 'executeDeletion', today: [{"typedConfirmation":"DELETE"}], bad: [{"typedConfirmation":["DELETE"]}, "typedConfirmation"] },
  { route: "POST /super-admin/database/backends/:pid/cancel", ctl: SuperAdminDatabaseController, handler: 'cancel', today: [{"reason":"runaway query"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "POST /super-admin/database/tables/:table/vacuum-analyze", ctl: SuperAdminDatabaseController, handler: 'vacuum', today: [{"reason":"bloat"}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/database/deferred-constraints/:id/retry", ctl: SuperAdminDatabaseController, handler: 'retry', today: [{"reason":"fixed data"}], bad: [{"reason":5}, "reason"] },
  { route: "POST /super-admin/disputes/exports", ctl: DisputesController, handler: 'exportCsv', today: [{"search":"visa","currentStatus":"open","riskLevel":"high","page":"1","pageSize":"50","sort":"deadline","direction":"asc"},{"tenantId":"t-1","columns":["id","amount"]},{"columns":"id,amount"}], bad: [{"search":{"$regex":"x"}}, "search"] },
  { route: "POST /super-admin/disputes/merchant-risk/:tenantId/flag", ctl: DisputesController, handler: 'flagRisk', today: [{"riskLevel":"high","riskReason":"ratio 2%","recommendedAction":"reserve","nextReviewAt":"2026-11-01"}], bad: [{"riskLevel":"high","riskReason":{"r":1}}, "riskReason"] },
  { route: "POST /super-admin/disputes/:id/evidence/request", ctl: DisputesController, handler: 'requestEvidence', today: [{"note":"need receipt"},{}], bad: [{"note":["x"]}, "note"] },
  { route: "POST /super-admin/disputes/:id/evidence", ctl: DisputesController, handler: 'uploadEvidence', today: [{"evidenceType":"receipt","fileName":"r.pdf","mimeType":"application/pdf","sizeBytes":1200,"contentBase64":"JVBERi0=","description":"signed receipt","source":"tenant"}], bad: [{"evidenceType":"receipt","sizeBytes":"big"}, "sizeBytes"] },
  { route: "POST /super-admin/disputes/:id/evidence/:evidenceId/review", ctl: DisputesController, handler: 'reviewEvidence', today: [{"decision":"accept"},{"decision":"reject","reason":"blurry"}], bad: [{"decision":{"d":1}}, "decision"] },
  { route: "POST /super-admin/disputes/:id/submit", ctl: DisputesController, handler: 'submit', today: [{"idempotencyKey":"k-1"}], bad: [{"idempotencyKey":["k"]}, "idempotencyKey"] },
  { route: "POST /super-admin/disputes/:id/notify-tenant", ctl: DisputesController, handler: 'notifyTenant', today: [{"channel":"email","recipient":"owner@x.co","subject":"Chargeback","body":"Please upload","idempotencyKey":"k-2"}], bad: [{"channel":{"c":1}}, "channel"] },
  { route: "POST /super-admin/disputes/:id/outcome", ctl: DisputesController, handler: 'outcome', today: [{"result":"won","fundsRecoveredCents":4500,"amountWonCents":4500,"processorFeeCents":1500,"decisionReason":"evidence accepted"},{"result":"lost","amountLostCents":4500,"overrideReason":"manual"}], bad: [{"result":"won","fundsRecoveredCents":45.5}, "fundsRecoveredCents"] },
  { route: "POST /super-admin/gift-cards/programs", ctl: GiftCardProgramsController, handler: 'create', today: [{"name":"Metro shared","ownerTenantId":"t-1","scope":"shared","sharedLiability":true}], bad: [{"name":"x","ownerTenantId":{"t":1}}, "ownerTenantId"] },
  { route: "POST /super-admin/gift-cards/programs/:id/members", ctl: GiftCardProgramsController, handler: 'addMember', today: [{"tenantId":"t-2"}], bad: [{"tenantId":["t"]}, "tenantId"] },
  { route: "PATCH /super-admin/gift-cards/programs/:id", ctl: GiftCardProgramsController, handler: 'update', today: [{"name":"Metro"},{"status":"paused","sharedLiability":false}], bad: [{"scope":{"s":1}}, "scope"] },
  { route: "PATCH /super-admin/gift-cards/programs/:id/members/:tenantId", ctl: GiftCardProgramsController, handler: 'setMemberStatus', today: [{"status":"suspended"}], bad: [{"status":[1]}, "status"] },
  { route: "POST /super-admin/gift-cards/settlement/batches", ctl: GiftCardSettlementController, handler: 'create', today: [{},{"programId":"p-1","entryIds":["e-1","e-2"]}], bad: [{"programId":"p-1","totalCents":100}, "totalCents"] },
  { route: "PATCH /super-admin/gift-cards/settlement/batches/:id", ctl: GiftCardSettlementController, handler: 'setStatus', today: [{"status":"approved"}], bad: [{"status":{"s":1}}, "status"] },
  { route: "POST /super-admin/hardware-packages", ctl: HardwarePackagesController, handler: 'create', today: [{"tenantId":"t-1","packageType":"pro","packageName":"Pro Package","paymentStatus":"pending","financingTerms":"","shippingAddress":"1 Main","shippingCity":"Merchantville","shippingState":"NJ","shippingZip":"08109","shippingCarrier":"fedex","trackingNumber":"","notes":"","confirmDuplicate":false,"hardwareCostCents":149900,"depositCents":null}], bad: [{"tenantId":"t-1","hardwareCostCents":{"c":1}}, "hardwareCostCents"] },
  { route: "POST /super-admin/hardware-packages/:packageId/devices", ctl: HardwarePackagesController, handler: 'devices', today: [{"devices":[{"deviceType":"device","deviceName":"Card reader","serialNumber":null,"quantity":1}]}], bad: ["reader", "(body)"] },
  { route: "POST /super-admin/hardware-packages/:packageId/notes", ctl: HardwarePackagesController, handler: 'note', today: [{"note":"shipped early"}], bad: [{"note":{"n":1}}, "note"] },
  { route: "POST /super-admin/hardware-packages/:packageId/cancel", ctl: HardwarePackagesController, handler: 'cancel', today: [{"reason":"tenant cancelled"},{}], bad: [{"reason":[1]}, "reason"] },
  { route: "POST /super-admin/hardware-packages/:packageId/return", ctl: HardwarePackagesController, handler: 'ret', today: [{"reason":"defective"}], bad: [{"reason":{"r":1}}, "reason"] },
  { route: "PATCH /super-admin/hardware-packages/:packageId", ctl: HardwarePackagesController, handler: 'update', today: [{"packageName":"Pro","packageType":"pro","financingTerms":"12 mo","shippingAddress":"1 Main","shippingCity":"Merchantville","shippingState":"NJ","shippingZip":"08109","hardwareCostCents":149900,"depositCents":null,"amountPaidCents":50000}], bad: [{"packageName":"P","amountPaidCents":{"a":1}}, "amountPaidCents"] },
  { route: "PATCH /super-admin/hardware-packages/:packageId/status", ctl: HardwarePackagesController, handler: 'status', today: [{"status":"shipped","force":false}], bad: [{"status":{"s":1}}, "status"] },
  { route: "PATCH /super-admin/hardware-packages/:packageId/payment-status", ctl: HardwarePackagesController, handler: 'payment', today: [{"paymentStatus":"paid"}], bad: [{"paymentStatus":[1]}, "paymentStatus"] },
  { route: "PATCH /super-admin/hardware-packages/:packageId/tracking", ctl: HardwarePackagesController, handler: 'tracking', today: [{"carrier":"fedex","trackingNumber":"1Z","trackingUrl":"","shippedDate":"2026-10-01","deliveredDate":""}], bad: [{"carrier":"fedex","trackingNumber":{"t":1}}, "trackingNumber"] },
];

describe('super-admin oversight — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => {
    const tenantTarget = declaresTenant(c);
    const failures = routeBodyFailures(c, bodyPipeOf as any).filter((f) => !(tenantTarget && f.endsWith('an undeclared tenantId was accepted')));
    if (tenantTarget) {
      try { bodyPipeOf(c.ctl, c.handler)!.transform({ ...c.today[0], tenantId: { $ne: null } }); failures.push(`${c.route}: a non-string tenantId was accepted`); } catch (e: any) { if (e?.getStatus?.() !== 400) failures.push(`${c.route}: a non-string tenantId did not answer 400`); }
    }
    expect(failures).toEqual([]);
  });
});
