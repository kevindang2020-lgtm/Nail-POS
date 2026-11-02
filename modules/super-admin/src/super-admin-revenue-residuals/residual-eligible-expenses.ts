/**
 * residual-eligible-expenses.ts — which processor costs may be deducted BEFORE the residual split (Jul 28, 2026).
 *
 * Until now `applicable_costs_cents` was a single opaque number typed into statement import: correct arithmetic,
 * but no record of WHAT was deducted, so nobody could check a deduction against the signed agreement. This adds the
 * itemization and a default eligibility list, without changing the split engine — it still receives one total.
 *
 * THE DEFAULT LIST IS CONSERVATIVE AND IT IS NOT LEGAL ADVICE. Eligible-by-default are the pass-through costs a
 * Schedule A normally lists: interchange, card-network assessments, network/brand fees, authorization and
 * settlement fees, and PCI/compliance pass-through. Everything else defaults to NOT eligible — a cost that is
 * merely real is not automatically deductible from a residual pool, and the asymmetry is deliberate: wrongly
 * deducting understates what the platform owes the salon, while wrongly excluding only understates the platform's
 * own retention. Chargeback FEES are eligible; chargeback LOSSES and fines are not. Anything not in the catalog is
 * treated as ineligible with a reason, never silently dropped or silently deducted.
 *
 * The list is CONFIGURABLE per agreement (`overrides`) so a signed Schedule A that says otherwise wins over these
 * defaults. Kevin's accountant/attorney owns the final list; this encodes a defensible starting point and, more
 * importantly, makes every deduction visible and attributable.
 */

export interface ExpenseCategory { key: string; label: string; eligibleByDefault: boolean; note: string; }

export const RESIDUAL_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: 'interchange',        label: 'Interchange',                 eligibleByDefault: true,  note: 'Paid through to the issuing bank; the classic Schedule A pass-through.' },
  { key: 'assessments',        label: 'Card-network assessments',    eligibleByDefault: true,  note: 'Paid through to the card networks.' },
  { key: 'network_fees',       label: 'Network / brand fees',        eligibleByDefault: true,  note: 'Per-transaction and monthly network charges.' },
  { key: 'authorization_fees', label: 'Authorization fees',          eligibleByDefault: true,  note: 'Per-authorization processor charges.' },
  { key: 'settlement_fees',    label: 'Settlement / batch fees',     eligibleByDefault: true,  note: 'Per-batch settlement charges.' },
  { key: 'pci_compliance',     label: 'PCI / compliance pass-through', eligibleByDefault: true, note: 'Compliance charges passed through by the processor.' },
  { key: 'chargeback_fees',    label: 'Chargeback fees',             eligibleByDefault: true,  note: 'The per-dispute FEE only — not the disputed amount.' },
  { key: 'chargeback_losses',  label: 'Chargeback losses',           eligibleByDefault: false, note: 'The disputed amount is a loss, not a processing cost — deduct only if the agreement says so.' },
  { key: 'fines_penalties',    label: 'Fines & penalties',           eligibleByDefault: false, note: 'Network fines are rarely a permitted deduction from a residual pool.' },
  { key: 'gateway_platform',   label: 'Gateway / platform fees',     eligibleByDefault: false, note: 'Often the platform’s own cost of doing business — agreement-specific.' },
  { key: 'equipment',          label: 'Equipment & hardware',        eligibleByDefault: false, note: 'Hardware financing is its own accounting bucket — never mix it into residuals.' },
  { key: 'marketing',          label: 'Marketing & incentives',      eligibleByDefault: false, note: 'A cost of growth, not a processing pass-through.' },
  { key: 'support_labor',      label: 'Support & labor',             eligibleByDefault: false, note: 'Operating expense, not a pass-through cost.' },
  { key: 'other',              label: 'Other',                       eligibleByDefault: false, note: 'Uncategorized costs are excluded until someone classifies them.' },
];

const BY_KEY = new Map(RESIDUAL_EXPENSE_CATEGORIES.map((c) => [c.key, c]));

export interface ExpenseLine { category: string; amountCents: number; note?: string | null; }
export interface EligibilityOverrides { [categoryKey: string]: boolean }
export interface CostBreakdownLine extends ExpenseLine { eligible: boolean; reason: string; known: boolean; }
export interface CostBreakdown {
  applicableCostsCents: number;      // the ONLY number the split engine consumes
  excludedCostsCents: number;        // real costs that are not deductible from the pool
  totalSubmittedCents: number;
  lines: CostBreakdownLine[];
  unknownCategories: string[];
}

/** Is a category deductible? An agreement override always wins over the default. */
export function isEligible(categoryKey: string, overrides: EligibilityOverrides = {}): boolean {
  if (Object.prototype.hasOwnProperty.call(overrides, categoryKey)) return !!overrides[categoryKey];
  return BY_KEY.get(categoryKey)?.eligibleByDefault ?? false;
}

/**
 * Itemized costs → the single total the layered split deducts off the top. Amounts are magnitudes (a cost of -500
 * and 500 both mean 500 deducted); non-finite amounts are dropped rather than poisoning the sum with NaN; an
 * unrecognized category is reported by name and excluded, never silently deducted.
 */
export function computeApplicableCosts(lines: ExpenseLine[], overrides: EligibilityOverrides = {}): CostBreakdown {
  const out: CostBreakdownLine[] = [];
  const unknown = new Set<string>();
  let applicable = 0; let excluded = 0;
  for (const l of lines || []) {
    const amount = Math.abs(Math.round(Number(l?.amountCents)));
    if (!Number.isFinite(amount)) continue;
    const key = String(l?.category ?? '').trim() || 'other';
    const cat = BY_KEY.get(key);
    if (!cat) unknown.add(key);
    const eligible = cat ? isEligible(key, overrides) : !!overrides[key];
    const reason = !cat
      ? 'Unrecognized cost category — excluded until it is classified'
      : eligible
        ? (Object.prototype.hasOwnProperty.call(overrides, key) ? 'Eligible per this agreement’s configuration' : cat.note)
        : (Object.prototype.hasOwnProperty.call(overrides, key) ? 'Excluded per this agreement’s configuration' : cat.note);
    if (eligible) applicable += amount; else excluded += amount;
    out.push({ category: key, amountCents: amount, note: l?.note ?? null, eligible, reason, known: !!cat });
  }
  return { applicableCostsCents: applicable, excludedCostsCents: excluded, totalSubmittedCents: applicable + excluded, lines: out, unknownCategories: [...unknown] };
}
