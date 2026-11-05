// refund-approval.ts — Constitution 12 §93, §180 (finding M9): large and cash refunds need more than routine authority.
//
// WHAT WAS THERE. `pos.checkout.refund` collapses to the coarse capability `checkout.process_payment` — the SAME one
// that lets a front-desk employee take a payment. So anyone at the counter could refund any payment in full with
// nothing but a typed reason. For a card, the money returns to the customer's card, which limits harm. For CASH it is
// the classic salon insider fraud: refund a cash sale, take the cash from the drawer.
//
// THE RULE. The CUMULATIVE amount refunded on one payment (prior refunds + this one) may not pass a threshold unless
// the person refunding holds `checkout.approve_refund` — owners and managers. Cumulative, so ten $49 refunds cannot
// walk past a $50 limit. Evaluated INSIDE the reservation's advisory lock, alongside the existing over-refund cap, so
// two concurrent under-limit refunds cannot pass together. Defaults: cash over $50, any method over $200; both
// configurable. Below them, front desk refunds exactly as before.
//
// HONEST SCOPE: this is role step-up — the manager must perform the refund signed in as themselves. It is not a
// second-person approval PIN at the counter; the POS has no such mechanism, and building one needs new screens.
// Splitting across many PAYMENTS is fraud-pattern territory (Phase 17), not this per-payment rule.
export const APPROVE_REFUND_CAPABILITY = 'checkout.approve_refund';

export interface RefundThresholds { cashCents: number; anyCents: number }
export function refundThresholds(env: NodeJS.ProcessEnv = process.env): RefundThresholds {
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isInteger(x) && x >= 0 ? x : d; };
  return { cashCents: n(env.REFUND_CASH_MANAGER_THRESHOLD_CENTS, 5_000), anyCents: n(env.REFUND_MANAGER_THRESHOLD_CENTS, 20_000) };
}

/** Pure. True when this refund, added to what was already refunded on the payment, needs an approver. */
export function refundNeedsApprover(method: string | null | undefined, alreadyRefundedCents: number, amountCents: number, t: RefundThresholds): boolean {
  const cumulative = alreadyRefundedCents + amountCents;
  if (String(method || '').toLowerCase() === 'cash' && cumulative > t.cashCents) return true;
  return cumulative > t.anyCents;
}

// ── BUILD_PLAN Phase 9 (Constitution 2): the salon approvals engine ──────────────────────────────────────────────────
// The HONEST-SCOPE note above is closed: a refund past the limit by someone WITHOUT checkout.approve_refund is no longer a
// 403 — it is SENT FOR APPROVAL (a request in the salon's one approvals engine, modules/workforce approvals); an approver
// (manager / owner, within their limit, never the person who asked) approves it on the POS Approvals screen or in the
// Owner App, and the engine runs the refund through this same canonical path, as the approver, exactly once. The limits
// are the SALON's (its refund policy — Kevin's decision 3: default = the env values above); without the engine in the
// process (a module test, a worker) the env limits and the 403 stand exactly as before.
//
// This is the narrow port the checkout module injects (string token 'TENANT_APPROVALS', @Optional) — structural, so
// checkout does not import the workforce module's internals.
export const TENANT_APPROVALS_TOKEN = 'TENANT_APPROVALS';
export interface RefundApprovalActor { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] }
export interface RefundApprovalsPort {
  registerExecutor(kind: 'refund', executor: {
    prepare?(actor: RefundApprovalActor, input: { subjectType: string; subjectId: string | null; amountCents: number | null; reason: string; payload: Record<string, unknown> }): Promise<Record<string, unknown>>;
    execute(actor: RefundApprovalActor, request: { id: string; subjectId: string | null; payload: Record<string, unknown>; requestedByUserId: string; branchId: string | null }): Promise<Record<string, unknown> | void>;
  }): void;
  policy(tenantId: string, kind: 'refund'): Promise<{ enabled: boolean; thresholdCents: number | null; cashThresholdCents: number | null }>;
  request(actor: RefundApprovalActor, body: unknown): Promise<{ request: { id: string; expiresAt: string | null; status: string }; created: boolean }>;
}
/** The salon's refund limits from its policy (the env defaults when the policy carries none). */
export function thresholdsFromPolicy(p: { thresholdCents: number | null; cashThresholdCents: number | null } | null | undefined, env: NodeJS.ProcessEnv = process.env): RefundThresholds {
  const d = refundThresholds(env);
  if (!p) return d;
  const any = p.thresholdCents ?? d.anyCents;
  return { anyCents: any, cashCents: p.cashThresholdCents ?? Math.min(d.cashCents, any) };
}
