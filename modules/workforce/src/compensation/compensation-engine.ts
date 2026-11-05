/**
 * compensation-engine.ts — THE one canonical compensation engine (spec §3). Pure, deterministic, integer-cents.
 * No DB, no I/O, no floating-point money. Every surface calls these functions so no two screens disagree (§25).
 *
 * Invariants enforced here:
 *  • Tax is NEVER part of the commissionable base (§2).
 *  • Tips are NEVER in the salon/tech split and the salon keeps 0% (§2, §12).
 *  • Supply charge is salon-retained and removed BEFORE commission by default (§9).
 *  • tech + salon === commissionable, per line and in total (§25).
 *  • Σ tip allocations === total tip (§12, §25).
 */
import { allocateByLargestRemainder, percentOfCents } from '@aipowersalon/money';
import { lineCommissionCents } from './commission-basis';
export { allocateByLargestRemainder };   // owned by @aipowersalon/money (Constitution 13 §86)
import type {
  Cents, ServiceLineInput, ServiceLineCompensation, LineTechCompensation, TicketCompensationInput,
  TicketCompensationResult, TechnicianTotals, TipInput, DiscountFunding,
} from './compensation.types';

export const COMPENSATION_ENGINE_VERSION = '1.0.0';

/** Largest-remainder apportionment: split `total` cents across integer `weights`, summing EXACTLY to total. */

/** Portion of a line discount that reduces the commissionable base, by funding source (§10). */
function commissionReducingDiscount(discountCents: Cents, funding: DiscountFunding): Cents {
  switch (funding) {
    case 'salon_funded': return 0;        // salon eats it; commission stays on full value
    case 'noncommissionable': return 0;   // promo doesn't touch commission
    case 'technician_funded': return discountCents; // tech absorbs (Phase 1: reduces base; asymmetric tech-only handling is a documented Phase-2 refinement)
    case 'proportional':
    default: return discountCents;        // default: reduces the base both share via the split
  }
}

/** Salon-retained supply charge for a line (§9). */
export function supplyChargeFor(line: ServiceLineInput): Cents {
  const s = line.supply;
  if (!s || s.method === 'none') return 0;
  if (s.method === 'fixed') return Math.max(0, Math.round(s.value));
  if (s.method === 'percent') return Math.max(0, percentOfCents(line.priceCents, s.value));
  return 0;
}

/** Compute one service line's full compensation breakdown (single or multi-technician). */
export function computeServiceLine(line: ServiceLineInput, warnings: string[]): ServiceLineCompensation {
  const price = Math.max(0, Math.round(line.priceCents));
  const discount = Math.max(0, Math.round(line.discountCents ?? 0));
  const funding: DiscountFunding = line.discountFunding ?? 'proportional';
  const tax = Math.max(0, Math.round(line.taxCents ?? 0));
  const supply = supplyChargeFor(line);
  const otherNon = Math.max(0, Math.round(line.otherNoncommissionableCents ?? 0));

  const reducingDiscount = commissionReducingDiscount(discount, funding);
  const eligibleForSplit = price - supply - otherNon; // commission base before any discount
  let commissionable = eligibleForSplit - reducingDiscount;
  if (commissionable < 0) {
    warnings.push(`Line ${line.lineId}: commissionable below zero (price ${price} − discount ${reducingDiscount} − supply ${supply} − other ${otherNon}); clamped to 0.`);
    commissionable = 0;
  }
  if (supply > price) warnings.push(`Line ${line.lineId}: supply charge ${supply} exceeds service price ${price}.`);

  // tech-vs-salon split on the commissionable base
  let techService: number;
  let salonService: number;
  if (funding === 'technician_funded' && line.commission.type === 'percent' && discount > 0) {
    // §10 technician-funded: the salon keeps its FULL share (computed on the pre-discount eligible); the technician
    // absorbs the entire discount. tech + salon still == commissionable (the discounted amount actually split).
    salonService = Math.min(commissionable, percentOfCents(Math.max(0, eligibleForSplit), 100 - line.commission.value));
    techService = commissionable - salonService;
    if (techService < 0) { warnings.push(`Line ${line.lineId}: technician-funded discount exceeds the technician's share; clamped.`); techService = 0; salonService = commissionable; }
  } else {
    techService = lineCommissionCents(commissionable, line.commission.type, line.commission.value);   // THE one formula (ONE-PAY)
    salonService = commissionable - techService; // residual → exact reconciliation
  }

  // allocate the tech pool among the performers (§11)
  const techs = line.technicians.length ? line.technicians : [{ technicianId: 'unassigned', method: 'equal' as const }];
  if (line.technicians.length === 0) warnings.push(`Line ${line.lineId}: no technician attribution; assigned to 'unassigned'.`);
  const weights = techs.map((t) =>
    t.method === 'percent' ? Math.max(0, t.value ?? 0)
    : t.method === 'fixed' ? Math.max(0, t.value ?? 0)
    : 1, // equal
  );
  const alloc = allocateByLargestRemainder(techService, weights);
  const perTech: LineTechCompensation[] = techs.map((t, i) => ({
    lineId: line.lineId,
    technicianId: t.technicianId,
    commissionableCents: allocateByLargestRemainder(commissionable, weights)[i],
    techServiceEarningsCents: alloc[i],
    allocationLabel: t.method === 'percent' ? `${t.value ?? 0}%` : t.method === 'fixed' ? `$${((t.value ?? 0) / 100).toFixed(2)}` : 'equal',
  }));

  return {
    lineId: line.lineId, priceCents: price, discountCents: discount, discountFunding: funding, taxCents: tax,
    supplyCents: supply, commissionableCents: commissionable, techServiceEarningsCents: techService,
    salonServiceShareCents: salonService, salonSupplyCents: supply, perTech, commissionSource: line.commission.source,
    excluded: { taxCents: tax, supplyCents: supply, otherNoncommissionableCents: otherNon },
  };
}

