// ai-inventory-recipe.core.ts — pure validation + lifecycle rules for service→supply recipes (§11). No DB, no mutation.
// A recipe is APPROVAL-GATED: drafts (manual or ai_proposed) must be approved by an authorized user before use, and only
// one approved version may exist per (service, branch scope). These helpers enforce structural validity and the legal
// status/version transitions; ownership (service/products belong to the tenant) is checked in the repository layer.

export type RecipeStatus = 'draft' | 'approved' | 'archived';
export type RecipeSource = 'manual' | 'ai_proposed';

export interface RecipeLineInput {
  productId: string;
  expectedQuantity: number;
  consumptionUnit: string;
  wasteAllowancePct?: number;
  required?: boolean;
  sortOrder?: number;
}

export interface RecipeDraftInput {
  serviceId: string;
  branchId?: string | null;   // null = tenant-wide default
  source?: RecipeSource;
  effectiveDate?: string | null;
  notes?: string | null;
  lines: RecipeLineInput[];
}

/** Structural validation. Returns a human-readable error, or null when valid. Never throws. */
export function validateDraft(input: RecipeDraftInput): string | null {
  if (!input.serviceId) return 'serviceId is required';
  if (!Array.isArray(input.lines) || input.lines.length === 0) return 'A recipe must have at least one supply line';
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!l.productId) return 'Each line needs a productId';
    if (seen.has(l.productId)) return `Duplicate supply in recipe: ${l.productId}`;
    seen.add(l.productId);
    if (!(typeof l.expectedQuantity === 'number') || Number.isNaN(l.expectedQuantity) || l.expectedQuantity < 0) {
      return `expectedQuantity must be a non-negative number for ${l.productId}`;
    }
    if (!l.consumptionUnit || !l.consumptionUnit.trim()) return `consumptionUnit is required for ${l.productId}`;
    const waste = l.wasteAllowancePct ?? 0;
    if (waste < 0 || waste > 100) return `wasteAllowancePct must be between 0 and 100 for ${l.productId}`;
  }
  return null;
}

/** Only drafts can be approved. */
export function canApprove(status: RecipeStatus): boolean {
  return status === 'draft';
}

/** Draft or approved recipes can be archived; already-archived cannot. */
export function canArchive(status: RecipeStatus): boolean {
  return status !== 'archived';
}

/** Next version = 1 + the highest existing version for the same (service, branch scope). */
export function nextVersion(existingVersions: number[]): number {
  return existingVersions.length === 0 ? 1 : Math.max(...existingVersions) + 1;
}

/** Stable scope key folding the tenant-wide default (null branch) into a sentinel — mirrors the DB unique index. */
export function scopeKey(branchId: string | null | undefined): string {
  return branchId ?? '00000000-0000-0000-0000-000000000000';
}
