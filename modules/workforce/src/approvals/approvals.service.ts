// approvals.service.ts — BUILD_PLAN Phase 9 (Constitution 2): the salon's ONE approvals engine, on the platform_approvals
// pattern (470 / modules/platform platform-approvals.ts) but per salon:
//
//   request  → a row (pending), its history, an audit line and approval.requested in the outbox — one transaction. One LIVE
//              request per kind + subject (the partial unique index): asking twice returns the request already open.
//   decide   → approve / reject; a compare-and-set on `version` under FOR UPDATE (two approvers at once → one decision, the
//              other 409 version_conflict); the decider must hold the kind's approver key, may not be the requester when the
//              request says so (`requester-not-approver`) and must be within the policy's approver limit unless they hold
//              approvals.manage_policies (`amount-within-limit`); a branch-confined decider only sees / decides their branch.
//   execute  → an approved request whose kind has a registered EXECUTOR (refund → checkout, deal_publish → deals,
//              purchase_order → inventory) runs it ONCE: execution_claimed_at is claimed by a guarded UPDATE before the
//              executor runs, so a retry, a second process or a double click can never run it twice (at-most-once; a
//              failure is recorded as execution_failed with the error — never retried behind anyone's back).
//   cancel   → the requester withdraws a pending request.
//   expire   → pending past expires_at → expired (lazily on read / decide, and by the expiry job).
//
// Policies are per salon and per kind, versioned (CAS on expectedVersion), every change kept in
// tenant_approval_policy_changes + audited; the route needs approvals.manage_policies and a step-up. No row = the code
// defaults (approvals.core defaultPolicy — Kevin's decision 3). Realtime is the projection consumer's job: every state
// change writes an approval.* domain event; nothing here emits to a socket.
import { sql, type Kysely } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type DomainEventType, type OutboxWriter } from '@aipowersalon/events';
import { hasPermission } from '@aipowersalon/permissions';
import type { ApprovalCreateResult, ApprovalPage, ApprovalPolicyDetail, ApprovalRequestView, TenantApprovalKind, TenantApprovalStatus } from '@aipowersalon/api-contracts/tenant';
import {
  APPROVAL_KINDS, APPROVAL_STATUSES, ApprovalError, UNLIMITED_APPROVER_KEY, amountNeedsApproval, cleanCreate, cleanDecision, cleanPolicyChange,
  defaultPolicy, isKind, whyCannotDecide, whyText, type ApprovalActor, type ApprovalPolicy, type CleanCreate,
  APPROVAL_GUARDRAILS_SETTING, BASELINE_GUARDRAILS, applyGuardrail, cleanEscalation, guardrailViolation, mergeGuardrails, parseGuardrails, type ApprovalGuardrails,
} from './approvals.core';
import { canMoveToSql } from '@aipowersalon/database';
import { APPROVAL_REQUEST } from '../workforce-lifecycles';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export const TENANT_APPROVALS = 'TENANT_APPROVALS';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (x: unknown): string | null => (typeof x === 'string' && UUID_RE.test(x) ? x : null);

/** The stored request as executors see it. */
export interface ApprovalRecord {
  id: string; tenantId: string; branchId: string | null; kind: TenantApprovalKind; subjectType: string; subjectId: string | null;
  title: string; amountCents: number | null; payload: Record<string, unknown>; reason: string; requestedByUserId: string;
  status: TenantApprovalStatus; version: number; decisionNote: string | null;
}
/** What a domain registers for its kind. `execute` runs the approved action as the APPROVER (in the request's branch);
 *  `onReject` lets the domain react to a rejection (e.g. the deal goes to 'rejected' with the note). */
export interface ApprovalExecutor {
  /** Optional: validate + normalize a NEW request of this kind against the domain (the subject exists in this salon, the
   *  amount is possible, the payload is the canonical one — never the client's). Throws to refuse (400 / 403). */
  prepare?(actor: ApprovalActor, input: CleanCreate): Promise<Partial<Pick<CleanCreate, 'subjectType' | 'subjectId' | 'amountCents' | 'payload' | 'title' | 'branchId'>>>;
  execute(actor: ApprovalActor, request: ApprovalRecord): Promise<Record<string, unknown> | void>;
  onReject?(actor: ApprovalActor, request: ApprovalRecord, note: string | null): Promise<void>;
}

/** The narrow port domain modules inject (string token TENANT_APPROVALS — no package dependency, no module cycle). */
export interface TenantApprovalsPort {
  registerExecutor(kind: TenantApprovalKind, executor: ApprovalExecutor): void;
  policy(tenantId: string, kind: TenantApprovalKind): Promise<ApprovalPolicy>;
  needsApproval(tenantId: string, kind: TenantApprovalKind, amountCents: number | null, method?: string | null): Promise<boolean>;
  request(actor: ApprovalActor, body: unknown): Promise<ApprovalCreateResult>;
  liveFor(actor: ApprovalActor, kind: TenantApprovalKind, subjectType: string, subjectId: string): Promise<ApprovalRequestView | null>;
  decide(actor: ApprovalActor, id: string, body: unknown): Promise<ApprovalRequestView>;
}

