// workflow-core.spec.ts — covers the pure workflow helpers: wait-time estimation, queue ranking, and the money math
// (tip, full cart totals, exact-cent equal split, split validation, USD formatting). The split + totals functions are the
// kind of cent arithmetic that hides off-by-one bugs, so they're worth pinning. esbuild + node, ok() style.
import { estimateWaitMinutes, rankByWait, tipAmountCents, cartTotals, splitEqually, isValidSplit, centsToUsd } from './workflow.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

// ---- estimateWaitMinutes ----
ok('wait estimate divides across techs', estimateWaitMinutes(10, 5, 2) === 25);
ok('wait estimate rounds', estimateWaitMinutes(3, 5, 2) === Math.round((3 / 2) * 5));
ok('with no techs, everyone waits in series', estimateWaitMinutes(4, 5, 0) === 20);

// ---- rankByWait ----
{
  const r = rankByWait([{ queueItemId: 'a', waitedMinutes: 5 }, { queueItemId: 'b', waitedMinutes: 20 }, { queueItemId: 'c', waitedMinutes: 12 }]);
  ok('longest wait ranks first with 1-based positions', r[0].queueItemId === 'b' && r[0].position === 1 && r[1].queueItemId === 'c' && r[2].queueItemId === 'a' && r[2].position === 3);
}

// ---- tipAmountCents ----
ok('tip is a rounded percentage of the taxable base', tipAmountCents(5000, 20) === 1000 && tipAmountCents(9999, 15) === Math.round(9999 * 0.15));

// ---- cartTotals ----
{
  const t = cartTotals([{ priceCents: 3000 }, { priceCents: 2000 }], 500, 10, 20);
  ok('cart totals: subtotal − discount = taxable, tax + tip on taxable', t.subtotalCents === 5000 && t.taxableCents === 4500 && t.taxCents === 450 && t.tipCents === 900 && t.totalCents === 5850);
}
{
  const t = cartTotals([{ priceCents: 1000 }], 5000, 10, 20); // discount exceeds subtotal
  ok('a discount over the subtotal floors taxable at 0', t.taxableCents === 0 && t.taxCents === 0 && t.tipCents === 0 && t.totalCents === 0);
}

// ---- splitEqually (must always sum exactly to the total) ----
ok('even split divides cleanly', JSON.stringify(splitEqually(10000, 4)) === JSON.stringify([2500, 2500, 2500, 2500]));
ok('uneven split puts the extra cents on the first parts', JSON.stringify(splitEqually(100, 3)) === JSON.stringify([34, 33, 33]));
ok('a tiny uneven split still sums exactly', JSON.stringify(splitEqually(10, 3)) === JSON.stringify([4, 3, 3]));
ok('every split sums back to the total', [splitEqually(9999, 7), splitEqually(100, 3), splitEqually(5, 4)].every((parts, i) => parts.reduce((a, b) => a + b, 0) === [9999, 100, 5][i]));
ok('zero ways yields no parts', splitEqually(100, 0).length === 0);

// ---- isValidSplit ----
ok('a split that sums to the total is valid', isValidSplit([{ amountCents: 3000 }, { amountCents: 2000 }], 5000));
ok('a split off by a cent is invalid', !isValidSplit([{ amountCents: 3000 }, { amountCents: 1999 }], 5000));

// ---- centsToUsd ----
ok('cents format to USD with thousands separators', centsToUsd(5000) === '$50.00' && centsToUsd(123456) === '$1,234.56' && centsToUsd(5) === '$0.05');

console.log(`\nworkflow-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
if (fail) process.exit(1);
