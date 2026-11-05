// gift-card-clearing-core.spec.ts — Nest-free harness (esbuild + node) for cross-tenant clearing accounting (§15–17).
import { clearingObligation, settlementTotals, canTransitionSettlement, canTransitionClearing, crossTenantRedeemable } from './gift-card-clearing-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

(async () => {
  // clearingObligation — cross-tenant creates an obligation from issuer -> redeemer
  {
    const o = clearingObligation({ issuingTenantId: 'A', redeemingTenantId: 'B', amountCents: 4000 });
    ok('cross-tenant redemption is applicable', o.applicable === true);
    ok('issuer is the payer (holds liability)', o.payerTenantId === 'A');
    ok('redeemer is the payee (is owed)', o.payeeTenantId === 'B');
    ok('gross obligation is the redeemed amount', o.amountCents === 4000);
    ok('no fee by default', o.platformFeeCents === 0 && o.netToPayeeCents === 4000);
  }

  // same-tenant redemption never clears (single-tenant card used at its issuer)
  {
    const o = clearingObligation({ issuingTenantId: 'A', redeemingTenantId: 'A', amountCents: 4000 });
    ok('same-tenant redemption is not applicable', o.applicable === false && o.reason === 'same_tenant');
  }

  // non-positive amounts never clear
  ok('zero amount is not applicable', clearingObligation({ issuingTenantId: 'A', redeemingTenantId: 'B', amountCents: 0 }).applicable === false);
  ok('negative amount is not applicable', clearingObligation({ issuingTenantId: 'A', redeemingTenantId: 'B', amountCents: -100 }).applicable === false);

  // platform fee split (basis points, floored)
  {
    const o = clearingObligation({ issuingTenantId: 'A', redeemingTenantId: 'B', amountCents: 5000, platformFeeBps: 250 }); // 2.5%
    ok('fee is floor(amount * bps / 10000)', o.platformFeeCents === 125);
    ok('net to payee is amount minus fee', o.netToPayeeCents === 4875);
  }
  {
    const o = clearingObligation({ issuingTenantId: 'A', redeemingTenantId: 'B', amountCents: 999, platformFeeBps: 100 }); // 1% of 999 = 9.99 -> 9
    ok('fee floors down (no fractional cents)', o.platformFeeCents === 9 && o.netToPayeeCents === 990);
  }

  // settlementTotals aggregates a batch
  {
    const t = settlementTotals([{ amountCents: 4000, platformFeeCents: 100 }, { amountCents: 2500, platformFeeCents: 0 }, { amountCents: 1500 }]);
    ok('batch counts entries', t.count === 3);
    ok('batch sums gross', t.totalCents === 8000);
    ok('batch sums fees', t.feeCents === 100);
    ok('batch net = gross - fees', t.netCents === 7900);
  }
  ok('empty batch totals to zero', JSON.stringify(settlementTotals([])) === JSON.stringify({ count: 0, totalCents: 0, feeCents: 0, netCents: 0 }));

  // settlement status transitions (human-approved; no auto-settlement)
  ok('open -> pending_review allowed', canTransitionSettlement('open', 'pending_review'));
  ok('pending_review -> approved allowed', canTransitionSettlement('pending_review', 'approved'));
  ok('approved -> settled allowed', canTransitionSettlement('approved', 'settled'));
  ok('open -> settled NOT allowed (must be reviewed + approved first)', !canTransitionSettlement('open', 'settled'));
  ok('settled -> reversed allowed', canTransitionSettlement('settled', 'reversed'));
  ok('reversed is terminal', !canTransitionSettlement('reversed', 'approved'));
  ok('unknown status transitions to nothing', !canTransitionSettlement('bogus', 'approved'));

  // clearing entry transitions
  ok('clearing pending -> validated allowed', canTransitionClearing('pending', 'validated'));
  ok('clearing pending -> settled NOT allowed', !canTransitionClearing('pending', 'settled'));
  ok('clearing approved -> settled allowed', canTransitionClearing('approved', 'settled'));

  // cross-tenant redemption eligibility
  ok('same-tenant is eligible and not cross-tenant', (() => { const r = crossTenantRedeemable({ issuingTenantId: 'A', redeemingTenantId: 'A', programScope: 'network' }); return r.crossTenant === false && r.eligible === true; })());
  ok('network card at a member salon is eligible cross-tenant', (() => { const r = crossTenantRedeemable({ issuingTenantId: 'A', redeemingTenantId: 'B', programScope: 'network', issuerActiveMember: true, redeemerActiveMember: true }); return r.crossTenant === true && r.eligible === true; })());
  ok('owner_portfolio card at a member salon is eligible', crossTenantRedeemable({ issuingTenantId: 'A', redeemingTenantId: 'B', programScope: 'owner_portfolio', issuerActiveMember: true, redeemerActiveMember: true }).eligible === true);
  ok('tenant-only card is NOT redeemable at another salon', (() => { const r = crossTenantRedeemable({ issuingTenantId: 'A', redeemingTenantId: 'B', programScope: 'tenant_only', issuerActiveMember: true, redeemerActiveMember: true }); return r.eligible === false && r.reason === 'scope_not_shared'; })());
  ok('a card with no program is not redeemable cross-tenant', crossTenantRedeemable({ issuingTenantId: 'A', redeemingTenantId: 'B', programScope: null }).reason === 'no_program');
  ok('network card is refused when the redeemer is not a member', (() => { const r = crossTenantRedeemable({ issuingTenantId: 'A', redeemingTenantId: 'B', programScope: 'network', issuerActiveMember: true, redeemerActiveMember: false }); return r.eligible === false && r.reason === 'not_member'; })());

  console.log(`\ngift-card-clearing-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
