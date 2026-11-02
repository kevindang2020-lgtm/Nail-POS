// revenue-split.ts — decimal-safe three-way revenue split (AI PowerSalon / processor / participating salon).
// All money is INTEGER CENTS. Shares are computed at high precision, floored, and the leftover cent(s) are
// allocated by the rounding policy so the three shares ALWAYS reconcile exactly to the gross. Net revenue is
// AI PowerSalon's retained share after refunds/credits and signed adjustments (per the agreement's allocation).
// No floating point is stored as authoritative — only the final integer-cent allocation is persisted.

export type SplitPercents = { ai: number; processor: number; salon: number };
export type RoundingPolicy = 'largest_remainder' | 'ai_absorbs';
export type RefundAllocation = 'ai_powersalon' | 'proportional';

export type SplitResult = {
  grossCents: number;
  aiShareCents: number;
  processorShareCents: number;
  salonIncentiveShareCents: number;
  roundingAdjustmentCents: number;   // number of leftover cents redistributed to reach exact reconciliation
  refundsCreditsCents: number;       // positive magnitude deducted from net
  adjustmentsCents: number;          // signed
  netRevenueCents: number;           // AI PowerSalon net
  reconciles: boolean;               // ai+processor+salon === gross
};

const int = (v: number | undefined | null) => Math.round(Number(v) || 0);

export function computeThreeWaySplit(
  grossCentsInput: number,
  pct: SplitPercents,
  opts: { refundsCreditsCents?: number; adjustmentsCents?: number; roundingPolicy?: RoundingPolicy; refundAllocation?: RefundAllocation } = {},
): SplitResult {
  const gross = int(grossCentsInput);
  const totalPct = (pct.ai || 0) + (pct.processor || 0) + (pct.salon || 0);
  const denom = totalPct > 0 ? totalPct : 100;
  const parts = [
    { key: 'ai', pct: pct.ai || 0 },
    { key: 'processor', pct: pct.processor || 0 },
    { key: 'salon', pct: pct.salon || 0 },
  ].map((p) => {
    const exact = (gross * p.pct) / denom;
    const floor = Math.floor(exact);
    return { key: p.key, floor, rem: exact - floor };
  });

  const flooredSum = parts.reduce((a, p) => a + p.floor, 0);
  let leftover = gross - flooredSum; // 0..(parts-1), can be negative for negative gross
  const roundingAdjustmentCents = Math.abs(leftover);

  if ((opts.roundingPolicy ?? 'largest_remainder') === 'ai_absorbs') {
    const ai = parts.find((p) => p.key === 'ai')!; ai.floor += leftover; leftover = 0;
  } else {
    // largest-remainder (Hamilton): give the extra cent(s) to the parties with the largest fractional remainder;
    // ties resolved deterministically (ai, then processor, then salon).
    const rank: Record<string, number> = { ai: 0, processor: 1, salon: 2 };
    const order = [...parts].sort((a, b) => (b.rem - a.rem) || (rank[a.key] - rank[b.key]));
    const step = leftover >= 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(leftover); i++) order[i % order.length].floor += step;
  }

  const shareOf = (k: string) => parts.find((p) => p.key === k)!.floor;
  const aiShareCents = shareOf('ai');
  const processorShareCents = shareOf('processor');
  const salonIncentiveShareCents = shareOf('salon');

  const refundsCreditsCents = Math.abs(int(opts.refundsCreditsCents));
  const adjustmentsCents = int(opts.adjustmentsCents);
  // Net = AI PowerSalon share, less refunds/credits (per allocation) plus signed adjustments.
  const refundToAi = (opts.refundAllocation ?? 'ai_powersalon') === 'proportional'
    ? Math.round((refundsCreditsCents * (pct.ai || 0)) / denom)
    : refundsCreditsCents;
  const netRevenueCents = aiShareCents - refundToAi + adjustmentsCents;

  return {
    grossCents: gross,
    aiShareCents,
    processorShareCents,
    salonIncentiveShareCents,
    roundingAdjustmentCents,
    refundsCreditsCents,
    adjustmentsCents,
    netRevenueCents,
    reconciles: aiShareCents + processorShareCents + salonIncentiveShareCents === gross,
  };
}

