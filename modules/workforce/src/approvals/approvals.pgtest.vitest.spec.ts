// approvals.pgtest — BUILD_PLAN Phase 9 (agent D): the salon approvals engine against the real schema (PGlite, migration 533).
// request → decide → execute once; maker/checker; approver key + limit; branch confinement; CAS; expiry; cancel; policies.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { TenantApprovalsService, type ApprovalRecord } from './approvals.service';
import { runApprovalExpiry } from './approvals.module';
import type { ApprovalActor } from './approvals.core';

const id = (n: number) => `d9d9d9d9-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), T2 = id(2), BA = id(3), BB = id(4);
const FD = id(10), MGR = id(11), OWN = id(12), MGR_B = id(13), FD2 = id(14);
const actor = (userId: string, role: string, branchId: string | null = BA, tenantId = T): ApprovalActor => ({ tenantId, branchId, userId, role, permissions: [...((ROLE_PERMISSIONS as any)[role] ?? [])] });
const frontDesk = actor(FD, 'FRONT_DESK'), manager = actor(MGR, 'MANAGER'), owner = actor(OWN, 'OWNER', null), managerB = actor(MGR_B, 'MANAGER', BB);

let pg: any; let db: any; let clock = Date.parse('2026-10-08T12:00:00Z');
const svc = () => new TenantApprovalsService(db, new OutboxWriter(), () => clock);
let ran: { kind: string; by: string; branch: string | null; subject: string | null }[] = [];
let rejected: { id: string; note: string | null }[] = [];
const withExecutors = (s: TenantApprovalsService, fail = false) => {
  s.registerExecutor('refund', { execute: async (a, r: ApprovalRecord) => { if (fail) throw Object.assign(new Error('gateway declined'), { code: 'declined' }); ran.push({ kind: r.kind, by: a.userId, branch: a.branchId, subject: r.subjectId }); return { refundId: 'rf-1' }; } });
  s.registerExecutor('deal_publish', { execute: async (a, r) => { ran.push({ kind: r.kind, by: a.userId, branch: a.branchId, subject: r.subjectId }); }, onReject: async (_a, r, note) => { rejected.push({ id: r.id, note }); } });
  return s;
};
const outbox = async (type: string) => (await sql<any>`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = ${type}`.execute(db)).rows[0].n;
let subj = 0;
const refundBody = (amountCents = 30_000, extra: Record<string, unknown> = {}) => ({ kind: 'refund', subjectType: 'payment', subjectId: `pay-${++subj}`, amountCents, reason: 'Customer unhappy with the color', payload: { paymentId: `pay-${subj}` }, ...extra });

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, code] of [[T, 'APRV1'], [T2, 'APRV2']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, 'A', 'A', ${'aprv-' + code}, ${code}, 'active') on conflict do nothing`.execute(db);
});
beforeEach(() => { ran = []; rejected = []; });

