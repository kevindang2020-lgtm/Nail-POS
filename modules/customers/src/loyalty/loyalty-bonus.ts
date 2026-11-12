// loyalty-bonus.ts — Customer Profile & Global Loyalty Protection guide (Nov 4 2026).
//
// The one way salon staff add points by hand. No salon user (receptionist, manager or owner) can set, lower, clear or
// reset a customer's points; a manager ASKS for a positive bonus, the salon OWNER approves it in the Owner App, and only
// the approval moves points:
//
//   POST /pos/loyalty/bonus-requests        (pos.customers.loyalty.edit) → a pending 'loyalty_bonus' request on the
//                                           salon's ONE approvals engine — nothing moves, no tokens are reserved
//   Owner App → Approvals → Approve / Reject (loyalty.bonus.approve — OWNER only; never the person who asked; a week to
//                                           decide, then it expires)
//   approve → the executor runs once (the engine claims it first):
//     • customer in the global rewards network (salon enrolled, flags on, verified + opted-in identity): debit the salon's
//       prepaid token wallet by the central program's cost (10 points = 1.00 token at the default policy) and credit the
//       customer's global points, one balanced journal entry — all in one transaction (postFundedBonus). Too few tokens →
//       nothing moves; the request ends execution_failed with LOYALTY_BONUS_NEEDS_FUNDING ("buy tokens, then ask again").
//     • otherwise: one +points entry in the salon's own points ledger (the salon's own program; no tokens involved).
//   reject / expire / withdraw → nothing moves.
//
// Everything the request shows (current points, after-approval preview, token cost) is the SERVER's, recomputed when
// the owner approves; the client sends only customer, points and reason.
import { sql, type Kysely } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { postFundedBonus, bonusGlobalTarget } from '@aipowersalon/loyalty';
import { applyLoyaltyEntry, lockLoyaltyCustomer } from './loyalty-ledger.service';

export const MAX_BONUS_POINTS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export class LoyaltyBonusError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) { super(message); this.name = 'LoyaltyBonusError'; }
}
const bad = (m: string) => new LoyaltyBonusError(400, m, 'LOYALTY_BONUS_INVALID');

export type BonusActor = { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] };
/** The approvals engine as this module sees it (string token 'TENANT_APPROVALS', structural — no package dependency). */
export interface LoyaltyBonusApprovalsPort {
  registerExecutor(kind: 'loyalty_bonus', executor: {
    prepare?(actor: BonusActor, input: { subjectType: string; subjectId: string | null; reason: string; payload: Record<string, unknown>; branchId: string | null }): Promise<Record<string, unknown>>;
    execute(actor: BonusActor, request: { id: string; subjectId: string | null; payload: Record<string, unknown>; reason: string; branchId: string | null }): Promise<Record<string, unknown> | void>;
  }): void;
  request(actor: BonusActor, body: unknown): Promise<{ request: Record<string, any>; created: boolean }>;
}

export function cleanBonusInput(b: any): { customerId: string; points: number; reason: string } {
  const customerId = String(b?.customerId ?? '');
  if (!UUID.test(customerId)) throw bad('Choose the customer.');
  const points = Number(b?.points);
  if (!Number.isInteger(points) || points < 1 || points > MAX_BONUS_POINTS) throw bad(`Bonus points must be a whole number from 1 to ${MAX_BONUS_POINTS.toLocaleString('en-US')}.`);
  const reason = String(b?.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < 3) throw bad('Say why the customer gets these points.');
  return { customerId, points, reason: reason.slice(0, 300) };
}

export interface BonusPreview {
  customerId: string; customerName: string; target: 'global' | 'salon';
  currentPoints: number; points: number; pointsAfter: number;
  tokenCostCents: number | null; walletAvailableCents: number | null;
}