type Db = Kysely<any>;
const iso = (d: unknown): string | null => (d == null ? null : new Date(d as any).toISOString());
const num = (v: unknown): number | null => (v == null ? null : Number(v));

function policyFromRow(kind: TenantApprovalKind, row: any | undefined): ApprovalPolicy {
  const d = defaultPolicy(kind);
  if (!row) return d;
  return { ...d, enabled: !!row.enabled, thresholdCents: num(row.threshold_cents), cashThresholdCents: num(row.cash_threshold_cents),
    approverLimitCents: num(row.approver_limit_cents), requireDifferentApprover: !!row.require_different_approver,
    expiresAfterHours: Number(row.expires_after_hours), version: Number(row.version) };
}
export const policyDetail = (p: ApprovalPolicy): ApprovalPolicyDetail => ({
  kind: p.kind, label: p.label, enabled: p.enabled, thresholdCents: p.thresholdCents, cashThresholdCents: p.cashThresholdCents,
  approverLimitCents: p.approverLimitCents, approverPermission: p.approverPermission, requireDifferentApprover: p.requireDifferentApprover,
  expiresAfterHours: p.expiresAfterHours, version: p.version,
});

function recordOf(r: any): ApprovalRecord {
  return { id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, kind: r.kind, subjectType: String(r.subject_type),
    subjectId: r.subject_id == null ? null : String(r.subject_id), title: String(r.title), amountCents: num(r.amount_cents), payload: (r.payload ?? {}) as Record<string, unknown>,
    reason: String(r.reason), requestedByUserId: String(r.requested_by_user_id), status: r.status, version: Number(r.version), decisionNote: r.decision_note ?? null };
}

export class TenantApprovalsService implements TenantApprovalsPort {
  private readonly executors = new Map<TenantApprovalKind, ApprovalExecutor>();
  constructor(private readonly db: Db | null, private readonly outbox: OutboxWriter | null, private readonly now: () => number = Date.now) {}

  private need(): Db { if (!this.db) throw new ApprovalError('approvals_unavailable', 503, 'Approvals need the database.'); return this.db; }

  registerExecutor(kind: TenantApprovalKind, executor: ApprovalExecutor): void { this.executors.set(kind, executor); }
  hasExecutor(kind: TenantApprovalKind): boolean { return this.executors.has(kind); }

  // ── policies ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** round 10 (Approvals 01 point 3): the rules a salon setting can never weaken — the code baseline merged with the Super
   *  Admin's platform_settings 'approvals.tenant_guardrails' (the stricter of each). */
  async guardrails(trx?: Db): Promise<ApprovalGuardrails> {
    if (!this.db) return BASELINE_GUARDRAILS;
    const r = await sql<{ value: unknown }>`select value from platform_settings where setting_key = ${APPROVAL_GUARDRAILS_SETTING} limit 1`.execute(trx ?? this.db);
    return mergeGuardrails(BASELINE_GUARDRAILS, parseGuardrails(r.rows[0]?.value ?? null));
  }
  /** The EFFECTIVE policy: the salon's saved rule (or the code default) read through the platform guardrail. Every caller —
   *  needsApproval, request, decide, the views — gets the guarded one, so a looser stored value never takes effect. */
  async policy(tenantId: string, kind: TenantApprovalKind, trx?: Db): Promise<ApprovalPolicy> {
    if (!this.db) return applyGuardrail(defaultPolicy(kind), BASELINE_GUARDRAILS[kind]).policy;
    const r = await sql<any>`select * from tenant_approval_policies where tenant_id = ${tenantId} and kind = ${kind} limit 1`.execute(trx ?? this.db);
    return applyGuardrail(policyFromRow(kind, r.rows[0]), (await this.guardrails(trx))[kind]).policy;
  }
  async policies(actor: ApprovalActor): Promise<ApprovalPolicyDetail[]> {
    const rows = this.db ? (await sql<any>`select * from tenant_approval_policies where tenant_id = ${actor.tenantId}`.execute(this.db)).rows : [];
    const g = await this.guardrails();
    return APPROVAL_KINDS.map((k) => { const a = applyGuardrail(policyFromRow(k, rows.find((x: any) => x.kind === k)), g[k]);
      return { ...policyDetail(a.policy), guardrail: g[k] ?? null, clampedByPlatform: a.clamped }; });
  }
  async needsApproval(tenantId: string, kind: TenantApprovalKind, amountCents: number | null, method?: string | null): Promise<boolean> {
    return amountNeedsApproval(await this.policy(tenantId, kind), amountCents, method);
  }

