// surcharge-enrollment.ts (platform realm) — Fiserv master build §9.2: Super Admin records what FISERV enrolled in the
// Merchant Surcharge Program for a merchant (rate fixed per MID, 1.00%–3.00%, with Fiserv's written reference), or
// withdraws it. Server: super-admin-merchant-accounts (POST /super-admin/merchant-accounts/:tenantId/surcharge-enrollment).
export interface SurchargeEnrollmentResult { ok: true; enrolled: boolean; rateBps: number | null; branchId: string | null }
