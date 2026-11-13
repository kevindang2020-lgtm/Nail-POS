// global-rewards.service.ts — the network's application service: the repository's guarded SQL + the funding provider
// seam + realtime (ids only). Controllers stay thin; every money and rule decision is in the repository / core.
import { GR_GLOBAL_RULE_ACTION, GR_PROGRAM_ACTION, GR_APPROVAL_PERMISSION, dualControlMode, auditSelfApproval, needReason, isPauseOnly, pendingApproval, type ApprovalsLike, type GrApprovalActor } from './global-rewards-dual-control';
import { sql, type Kysely } from 'kysely';
import { recordPlatformAuditStrict } from '@aipowersalon/audit';
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { logException } from '@aipowersalon/observability';
import { GlobalRewardsRepository, type GrCtx } from './global-rewards.repository';
import { GlobalRewardsPlatformRepository } from './global-rewards-platform.repository';
import { GlobalRewardsError, validateGlobalRate, previewRows, rateLabel, type PurchaseStatus } from './global-rewards-core';
import type { TokenFundingProvider } from './token-funding-provider';
import { runBooksCheck, integritySummary, listRuns, listFindings, reviewFinding, listPayables, lineage, listFraudAlerts, reviewFraudAlert, findingsCsv } from './rewards-books-check';
import { markPayoutEligible, holdPayable, requestPayout, type PayoutProvider } from './rewards-payouts';
import { canMoveToSql } from '@aipowersalon/database';
import { GLOBAL_REWARDS_ACCOUNT } from './global-rewards-lifecycles';
import { flagState } from './global-rewards-flags';
import { salonPayables, salonFinanceExport, type SalonPayablesQuery } from './rewards-salon-payables';
import { recordAuditStrict } from '@aipowersalon/audit';
import { isValidTimeZone } from '@aipowersalon/database';

export class GlobalRewardsService {
  readonly platform: GlobalRewardsPlatformRepository;
  constructor(readonly repo: GlobalRewardsRepository, private readonly provider: TokenFundingProvider | null, private readonly realtime: RealtimeEmitter | null) {
    this.platform = new GlobalRewardsPlatformRepository(repo.database, repo);
  }

  /** every POS of the salon refetches (addendum §6.2) — ids only, never amounts or rates */
  async emit(tenantId: string, kind: string): Promise<void> {
    if (!this.realtime) return;
    try {
      const rows = (await sql<{ id: string }>`SELECT b.id::text AS id FROM branches b WHERE b.tenant_id = ${tenantId}::uuid AND b.deleted_at IS NULL LIMIT 500`.execute(this.repo.database)).rows;
      for (const b of rows) {
        // §343 exempt: a momentary screen signal (the salon's rewards rule / wallet changed; refetch, ids only) — the audited write is the fact
        this.realtime.toTenant({ tenantId, branchId: b.id }, EVENTS.loyaltyNetworkUpdated, { kind });
      }
    } catch (e) { logException(e, { where: 'global-rewards.emit', tenantId }); }
  }

  async state(ctx: GrCtx) {
    const v = await this.repo.policyView(ctx);
    return { ...v, funding: { provider: this.provider?.name ?? null, sandbox: !!this.provider?.sandbox, available: !!this.provider } };
  }
  preview(ctx: GrCtx, body: Record<string, unknown>) { return this.repo.preview(ctx, body); }
  history(ctx: GrCtx) { return this.repo.history(ctx); }
  async saveDraft(ctx: GrCtx, body: Record<string, any>) { const r = await this.repo.saveDraft(ctx, body); await this.emit(ctx.tenantId, 'draft'); return r; }
  async discardDraft(ctx: GrCtx, id: string) { const r = await this.repo.discardDraft(ctx, id); await this.emit(ctx.tenantId, 'draft'); return r; }
  async activate(ctx: GrCtx, body: Record<string, any>) { const r = await this.repo.activateCustom(ctx, body); await this.emit(ctx.tenantId, 'earning_rule'); return r; }
  async useGlobal(ctx: GrCtx, body: Record<string, any>) { const r = await this.repo.useGlobal(ctx, body); await this.emit(ctx.tenantId, 'earning_rule'); return r; }
  async cancelScheduled(ctx: GrCtx, id: string) { const r = await this.repo.cancelScheduled(ctx, id); await this.emit(ctx.tenantId, 'earning_rule'); return r; }

