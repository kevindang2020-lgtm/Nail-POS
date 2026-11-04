// inventory-core.spec.ts — Nest-free assertions for stock math: bottle counts, status thresholds,
// reorder suggestion, lifecycle guards (no double-empty / double-open), movement integrity, summary.
import {
  countsFromUnits, stockStatus, reorderSuggestion, canTransitionBottle, applyMovement, validateTechReport, summarize,
  poReceivingStatus, receivableQty, poTotals, canReceivePO, canTransitionPO,
  isMovableUnit, movableCount, clampMove,
  clampCount, countVariance, countLineState, summarizeCount, recipeCostCents,
  type BottleStatus,
} from './inventory-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const U = (s: BottleStatus) => ({ status: s });

// ---- counts from bottles ----
const counts = countsFromUnits([U('unopened'), U('unopened'), U('unopened'), U('opened'), U('opened'), U('low'), U('empty'), U('damaged')]);
ok('onHand = unopened+opened+low', counts.onHand === 6);
ok('open = opened+low', counts.open === 3);
ok('unopened counted', counts.unopened === 3);
ok('empty/damaged excluded from onHand', counts.empty === 1 && counts.damaged === 1);
ok('available = onHand - reserved', countsFromUnits([U('unopened'), U('opened')], 1).available === 1);

// ---- stock status ----
ok('out when zero', stockStatus(0, 3) === 'out_of_stock');
ok('critical at/below half reorder', stockStatus(1, 4) === 'critical');
ok('low at/below reorder', stockStatus(3, 3) === 'low');
ok('in_stock above reorder', stockStatus(10, 3) === 'in_stock');
ok('overstock above max', stockStatus(50, 3, 40) === 'overstock');
// explicit critical_level (§16 multi-level thresholds)
ok('explicit critical at/below critical_level', stockStatus(2, 10, null, 2) === 'critical');
ok('explicit critical: just above is low', stockStatus(3, 10, null, 2) === 'low');
ok('explicit critical overrides derived half', stockStatus(4, 10, null, 2) === 'low' && stockStatus(4, 10) === 'critical');
ok('null critical_level falls back to derived', stockStatus(5, 10, null, null) === 'critical');

// ---- reorder suggestion ----
ok('suggest when low', reorderSuggestion(2, 3, 6) === 6);
ok('no suggestion when healthy', reorderSuggestion(10, 3, 6) === 0);
ok('on-order bottles are subtracted', reorderSuggestion(2, 3, 6, 4) === 2);
ok('fully covered by an order → 0', reorderSuggestion(2, 3, 6, 9) === 0);
ok('suggestion at least the gap', reorderSuggestion(1, 10, 2) === 9);

// ---- bottle lifecycle guards ----
ok('unopened→opened allowed', canTransitionBottle('unopened', 'opened'));
ok('opened→empty allowed', canTransitionBottle('opened', 'empty'));
ok('no double-empty (empty→empty rejected)', !canTransitionBottle('empty', 'empty'));
ok('no double-open (opened→opened rejected)', !canTransitionBottle('opened', 'opened'));
ok('cannot empty an unopened directly', !canTransitionBottle('unopened', 'empty'));
ok('disposed is terminal', !canTransitionBottle('disposed', 'opened'));

// ---- movement integrity ----
ok('after = before + change', applyMovement(10, -3).after === 7);
ok('negative rejected by default', applyMovement(2, -5).ok === false);
ok('negative allowed when permitted', applyMovement(2, -5, true).ok === true);

// ---- technician report validation ----
ok('cannot report empty on empty bottle', validateTechReport('bottle_empty', 'empty') !== null);
ok('cannot open an already-open bottle', validateTechReport('open_new', 'opened') !== null);
ok('valid empty report on opened bottle', validateTechReport('bottle_empty', 'opened') === null);
ok('product-level report ok (no bottle)', validateTechReport('need_reorder', null) === null);

// ---- summary ----
const sm = summarize([
  { onHand: 6, unopened: 3, open: 3, empty: 1, reorderLevel: 3, valueCents: 6000 },
  { onHand: 2, unopened: 0, open: 2, empty: 0, reorderLevel: 3, valueCents: 1500, expiringSoon: true },
  { onHand: 0, unopened: 0, open: 0, empty: 0, reorderLevel: 2, valueCents: 0 },
]);
ok('summary totals', sm.totalProducts === 3 && sm.totalBottles === 8 && sm.openBottles === 5);
ok('summary low+out', sm.lowStock === 1 && sm.outOfStock === 1 && sm.expiringSoon === 1);
ok('summary value', sm.valueCents === 7500);

