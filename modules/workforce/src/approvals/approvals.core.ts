// approvals.core.ts — BUILD_PLAN Phase 9 (Constitution 2): the pure half of the salon's ONE approvals engine — the kinds, the
// per-kind default policies (Kevin's open decision 3: refund cash $50 / any $200 = today's env values), who may decide a
// request (and the reason they may not), when an amount needs approval, and input validation. No I/O.
//
// The two policy handlers the contract names (`requester-not-approver`, `amount-within-limit`) are the authorization core's
// typed handlers (packages/permissions/src/policies.ts); the two functions below only adapt them to this engine's facts
// (separation applies when the request says so; the limit applies to an amount, for a decider without the unlimited key).
import type { ApprovalCreateRequest, ApprovalPolicyView, TenantApprovalKind, TenantApprovalStatus } from '@aipowersalon/api-contracts/tenant';
import { hasPermission, requesterNotApprover as requesterNotApproverPolicy, amountWithinLimit as amountWithinLimitPolicy } from '@aipowersalon/permissions';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export const APPROVAL_KINDS: readonly TenantApprovalKind[] = ['refund', 'void', 'discount_override', 'deal_publish', 'purchase_order', 'price_override', 'payout_adjustment', 'other'];
export const APPROVAL_STATUSES: readonly TenantApprovalStatus[] = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'execution_failed'];
/** A request is LIVE (blocks a second one for the same subject) while pending or approved-but-not-yet-executed. */
export const LIVE_STATUSES: readonly TenantApprovalStatus[] = ['pending', 'approved'];
/** Holders of this key are never capped by a policy's approver limit (owners by default). */
export const UNLIMITED_APPROVER_KEY = 'approvals.manage_policies';
export const MIN_POLICY_REASON = 5;
export const MAX_REASON = 500;

export class ApprovalError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string, public readonly extra?: Record<string, unknown>) { super(message); this.name = 'ApprovalError'; }
}

export interface ApprovalActor { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] }

/** The full policy as stored (the wire view + the two extra numbers). */
export interface ApprovalPolicy extends ApprovalPolicyView {
  cashThresholdCents: number | null;     // refund only: the lower limit for cash
  approverLimitCents: number | null;     // an approver WITHOUT approvals.manage_policies may approve up to this (null = no cap)
  label: string;
}

const KIND_LABEL: Record<TenantApprovalKind, string> = {
  refund: 'Refund over the limit', void: 'Void', discount_override: 'Discount override', deal_publish: 'Deal for customers',
  purchase_order: 'Purchase order', price_override: 'Price override', payout_adjustment: 'Payout adjustment', other: 'Other request',
};
/** What an approver must hold, per kind — FIXED (not a salon setting): the same key the action itself needs today. */
export const APPROVER_PERMISSION: Record<TenantApprovalKind, string> = {
  refund: 'checkout.approve_refund',
  void: 'checkout.approve_refund',
  discount_override: 'checkout.manage_overrides',
  price_override: 'checkout.manage_overrides',
  deal_publish: 'marketing.manage',
  purchase_order: 'inventory.purchase_order.approve',
  payout_adjustment: 'payroll.manage',
  other: 'approvals.decide',
};

/** Today's refund limits (env, else $50 cash / $200 any) — the salon default until the owner changes them. */
export function envRefundThresholds(env: NodeJS.ProcessEnv = process.env): { cashCents: number; anyCents: number } {
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isInteger(x) && x >= 0 ? x : d; };
  return { cashCents: n(env.REFUND_CASH_MANAGER_THRESHOLD_CENTS, 5_000), anyCents: n(env.REFUND_MANAGER_THRESHOLD_CENTS, 20_000) };
}

/** The policy a salon has when it never saved one (version 0). Behaviour-preserving: deals and purchase orders keep
 *  today's "the same manager may submit and approve" (requireDifferentApprover false — a one-owner salon is never locked
 *  out of its own deals); refunds are maker/checker by nature (the requester lacks the approve key). */
export function defaultPolicy(kind: TenantApprovalKind, env: NodeJS.ProcessEnv = process.env): ApprovalPolicy {
  const base = { kind, enabled: true, thresholdCents: null as number | null, cashThresholdCents: null as number | null, approverLimitCents: null as number | null,
    approverPermission: APPROVER_PERMISSION[kind], requireDifferentApprover: true, expiresAfterHours: 24, version: 0, label: KIND_LABEL[kind] };
  if (kind === 'refund') { const t = envRefundThresholds(env); return { ...base, thresholdCents: t.anyCents, cashThresholdCents: t.cashCents }; }
  if (kind === 'deal_publish' || kind === 'purchase_order') return { ...base, requireDifferentApprover: false, expiresAfterHours: 72 };
  return base;
}

export function isKind(k: unknown): k is TenantApprovalKind { return typeof k === 'string' && (APPROVAL_KINDS as readonly string[]).includes(k); }

