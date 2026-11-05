// policies.ts — BUILD_PLAN Phase 9 (Constitution 2 §policy conditions): the typed POLICY HANDLERS a decision can carry
// beyond "does this principal hold the key". Before this every service hand-wrote its own condition (refund-approval.ts,
// deals.service.ts, okSameBranch with one caller); now the four conditions the salon actually needs are named, typed and
// tested once, and both `decide()` (decision.ts) and the services call the same functions.
//
//   same-branch             the record belongs to a branch the principal may act in (null = a tenant-wide record)
//   own-record              the record is the principal's own (a technician's own ticket, a requester's own request)
//   requester-not-approver  separation of duties: whoever asked for something cannot be the one who approves it
//   amount-within-limit     an amount (cents) is within the principal's limit (null limit = no limit)
//
// Pure: no I/O, no Nest. A policy never grants anything — it can only turn an otherwise-allowed decision into a denial
// with reason `policy_denied` and the policy's name in `detail`.

/** The facts a policy reads about the acting principal (a subset of AuthzPrincipal — kept structural on purpose). */
export interface PolicyPrincipal {
  userId: string;
  branchId?: string | null;
  /** The branches this principal may act in; null / undefined = every branch of the salon (TENANT scope). */
  branchIds?: readonly string[] | null;
}

export type PolicyResult = { ok: true } | { ok: false; detail: string };
const OK: PolicyResult = { ok: true };

export interface SameBranchInput { branchId: string | null | undefined }
export interface OwnRecordInput { ownerUserId: string | null | undefined }
export interface RequesterNotApproverInput { requestedByUserId: string | null | undefined }
export interface AmountWithinLimitInput { amountCents: number | null | undefined; limitCents: number | null | undefined }

/** The record's branch is one this principal may act in. A null branch is a tenant-wide record (always in scope). */
export function sameBranch(p: PolicyPrincipal, input: SameBranchInput): PolicyResult {
  const b = input?.branchId ?? null;
  if (b === null || b === '') return OK;
  if (p.branchIds === null || p.branchIds === undefined) {
    // TENANT scope: any branch of the salon. The tenant itself is checked by decide() before any policy runs.
    return OK;
  }
  if (p.branchIds.includes(b)) return OK;
  if (p.branchIds.length === 0 && p.branchId && p.branchId === b) return OK;
  return { ok: false, detail: 'record_in_other_branch' };
}

/** The record belongs to the acting principal. An unknown owner is NOT the principal's (fail closed). */
export function ownRecord(p: PolicyPrincipal, input: OwnRecordInput): PolicyResult {
  const o = input?.ownerUserId ?? null;
  return o !== null && o !== '' && o === p.userId ? OK : { ok: false, detail: 'not_own_record' };
}

/** Separation of duties: the person who asked may not approve. An unknown requester is treated as a conflict. */
export function requesterNotApprover(p: PolicyPrincipal, input: RequesterNotApproverInput): PolicyResult {
  const r = input?.requestedByUserId ?? null;
  if (r === null || r === '') return { ok: false, detail: 'requester_unknown' };
  return r === p.userId ? { ok: false, detail: 'requester_cannot_approve' } : OK;
}

/** The amount is within the limit. A null limit means "no limit"; a missing / negative / non-integer amount is refused. */
export function amountWithinLimit(_p: PolicyPrincipal, input: AmountWithinLimitInput): PolicyResult {
  const a = input?.amountCents;
  if (typeof a !== 'number' || !Number.isFinite(a) || a < 0 || !Number.isInteger(a)) return { ok: false, detail: 'amount_invalid' };
  const l = input?.limitCents;
  if (l === null || l === undefined) return OK;
  return a <= l ? OK : { ok: false, detail: 'over_your_limit' };
}

export const POLICY_HANDLERS = {
  'same-branch': sameBranch,
  'own-record': ownRecord,
  'requester-not-approver': requesterNotApprover,
  'amount-within-limit': amountWithinLimit,
} as const;
export type PolicyName = keyof typeof POLICY_HANDLERS;
type InputOf<N extends PolicyName> = Parameters<(typeof POLICY_HANDLERS)[N]>[1];

/** A policy bound to its input, ready to hand to decide(). */
export interface AuthzPolicyCheck { name: PolicyName; check(p: PolicyPrincipal): PolicyResult }

/** Bind a named policy to its input: `policy('requester-not-approver', { requestedByUserId })`. */
export function policy<N extends PolicyName>(name: N, input: InputOf<N>): AuthzPolicyCheck {
  const handler = POLICY_HANDLERS[name] as (p: PolicyPrincipal, i: InputOf<N>) => PolicyResult;
  return { name, check: (p) => handler(p, input) };
}

/** Run bound policies in order; the first failure wins. */
export function runPolicies(p: PolicyPrincipal, checks: readonly AuthzPolicyCheck[] | undefined): { ok: true } | { ok: false; name: PolicyName; detail: string } {
  for (const c of checks ?? []) {
    const r = c.check(p);
    if (!r.ok) return { ok: false, name: c.name, detail: r.detail };
  }
  return { ok: true };
}