// ---- purchase orders ----
ok('PO none when nothing received', poReceivingStatus([{ quantityOrdered: 12, quantityReceived: 0 }, { quantityOrdered: 6, quantityReceived: 0 }]) === 'none');
ok('PO partial when some received', poReceivingStatus([{ quantityOrdered: 12, quantityReceived: 12 }, { quantityOrdered: 6, quantityReceived: 0 }]) === 'partial');
ok('PO received when all received', poReceivingStatus([{ quantityOrdered: 12, quantityReceived: 12 }, { quantityOrdered: 6, quantityReceived: 6 }]) === 'received');
ok('PO empty lines = none', poReceivingStatus([]) === 'none');
ok('receivable clamps to remaining', receivableQty(12, 4, 100) === 8);
ok('receivable never negative', receivableQty(5, 5, 3) === 0);
ok('receivable floors fractional incoming', receivableQty(10, 0, 3.9) === 3);
ok('PO totals = qty*cost + shipping + tax', poTotals([{ quantityOrdered: 12, unitCostCents: 450 }, { quantityOrdered: 6, unitCostCents: 1200 }], 500, 0).totalCents === (12 * 450 + 6 * 1200 + 500));
ok('PO subtotal excludes shipping/tax', poTotals([{ quantityOrdered: 2, unitCostCents: 1000 }], 999, 999).subtotalCents === 2000);
ok('can receive approved/ordered/partial', canReceivePO('approved') && canReceivePO('ordered') && canReceivePO('partial'));
ok('cannot receive draft/received/cancelled', !canReceivePO('draft') && !canReceivePO('received') && !canReceivePO('cancelled'));
ok('PO draft→approved allowed', canTransitionPO('draft', 'approved'));
ok('PO cannot skip draft→received', !canTransitionPO('draft', 'received'));
ok('PO received→closed allowed; cancelled terminal', canTransitionPO('received', 'closed') && !canTransitionPO('cancelled', 'approved'));

// ---- branch transfers ----
ok('unopened/opened/low are movable', isMovableUnit('unopened') && isMovableUnit('opened') && isMovableUnit('low'));
ok('empty/damaged/disposed not movable', !isMovableUnit('empty') && !isMovableUnit('damaged') && !isMovableUnit('disposed'));
ok('movableCount excludes dead bottles', movableCount([U('unopened'), U('opened'), U('low'), U('empty'), U('damaged')]) === 3);
ok('clampMove limits to available', clampMove(10, 4) === 4);
ok('clampMove honors request when stock ample', clampMove(3, 9) === 3);
ok('clampMove never negative', clampMove(5, 0) === 0 && clampMove(-2, 5) === 0);
ok('clampMove floors fractional request', clampMove(3.9, 9) === 3);

// ---- physical inventory counts ----
ok('clampCount non-negative integer', clampCount(7.8) === 7 && clampCount(-3) === 0);
ok('countVariance surplus', countVariance(10, 12) === 2);
ok('countVariance shrinkage', countVariance(10, 8) === -2);
ok('countVariance exact', countVariance(10, 10) === 0);
ok('countLineState uncounted', countLineState(10, null) === 'uncounted');
ok('countLineState match/over/short', countLineState(5, 5) === 'match' && countLineState(5, 9) === 'over' && countLineState(5, 2) === 'short');
{
  const s = summarizeCount([
    { expectedQty: 10, countedQty: 10 }, // match
    { expectedQty: 8, countedQty: 12 },  // over +4
    { expectedQty: 6, countedQty: 2 },   // short -4
    { expectedQty: 5, countedQty: null }, // uncounted
  ]);
  ok('summarizeCount counts lines/counted', s.lines === 4 && s.counted === 3);
  ok('summarizeCount match/over/short', s.matched === 1 && s.over === 1 && s.short === 1);
  ok('summarizeCount net variance = 0', s.netVariance === 0);
  ok('summarizeCount abs variance = 8', s.absVariance === 8);
}

// ---- service recipes ----
ok('recipeCostCents sums qty×cost', recipeCostCents([{ quantity: 2, costCents: 150 }, { quantity: 3, costCents: 100 }]) === 600);
ok('recipeCostCents ignores null costs', recipeCostCents([{ quantity: 2, costCents: null }, { quantity: 1, costCents: 250 }]) === 250);
ok('recipeCostCents is exact for fractional qty (audit D9)', recipeCostCents([{ quantity: 2.9, costCents: 100 }]) === 290 && recipeCostCents([{ quantity: 0.25, costCents: 1000 }]) === 250);
ok('recipeCostCents empty = 0', recipeCostCents([]) === 0);

console.log(`inventory-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