/** Does this amount need an approver under the policy? Disabled → never. No threshold → always. Else strictly over it
 *  (cash refunds also against the lower cash limit). */
export function amountNeedsApproval(p: Pick<ApprovalPolicy, 'enabled' | 'thresholdCents' | 'cashThresholdCents'>, amountCents: number | null, method?: string | null): boolean {
  if (!p.enabled) return false;
  if (p.thresholdCents == null) return true;
  const a = Math.max(0, Number(amountCents ?? 0));
  if (String(method || '').toLowerCase() === 'cash' && p.cashThresholdCents != null && a > p.cashThresholdCents) return true;
  return a > p.thresholdCents;
}

// ── the two typed policy handlers (facts in → reason code or null) ───────────────────────────────────────────────────
/** `requester-not-approver`: when the request says so, the person who asked can never decide. */
export function requesterNotApprover(f: { requestedByUserId: string; approverUserId: string; requireDifferentApprover: boolean }): 'requester_cannot_approve' | null {
  if (!f.requireDifferentApprover) return null;
  return requesterNotApproverPolicy({ userId: f.approverUserId }, { requestedByUserId: f.requestedByUserId }).ok ? null : 'requester_cannot_approve';
}
/** `amount-within-limit`: an approver without the unlimited key may approve only up to the policy's limit. */
export function amountWithinLimit(f: { amountCents: number | null; limitCents: number | null; unlimited: boolean }): 'over_your_limit' | null {
  if (f.unlimited || f.limitCents == null || f.amountCents == null) return null;
  return amountWithinLimitPolicy({ userId: '' }, { amountCents: f.amountCents, limitCents: f.limitCents }).ok ? null : 'over_your_limit';
}

export interface DecidableFacts {
  status: TenantApprovalStatus; expiresAt: string | null; requestedByUserId: string; requiredPermission: string;
  requireDifferentApprover: boolean; amountCents: number | null;
}
/** Why THIS actor may not decide THIS request (null = they may). Order: state → expiry → separation → key → limit. */
export function whyCannotDecide(r: DecidableFacts, actor: Pick<ApprovalActor, 'userId' | 'role' | 'permissions'>, limitCents: number | null, nowMs = Date.now()): string | null {
  if (r.status !== 'pending') return 'not_pending';
  if (r.expiresAt && Date.parse(r.expiresAt) <= nowMs) return 'expired';
  const sep = requesterNotApprover({ requestedByUserId: r.requestedByUserId, approverUserId: actor.userId, requireDifferentApprover: r.requireDifferentApprover });
  if (sep) return sep;
  const ctx = { role: actor.role as any, permissions: [...actor.permissions] } as any;
  if (!hasPermission(ctx, r.requiredPermission)) return 'missing_permission';
  return amountWithinLimit({ amountCents: r.amountCents, limitCents, unlimited: hasPermission(ctx, UNLIMITED_APPROVER_KEY) });
}

const WHY_TEXT: Record<string, string> = {
  not_pending: 'This request has already been decided.',
  expired: 'This request has expired.',
  requester_cannot_approve: 'You asked for this — someone else has to approve it.',
  missing_permission: 'You do not have the permission this approval needs.',
  over_your_limit: 'This amount is over your approval limit — the owner has to approve it.',
};
export function whyText(code: string): string { return WHY_TEXT[code] ?? 'You cannot decide this request.'; }

export interface CleanCreate { kind: TenantApprovalKind; subjectType: string; subjectId: string | null; amountCents: number | null; reason: string; payload: Record<string, unknown>; branchId: string | null; title: string | null }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Validate a create body (400 invalid_input naming the field). The branch is the caller's unless a valid uuid is given. */
export function cleanCreate(b: Partial<ApprovalCreateRequest> & { title?: string | null } | null | undefined, actorBranch: string | null): CleanCreate {
  const bad = (field: string, message: string) => new ApprovalError('invalid_input', 400, message, { field });
  if (!b || typeof b !== 'object') throw bad('body', 'A request body is required.');
  if (!isKind(b.kind)) throw bad('kind', 'Unknown approval kind.');
  const subjectType = String(b.subjectType ?? '').trim();
  if (!subjectType || subjectType.length > 60 || !/^[a-z][a-z0-9_]*$/.test(subjectType)) throw bad('subjectType', 'subjectType must be a short lowercase name.');
  const subjectId = b.subjectId == null || b.subjectId === '' ? null : String(b.subjectId).trim();
  if (subjectId != null && (subjectId.length > 100 || /\s/.test(subjectId))) throw bad('subjectId', 'subjectId is not valid.');
  let amountCents: number | null = null;
  if (b.amountCents != null) { const a = Number(b.amountCents); if (!Number.isSafeInteger(a) || a < 0) throw bad('amountCents', 'amountCents must be a whole, non-negative number of cents.'); amountCents = a; }
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 3) throw bad('reason', 'Say why (at least 3 characters).');
  if (reason.length > MAX_REASON) throw bad('reason', `The reason is too long (max ${MAX_REASON}).`);
  const payload = b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload) ? (b.payload as Record<string, unknown>) : {};
  if (Buffer.byteLength(JSON.stringify(payload)) > 8_192) throw bad('payload', 'The request details are too large.');
  const branchId = b.branchId && UUID_RE.test(String(b.branchId)) ? String(b.branchId) : (actorBranch && UUID_RE.test(actorBranch) ? actorBranch : null);
  const title = b.title == null ? null : String(b.title).trim().slice(0, 140) || null;
  return { kind: b.kind, subjectType, subjectId, amountCents, reason, payload, branchId, title };
}