/** Allocate the ticket tip across technicians (§12). Salon keeps 0. Card and cash tracked separately. */
export function allocateTips(
  tip: TipInput | undefined,
  lineComps: ServiceLineCompensation[],
  warnings: string[],
): Map<string, { cardTipCents: Cents; cashTipCents: Cents }> {
  const out = new Map<string, { cardTipCents: Cents; cashTipCents: Cents }>();
  if (!tip) return out;
  const card = Math.max(0, Math.round(tip.cardTipCents ?? 0));
  const cash = Math.max(0, Math.round(tip.cashTipCents ?? 0));
  if (card + cash === 0) return out;

  // eligible technicians + their weights by method
  const techIds = tip.eligibleTechnicianIds?.length
    ? tip.eligibleTechnicianIds
    : [...new Set(lineComps.flatMap((l) => l.perTech.map((p) => p.technicianId)))];

  const ensure = (id: string) => { if (!out.has(id)) out.set(id, { cardTipCents: 0, cashTipCents: 0 }); return out.get(id)!; };

  if ((tip.method === 'customer_directed' || tip.method === 'custom') && tip.directed?.length) {
    const total = tip.directed.reduce((a, d) => a + Math.max(0, Math.round(d.tipCents)), 0);
    if (total !== card + cash) warnings.push(`Tip: directed allocations (${total}) do not equal total tip (${card + cash}).`);
    // split each tech's directed amount into card/cash proportionally to the card:cash pool
    const cardWeights = tip.directed.map((d) => Math.max(0, Math.round(d.tipCents)));
    const cardParts = allocateByLargestRemainder(card, cardWeights);
    const cashParts = allocateByLargestRemainder(cash, cardWeights);
    tip.directed.forEach((d, i) => { const e = ensure(d.technicianId); e.cardTipCents += cardParts[i]; e.cashTipCents += cashParts[i]; });
    return out;
  }

  // weighted methods
  let weights: number[];
  const ids = techIds;
  if (tip.method === 'by_commission_pool') {
    weights = ids.map((id) => lineComps.reduce((a, l) => a + l.perTech.filter((p) => p.technicianId === id).reduce((b, p) => b + p.techServiceEarningsCents, 0), 0));
  } else if (tip.method === 'by_service_revenue') {
    weights = ids.map((id) => lineComps.reduce((a, l) => a + l.perTech.filter((p) => p.technicianId === id).reduce((b, p) => b + p.commissionableCents, 0), 0));
  } else { // equal (default fallback)
    weights = ids.map(() => 1);
  }
  const cardParts = allocateByLargestRemainder(card, weights);
  const cashParts = allocateByLargestRemainder(cash, weights);
  ids.forEach((id, i) => { const e = ensure(id); e.cardTipCents += cardParts[i]; e.cashTipCents += cashParts[i]; });
  return out;
}

