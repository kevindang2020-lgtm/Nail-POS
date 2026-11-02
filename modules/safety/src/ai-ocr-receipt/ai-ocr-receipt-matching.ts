// ai-ocr-receipt-matching.ts — PURE advisory matching against the tenant's own catalogs (inventory_vendors,
// inventory_categories, products). Every result is a SUGGESTION: nothing here confirms, merges, applies a category, or
// receives inventory. A human confirms in review. No weak AI similarity is ever auto-committed. All matching is over
// same-tenant candidates the caller supplies, so nothing crosses tenants.
import { normalizeVendor } from './ai-ocr-receipt-dedup';

/** Token Jaccard similarity with a small prefix bonus (deterministic, 0..1). */
export function stringSimilarity(a: string | null, b: string | null): number {
  const na = normalizeVendor(a), nb = normalizeVendor(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ').filter(Boolean)), tb = new Set(nb.split(' ').filter(Boolean));
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union ? inter / union : 0;
  const prefixBonus = na.startsWith(nb) || nb.startsWith(na) ? 0.1 : 0;
  return Math.min(1, Math.round((jaccard + prefixBonus) * 100) / 100);
}

// ── vendor matching ──────────────────────────────────────────────────────────
export type VendorMatchStatus = 'exact' | 'strong' | 'multiple' | 'new' | 'unknown';
export interface VendorCandidate { vendorId: string; name: string; }
export interface VendorMatchResult { status: VendorMatchStatus; matches: { vendorId: string; name: string; score: number }[]; confirmed: false; }

export function matchVendor(extracted: string | null, candidates: VendorCandidate[]): VendorMatchResult {
  if (!extracted || !extracted.trim()) return { status: 'unknown', matches: [], confirmed: false };
  const scored = candidates.map((c) => ({ vendorId: c.vendorId, name: c.name, score: stringSimilarity(extracted, c.name) }))
    .filter((m) => m.score >= 0.5).sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: 'new', matches: [], confirmed: false };            // suggest creating a new vendor
  let status: VendorMatchStatus;
  if (scored[0].score >= 0.95) status = 'exact';
  else if (scored.length === 1) status = 'strong';                                         // single probable match
  else if (scored[0].score - scored[1].score >= 0.2) status = 'strong';                    // one clear leader
  else status = 'multiple';                                                                // comparable candidates → a human picks
  return { status, matches: scored.slice(0, 5), confirmed: false };
}

// ── category suggestion ──────────────────────────────────────────────────────
export interface CategoryCandidate { categoryId: string; name: string; keywords?: string[]; }
export interface CategorySuggestion { categoryId: string | null; name: string; score: number; reason: string; source: 'history' | 'keyword' | 'ai'; }
export interface CategoryResult { suggestions: CategorySuggestion[]; requiresReview: true; }

/** Deterministic baseline: prior vendor→category history wins, then keyword hits. An AI suggestion can be appended by the
 *  caller but is still advisory. Never auto-applies. */
export function suggestCategory(input: { vendor: string | null; lineText: string | null }, ctx: { vendorHistory?: { vendor: string; categoryId: string; name: string }[]; categories: CategoryCandidate[]; aiSuggestion?: CategorySuggestion | null }): CategoryResult {
  const suggestions: CategorySuggestion[] = [];
  // 1) vendor→category history (strongest deterministic signal)
  if (input.vendor && ctx.vendorHistory) {
    const hist = ctx.vendorHistory.find((h) => stringSimilarity(input.vendor, h.vendor) >= 0.9);
    if (hist) suggestions.push({ categoryId: hist.categoryId, name: hist.name, score: 0.85, reason: 'prior_vendor_mapping', source: 'history' });
  }
  // 2) keyword hits on category definitions
  const text = `${input.vendor ?? ''} ${input.lineText ?? ''}`.toLowerCase();
  for (const c of ctx.categories) {
    const hit = (c.keywords ?? []).some((k) => text.includes(k.toLowerCase()));
    if (hit && !suggestions.some((s) => s.categoryId === c.categoryId)) suggestions.push({ categoryId: c.categoryId, name: c.name, score: 0.6, reason: 'keyword_match', source: 'keyword' });
  }
  // 3) optional AI suggestion (advisory, ranked below deterministic history)
  if (ctx.aiSuggestion && !suggestions.some((s) => s.categoryId === ctx.aiSuggestion!.categoryId)) suggestions.push({ ...ctx.aiSuggestion, source: 'ai' });
  suggestions.sort((a, b) => b.score - a.score);
  return { suggestions, requiresReview: true };
}

// ── inventory matching ───────────────────────────────────────────────────────
export type InventoryMatchStatus = 'exact' | 'probable' | 'multiple' | 'new' | 'non_inventory';
export interface ProductCandidate { productId: string; name: string; sku?: string | null; upc?: string | null; }
export interface InventoryLineInput { description: string | null; sku?: string | null; upc?: string | null; }
export interface InventoryMatchResult { status: InventoryMatchStatus; matches: { productId: string; name: string; score: number }[]; confirmed: false; }

export function matchInventoryLine(line: InventoryLineInput, products: ProductCandidate[]): InventoryMatchResult {
  // exact code match first (SKU/UPC)
  const codeHit = products.filter((p) => (line.sku && p.sku && p.sku === line.sku) || (line.upc && p.upc && p.upc === line.upc));
  if (codeHit.length === 1) return { status: 'exact', matches: [{ productId: codeHit[0].productId, name: codeHit[0].name, score: 1 }], confirmed: false };
  if (codeHit.length > 1) return { status: 'multiple', matches: codeHit.map((p) => ({ productId: p.productId, name: p.name, score: 0.9 })), confirmed: false };
  // description similarity
  if (!line.description || !line.description.trim()) return { status: 'non_inventory', matches: [], confirmed: false };
  const scored = products.map((p) => ({ productId: p.productId, name: p.name, score: stringSimilarity(line.description, p.name) }))
    .filter((m) => m.score >= 0.5).sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: 'new', matches: [], confirmed: false };             // suggest a new item (human decides)
  const strong = scored.filter((m) => m.score >= 0.75);
  if (strong.length === 1) return { status: 'probable', matches: scored.slice(0, 5), confirmed: false };
  return { status: 'multiple', matches: scored.slice(0, 5), confirmed: false };
}
