// plan-links.ts — Super Admin: salons whose subscription plan is not linked to a feature-catalogue plan, and the link
// result (batch 8 decision 3, Nov 9 2026). Types only — the ONE definition, read by the API and the admin web.
export interface UnlinkedTenant { tenantId: string; tenantName: string | null; tenantCode: string | null; planText: string; status: string; subscriptionId: string }
export interface CatalogPlanOption { code: string; name: string; status: string }
export interface UnlinkedTenantsResponse { tenants: UnlinkedTenant[]; plans: CatalogPlanOption[] }
export interface PlanLinkResult { tenantId: string; planCode: string; planText: string }