  /** CAS on expectedVersion (0 = the salon never saved this kind). Route: approvals.manage_policies + step-up. */
  async updatePolicy(actor: ApprovalActor, body: unknown): Promise<ApprovalPolicyDetail> {
    if (!hasPermission(actor as any, 'approvals.manage_policies')) throw withCode(new ApprovalError('forbidden', 403, 'Changing approval rules needs approvals.manage_policies.'), 'APPROVAL_POLICY_PERMISSION');
    const c = cleanPolicyChange(body);
    const db = this.need();
    const next = await db.transaction().execute(async (trx) => {
      const cur = await this.policy(actor.tenantId, c.kind, trx);
      if (cur.version !== c.expectedVersion) throw withCode(new ApprovalError('version_conflict', 409, 'Someone changed this rule — reload and try again.', { currentVersion: cur.version }), 'RECORD_CHANGED_RELOAD');
      const n: ApprovalPolicy = { ...cur,
        enabled: c.enabled ?? cur.enabled, thresholdCents: c.thresholdCents !== undefined ? c.thresholdCents : cur.thresholdCents,
        cashThresholdCents: c.cashThresholdCents !== undefined ? c.cashThresholdCents : cur.cashThresholdCents,
        approverLimitCents: c.approverLimitCents !== undefined ? c.approverLimitCents : cur.approverLimitCents,
        requireDifferentApprover: c.requireDifferentApprover ?? cur.requireDifferentApprover, expiresAfterHours: c.expiresAfterHours ?? cur.expiresAfterHours,
        version: cur.version + 1 };
      // round 10 (Approvals 01 point 3): a salon may be stricter than the platform, never looser — refused, not clamped silently
      const g = (await this.guardrails(trx))[c.kind]; const off = guardrailViolation(n, g);
      if (off) throw withCode(new ApprovalError('policy_below_platform', 409, 'The platform requires a stricter approval rule than this — a salon setting cannot loosen it.', { field: off.field, platformLimit: off.limit }), 'APPROVAL_POLICY_PLATFORM_FLOOR');
      if (c.kind === 'refund' && n.cashThresholdCents != null && n.thresholdCents != null && n.cashThresholdCents > n.thresholdCents) {
        throw withCode(new ApprovalError('invalid_input', 400, 'The cash limit cannot be higher than the limit for any refund.', { field: 'cashThresholdCents' }), 'CASH_LIMIT_ABOVE_REFUND_LIMIT');
      }
      const userId = uuidOrNull(actor.userId);
      const w = cur.version === 0
        ? await sql<any>`insert into tenant_approval_policies (tenant_id, kind, enabled, threshold_cents, cash_threshold_cents, approver_limit_cents, require_different_approver, expires_after_hours, version, updated_by_user_id)
            values (${actor.tenantId}, ${c.kind}, ${n.enabled}, ${n.thresholdCents}, ${n.cashThresholdCents}, ${n.approverLimitCents}, ${n.requireDifferentApprover}, ${n.expiresAfterHours}, 1, ${userId})
            on conflict (tenant_id, kind) do nothing returning version`.execute(trx)
        : await sql<any>`update tenant_approval_policies set enabled = ${n.enabled}, threshold_cents = ${n.thresholdCents}, cash_threshold_cents = ${n.cashThresholdCents},
            approver_limit_cents = ${n.approverLimitCents}, require_different_approver = ${n.requireDifferentApprover}, expires_after_hours = ${n.expiresAfterHours},
            version = version + 1, updated_by_user_id = ${userId}, updated_at = now()
            where tenant_id = ${actor.tenantId} and kind = ${c.kind} and version = ${c.expectedVersion} returning version`.execute(trx);
      if (!w.rows.length) throw withCode(new ApprovalError('version_conflict', 409, 'Someone changed this rule — reload and try again.'), 'RECORD_CHANGED_RELOAD');
      const prev = cur.version === 0 ? null : policyDetail(cur);
      await sql`insert into tenant_approval_policy_changes (tenant_id, kind, version, previous_value, new_value, actor_user_id, reason)
                values (${actor.tenantId}, ${c.kind}, ${n.version}, ${prev ? JSON.stringify(prev) : null}::jsonb, ${JSON.stringify(policyDetail(n))}::jsonb, ${userId}, ${c.reason})`.execute(trx);
      await this.audit(trx, actor, 'approval_policy_changed', `${c.kind}`, { kind: c.kind, version: n.version, reason: c.reason, previous: prev, next: policyDetail(n) });
      return n;
    });
    return policyDetail(next);
  }