export interface CleanPolicyChange {
  kind: TenantApprovalKind; expectedVersion: number; reason: string;
  enabled?: boolean; thresholdCents?: number | null; cashThresholdCents?: number | null; approverLimitCents?: number | null;
  requireDifferentApprover?: boolean; expiresAfterHours?: number;
}
/** Validate a policy change. A refund policy can never be switched off (Constitution 12 M9 — large refunds always need
 *  an approver; the owner may move the limits, not remove them). */
export function cleanPolicyChange(b: any): CleanPolicyChange {
  const bad = (field: string, message: string) => new ApprovalError('invalid_input', 400, message, { field });
  if (!b || typeof b !== 'object') throw bad('body', 'A request body is required.');
  if (!isKind(b.kind)) throw bad('kind', 'Unknown approval kind.');
  const ev = Number(b.expectedVersion);
  if (!Number.isInteger(ev) || ev < 0) throw bad('expectedVersion', 'expectedVersion is required.');
  const reason = String(b.reason ?? '').trim();
  if (reason.length < MIN_POLICY_REASON) throw bad('reason', `Say why you are changing this (at least ${MIN_POLICY_REASON} characters).`);
  const out: CleanPolicyChange = { kind: b.kind, expectedVersion: ev, reason: reason.slice(0, MAX_REASON) };
  const cents = (k: string) => {
    if (!(k in b)) return undefined;
    if (b[k] === null) return null;
    const v = Number(b[k]); if (!Number.isSafeInteger(v) || v < 0) throw bad(k, `${k} must be a whole, non-negative number of cents (or null).`);
    return v;
  };
  if ('enabled' in b) { if (typeof b.enabled !== 'boolean') throw bad('enabled', 'enabled must be true or false.'); out.enabled = b.enabled; }
  if (out.enabled === false && b.kind === 'refund') throw withCode(new ApprovalError('policy_required', 400, 'Refunds over the limit always need an approver — change the limits instead.', { field: 'enabled' }), 'REFUND_APPROVER_ALWAYS');
  const t = cents('thresholdCents'); if (t !== undefined) out.thresholdCents = t;
  const c = cents('cashThresholdCents'); if (c !== undefined) { if (b.kind !== 'refund' && c !== null) throw bad('cashThresholdCents', 'Only a refund policy has a cash limit.'); out.cashThresholdCents = c; }
  const l = cents('approverLimitCents'); if (l !== undefined) out.approverLimitCents = l;
  if (b.kind === 'refund' && out.thresholdCents === null) throw bad('thresholdCents', 'A refund policy needs a limit.');
  if ('requireDifferentApprover' in b) { if (typeof b.requireDifferentApprover !== 'boolean') throw bad('requireDifferentApprover', 'requireDifferentApprover must be true or false.'); out.requireDifferentApprover = b.requireDifferentApprover; }
  if ('expiresAfterHours' in b) { const h = Number(b.expiresAfterHours); if (!Number.isInteger(h) || h < 1 || h > 720) throw bad('expiresAfterHours', 'expiresAfterHours must be between 1 and 720.'); out.expiresAfterHours = h; }
  return out;
}

/** The decide body: approve / reject (+ note — required to reject), expectedVersion. */
export function cleanDecision(b: any): { decision: 'approve' | 'reject'; note: string | null; expectedVersion: number } {
  const bad = (field: string, message: string) => new ApprovalError('invalid_input', 400, message, { field });
  if (!b || typeof b !== 'object') throw bad('body', 'A request body is required.');
  if (b.decision !== 'approve' && b.decision !== 'reject') throw bad('decision', "decision must be 'approve' or 'reject'.");
  const ev = Number(b.expectedVersion);
  if (!Number.isInteger(ev) || ev < 1) throw bad('expectedVersion', 'expectedVersion is required.');
  const note = b.note == null ? null : String(b.note).trim().slice(0, MAX_REASON) || null;
  if (b.decision === 'reject' && !note) throw bad('note', 'Say why you are rejecting it.');
  return { decision: b.decision, note, expectedVersion: ev };
}