export class LoyaltyBonusService {
  private approvals: LoyaltyBonusApprovalsPort | null = null;
  constructor(private readonly db: Kysely<any> | null) {}
  private need(): Kysely<any> { if (!this.db || !this.approvals) throw new LoyaltyBonusError(503, 'Bonus requests need the database and the approvals service.', 'LOYALTY_BONUS_UNAVAILABLE'); return this.db; }

  useApprovals(port: LoyaltyBonusApprovalsPort | null | undefined): this {
    this.approvals = port ?? null;
    port?.registerExecutor('loyalty_bonus', {
      // the canonical request: the client's points + reason, everything else read here (tenant-checked)
      prepare: async (actor, input) => {
        const c = cleanBonusInput({ customerId: input.subjectId, points: input.payload?.points, reason: input.reason });
        const p = await this.preview(actor, c.customerId, c.points);
        return {
          subjectType: 'customer', subjectId: c.customerId, branchId: input.branchId ?? actor.branchId ?? null,
          title: `+${c.points.toLocaleString('en-US')} bonus points for ${p.customerName}`,
          // the money the approval spends: the token cost for a global bonus, else the points' redemption value (10 pts = $1)
          amountCents: p.tokenCostCents ?? c.points * 10,
          payload: { customerId: c.customerId, customerName: p.customerName, points: c.points, target: p.target, currentPoints: p.currentPoints, pointsAfter: p.pointsAfter,
            tokenCostCents: p.tokenCostCents, walletAvailableCents: p.walletAvailableCents },
        };
      },
      execute: async (actor, request) => this.execute(actor, request),
    });
    return this;
  }

  /** What a bonus would do right now (server figures; the owner's approval recomputes them). */
  async preview(actor: BonusActor, customerId: string, points: number): Promise<BonusPreview> {
    const db = this.db!;
    const c = (await sql<Row>`SELECT id, first_name, last_name, status FROM customers WHERE tenant_id = ${actor.tenantId}::uuid AND id = ${customerId}::uuid`.execute(db)).rows[0];
    if (!c) throw new LoyaltyBonusError(404, 'Customer not found.', 'CUSTOMER_NOT_FOUND');
    if (c.status === 'archived') throw bad('This customer is archived — restore them first.');
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Customer';
    const g = await bonusGlobalTarget(db, actor.tenantId, customerId);
    if (g) {
      const acct = (await sql<Row>`SELECT available_tenths FROM global_rewards_accounts WHERE identity_id = ${g.identityId}::uuid`.execute(db)).rows[0];
      const w = (await sql<Row>`SELECT available_cents FROM tenant_token_wallets WHERE tenant_id = ${actor.tenantId}::uuid`.execute(db)).rows[0];
      const cur = Math.floor(n(acct?.available_tenths) / 10);
      return { customerId, customerName: name, target: 'global', currentPoints: cur, points, pointsAfter: cur + points, tokenCostCents: points * 10 * g.centsPerTenth, walletAvailableCents: n(w?.available_cents) };
    }
    const lp = (await sql<Row>`SELECT points_balance FROM customer_loyalty_profiles WHERE tenant_id = ${actor.tenantId}::uuid AND customer_id = ${customerId}::uuid ORDER BY created_at LIMIT 1`.execute(db)).rows[0];
    const cur = n(lp?.points_balance);
    return { customerId, customerName: name, target: 'salon', currentPoints: cur, points, pointsAfter: cur + points, tokenCostCents: null, walletAvailableCents: null };
  }