  // ── requests ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** File a request. A live request for the same kind + subject is returned instead of a second one (created: false). */
  async request(actor: ApprovalActor, body: unknown): Promise<ApprovalCreateResult> {
    if (!uuidOrNull(actor.userId)) throw withCode(new ApprovalError('forbidden', 403, 'A signed-in staff member is required to ask for an approval.'), 'AUTH_REQUIRED');
    let c = cleanCreate(body as any, actor.branchId);
    const prep = this.executors.get(c.kind)?.prepare;
    if (prep) {
      try { c = { ...c, ...(await prep(actor, c)) }; }
      catch (e) {
        if (e instanceof ApprovalError) throw e;
        const err: any = e;
        throw new ApprovalError(err?.name === 'ForbiddenError' ? 'forbidden' : 'invalid_subject', err?.name === 'ForbiddenError' ? 403 : 400, String(err?.message ?? 'This request cannot be made.'));
      }
    }
    const db = this.need();
    const out = await db.transaction().execute(async (trx) => {
      const p = await this.policy(actor.tenantId, c.kind, trx);
      if (!p.enabled) throw withCode(new ApprovalError('policy_disabled', 409, 'This salon does not use approvals for this kind of request.'), 'APPROVALS_NOT_USED');
      const title = c.title ?? (c.amountCents != null ? `${p.label} — $${(c.amountCents / 100).toFixed(2)}` : p.label);
      const ins = await sql<any>`insert into tenant_approval_requests (tenant_id, branch_id, kind, subject_type, subject_id, title, amount_cents, payload, reason,
            requested_by_user_id, required_permission, require_different_approver, policy_version, expires_at)
          values (${actor.tenantId}, ${c.branchId}, ${c.kind}, ${c.subjectType}, ${c.subjectId}, ${title}, ${c.amountCents}, ${JSON.stringify(c.payload)}::jsonb, ${c.reason},
            ${actor.userId}, ${p.approverPermission}, ${p.requireDifferentApprover}, ${p.version}, ${new Date(this.now() + p.expiresAfterHours * 3_600_000).toISOString()}::timestamptz)
          on conflict (tenant_id, kind, subject_type, subject_id) where status in ('pending','approved') and subject_id is not null do nothing
          returning *`.execute(trx);
      if (!ins.rows.length) {
        const live = await sql<any>`select id from tenant_approval_requests where tenant_id = ${actor.tenantId} and kind = ${c.kind} and subject_type = ${c.subjectType}
                                    and subject_id = ${c.subjectId} and status in ('pending','approved') limit 1`.execute(trx);
        return { id: String(live.rows[0]?.id ?? ''), created: false };
      }
      const r = recordOf(ins.rows[0]);
      await this.history(trx, r, 'requested', null, 'pending', actor.userId, c.reason);
      await this.audit(trx, actor, 'approval_requested', r.id, { kind: r.kind, subjectType: r.subjectType, subjectId: r.subjectId, amountCents: r.amountCents });
      await this.emit(trx, actor, DOMAIN_EVENTS.APPROVAL_REQUESTED, r, { approvalId: r.id, kind: r.kind, status: 'pending', subjectType: r.subjectType, subjectId: r.subjectId });
      return { id: r.id, created: true };
    });
    return { request: await this.get(actor, out.id, true), created: out.created };
  }