// Validate that a three-way split totals exactly 100 (percentages given as e.g. 60, 15, 25).
export function splitPercentsValid(pct: SplitPercents): boolean {
  const total = (pct.ai || 0) + (pct.processor || 0) + (pct.salon || 0);
  return Math.abs(total - 100) < 1e-9 && (pct.ai || 0) >= 0 && (pct.processor || 0) >= 0 && (pct.salon || 0) >= 0;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// LAYERED residual split — the two-layer model the Fiserv Schedule A actually describes.
//
//   Layer 0 (Net Revenue pool): applicable processor/card-network pass-through costs come off the top FIRST.
//       netPool = grossResidual − applicableCosts.  The split NEVER applies to the raw gross.
//   Layer 1 (contractual):      netPool divides between the platform's contractual share (e.g. 65%) and the
//       processor's retained share (e.g. 35%). This is what the processor owes AI PowerSalon — reconciled
//       against processor statements, independent of any tenant program.
//   Layer 2 (tenant incentive): the participating tenant's share (e.g. 25% of the net pool) is an
//       AI PowerSalon-MANAGED payable carved OUT OF the platform's contractual share — never a direct
//       processor payout. platformRetained = contractual − tenantIncentive (e.g. 65 − 25 → 40).
//
//   Economic result (e.g.): platform 40 / processor 35 / tenant 25 = 100% of the net pool — but the books can
//   reconcile "processor owes platform" separately from "platform owes tenant", which a flat split cannot.
//   All integer cents; both layers reconcile exactly; the tenant share is capped at the contractual share so a
//   misconfigured percentage can never pay out money the platform was never owed.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════

export type LayeredPercents = {
  platformContractual: number;  // platform's contractual % of the net pool (e.g. 65)
  processor: number;            // processor's retained % of the net pool (e.g. 35)
  tenantIncentive: number;      // tenant's % of the net pool, carved from platformContractual (e.g. 25)
};

export type LayeredSplitResult = {
  grossResidualCents: number;
  applicableCostsCents: number;      // positive magnitude deducted off the top
  netPoolCents: number;              // the Net Revenue pool everything splits over
  processorRetainedCents: number;    // layer 1: processor keeps
  processorOwesPlatformCents: number;// layer 1: the platform's contractual share (what the processor remits)
  platformOwesTenantCents: number;   // layer 2: AI PowerSalon-managed tenant payable (carved from contractual)
  platformRetainedCents: number;     // layer 2: what the platform keeps (contractual − tenant incentive)
  tenantShareCapped: boolean;        // true if a misconfigured tenant % had to be capped at the contractual share
  contractualReconciles: boolean;    // processorRetained + processorOwesPlatform === netPool
  economicReconciles: boolean;       // platformRetained + processorRetained + platformOwesTenant === netPool
  effectivePcts: { platform: number; processor: number; tenant: number }; // realized % of net pool (1dp)
};

/** Map an agreement's stored flat percentages (ai/processor/salon, summing to 100) onto the layered model:
 *  the platform's CONTRACTUAL share is ai + salon (the tenant incentive is carved from it), the processor's is
 *  processor, and the tenant incentive is salon. e.g. flat 40/35/25 → layered {65, 35, 25}. */
export function layeredFromFlat(pct: SplitPercents): LayeredPercents {
  return { platformContractual: (pct.ai || 0) + (pct.salon || 0), processor: pct.processor || 0, tenantIncentive: pct.salon || 0 };
}

export function computeLayeredResidualSplit(
  grossResidualCents: number,
  pct: LayeredPercents,
  opts: { applicableCostsCents?: number } = {},
): LayeredSplitResult {
  const gross = int(grossResidualCents);
  const costs = Math.abs(int(opts.applicableCostsCents));
  const netPool = gross - costs;

  // Layer 1 — contractual split of the net pool. Denominator normalizes like the flat engine; the two shares
  // always reconcile exactly to the pool (floor + leftover cents to the largest remainder, platform on ties).
  const l1 = (pct.platformContractual || 0) + (pct.processor || 0);
  const denom = l1 > 0 ? l1 : 100;
  const exactPlatform = (netPool * (pct.platformContractual || 0)) / denom;
  const exactProcessor = (netPool * (pct.processor || 0)) / denom;
  let platformContractualCents = Math.floor(exactPlatform);
  let processorRetainedCents = Math.floor(exactProcessor);
  let leftover = netPool - platformContractualCents - processorRetainedCents;
  const step = leftover >= 0 ? 1 : -1;
  const remPlatform = exactPlatform - Math.floor(exactPlatform);
  const remProcessor = exactProcessor - Math.floor(exactProcessor);
  for (let i = 0; i < Math.abs(leftover); i++) {
    if (remPlatform >= remProcessor ? i % 2 === 0 : i % 2 === 1) platformContractualCents += step; else processorRetainedCents += step;
  }

  // Layer 2 — the tenant incentive is carved from (and capped at) the platform's contractual share. The cap is a
  // safety floor: a bad tenant % can reduce the platform's retained share to zero, but can never invent money the
  // platform was not contractually owed.
  let platformOwesTenantCents = Math.round((netPool * (pct.tenantIncentive || 0)) / denom);
  let tenantShareCapped = false;
  if (platformContractualCents >= 0) {
    const capped = Math.max(0, Math.min(platformOwesTenantCents, platformContractualCents));
    tenantShareCapped = capped !== platformOwesTenantCents; platformOwesTenantCents = capped;
  } else {
    const capped = Math.min(0, Math.max(platformOwesTenantCents, platformContractualCents));
    tenantShareCapped = capped !== platformOwesTenantCents; platformOwesTenantCents = capped;
  }
  const platformRetainedCents = platformContractualCents - platformOwesTenantCents;

  const pctOf = (v: number) => (netPool ? Math.round((v / netPool) * 1000) / 10 : 0);
  return {
    grossResidualCents: gross,
    applicableCostsCents: costs,
    netPoolCents: netPool,
    processorRetainedCents,
    processorOwesPlatformCents: platformContractualCents,
    platformOwesTenantCents,
    platformRetainedCents,
    tenantShareCapped,
    contractualReconciles: processorRetainedCents + platformContractualCents === netPool,
    economicReconciles: platformRetainedCents + processorRetainedCents + platformOwesTenantCents === netPool,
    effectivePcts: { platform: pctOf(platformRetainedCents), processor: pctOf(processorRetainedCents), tenant: pctOf(platformOwesTenantCents) },
  };
}
