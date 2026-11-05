// checkout-giftcard-charge-core.spec.ts — Nest-free harness (esbuild + node) for the gift-card charge in computeTotals.
// Proves: (1) with no charge (default) the math is byte-identical to before; (2) a gift-card charge is added to the total
// but NEVER taxed and NEVER surcharged; (3) totalsForMethod forwards it; (4) it's clamped non-negative.
import { computeTotals } from './checkout-display.dto';
import { totalsForMethod } from './checkout.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const settings = (over: any = {}) => ({ taxRatePercent: 8, creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3, ...over }) as any;

(async () => {
  // (1) regression — no charge argument == the old formula exactly
  {
    const t = computeTotals(10000, 2000, settings(), 'card'); // sub 100, tip 20
    const expTax = 800;                                        // 8% of 100
    const expSur = Math.round((10000 + 2000 + expTax) * 0.03); // 3% of (sub+tip+tax) = 384
    ok('no-charge tax = 8% of subtotal', t.taxCents === expTax);
    ok('no-charge surcharge = 3% of (sub+tip+tax)', t.surchargeCents === expSur);
    ok('no-charge total = sub+tip+tax+surcharge', t.totalDueCents === 10000 + 2000 + expTax + expSur);
    ok('no-charge giftCardChargeCents defaults to 0', t.giftCardChargeCents === 0);
  }

  // (2) with a $50 gift-card charge on a card ticket: tax + surcharge UNCHANGED, total = base + 50
  {
    const base = computeTotals(10000, 2000, settings(), 'card');
    const gc = computeTotals(10000, 2000, settings(), 'card', 5000);
    ok('gift card is NOT taxed (tax unchanged)', gc.taxCents === base.taxCents);
    ok('gift card is NOT surcharged (surcharge unchanged)', gc.surchargeCents === base.surchargeCents);
    ok('charge is recorded on the totals', gc.giftCardChargeCents === 5000);
    ok('total = base total + charge', gc.totalDueCents === base.totalDueCents + 5000);
  }

  // (3) cash ticket (no surcharge) still adds the charge untaxed
  {
    const t = computeTotals(5500, 0, settings(), 'cash', 5000); // sub 55 → tax 440, +50 gc
    ok('cash has no surcharge', t.surchargeCents === 0);
    ok('cash total = sub + tax + charge', t.totalDueCents === 5500 + 440 + 5000);
    const fwd = totalsForMethod(5500, 0, settings(), 'cash', 5000);
    ok('totalsForMethod forwards the charge', fwd.totalDueCents === 5500 + 440 + 5000 && fwd.giftCardChargeCents === 5000);
  }

  // (4) negative / bogus charge clamps to 0
  ok('negative charge clamps to 0', computeTotals(1000, 0, settings(), 'cash', -999).giftCardChargeCents === 0);
  ok('tax-free tenant: only services + charge', computeTotals(4000, 0, settings({ taxRatePercent: 0 }), 'cash', 2500).totalDueCents === 4000 + 2500);

  console.log(`\ncheckout-giftcard-charge-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