  wallet(ctx: GrCtx) { return this.repo.walletSummary(ctx.tenantId); }
  async setWalletLevels(ctx: GrCtx, body: Record<string, unknown>) { const r = await this.repo.setWalletLevels(ctx, body); await this.emit(ctx.tenantId, 'wallet'); return r; }
  ledger(ctx: GrCtx, page: number, pageSize: number) { return this.repo.walletLedger(ctx.tenantId, page, pageSize); }
  purchases(ctx: GrCtx, page: number, pageSize: number) { return this.repo.purchases(ctx.tenantId, page, pageSize); }
  purchase(ctx: GrCtx, id: string) { return this.repo.purchase(ctx.tenantId, id); }
  /** what the network owes THIS salon, with provider + journal evidence (read-only; extras GLOBAL LOYALTY REWARDS 07 / 10) */
  reimbursements(ctx: GrCtx, q: SalonPayablesQuery) { return salonPayables(this.repo.database, ctx.tenantId, q); }
  /** the owner's finance audit trail (extras GLOBAL LOYALTY REWARDS 16): purchases, allocations, payables + exceptions as ONE
   *  CSV over salon days [from, to] in the salon's zone (its first branch, as the wallet's month uses); audited, nothing else written */
  async financeExport(ctx: GrCtx, range: { from: string; to: string }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to) || range.from > range.to) throw new GlobalRewardsError('Choose a From and To date (From before To).', 'VALIDATION_FAILED', 400);
    const db = this.repo.database;
    const tzRow = (await sql<{ timezone: string | null }>`SELECT b.timezone FROM branches b WHERE b.tenant_id = ${ctx.tenantId}::uuid AND b.deleted_at IS NULL ORDER BY b.created_at LIMIT 1`.execute(db)).rows[0];
    const tz = tzRow?.timezone && isValidTimeZone(String(tzRow.timezone)) ? String(tzRow.timezone) : 'America/New_York';
    const out = await salonFinanceExport(db, ctx.tenantId, range, tz);
    await recordAuditStrict(db, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null },
      { module: 'loyalty', action: 'network_finance_exported', summary: `Rewards network finance export ${range.from} to ${range.to} (${out.rows} rows)`, resourceType: 'tenant_token_wallet', resourceId: null,
        metadata: { from: range.from, to: range.to, timeZone: tz, rows: out.rows, ...out.counts } });
    return { format: 'csv' as const, filename: `rewards-network-finance-${range.from}-to-${range.to}.csv`, csv: out.csv, rows: out.rows, counts: out.counts };
  }

  /**
   * Buy Tokens (guide §3.3, §5.3): one logical purchase per request key. A retry of the SAME key returns the same
   * purchase and never submits a second charge; a lost provider answer becomes UNKNOWN (Verification Pending) — never a
   * blind retry with a new key. Nothing is spendable until FUNDS_VERIFIED.
   */
  async buyTokens(ctx: GrCtx, tokens: unknown, idempotencyKey: string) {
    if (!this.provider) throw new GlobalRewardsError('Token purchases are not set up yet: no approved payment provider is connected.', 'TOKEN_FUNDING_PROVIDER_UNAVAILABLE', 503);
    const r = await this.repo.createPurchase(ctx, { tokens, idempotencyKey, provider: this.provider.name });
    if (r.created) {
      await this.repo.movePurchase(r.intentId, 'PROCESSING', { tenantId: ctx.tenantId, source: 'owner', actorUserId: ctx.userId });
      const cur = await this.repo.purchase(ctx.tenantId, r.intentId);
      let res: Awaited<ReturnType<TokenFundingProvider['submit']>>;
      try { res = await this.provider.submit({ id: r.intentId, tenantId: ctx.tenantId, amountCents: cur.amountCents, tokenCents: cur.tokenCents, idempotencyKey }); }
      catch (e) { logException(e, { where: 'global-rewards.buy.submit', tenantId: ctx.tenantId, intentId: r.intentId }); res = { status: 'UNKNOWN', providerRef: null, failureCode: 'PROVIDER_NO_ANSWER' }; }
      if (res.status !== 'PROCESSING') await this.repo.movePurchase(r.intentId, res.status as PurchaseStatus, { tenantId: ctx.tenantId, source: `provider:${this.provider.name}`, providerRef: res.providerRef, failureCode: res.failureCode ?? null, actorUserId: ctx.userId });
      await this.emit(ctx.tenantId, 'purchase');
    }
    return { ...(await this.repo.purchase(ctx.tenantId, r.intentId)), created: r.created };
  }

  // ── Super Admin ──────────────────────────────────────────────────────────────────────────────────────────────────
  async adminOverview() {
    const [program, versions, impact, recon] = await Promise.all([this.repo.program(), this.repo.globalVersions(), this.repo.globalImpact(), this.platform.reconciliation()]);
    return { program, globalVersions: versions, impact, reconciliation: recon, funding: { provider: this.provider?.name ?? null, sandbox: !!this.provider?.sandbox } };
  }
  async publishGlobal(body: Record<string, any>, actorUserId: string) {
    const r = await this.repo.publishGlobalRule(body, actorUserId);
    for (const t of (await sql<{ id: string }>`SELECT e.tenant_id::text AS id FROM global_rewards_enrollments e WHERE e.status = 'enrolled' LIMIT 20000`.execute(this.repo.database)).rows) await this.emit(t.id, 'global_rule');
    return r;
  }
  /** What a proposed GLOBAL rule would do before it is published: the $5–$100 points / token cost against the rule in force
   *  now, and how many enrolled salons follow the global rule (they change) vs keep their own custom rule (untouched). */
  async previewGlobal(body: Record<string, unknown>) {
    const program = await this.repo.program();
    const proposed = validateGlobalRate(body, program);
    const current = await this.repo.globalRuleAt(this.repo.database, new Date());
    if (!current) throw new GlobalRewardsError('No global earning rule is in force.', 'LOYALTY_DISABLED', 503);
    return { proposed: { ...proposed, rateLabel: rateLabel(proposed) }, current: { ...current, rateLabel: rateLabel(current) }, rows: previewRows(proposed, current, program), impact: await this.repo.globalImpact() };
  }
  cancelGlobal(id: string, actorUserId: string) { return this.repo.cancelGlobalRule(id, actorUserId); }

  // ── Batch C decision 1 (Nov 6 2026): dual control on global rule publish / program update (global-rewards-dual-control.ts)
  private approvals: ApprovalsLike | null = null;
  /** Bind the platform maker/checker and register the two approvable actions (idempotent; boot-time, so an approval filed
   *  before a restart still executes). On approval each runs as the REQUESTER. */
  useApprovals(a: ApprovalsLike | null): this {
    this.approvals = a;
    if (!a) return this;
    const has = (k: string) => a.registered().some((x) => x.key === k);
    if (!has(GR_GLOBAL_RULE_ACTION)) a.register({ key: GR_GLOBAL_RULE_ACTION, label: 'Publish a global loyalty earning rule', requiredPermission: GR_APPROVAL_PERMISSION,
      execute: (p: any, actor) => this.publishGlobal(p?.body ?? {}, String(actor.userId ?? '')) });
    if (!has(GR_PROGRAM_ACTION)) a.register({ key: GR_PROGRAM_ACTION, label: 'Change the loyalty program limits / pauses', requiredPermission: GR_APPROVAL_PERMISSION,
      execute: (p: any, actor) => this.updateProgram(p?.patch ?? {}, Number(p?.expectedVersion), String(actor.userId ?? '')) });
    return this;
  }
  async publishGlobalControlled(body: Record<string, any>, actor: GrApprovalActor) {
    const mode = await dualControlMode(this.approvals, this.repo.database, GR_GLOBAL_RULE_ACTION, actor);
    if (mode === 'off') return this.publishGlobal(body, String(actor.userId ?? ''));
    await this.previewGlobal(body);   // a request that would fail validation is refused now, never filed for a second person
    const reason = needReason(body.reason);
    if (mode === 'self_approval') { await auditSelfApproval(this.repo.database, actor, GR_GLOBAL_RULE_ACTION, reason, { body }); return this.publishGlobal(body, String(actor.userId ?? '')); }
    const out = await this.approvals!.runOrRequest(GR_GLOBAL_RULE_ACTION, { body }, reason, actor, 'global_rule');
    return out.executed ? out.result : pendingApproval(out.approvalId, out.expiresAt);
  }
  async updateProgramControlled(patch: Record<string, unknown>, expectedVersion: number, reason: string | null | undefined, actor: GrApprovalActor) {
    const mode = isPauseOnly(patch) ? 'off' : await dualControlMode(this.approvals, this.repo.database, GR_PROGRAM_ACTION, actor);
    if (mode === 'off') return this.updateProgram(patch, expectedVersion, String(actor.userId ?? ''));
    const r = needReason(reason);
    if (mode === 'self_approval') { await auditSelfApproval(this.repo.database, actor, GR_PROGRAM_ACTION, r, { patch, expectedVersion }); return this.updateProgram(patch, expectedVersion, String(actor.userId ?? '')); }
    const out = await this.approvals!.runOrRequest(GR_PROGRAM_ACTION, { patch, expectedVersion }, r, actor, 'program');
    return out.executed ? out.result : pendingApproval(out.approvalId, out.expiresAt);
  }
  updateProgram(patch: Record<string, unknown>, expectedVersion: number, actorUserId: string) { return this.repo.updateProgram(patch, expectedVersion, actorUserId); }
  async setEnrollment(tenantId: string, to: 'enrolled' | 'suspended' | 'withdrawn', a: { earningSuspended?: boolean; purchasingSuspended?: boolean; reason: string; actorUserId: string }) {
    const r = await this.repo.setEnrollment(tenantId, to, a); await this.emit(tenantId, 'enrollment'); return r;
  }
  enrollments(q: { search?: string | null; page?: number; pageSize?: number }) { return this.repo.enrollments(q); }
  allPurchases(page: number, pageSize: number) { return this.platform.allPurchases(page, pageSize); }
  /** SANDBOX ONLY: stand in for the provider's later answers (settlement pending / funds verified / declined). */
  async sandboxAdvance(intentId: string, to: PurchaseStatus, actorUserId: string) {
    if (!this.provider?.sandbox) throw new GlobalRewardsError('Only sandbox purchases can be advanced by hand; a live purchase is moved by its provider.', 'SETTLEMENT_UNCONFIRMED', 409);
    if (!['SETTLEMENT_PENDING', 'FUNDS_VERIFIED', 'DECLINED', 'FAILED', 'REVERSED'].includes(to)) throw new GlobalRewardsError('That status cannot be set by hand.', 'VALIDATION_FAILED', 400, { field: 'status' });
    const tenantId = await this.platform.purchaseTenant(intentId);
    await this.repo.movePurchase(intentId, to, { tenantId, source: 'sandbox_admin', actorUserId });
    await this.emit(tenantId, 'purchase');
    return this.repo.purchase(tenantId, intentId);
  }
  reconciliation() { return this.platform.reconciliation(); }

  // ── Final Completion guide §07–§09: books check, integrity dashboard, payables, fraud review (Super Admin) ──────────
  private payoutProvider: PayoutProvider | null = null;   // none approved (BLOCKED_EXTERNAL); bound only by an approved adapter
  usePayoutProvider(p: PayoutProvider | null): this { this.payoutProvider = p; return this; }
  runBooksCheckNow(actorUserId: string) { return runBooksCheck(this.repo.database, { trigger: 'manual', requestedBy: actorUserId }); }
  integrity() { return integritySummary(this.repo.database); }
  books(q: { page?: number; pageSize?: number }) { return listRuns(this.repo.database, q); }
  findings(q: { runId?: string | null; outcome?: string | null; reviewStatus?: string | null; tenantId?: string | null; page?: number; pageSize?: number }) { return listFindings(this.repo.database, q); }
  findingsCsv(actorUserId: string, runId: string | null) { return findingsCsv(this.repo.database, actorUserId, { runId }); }
  async reviewFinding(id: string, to: string, note: string, actorUserId: string) {
    if (!['INVESTIGATING', 'RESOLVED', 'ACCEPTED', 'OPEN'].includes(to)) throw new GlobalRewardsError('Choose investigating, resolved, accepted or open.', 'VALIDATION_FAILED', 400, { field: 'to' });
    if (String(note ?? '').trim().length < 10) throw new GlobalRewardsError('Give a note of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'note' });
    const r = await reviewFinding(this.repo.database, { findingId: id, to: to as 'RESOLVED', note: String(note).trim(), actorUserId });
    if (!r) throw new GlobalRewardsError('That finding cannot move to that state.', 'EARNING_POLICY_CONFLICT', 409);
    return r;
  }
  payables(q: { status?: string | null; tenantId?: string | null; page?: number; pageSize?: number }) { return listPayables(this.repo.database, q); }
  lineage(redemptionId: string) { return lineage(this.repo.database, redemptionId).then((r) => { if (!r) throw new GlobalRewardsError('That redemption was not found.', 'RESOURCE_NOT_FOUND', 404); return r; }); }
  async markEligible(id: string, actorUserId: string) {
    const ok = await this.repo.database.transaction().execute(async (trx) => {
      const moved = await markPayoutEligible(trx, { reimbursementId: id, actorUserId });
      if (moved) await this.auditPlatformAction(trx, actorUserId, 'loyalty.payable_eligible', 'merchant_reimbursement', id, {});   // same transaction: no row, no change
      return moved;
    });
    if (!ok) throw new GlobalRewardsError('Only an owed payable can become eligible for payout.', 'EARNING_POLICY_CONFLICT', 409);
    return { id, status: 'PAYOUT_ELIGIBLE' };
  }
  async holdPayable(id: string, reason: string, actorUserId: string) {
    if (String(reason ?? '').trim().length < 10) throw new GlobalRewardsError('Give a reason of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'reason' });
    const ok = await this.repo.database.transaction().execute(async (trx) => {
      const moved = await holdPayable(trx, { reimbursementId: id, actorUserId, reason: String(reason).trim() });
      if (moved) await this.auditPlatformAction(trx, actorUserId, 'loyalty.payable_on_hold', 'merchant_reimbursement', id, { reason });
      return moved;
    });
    if (!ok) throw new GlobalRewardsError('That payable cannot be put on hold now.', 'EARNING_POLICY_CONFLICT', 409);
    return { id, status: 'ON_HOLD' };
  }
  /** C1 audit (Nov 4 2026) — guide §4.4: Super Admin pauses a suspected compromised rewards account (earning and redeeming
   *  already require an active account) or lifts the pause. Points stay where they are; reason ≥ 10 characters; audited. */
  async setAccountStatus(identityId: string, to: 'suspended' | 'active', reason: string, actorUserId: string) {
    if (to !== 'suspended' && to !== 'active') throw new GlobalRewardsError('status must be suspended or active.', 'VALIDATION_FAILED', 400, { field: 'status' });
    const why = String(reason ?? '').trim();
    if (why.length < 10) throw new GlobalRewardsError('Give a reason of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'reason' });
    const moved = await this.repo.database.transaction().execute(async (trx) => {
      const r = (await sql<{ identity_id: string }>`UPDATE global_rewards_accounts ga SET status = ${to}, version = ga.version + 1, updated_at = now()
        WHERE ga.identity_id = ${identityId}::uuid AND ga.status <> ${to} AND ${canMoveToSql(GLOBAL_REWARDS_ACCOUNT, to, 'ga')} RETURNING ga.identity_id`.execute(trx)).rows[0];
      if (r) await this.auditPlatformAction(trx, actorUserId, to === 'suspended' ? 'loyalty.account_suspended' : 'loyalty.account_reactivated', 'global_rewards_account', identityId, { reason: why });
      return !!r;
    });
    if (!moved) throw new GlobalRewardsError(to === 'suspended' ? 'That rewards account is not active (or does not exist).' : 'That rewards account is not suspended (or does not exist).', 'EARNING_POLICY_CONFLICT', 409);
    return { identityId, status: to };
  }
  /** the account a fraud alert is about (the console addresses the alert, never the identity id) */
  async setAccountStatusForAlert(alertId: string, to: 'suspended' | 'active', reason: string, actorUserId: string) {
    const a = (await sql<{ identity_id: string | null }>`SELECT identity_id FROM loyalty_fraud_alerts WHERE id = ${alertId}::uuid`.execute(this.repo.database)).rows[0];
    if (!a) throw new GlobalRewardsError('That alert was not found.', 'RESOURCE_NOT_FOUND', 404);
    if (!a.identity_id) throw new GlobalRewardsError('This alert is not about one customer account.', 'EARNING_POLICY_CONFLICT', 409);
    const r = await this.setAccountStatus(String(a.identity_id), to, reason, actorUserId);
    return { alertId, status: r.status };
  }
  /** no approved payout provider → PAYOUT_PROVIDER_UNAVAILABLE; the payable stays owed (never PAID by hand) */
  async requestPayout(id: string, actorUserId: string, idempotencyKey: string) {
    // merchant_reimbursement_enabled (default OFF) gates money OUT, in addition to an approved payout provider
    const f = await flagState(this.repo.database, null);
    if (!f.engine || !f.reimbursement) throw new GlobalRewardsError('Salon payouts are switched off (merchant_reimbursement_enabled). The amount stays owed.', 'LOYALTY_DISABLED', 403);
    return requestPayout(this.repo.database, this.payoutProvider, { reimbursementId: id, actorUserId, idempotencyKey });
  }
  fraudAlerts(q: { status?: string | null; page?: number; pageSize?: number }) { return listFraudAlerts(this.repo.database, q); }
  async reviewFraud(id: string, to: string, note: string, actorUserId: string) {
    if (!['INVESTIGATING', 'DISMISSED', 'CONFIRMED', 'OPEN'].includes(to)) throw new GlobalRewardsError('Choose investigating, dismissed, confirmed or open.', 'VALIDATION_FAILED', 400, { field: 'to' });
    if (String(note ?? '').trim().length < 10) throw new GlobalRewardsError('Give a note of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'note' });
    const r = await reviewFraudAlert(this.repo.database, { alertId: id, to: to as 'DISMISSED', note: String(note).trim(), actorUserId });
    if (!r) throw new GlobalRewardsError('That alert cannot move to that state.', 'EARNING_POLICY_CONFLICT', 409);
    return r;
  }
  private async auditPlatformAction(trx: Parameters<typeof markPayoutEligible>[0], actorUserId: string, action: string, entityType: string, entityId: string, meta: Record<string, unknown>) {
    await recordPlatformAuditStrict(trx as Kysely<any>, { userId: actorUserId, role: 'super_admin' },
      { module: 'loyalty', action: action.replace(/^loyalty\./, ''), resourceType: entityType, resourceId: entityId, metadata: meta });
  }
}