  /** A manager asks. One request per customer can wait at a time (a second ask returns the one waiting). */
  async request(actor: BonusActor, body: unknown): Promise<{ request: Record<string, any>; created: boolean }> {
    this.need();
    const c = cleanBonusInput(body);
    const out = await this.approvals!.request(actor, { kind: 'loyalty_bonus', subjectType: 'customer', subjectId: c.customerId, reason: c.reason, payload: { points: c.points } });
    if (!out.created) throw withCode(new LoyaltyBonusError(409, 'A bonus request for this customer is already waiting for the owner.', 'LOYALTY_BONUS_ALREADY_WAITING'), 'LOYALTY_BONUS_ALREADY_WAITING');
    // §04 step 3: the persistent Owner App inbox is the approvals list itself (live via approval.requested); this owner alert
    // is the supplemental nudge. No customer name or reason in it (lock-screen previews, §10).
    try {
      await sql`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata)
        VALUES (${actor.tenantId}::uuid, ${actor.branchId}, 'loyalty', 'info', 'new', 'Bonus points waiting for your approval',
          ${`A manager asked to add ${c.points} bonus points for a customer. Open Approvals in the Owner App to approve or reject.`},
          ${JSON.stringify({ approvalId: String(out.request.id ?? ''), kind: 'loyalty_bonus' })}::jsonb)`.execute(this.db!);
    } catch (e) { console.warn(`[loyalty-bonus] owner alert not written (the request itself is saved): ${e instanceof Error ? e.message : String(e)}`); }
    return out;
  }

  /** The approved request's one posting (the engine runs this at most once). Recomputed at approval time. */
  private async execute(actor: BonusActor, r: { id: string; subjectId: string | null; payload: Record<string, unknown>; reason: string; branchId: string | null }): Promise<Record<string, unknown>> {
    const db = this.db!;
    const c = cleanBonusInput({ customerId: r.subjectId, points: r.payload?.points, reason: r.reason });
    const target = await bonusGlobalTarget(db, actor.tenantId, c.customerId);
    return db.transaction().execute(async (trx) => {
      if (target) {
        const res = await postFundedBonus(trx, { tenantId: actor.tenantId, branchId: r.branchId, identityId: target.identityId, points: c.points, requestId: r.id, actorUserId: actor.userId, reason: c.reason });
        if (!res.ok && res.code === 'NEEDS_FUNDING') {
          throw withCode(new LoyaltyBonusError(409, `Not enough salon reward tokens: these points need ${(res.neededCents / 100).toFixed(2)} tokens and the wallet has ${(res.availableCents / 100).toFixed(2)}. Buy tokens, then ask again.`, 'LOYALTY_BONUS_NEEDS_FUNDING'), 'LOYALTY_BONUS_NEEDS_FUNDING');
        }
        if (!res.ok) throw withCode(new LoyaltyBonusError(409, `The salon's reward token wallet is ${res.status}; no points were added.`, 'LOYALTY_BONUS_NEEDS_FUNDING'), 'LOYALTY_BONUS_NEEDS_FUNDING');
        return { target: 'global', customerId: c.customerId, points: c.points, tokenCostCents: res.backingCents, walletAfterCents: res.walletAfterCents, pointsAfter: Math.floor(res.pointsAfterTenths / 10), replay: res.replay };
      }
      await lockLoyaltyCustomer(trx, actor.tenantId, c.customerId);
      const e = await applyLoyaltyEntry(trx, { tenantId: actor.tenantId, branchId: r.branchId, customerId: c.customerId, entryType: 'adjust', delta: c.points,
        reason: `Owner-approved bonus: ${c.reason}`, sourceTable: 'tenant_approval_requests', sourceId: r.id, actorUserId: actor.userId, legacyType: 'bonus_approved', legacySource: 'pos' });
      return { target: 'salon', customerId: c.customerId, points: c.points, pointsAfter: e.balanceAfter, replay: e.duplicate };
    });
  }