describe('policies', () => {
  it('defaults = today\'s env limits (refund cash $50 / any $200), every kind listed, version 0', async () => {
    const ps = await svc().policies(owner);
    expect(ps.map((p) => p.kind)).toEqual(['refund', 'void', 'discount_override', 'deal_publish', 'purchase_order', 'price_override', 'payout_adjustment', 'loyalty_bonus', 'other']);
    expect(ps[0]).toMatchObject({ kind: 'refund', enabled: true, thresholdCents: 20_000, cashThresholdCents: 5_000, approverPermission: 'checkout.approve_refund', requireDifferentApprover: true, version: 0 });
    expect(ps.find((p) => p.kind === 'deal_publish')).toMatchObject({ requireDifferentApprover: false, approverPermission: 'marketing.manage' });
  });
  it('owner changes a policy with CAS; history + audit; a stale version is 409; a manager cannot', async () => {
    const s = svc();
    await expect(s.updatePolicy(manager, { kind: 'purchase_order', expectedVersion: 0, thresholdCents: 50_000, reason: 'big orders only' })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    const p = await s.updatePolicy(owner, { kind: 'purchase_order', expectedVersion: 0, thresholdCents: 50_000, reason: 'big orders only' });
    expect(p).toMatchObject({ thresholdCents: 50_000, version: 1 });
    await expect(s.updatePolicy(owner, { kind: 'purchase_order', expectedVersion: 0, thresholdCents: 1, reason: 'stale write' })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    const h = (await sql<any>`select version, reason from tenant_approval_policy_changes where tenant_id = ${T} and kind = 'purchase_order'`.execute(db)).rows;
    expect(h).toEqual([{ version: 1, reason: 'big orders only' }]);
    expect((await sql<any>`select count(*)::int as n from audit_logs where tenant_id = ${T} and action_type = 'approval_policy_changed'`.execute(db)).rows[0].n).toBe(1);
    expect(await s.needsApproval(T, 'purchase_order', 50_000)).toBe(false);
    expect(await s.needsApproval(T, 'purchase_order', 50_001)).toBe(true);
    expect(await s.needsApproval(T2, 'purchase_order', 1)).toBe(true);   // the other salon still has the default (every PO)
  });
  it('a refund policy can never be switched off, and needs a limit; cash ≤ any', async () => {
    const s = svc();
    await expect(s.updatePolicy(owner, { kind: 'refund', expectedVersion: 0, enabled: false, reason: 'no approvals please' })).rejects.toMatchObject({ code: 'policy_required' });
    await expect(s.updatePolicy(owner, { kind: 'refund', expectedVersion: 0, thresholdCents: null, reason: 'no limit please' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.updatePolicy(owner, { kind: 'refund', expectedVersion: 0, cashThresholdCents: 30_000, reason: 'cash above any' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('request → decide → execute', () => {
  it('front desk asks; one live request per subject; requested event + history + audit', async () => {
    const s = svc();
    const body = refundBody();
    const a = await s.request(frontDesk, body);
    expect(a.created).toBe(true);
    expect(a.request).toMatchObject({ kind: 'refund', status: 'pending', amountCents: 30_000, requestedByUserId: FD, branchId: BA, requiredPermission: 'checkout.approve_refund', canDecide: false, whyNot: 'requester_cannot_approve', version: 1 });
    expect(a.request.expiresAt).toBe(new Date(clock + 24 * 3_600_000).toISOString());
    const again = await s.request(frontDesk, body);
    expect(again).toMatchObject({ created: false, request: { id: a.request.id } });
    expect(await outbox('approval.requested')).toBeGreaterThanOrEqual(1);
    expect((await sql<any>`select action from tenant_approval_request_events where request_id = ${a.request.id}`.execute(db)).rows).toEqual([{ action: 'requested' }]);
  });
  it('the manager sees it as decidable; approving runs the executor ONCE as the approver in the request\'s branch', async () => {
    const s = withExecutors(svc());
    const { request } = await s.request(frontDesk, refundBody());
    expect((await s.get(manager, request.id)).canDecide).toBe(true);
    const before = await outbox('approval.executed');
    const done = await s.decide({ ...manager, branchId: null }, request.id, { decision: 'approve', note: 'ok', expectedVersion: 1 });
    expect(done).toMatchObject({ status: 'executed', decidedByName: null, decisionNote: 'ok', version: 3 });
    expect(done.payload.executionResult).toEqual({ refundId: 'rf-1' });
    expect(ran).toEqual([{ kind: 'refund', by: MGR, branch: BA, subject: request.subjectId }]);
    expect(await s.execute(manager, request.id)).toBe(false);          // idempotent: claimed once, never again
    expect(ran).toHaveLength(1);
    expect(await outbox('approval.executed')).toBe(before + 1);
    // executed → no longer live: the same subject may be asked again
    expect((await s.request(frontDesk, { ...refundBody(), subjectId: request.subjectId })).created).toBe(true);
  });
  it('the requester can never approve their own; front desk lacks the key; a stale version is 409', async () => {
    const s = withExecutors(svc());
    const { request } = await s.request(frontDesk, refundBody());
    await expect(s.decide(frontDesk, request.id, { decision: 'approve', expectedVersion: 1 })).rejects.toMatchObject({ code: 'requester_cannot_approve', status: 403 });
    await expect(s.decide(actor(FD2, 'FRONT_DESK'), request.id, { decision: 'approve', expectedVersion: 1 })).rejects.toMatchObject({ code: 'missing_permission', status: 403 });
    await expect(s.decide(manager, request.id, { decision: 'approve', expectedVersion: 2 })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    expect(ran).toEqual([]);
    // a manager who asked for a refund needs ANOTHER approver
    const mine = await s.request(manager, refundBody());
    await expect(s.decide(manager, mine.request.id, { decision: 'approve', expectedVersion: 1 })).rejects.toMatchObject({ code: 'requester_cannot_approve' });
  });
  it('the database refuses a self-approval even if the service rule were skipped', async () => {
    const { request } = await svc().request(frontDesk, refundBody());
    await expect(sql`update tenant_approval_requests set status = 'approved', decided_by_user_id = ${FD} where id = ${request.id}`.execute(db)).rejects.toThrow(/tenant_approval_separation/);
  });
  it('reject needs a note, does not execute, and tells the domain', async () => {
    const s = withExecutors(svc());
    const { request } = await s.request(actor(FD, 'FRONT_DESK'), { kind: 'deal_publish', subjectType: 'deal', subjectId: id(500 + ++subj), reason: 'Deal submitted for approval' });
    await expect(s.decide(manager, request.id, { decision: 'reject', expectedVersion: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    const r = await s.decide(manager, request.id, { decision: 'reject', note: 'Price too low', expectedVersion: 1 });
    expect(r).toMatchObject({ status: 'rejected', decisionNote: 'Price too low' });
    expect(ran).toEqual([]); expect(rejected).toEqual([{ id: request.id, note: 'Price too low' }]);
  });
  it('a kind with no executor stays approved (the decision is the outcome)', async () => {
    const s = svc();
    const { request } = await s.request(frontDesk, { kind: 'other', subjectType: 'note', subjectId: null, reason: 'Can I leave early?' });
    expect(await s.decide(manager, request.id, { decision: 'approve', expectedVersion: 1 })).toMatchObject({ status: 'approved' });
  });
  it('an executor failure is recorded as execution_failed with the error, never retried', async () => {
    const s = withExecutors(svc(), true);
    const { request } = await s.request(frontDesk, refundBody());
    const r = await s.decide(manager, request.id, { decision: 'approve', expectedVersion: 1 });
    expect(r).toMatchObject({ status: 'execution_failed' });
    expect(r.payload.executionResult).toEqual({ error: 'gateway declined', code: 'declined' });
    expect(await s.execute(manager, request.id)).toBe(false);
  });
});

describe('approver limit, branches, cancel, expiry', () => {
  it('amount-within-limit: a manager over the policy\'s approver limit cannot; the owner can', async () => {
    const s = withExecutors(svc());
    await s.updatePolicy(owner, { kind: 'refund', expectedVersion: 0, approverLimitCents: 50_000, reason: 'owner approves the big ones' });
    const big = await s.request(frontDesk, refundBody(60_000));
    expect((await s.get(manager, big.request.id)).whyNot).toBe('over_your_limit');
    await expect(s.decide(manager, big.request.id, { decision: 'approve', expectedVersion: 1 })).rejects.toMatchObject({ code: 'over_your_limit', status: 403 });
    expect(await s.decide(owner, big.request.id, { decision: 'approve', expectedVersion: 1 })).toMatchObject({ status: 'executed' });
    const small = await s.request(frontDesk, refundBody(40_000));
    expect(await s.decide(manager, small.request.id, { decision: 'approve', expectedVersion: 1 })).toMatchObject({ status: 'executed' });
  });
  it('a branch-confined manager neither sees nor decides another branch\'s request; the owner sees all; another salon sees nothing', async () => {
    const s = svc();
    const { request } = await s.request(frontDesk, refundBody());
    await expect(s.get(managerB, request.id)).rejects.toMatchObject({ status: 404 });
    await expect(s.decide(managerB, request.id, { decision: 'approve', expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
    expect((await s.list(managerB, { status: 'all', pageSize: 100 })).items.map((x) => x.id)).not.toContain(request.id);
    expect((await s.list(owner, { status: 'all', pageSize: 100 })).items.map((x) => x.id)).toContain(request.id);
    await expect(s.get(actor(OWN, 'OWNER', null, T2), request.id)).rejects.toMatchObject({ status: 404 });
  });
  it('list: open first, mine filter, kind filter, paging', async () => {
    const s = svc();
    const mine = await s.list(frontDesk, { mine: true, status: 'all', pageSize: 2 });
    expect(mine.items.every((x) => x.requestedByUserId === FD)).toBe(true);
    expect(mine.pageSize).toBe(2); expect(mine.hasMore).toBe(mine.total > 2);
    expect((await s.list(owner, { kind: 'deal_publish', status: 'all' })).items.every((x) => x.kind === 'deal_publish')).toBe(true);
    await expect(s.list(owner, { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('only the requester withdraws, only while pending', async () => {
    const s = svc();
    const { request } = await s.request(frontDesk, refundBody());
    await expect(s.cancel(manager, request.id, { reason: 'not mine' })).rejects.toMatchObject({ code: 'not_requester', status: 403 });
    expect(await s.cancel(frontDesk, request.id, { reason: 'customer changed mind' })).toMatchObject({ status: 'cancelled', decisionNote: 'customer changed mind' });
    await expect(s.cancel(frontDesk, request.id, { reason: 'again' })).rejects.toMatchObject({ code: 'not_pending', status: 409 });
  });
  it('expiry: a decision after expires_at is refused and the request becomes expired; the job sweeps every salon', async () => {
    const s = withExecutors(svc());
    const { request } = await s.request(frontDesk, refundBody());
    const other = await s.request(frontDesk, refundBody());
    clock += 25 * 3_600_000;
    await expect(s.decide(manager, request.id, { decision: 'approve', expectedVersion: 1 })).rejects.toMatchObject({ code: 'expired', status: 409 });
    expect((await s.get(owner, request.id)).status).toBe('expired');
    // the job: move the row's expiry into the past on the SERVICE's clock (expireDue compares with this.now()). It used the
    // database's real now(), which only worked while the real date was before the test's fixed clock + 25 h (Oct 9 13:00 UTC)
    await sql`update tenant_approval_requests set expires_at = ${new Date(clock - 60_000).toISOString()}::timestamptz where id = ${other.request.id}`.execute(db);
    expect(await runApprovalExpiry(s)).toBeGreaterThanOrEqual(1);
    expect((await s.get(owner, other.request.id)).status).toBe('expired');
    expect(await runApprovalExpiry(s)).toBe(0);
    expect(ran).toEqual([]);
    clock -= 25 * 3_600_000;
  });
});
