// loyalty-idempotency.ts — extras GLOBAL LOYALTY REWARDS 11 (round 10): the Super Admin's read-only idempotency conflict
// center (GET super-admin/loyalty-network/idempotency). One row per repeated rewards request key: a 'replay' (the same
// request again, answered with the first result — no second side effect) or a 'conflict' (the key reused for a different
// request — refused). The key is shown by its last 8 characters only.
export interface RewardsIdempotencyEvent {
  id: string; tenantId: string; salon: string | null; scope: 'token_purchase' | 'redemption' | string; outcome: 'replay' | 'conflict' | string;
  keyRef: string; resourceId: string | null; repeats: number; detail: Record<string, unknown>; at: string;
}
export interface RewardsIdempotencyPage { total: number; conflicts: number; page: number; pageSize: number; pageCount: number; items: RewardsIdempotencyEvent[] }