/** Aggregate a whole ticket into the canonical result with reconciliation (§14, §25). */
export function computeTicketCompensation(input: TicketCompensationInput): TicketCompensationResult {
  const warnings: string[] = [];
  const serviceLines = input.serviceLines.filter((l) => !l.isRetail);
  const lines = serviceLines.map((l) => computeServiceLine(l, warnings));
  const tipByTech = allocateTips(input.tip, lines, warnings);

  // retail commission (kept entirely separate from service commission, §5)
  const retailByTech = new Map<string, Cents>();
  for (const l of input.serviceLines.filter((x) => x.isRetail)) {
    const c = l.commission.type === 'percent' ? percentOfCents(l.priceCents, l.commission.value) : Math.round(l.commission.value);
    const id = l.technicians[0]?.technicianId ?? 'unassigned';
    retailByTech.set(id, (retailByTech.get(id) ?? 0) + Math.max(0, c));
  }

  // per-technician rollup
  const techIds = new Set<string>([
    ...lines.flatMap((l) => l.perTech.map((p) => p.technicianId)),
    ...tipByTech.keys(), ...retailByTech.keys(),
  ]);
  const perTechnician: TechnicianTotals[] = [...techIds].map((id) => ({
    technicianId: id,
    serviceEarningsCents: lines.reduce((a, l) => a + l.perTech.filter((p) => p.technicianId === id).reduce((b, p) => b + p.techServiceEarningsCents, 0), 0),
    cardTipCents: tipByTech.get(id)?.cardTipCents ?? 0,
    cashTipCents: tipByTech.get(id)?.cashTipCents ?? 0,
    retailCommissionCents: retailByTech.get(id) ?? 0,
  }));

  const sum = (f: (l: ServiceLineCompensation) => Cents) => lines.reduce((a, l) => a + f(l), 0);
  const totals = {
    grossServiceCents: sum((l) => l.priceCents),
    discountCents: sum((l) => l.discountCents),
    taxCents: sum((l) => l.taxCents),
    supplyCents: sum((l) => l.supplyCents),
    commissionableCents: sum((l) => l.commissionableCents),
    techServiceEarningsCents: sum((l) => l.techServiceEarningsCents),
    salonServiceShareCents: sum((l) => l.salonServiceShareCents),
    cardTipCents: [...tipByTech.values()].reduce((a, v) => a + v.cardTipCents, 0),
    cashTipCents: [...tipByTech.values()].reduce((a, v) => a + v.cashTipCents, 0),
    retailCommissionCents: [...retailByTech.values()].reduce((a, v) => a + v, 0),
  };

  const totalTipIn = Math.max(0, Math.round(input.tip?.cardTipCents ?? 0)) + Math.max(0, Math.round(input.tip?.cashTipCents ?? 0));
  const reconciliation = {
    splitsReconcile: lines.every((l) => l.techServiceEarningsCents + l.salonServiceShareCents === l.commissionableCents)
      && totals.techServiceEarningsCents + totals.salonServiceShareCents === totals.commissionableCents,
    tipsReconcile: totals.cardTipCents + totals.cashTipCents === totalTipIn,
    salonTipIsZero: true,
    noNegativeCommissionable: lines.every((l) => l.commissionableCents >= 0),
  };

  return { ticketId: input.ticketId, lines, salonTipCents: 0, totals, perTechnician, reconciliation, warnings };
}

/**
 * Guaranteed-earnings salon top-up (§6). Tips and tax are EXCLUDED from eligible compensation by the caller.
 * Nonrecoverable by default — never carried forward as technician debt.
 */
export function computeGuaranteeTopUp(guaranteedCents: Cents, eligibleCompensationCents: Cents): Cents {
  return Math.max(0, Math.round(guaranteedCents) - Math.round(eligibleCompensationCents));
}

/** Prorate a guarantee by eligible vs scheduled hours (§7).
 *  FAIL-SAFE (Jul 28, 2026): an unknown/zero denominator returns the FULL guarantee. "Cannot prorate" must never
 *  silently become "prorate to nothing" — a guarantee is a promise, and missing schedule data doesn't revoke it.
 *  Withholding a guarantee from someone who didn't work is the job of the eligibility levers
 *  (require_clocked_in / min_hours_required), not of a 0/0 ratio. */
export function prorateGuarantee(guaranteedCents: Cents, eligibleHours: number, scheduledHours: number): Cents {
  const g = Math.max(0, Math.round(guaranteedCents));
  if (!Number.isFinite(scheduledHours) || scheduledHours <= 0) return g;
  const ratio = Math.min(1, Math.max(0, eligibleHours / scheduledHours));
  return Math.round(g * ratio);
}