  async get(actor: ApprovalActor, id: string, skipScope = false): Promise<ApprovalRequestView> {
    if (!uuidOrNull(id)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
    const db = this.need();
    const r = await sql<any>`${this.selectViewSql()} where a.tenant_id = ${actor.tenantId} and a.id = ${id} limit 1`.execute(db);
    const row = r.rows[0];
    if (!row || (!skipScope && !this.visible(actor, row))) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
    return this.view(actor, row, await this.policy(actor.tenantId, row.kind));
  }

  /** The live request for a subject (domain modules use this to route their legacy approve / reject through the engine). */
  async liveFor(actor: ApprovalActor, kind: TenantApprovalKind, subjectType: string, subjectId: string): Promise<ApprovalRequestView | null> {
    if (!this.db) return null;
    const r = await sql<any>`${this.selectViewSql()} where a.tenant_id = ${actor.tenantId} and a.kind = ${kind} and a.subject_type = ${subjectType}
                             and a.subject_id = ${subjectId} and a.status in ('pending','approved') limit 1`.execute(this.db);
    return r.rows[0] ? this.view(actor, r.rows[0], await this.policy(actor.tenantId, kind)) : null;
  }

  async list(actor: ApprovalActor, q: any = {}): Promise<ApprovalPage> {
    const db = this.need();
    await this.expireDue(actor.tenantId);
    const page = Math.max(1, Math.floor(Number(q?.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(q?.pageSize) || 25)));
    const st = String(q?.status ?? 'open');
    if (st !== 'open' && st !== 'all' && !(APPROVAL_STATUSES as readonly string[]).includes(st)) throw new ApprovalError('invalid_input', 400, 'Unknown status filter.', { field: 'status' });
    if (q?.kind != null && q.kind !== '' && !isKind(q.kind)) throw new ApprovalError('invalid_input', 400, 'Unknown approval kind.', { field: 'kind' });
    const mine = q?.mine === true || q?.mine === 'true';
    const statusSql = st === 'open' ? sql`a.status in ('pending','approved')` : st === 'all' ? sql`true` : sql`a.status = ${st}`;
    const kindSql = q?.kind ? sql`a.kind = ${q.kind}` : sql`true`;
    const mineSql = mine ? sql`a.requested_by_user_id = ${uuidOrNull(actor.userId)}` : sql`true`;
    const scopeSql = this.unconfined(actor) ? sql`true`
      : sql`(a.branch_id is null or a.branch_id = ${uuidOrNull(actor.branchId)} or a.requested_by_user_id = ${uuidOrNull(actor.userId)})`;
    const filters = sql`${statusSql} and ${kindSql} and ${mineSql} and ${scopeSql}`;
    const total = Number((await sql<any>`select count(*)::int as n from tenant_approval_requests a where a.tenant_id = ${actor.tenantId} and ${filters}`.execute(db)).rows[0]?.n ?? 0);
    const rows = (await sql<any>`${this.selectViewSql()} where a.tenant_id = ${actor.tenantId} and ${filters} order by (a.status = 'pending') desc, (a.status = 'pending' and a.escalated_at is not null) desc, a.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(db)).rows;
    const pol = new Map<string, ApprovalPolicy>();
    for (const k of new Set(rows.map((x: any) => x.kind as TenantApprovalKind))) pol.set(k, await this.policy(actor.tenantId, k));
    return { items: rows.map((x: any) => this.view(actor, x, pol.get(x.kind)!)), page, pageSize, total, hasMore: page * pageSize < total };
  }

  /** Approve / reject. Executes an approved request with a registered executor, once. */
  async decide(actor: ApprovalActor, id: string, body: unknown): Promise<ApprovalRequestView> {
    const d = cleanDecision(body);
    if (!uuidOrNull(id)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
    if (!uuidOrNull(actor.userId)) throw withCode(new ApprovalError('forbidden', 403, 'A signed-in staff member is required to decide.'), 'AUTH_REQUIRED');
    const db = this.need();
    const res = await db.transaction().execute(async (trx) => {
      const row = (await sql<any>`select * from tenant_approval_requests where tenant_id = ${actor.tenantId} and id = ${id} for update`.execute(trx)).rows[0];
      if (!row || !this.visible(actor, row)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
      if (row.status === 'pending' && Date.parse(iso(row.expires_at)!) <= this.now()) {
        await this.expireRow(trx, row);
        return { expired: true as const };
      }
      if (Number(row.version) !== d.expectedVersion) throw withCode(new ApprovalError('version_conflict', 409, 'This request changed — reload it.', { currentVersion: Number(row.version), status: row.status }), 'RECORD_CHANGED_RELOAD');
      const p = await this.policy(actor.tenantId, row.kind, trx);
      const why = whyCannotDecide({ status: row.status, expiresAt: iso(row.expires_at), requestedByUserId: String(row.requested_by_user_id), requiredPermission: String(row.required_permission),
        requireDifferentApprover: !!row.require_different_approver, amountCents: num(row.amount_cents) }, actor, p.approverLimitCents, this.now());
      if (why) throw new ApprovalError(why, why === 'not_pending' ? 409 : 403, whyText(why));
      const to = d.decision === 'approve' ? 'approved' : 'rejected';
      const u = await sql<any>`update tenant_approval_requests set status = ${to}, decided_by_user_id = ${actor.userId}, decision_note = ${d.note}, decided_at = now(),
            version = version + 1, updated_at = now()
          where tenant_id = ${actor.tenantId} and id = ${id} and version = ${d.expectedVersion} and status = 'pending' and ${canMoveToSql(APPROVAL_REQUEST, to)} returning *`.execute(trx);
      if (!u.rows.length) throw withCode(new ApprovalError('version_conflict', 409, 'This request changed — reload it.'), 'RECORD_CHANGED_RELOAD');
      const r = recordOf(u.rows[0]);
      await this.history(trx, r, d.decision === 'approve' ? 'approved' : 'rejected', 'pending', to, actor.userId, d.note);
      await this.audit(trx, actor, d.decision === 'approve' ? 'approval_approved' : 'approval_rejected', r.id, { kind: r.kind, subjectId: r.subjectId, amountCents: r.amountCents, note: d.note });
      await this.emit(trx, actor, DOMAIN_EVENTS.APPROVAL_DECIDED, r, { approvalId: r.id, kind: r.kind, status: to });
      return { expired: false as const, record: r };
    });
    if (res.expired) throw new ApprovalError('expired', 409, whyText('expired'));
    const ex = this.executors.get(res.record.kind);
    if (res.record.status === 'approved' && ex) await this.execute(actor, res.record.id);
    if (res.record.status === 'rejected' && ex?.onReject) {
      try { await ex.onReject(this.inBranch(actor, res.record), res.record, d.note); }
      catch (e) { await this.recordResult(res.record, { onRejectError: String((e as Error)?.message ?? e).slice(0, 300) }); }
    }
    return this.get(actor, id, true);
  }

  /** Run an approved request's executor exactly once (claim first). Returns false when someone else already claimed it. */
  async execute(actor: ApprovalActor, id: string): Promise<boolean> {
    const db = this.need();
    const claim = await sql<any>`update tenant_approval_requests set execution_claimed_at = now(), updated_at = now()
        where tenant_id = ${actor.tenantId} and id = ${id} and status = 'approved' and execution_claimed_at is null returning *`.execute(db);
    if (!claim.rows.length) return false;
    const r = recordOf(claim.rows[0]);
    const ex = this.executors.get(r.kind);
    let ok = false; let result: Record<string, unknown>;
    try {
      if (!ex) throw new Error('No executor is registered for ' + r.kind);
      result = { ...((await ex.execute(this.inBranch(actor, r), r)) ?? {}) }; ok = true;
    } catch (e) {
      const err: any = e;
      result = { error: String(err?.message ?? err).slice(0, 500), ...(err?.code ? { code: String(err.code) } : {}) };
    }
    await db.transaction().execute(async (trx) => {
      const to = ok ? 'executed' : 'execution_failed';
      const u = await sql<any>`update tenant_approval_requests set status = ${to}, executed_at = now(), execution_result = ${JSON.stringify(result)}::jsonb, version = version + 1, updated_at = now()
          where tenant_id = ${actor.tenantId} and id = ${id} and status = 'approved' and ${canMoveToSql(APPROVAL_REQUEST, to)} returning *`.execute(trx);
      if (!u.rows.length) return;
      const rec = recordOf(u.rows[0]);
      await this.history(trx, rec, to, 'approved', to, actor.userId, ok ? null : String(result.error ?? ''));
      await this.audit(trx, actor, ok ? 'approval_executed' : 'approval_execution_failed', rec.id, { kind: rec.kind, subjectId: rec.subjectId, result });
      await this.emit(trx, actor, DOMAIN_EVENTS.APPROVAL_EXECUTED, rec, { approvalId: rec.id, kind: rec.kind, status: to, ok });
    });
    return true;
  }

  /** The requester withdraws their own pending request. */
  async cancel(actor: ApprovalActor, id: string, body: any): Promise<ApprovalRequestView> {
    if (!uuidOrNull(id)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
    const reason = String(body?.reason ?? '').trim().slice(0, 500);
    if (reason.length < 3) throw withCode(new ApprovalError('invalid_input', 400, 'Say why you are withdrawing it.', { field: 'reason' }), 'WITHDRAW_REASON_REQUIRED');
    const db = this.need();
    await db.transaction().execute(async (trx) => {
      const row = (await sql<any>`select * from tenant_approval_requests where tenant_id = ${actor.tenantId} and id = ${id} for update`.execute(trx)).rows[0];
      if (!row || !this.visible(actor, row)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
      if (String(row.requested_by_user_id) !== actor.userId) throw withCode(new ApprovalError('not_requester', 403, 'Only the person who asked can withdraw a request.'), 'APPROVAL_WITHDRAW_OWN_ONLY');
      if (row.status !== 'pending') throw new ApprovalError('not_pending', 409, whyText('not_pending'));
      const u = await sql<any>`update tenant_approval_requests set status = 'cancelled', cancelled_reason = ${reason}, version = version + 1, updated_at = now()
          where tenant_id = ${actor.tenantId} and id = ${id} and status = 'pending' and ${canMoveToSql(APPROVAL_REQUEST, 'cancelled')} returning *`.execute(trx);
      const r = recordOf(u.rows[0]);
      await this.history(trx, r, 'cancelled', 'pending', 'cancelled', actor.userId, reason);
      await this.audit(trx, actor, 'approval_cancelled', r.id, { kind: r.kind, reason });
      await this.emit(trx, actor, DOMAIN_EVENTS.APPROVAL_DECIDED, r, { approvalId: r.id, kind: r.kind, status: 'cancelled' });
    });
    return this.get(actor, id, true);
  }

  /** round 10 (Approvals 01 point 2 — urgent escalation WITHOUT auto-approving): anyone who can see a pending request may mark
   *  it urgent with a reason. It STAYS pending: status, version-checked decision, approver key, separation and limit are
   *  untouched; nothing executes. The approvers hear about it in the salon's alert feed (owner_alerts 'approval_escalated',
   *  severity high, in the request's branch). Escalating twice keeps the first (who / when / why) and adds no second alert. */
  async escalate(actor: ApprovalActor, id: string, body: unknown): Promise<ApprovalRequestView> {
    if (!uuidOrNull(id)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
    if (!uuidOrNull(actor.userId)) throw withCode(new ApprovalError('forbidden', 403, 'A signed-in staff member is required to escalate.'), 'AUTH_REQUIRED');
    const e = cleanEscalation(body);
    const db = this.need();
    await db.transaction().execute(async (trx) => {
      const row = (await sql<any>`select id, tenant_id, branch_id, kind, subject_type, subject_id, title, amount_cents, payload, reason, requested_by_user_id, status, version, decision_note, expires_at, escalated_at
          from tenant_approval_requests where tenant_id = ${actor.tenantId} and id = ${id} for update`.execute(trx)).rows[0];
      if (!row || !this.visible(actor, row)) throw withCode(new ApprovalError('not_found', 404, 'Approval request not found.'), 'APPROVAL_NOT_FOUND');
      if (row.status !== 'pending' || Date.parse(iso(row.expires_at)!) <= this.now()) throw new ApprovalError('not_pending', 409, whyText(row.status !== 'pending' ? 'not_pending' : 'expired'));
      if (row.escalated_at) return;
      const u = await sql<any>`update tenant_approval_requests set escalated_at = now(), escalated_by_user_id = ${actor.userId}, escalation_reason = ${e.reason}, version = version + 1, updated_at = now()
          where tenant_id = ${actor.tenantId} and id = ${id} and status = 'pending' and escalated_at is null
          returning id, tenant_id, branch_id, kind, subject_type, subject_id, title, amount_cents, payload, reason, requested_by_user_id, status, version, decision_note`.execute(trx);
      if (!u.rows.length) return;
      const r = recordOf(u.rows[0]);
      await this.history(trx, r, 'escalated', 'pending', 'pending', actor.userId, e.reason);
      await this.audit(trx, actor, 'approval_escalated', r.id, { kind: r.kind, subjectId: r.subjectId, amountCents: r.amountCents, reason: e.reason, autoApproved: false });
      const meta = { approvalId: r.id, kind: r.kind, amountCents: r.amountCents, escalatedBy: actor.userId, source: 'approvals.escalate' };
      await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
          values (${r.tenantId}, ${r.branchId}, 'approval_escalated', 'high', 'new', ${('Urgent approval: ' + r.title).slice(0, 200)}, ${e.reason.slice(0, 1000)}, ${JSON.stringify(meta)}::jsonb, 'all')`.execute(trx);
    });
    return this.get(actor, id, true);
  }