  /** This salon's bonus requests (newest first; optional customer / status), for the drawer's history and the POS list. */
  async list(actor: BonusActor, q: { customerId?: string; status?: string; page?: number; pageSize?: number }): Promise<{ items: Row[]; total: number; page: number; pageSize: number }> {
    const db = this.need();
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const pageSize = [10, 25, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
    const cust = q.customerId && UUID.test(q.customerId) ? sql`AND a.subject_id = ${q.customerId}` : sql``;
    const st = q.status && /^[a-z_]{3,20}$/.test(q.status) ? sql`AND a.status = ${q.status}` : sql``;
    const total = n((await sql<Row>`SELECT count(*)::int AS c FROM tenant_approval_requests a WHERE a.tenant_id = ${actor.tenantId}::uuid AND a.kind = 'loyalty_bonus' ${cust} ${st}`.execute(db)).rows[0]?.c);
    const rows = (await sql<Row>`SELECT a.id, a.status, a.title, a.reason, a.payload, a.execution_result, a.decision_note, a.created_at, a.decided_at, a.expires_at,
        a.subject_id, a.requested_by_user_id, a.decided_by_user_id,
        coalesce(nullif(trim(coalesce(ru.first_name, '') || ' ' || coalesce(ru.last_name, '')), ''), ru.email) AS requested_by_name,
        coalesce(nullif(trim(coalesce(du.first_name, '') || ' ' || coalesce(du.last_name, '')), ''), du.email) AS decided_by_name
      FROM tenant_approval_requests a LEFT JOIN users ru ON ru.id = a.requested_by_user_id LEFT JOIN users du ON du.id = a.decided_by_user_id
      WHERE a.tenant_id = ${actor.tenantId}::uuid AND a.kind = 'loyalty_bonus' ${cust} ${st}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(db)).rows;
    const now = Date.now();
    const items = rows.map((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>; const ex = (r.execution_result ?? null) as Record<string, unknown> | null;
      const expired = r.status === 'pending' && r.expires_at && Date.parse(new Date(r.expires_at).toISOString()) <= now;
      return {
        id: String(r.id), status: expired ? 'expired' : String(r.status), customerId: r.subject_id ? String(r.subject_id) : null, customerName: p.customerName ?? null,
        points: n(p.points), target: p.target ?? null, tokenCostCents: p.tokenCostCents == null ? null : n(p.tokenCostCents), reason: String(r.reason),
        requestedByName: r.requested_by_name ?? null, decidedByName: r.decided_by_name ?? null, decisionNote: r.decision_note ?? null,
        createdAt: new Date(r.created_at).toISOString(), decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
        failureCode: ex && typeof ex.code === 'string' ? ex.code : null, failure: ex && typeof ex.error === 'string' ? ex.error : null,
      };
    });
    return { items, total, page, pageSize };
  }

  /** §11 "Check Customer & Loyalty System" — read-only; never writes or reverses anything. */
  async health(actor: BonusActor): Promise<{ checkedAt: string; checks: { key: string; result: 'passed' | 'warning' | 'failed'; detail: string; affected: string[] }[] }> {
    const db = this.need();
    const T = actor.tenantId;
    const checks: { key: string; result: 'passed' | 'warning' | 'failed'; detail: string; affected: string[] }[] = [];
    // 1 — every executed bonus has exactly its posting(s): global → one wallet debit + one points credit + one journal; salon → one ledger entry
    const exec = (await sql<Row>`SELECT a.id, a.payload->>'target' AS target,
        (SELECT count(*) FROM token_wallet_ledger l WHERE l.tenant_id = a.tenant_id AND l.source_table = 'tenant_approval_requests' AND l.source_id = a.id::text) AS wl,
        (SELECT count(*) FROM global_points_ledger g WHERE g.tenant_id = a.tenant_id AND g.source_table = 'tenant_approval_requests' AND g.source_id = a.id::text) AS gl,
        (SELECT count(*) FROM rewards_journal_entries j WHERE j.source_table = 'tenant_approval_requests' AND j.source_id = a.id::text) AS jl,
        (SELECT count(*) FROM loyalty_ledger x WHERE x.tenant_id = a.tenant_id AND x.source_table = 'tenant_approval_requests' AND x.source_id::text = a.id::text) AS ll
      FROM tenant_approval_requests a WHERE a.tenant_id = ${T}::uuid AND a.kind = 'loyalty_bonus' AND a.status = 'executed'`.execute(db)).rows;
    const badExec = exec.filter((r) => (r.target === 'global' ? !(n(r.wl) === 1 && n(r.gl) === 1 && n(r.jl) === 1 && n(r.ll) === 0) : !(n(r.ll) === 1 && n(r.wl) === 0 && n(r.gl) === 0)));
    checks.push({ key: 'approved_bonus_posted_once', result: badExec.length ? 'failed' : 'passed', affected: badExec.map((r) => String(r.id)),
      detail: badExec.length ? `${badExec.length} approved bonus(es) without exactly one funding debit and one points credit` : `${exec.length} approved bonus(es): each one token debit + one points credit (or one salon-points entry)` });
    // 2 — nothing credited without an executed approval (no pending / rejected / failed request moved points or tokens)
    const orphan = (await sql<Row>`SELECT DISTINCT x.src AS id FROM (
        SELECT l.source_id AS src FROM token_wallet_ledger l WHERE l.tenant_id = ${T}::uuid AND l.source_table = 'tenant_approval_requests'
        UNION ALL SELECT g.source_id FROM global_points_ledger g WHERE g.tenant_id = ${T}::uuid AND g.source_table = 'tenant_approval_requests'
        UNION ALL SELECT y.source_id::text FROM loyalty_ledger y WHERE y.tenant_id = ${T}::uuid AND y.source_table = 'tenant_approval_requests') x
      WHERE NOT EXISTS (SELECT 1 FROM tenant_approval_requests a WHERE a.tenant_id = ${T}::uuid AND a.id::text = x.src AND a.kind = 'loyalty_bonus' AND a.status = 'executed')`.execute(db)).rows;
    checks.push({ key: 'no_credit_without_owner_approval', result: orphan.length ? 'failed' : 'passed', affected: orphan.map((r) => String(r.id)),
      detail: orphan.length ? `${orphan.length} posting(s) point at a bonus request that was never approved and executed` : 'Every bonus posting belongs to an owner-approved request' });
    // 3 — no manual decrease since the rule took effect (any negative 'adjust' entry written by staff, not a redemption / reversal / merge)
    const dec = (await sql<Row>`SELECT id FROM loyalty_ledger WHERE tenant_id = ${T}::uuid AND entry_type = 'adjust' AND delta < 0 AND created_at >= ${'2026-11-05T00:00:00Z'}::timestamptz ORDER BY created_at DESC LIMIT 50`.execute(db)).rows;
    checks.push({ key: 'no_manual_point_reduction', result: dec.length ? 'failed' : 'passed', affected: dec.map((r) => String(r.id)),
      detail: dec.length ? `${dec.length} manual point reduction(s) recorded since Nov 5 2026 — the salon adjustment routes refuse these` : 'No manual point reductions since the rule took effect (Nov 5 2026)' });
    // 4 — failed approvals (usually not enough tokens) and requests waiting past their deadline
    const failed = (await sql<Row>`SELECT id FROM tenant_approval_requests WHERE tenant_id = ${T}::uuid AND kind = 'loyalty_bonus' AND status = 'execution_failed' AND updated_at > now() - interval '30 days'`.execute(db)).rows;
    checks.push({ key: 'approved_but_not_completed', result: failed.length ? 'warning' : 'passed', affected: failed.map((r) => String(r.id)),
      detail: failed.length ? `${failed.length} approved request(s) in the last 30 days did not complete (no points moved) — usually not enough reward tokens` : 'No approved request failed to complete in the last 30 days' });
    const stale = (await sql<Row>`SELECT id FROM tenant_approval_requests WHERE tenant_id = ${T}::uuid AND kind = 'loyalty_bonus' AND status = 'pending' AND expires_at <= now()`.execute(db)).rows;
    checks.push({ key: 'pending_past_deadline', result: stale.length ? 'warning' : 'passed', affected: stale.map((r) => String(r.id)),
      detail: stale.length ? `${stale.length} request(s) passed their decision deadline (shown as expired; nothing moved)` : 'No request is waiting past its deadline' });
    // extras (Loyalty #04 / #07): redemption reconciliation — every reward redemption against its points debit, every void
    // against its single restore, every used code against a ticket of this salon; and points debits with no redemption.
    const rd = (await sql<Row>`SELECT r.id FROM loyalty_redemptions r WHERE r.tenant_id = ${T}::uuid AND NOT (
        (SELECT count(*) FROM loyalty_ledger l WHERE l.tenant_id = r.tenant_id AND l.source_table = 'loyalty_redemptions' AND l.source_id::text = r.id::text AND l.entry_type = 'redeem') = 1
        AND coalesce((SELECT sum(l.delta) FROM loyalty_ledger l WHERE l.tenant_id = r.tenant_id AND l.source_table = 'loyalty_redemptions' AND l.source_id::text = r.id::text AND l.entry_type = 'redeem'), 0) = -r.points_spent)
      ORDER BY r.created_at DESC LIMIT 50`.execute(db)).rows;
    checks.push({ key: 'redemption_matches_points_debit', result: rd.length ? 'failed' : 'passed', affected: rd.map((r) => String(r.id)),
      detail: rd.length ? `${rd.length} redemption(s) without exactly one points debit of the reward's cost` : 'Every redemption has exactly one points debit of its cost' });
    const orphanDebit = (await sql<Row>`SELECT l.id FROM loyalty_ledger l WHERE l.tenant_id = ${T}::uuid AND l.source_table = 'loyalty_redemptions'
        AND NOT EXISTS (SELECT 1 FROM loyalty_redemptions r WHERE r.tenant_id = l.tenant_id AND r.id::text = l.source_id::text) ORDER BY l.created_at DESC LIMIT 50`.execute(db)).rows;
    checks.push({ key: 'points_debit_without_redemption', result: orphanDebit.length ? 'failed' : 'passed', affected: orphanDebit.map((r) => String(r.id)),
      detail: orphanDebit.length ? `${orphanDebit.length} points debit(s) point at a redemption that does not exist` : 'Every redemption debit belongs to a redemption' });
    const voids = (await sql<Row>`SELECT r.id FROM loyalty_redemptions r WHERE r.tenant_id = ${T}::uuid AND r.status = 'void' AND coalesce((SELECT sum(l.delta) FROM loyalty_ledger l
        WHERE l.tenant_id = r.tenant_id AND l.source_table = 'loyalty_redemption_voids' AND l.source_id::text = r.id::text), 0) <> r.points_spent ORDER BY r.created_at DESC LIMIT 50`.execute(db)).rows;
    checks.push({ key: 'void_restored_once', result: voids.length ? 'failed' : 'passed', affected: voids.map((r) => String(r.id)),
      detail: voids.length ? `${voids.length} voided redemption(s) whose points were not given back exactly once` : 'Every voided redemption gave its points back once' });
    const used = (await sql<Row>`SELECT r.id FROM loyalty_redemptions r WHERE r.tenant_id = ${T}::uuid AND r.status IN ('applied', 'used')
        AND (r.ticket_id IS NULL OR NOT EXISTS (SELECT 1 FROM tickets t WHERE t.tenant_id = r.tenant_id AND t.id = r.ticket_id)) ORDER BY r.created_at DESC LIMIT 50`.execute(db)).rows;
    checks.push({ key: 'used_redemption_on_ticket', result: used.length ? 'warning' : 'passed', affected: used.map((r) => String(r.id)),
      detail: used.length ? `${used.length} applied / used code(s) without a ticket of this salon` : 'Every applied or used code is on a ticket of this salon' });
    return { checkedAt: new Date().toISOString(), checks };
  }
}
