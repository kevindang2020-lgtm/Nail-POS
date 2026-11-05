// super-admin-deals.ts — BUILD_PLAN Phase 5: Super Admin → Deals Oversight (GET /super-admin/deals). One row per deal
// across salons, with the suspension (reason, when) and the cap/budget use.
export interface AdminDealRow {
  id: string; tenantId: string; salonName: string | null; title: string; ownerType: string; kind: string; status: string; redemptionCount: number;
  createdAt: string | null; suspendedReason: string | null; suspendedAt: string | null; discountType: string; discountPercent: number | null;
  discountCents: number | null; maxRedemptions: number | null; budgetCents: number | null; budgetReservedCents: number; endsAt: string | null;
}