  /** Pending requests past their expiry → expired (one salon). Returns how many. Idempotent: a second process finds none. */
  async expireDue(tenantId: string): Promise<number> {
    if (!this.db || !uuidOrNull(tenantId)) return 0;
    return this.db.transaction().execute(async (trx) => {
      const rows = (await sql<any>`select * from tenant_approval_requests where tenant_id = ${tenantId} and status = 'pending' and expires_at <= ${new Date(this.now()).toISOString()}::timestamptz
                                   order by expires_at limit 500 for update skip locked`.execute(trx)).rows;
      for (const row of rows) await this.expireRow(trx, row);
      return rows.length;
    });
  }
  /** Salons with pending requests past expiry (the expiry job's dispatcher — a cross-salon read of ids only). */
  async salonsWithDueExpiry(): Promise<string[]> {
    if (!this.db) return [];
    const r = await sql<any>`select distinct tenant_id from tenant_approval_requests where status = 'pending' and expires_at <= now() limit 1000`.execute(this.db);
    return r.rows.map((x: any) => String(x.tenant_id));
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────────────────────────────
  private async expireRow(trx: Db, row: any): Promise<void> {
    const u = await sql<any>`update tenant_approval_requests set status = 'expired', version = version + 1, updated_at = now()
        where tenant_id = ${row.tenant_id} and id = ${row.id} and status = 'pending' and ${canMoveToSql(APPROVAL_REQUEST, 'expired')} returning *`.execute(trx);
    if (!u.rows.length) return;
    const r = recordOf(u.rows[0]);
    const sys: ApprovalActor = { tenantId: r.tenantId, branchId: r.branchId, userId: '', role: 'WORKER', permissions: [] };
    await this.history(trx, r, 'expired', 'pending', 'expired', null, null);
    await this.audit(trx, sys, 'approval_expired', r.id, { kind: r.kind });
    await this.emit(trx, sys, DOMAIN_EVENTS.APPROVAL_DECIDED, r, { approvalId: r.id, kind: r.kind, status: 'expired' });
  }
  private async recordResult(r: ApprovalRecord, result: Record<string, unknown>) {
    await sql`update tenant_approval_requests set execution_result = ${JSON.stringify(result)}::jsonb, updated_at = now() where tenant_id = ${r.tenantId} and id = ${r.id}`.execute(this.need()).catch(() => undefined);
  }
  /** Owners (approvals.manage_policies) see the whole salon; anyone else their branch, branch-less requests and their own. */
  private unconfined(actor: ApprovalActor): boolean { return hasPermission(actor as any, UNLIMITED_APPROVER_KEY) || !uuidOrNull(actor.branchId); }
  private visible(actor: ApprovalActor, row: any): boolean {
    if (this.unconfined(actor)) return true;
    return !row.branch_id || String(row.branch_id) === actor.branchId || String(row.requested_by_user_id) === actor.userId;
  }
  /** The executor acts as the approver, in the REQUEST's branch (the payment / PO lives there). */
  private inBranch(actor: ApprovalActor, r: ApprovalRecord): ApprovalActor { return { ...actor, branchId: r.branchId ?? actor.branchId }; }
  private selectViewSql() {
    return sql`select a.*, b.name as branch_name,
        coalesce(nullif(trim(coalesce(ru.full_name, '')), ''), nullif(trim(coalesce(ru.first_name, '') || ' ' || coalesce(ru.last_name, '')), ''), ru.email) as requested_by_name,
        coalesce(nullif(trim(coalesce(du.full_name, '')), ''), nullif(trim(coalesce(du.first_name, '') || ' ' || coalesce(du.last_name, '')), ''), du.email) as decided_by_name,
        coalesce(nullif(trim(coalesce(eu.full_name, '')), ''), nullif(trim(coalesce(eu.first_name, '') || ' ' || coalesce(eu.last_name, '')), ''), eu.email) as escalated_by_name
      from tenant_approval_requests a
      left join branches b on b.id = a.branch_id and b.tenant_id = a.tenant_id
      left join users ru on ru.id = a.requested_by_user_id and ru.tenant_id = a.tenant_id
      left join users du on du.id = a.decided_by_user_id and du.tenant_id = a.tenant_id
      left join users eu on eu.id = a.escalated_by_user_id and eu.tenant_id = a.tenant_id`;
  }
  private view(actor: ApprovalActor, x: any, p: ApprovalPolicy): ApprovalRequestView {
    const expiresAt = iso(x.expires_at);
    const status: TenantApprovalStatus = x.status === 'pending' && expiresAt && Date.parse(expiresAt) <= this.now() ? 'expired' : x.status;
    const why = whyCannotDecide({ status, expiresAt, requestedByUserId: String(x.requested_by_user_id), requiredPermission: String(x.required_permission),
      requireDifferentApprover: !!x.require_different_approver, amountCents: num(x.amount_cents) }, actor, p.approverLimitCents, this.now());
    return {
      id: String(x.id), kind: x.kind, status, branchId: x.branch_id ? String(x.branch_id) : null, branchName: x.branch_name ?? null,
      subjectType: String(x.subject_type), subjectId: x.subject_id == null ? null : String(x.subject_id), title: String(x.title), amountCents: num(x.amount_cents),
      requestedByUserId: String(x.requested_by_user_id), requestedByName: x.requested_by_name ?? null, reason: String(x.reason),
      decidedByName: x.decided_by_name ?? null, decidedAt: iso(x.decided_at), decisionNote: x.decision_note ?? x.cancelled_reason ?? null,
      requiredPermission: String(x.required_permission), canDecide: why === null, whyNot: why,
      expiresAt, createdAt: iso(x.created_at)!, version: Number(x.version),
      payload: { ...(x.payload ?? {}), ...(x.execution_result ? { executionResult: x.execution_result } : {}) },
      escalatedAt: iso(x.escalated_at), escalatedByName: x.escalated_by_name ?? null, escalationReason: x.escalation_reason ?? null,
    };
  }
  private async history(trx: Db, r: ApprovalRecord, action: string, from: string | null, to: string, actorUserId: string | null, note: string | null) {
    await sql`insert into tenant_approval_request_events (tenant_id, request_id, action, from_status, to_status, actor_user_id, note)
              values (${r.tenantId}, ${r.id}, ${action}, ${from}, ${to}, ${uuidOrNull(actorUserId)}, ${note})`.execute(trx);
  }
  private async audit(trx: Db, actor: ApprovalActor, action: string, entityId: string, meta: Record<string, unknown>) {
    await sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              values (${actor.tenantId}, ${uuidOrNull(actor.branchId)}, ${uuidOrNull(actor.userId)}, ${actor.role || null}, ${action}, 'tenant_approval', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(trx);
  }
  private async emit(trx: Db, actor: ApprovalActor, type: DomainEventType, r: ApprovalRecord, payload: Record<string, unknown>) {
    if (!this.outbox) return;
    const actorId = uuidOrNull(actor.userId);
    await this.outbox.write(trx as never, createDomainEvent({ eventType: type, tenantId: r.tenantId, branchId: r.branchId ?? undefined,
      aggregateType: 'tenant_approval', aggregateId: r.id, aggregateVersion: r.version, actorId: actorId ?? undefined, actorType: actorId ? 'user' : 'system', payload }));
  }
}
