/**
 * compensation-supply.ts — supply-charge resolution (spec §9). Resolves a per-service supply CONFIG (fixed, percent,
 * tiered-by-price, or product-usage recipe) to integer cents the engine retains for the salon BEFORE commission.
 * The resolved cents is fed to the engine as the line's supply (the engine then removes it from the commissionable base).
 * Pure, integer-cents, no DB. Supply NEVER touches tips and NEVER exceeds price (the engine guards/warns on the latter).
 */
import type { Cents } from './compensation.types';

export interface SupplyTier { /** inclusive upper bound in cents; null = top (no upper bound). */ uptoCents: number | null; chargeCents: Cents; }
export interface SupplyRecipeItem {
  productId: string;
  expectedQty: number;
  unitCostCents: Cents;
  /** standard salon recovery for this item; defaults to expectedQty × unitCostCents when omitted. */
  salonRecoveryCents?: Cents;
}

export type SupplyChargeConfig =
  | { method: 'none' }
  | { method: 'fixed'; amountCents: Cents }
  | { method: 'percent'; percent: number }                 // % of the line price
  | { method: 'tiered'; tiers: SupplyTier[] }              // by service price (§9)
  | { method: 'recipe'; items: SupplyRecipeItem[] };       // product-usage based (§9)

/** Resolve a supply config + line price to the salon-retained supply cents. */
export function resolveSupplyCents(config: SupplyChargeConfig | undefined, priceCents: Cents): Cents {
  if (!config || config.method === 'none') return 0;
  const price = Math.max(0, Math.round(priceCents));
  switch (config.method) {
    case 'fixed':
      return Math.max(0, Math.round(config.amountCents));
    case 'percent':
      return Math.max(0, Math.round((price * config.percent) / 100));
    case 'tiered': {
      // first tier (ascending by bound) whose bound covers the price; null bound = catch-all top tier
      const tiers = [...config.tiers].sort((a, b) => (a.uptoCents ?? Infinity) - (b.uptoCents ?? Infinity));
      for (const t of tiers) if (t.uptoCents == null || price <= t.uptoCents) return Math.max(0, Math.round(t.chargeCents));
      return 0;
    }
    case 'recipe':
      return config.items.reduce((sum, it) => {
        const recovery = it.salonRecoveryCents != null ? it.salonRecoveryCents : Math.round(it.expectedQty * it.unitCostCents);
        return sum + Math.max(0, Math.round(recovery));
      }, 0);
    default:
      return 0;
  }
}

/** Config-time validation (§27): non-negative amounts, ordered tiers, sane percent. */
export function validateSupplyConfig(config: SupplyChargeConfig): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  if (config.method === 'fixed' && config.amountCents < 0) errors.push('Fixed supply amount must be ≥ 0.');
  if (config.method === 'percent' && (config.percent < 0 || config.percent > 100)) errors.push('Supply percent must be 0–100.');
  if (config.method === 'tiered') {
    if (config.tiers.length === 0) errors.push('Tiered supply needs at least one tier.');
    const bounds = config.tiers.map((t) => t.uptoCents).filter((b): b is number => b != null);
    if (bounds.some((b, i) => i > 0 && b <= bounds[i - 1])) warnings.push('Tier upper bounds are not strictly ascending.');
    if (config.tiers.filter((t) => t.uptoCents == null).length > 1) errors.push('At most one open-ended (top) tier is allowed.');
    if (config.tiers.some((t) => t.chargeCents < 0)) errors.push('Tier charges must be ≥ 0.');
  }
  if (config.method === 'recipe' && config.items.some((it) => it.expectedQty < 0 || it.unitCostCents < 0)) {
    errors.push('Recipe quantities and unit costs must be ≥ 0.');
  }
  return { errors, warnings };
}
