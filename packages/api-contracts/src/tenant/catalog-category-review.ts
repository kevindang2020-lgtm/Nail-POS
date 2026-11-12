// catalog-category-review.ts — SERVICE PRICING 13 (Nov 12 2026): Owner Review for Suspicious Categories.
// POST /pos/catalog/categories/:categoryId/review — approve a Service Categories review finding as is, or reopen it.
// Nothing in the catalog changes; the decision is append-only and tied to the original ids and names.
export type CategoryReviewKind = 'code_like_name' | 'service_category_mismatch' | 'empty';
export interface CategoryReviewDecisionRequest { kind: CategoryReviewKind; serviceId?: string | null; decision: 'approve' | 'reopen'; note: string }
export interface CategoryReviewDecisionView { decision: 'approved_as_is' | 'reopened'; note: string; by: string | null; at: string }
export interface CategoryReviewItem {
  kind: CategoryReviewKind; categoryId: string; categoryName: string; serviceId?: string; serviceName?: string;
  status: 'open' | 'approved'; lastDecision: CategoryReviewDecisionView | null;
}
export interface CategoryReviewDecisionResponse { item: CategoryReviewItem; history: CategoryReviewDecisionView[]; changesCatalog: false }
