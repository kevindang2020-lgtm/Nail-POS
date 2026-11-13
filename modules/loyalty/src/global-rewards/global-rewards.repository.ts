// global-rewards.repository.ts — the Global Loyalty & Rewards Network's SQL (LoyaltyTokens.pdf v1.0 + LoyaltyRules.pdf v2.0).
// Raw SQL only; tenant from the trusted session, never a body. Every money write is one transaction with its ledger
// row, its journal entry and the guarded status move, so they commit together or not at all.
//
//   program()                   the singleton central policy (redemption value, token value, pauses, limits)
//   resolveEarningRule()        THE resolver (addendum §2.2): exactly one source — TENANT_OVERRIDE when an ACTIVATED CUSTOM
//                               transition is in force at the sale's time, else GLOBAL_DEFAULT read live (no per-tenant copy)
//   policyView / preview / saveDraft / activate / useGlobal / cancelScheduled / discardDraft / history   the owner's controls
//   creditWallet / debitWallet  the ONLY wallet writers (row lock + append-only ledger + balanced journal)
//   createPurchase / movePurchase  Buy Tokens; tokens become spendable only at FUNDS_VERIFIED
import { hasPermission } from '@aipowersalon/permissions';
import { sql, type Kysely, type Transaction } from 'kysely';
import { canMoveToSql, isValidTimeZone } from '@aipowersalon/database';
import { monthStartMs } from '@aipowersalon/date-time';
import { logException } from '@aipowersalon/observability';
import {
  GlobalRewardsError, alertLevel, walletLevels, clampRateToPolicy, computeEarn, previewRows, validateCustomRate, validateGlobalRate, policyDisplay, policyVersionAt, versionDisplayState,
  purchaseQuantity, isPending, rateLabel, tokensLabel, walletFundingForecast, FORECAST_BASIS_DAYS,
  type EarningRate, type EffectiveEarningRule, type PolicyVersion, type ProgramPolicy, type PurchaseStatus,
} from './global-rewards-core';
import { TENANT_EARNING_POLICY_VERSION, TOKEN_PURCHASE_INTENT, GLOBAL_EARNING_RULE_VERSION, GLOBAL_REWARDS_ENROLLMENT, TENANT_TOKEN_WALLET } from './global-rewards-lifecycles';
import { flagState, type GrFlagState } from './global-rewards-flags';
import { recordAuditStrict, recordPlatformAuditStrict } from '@aipowersalon/audit';

type Db = Kysely<any>;
type Exec = Db | Transaction<any>;
type Row = Record<string, any>;
export interface GrCtx { tenantId: string; branchId: string | null; userId: string; role?: string | null; permissions: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const actor = (id: string | null | undefined): string | null => (id && UUID.test(id) ? id : null);
/** a whole-tenant serialisation point for policy writes (T24: two simultaneous activations stay consistent) */
const lockTenantPolicy = (x: Exec, tenantId: string) => sql`SELECT pg_advisory_xact_lock(hashtext(${'gr-policy:' + tenantId}))`.execute(x);

export const PROGRAM_COLS = sql`p.earn_paused, p.redeem_paused, p.purchases_paused, p.reimbursements_paused, p.points_per_redeem_block, p.redeem_block_value_cents,
  p.token_value_cents, p.custom_min_spend_increment_cents, p.custom_max_spend_increment_cents, p.custom_max_point_tenths_per_increment, p.custom_min_eligible_floor_cents,
  p.max_point_tenths_per_ticket, p.low_balance_cents, p.critical_balance_cents, p.reservation_ttl_seconds, p.purchase_presets_tokens, p.max_purchase_tokens,
  p.terms_version, p.version, p.updated_at`;
export const programOf = (r: Row): ProgramPolicy => ({
  earnPaused: !!r.earn_paused, redeemPaused: !!r.redeem_paused, purchasesPaused: !!r.purchases_paused, reimbursementsPaused: !!r.reimbursements_paused,
  pointsPerRedeemBlock: n(r.points_per_redeem_block), redeemBlockValueCents: n(r.redeem_block_value_cents), tokenValueCents: n(r.token_value_cents),
  customMinSpendIncrementCents: n(r.custom_min_spend_increment_cents), customMaxSpendIncrementCents: n(r.custom_max_spend_increment_cents),
  customMaxPointTenthsPerIncrement: n(r.custom_max_point_tenths_per_increment), customMinEligibleFloorCents: n(r.custom_min_eligible_floor_cents),
  maxPointTenthsPerTicket: n(r.max_point_tenths_per_ticket), lowBalanceCents: n(r.low_balance_cents), criticalBalanceCents: n(r.critical_balance_cents),
  reservationTtlSeconds: n(r.reservation_ttl_seconds), purchasePresetsTokens: (Array.isArray(r.purchase_presets_tokens) ? r.purchase_presets_tokens : String(r.purchase_presets_tokens ?? '').replace(/[{}]/g, '').split(',').filter(Boolean)).map(Number),
  maxPurchaseTokens: n(r.max_purchase_tokens), termsVersion: String(r.terms_version), version: n(r.version),
});

const GV_COLS = sql`g.id, g.version_no, g.spend_increment_cents, g.point_tenths_per_increment, g.min_eligible_cents, g.per_ticket_cap_tenths, g.rounding_mode, g.effective_from, g.status, g.reason, g.published_by, g.created_at`;
const TV_COLS = sql`v.id, v.version_no, v.mode, v.spend_increment_cents, v.point_tenths_per_increment, v.min_eligible_cents, v.per_ticket_cap_tenths, v.rounding_mode,
  v.effective_from, v.status, v.reason, v.created_by, v.activated_by, v.activated_at, v.canceled_at, v.record_version, v.created_at, v.updated_at`;
const rateOf = (r: Row): EarningRate => ({ spendIncrementCents: n(r.spend_increment_cents), pointTenthsPerIncrement: n(r.point_tenths_per_increment),
  minEligibleCents: n(r.min_eligible_cents), perTicketCapTenths: r.per_ticket_cap_tenths == null ? null : n(r.per_ticket_cap_tenths), roundingMode: 'COMPLETED_INCREMENT' });
const versionOf = (r: Row): PolicyVersion => ({ id: String(r.id), versionNo: n(r.version_no), mode: r.mode === 'CUSTOM' ? 'CUSTOM' : 'GLOBAL', status: r.status,
  effectiveFrom: iso(r.effective_from), rate: r.mode === 'CUSTOM' && r.spend_increment_cents != null ? rateOf(r) : null });
const globalRuleOf = (r: Row): EffectiveEarningRule => ({ source: 'GLOBAL_DEFAULT', versionId: String(r.id), versionNo: n(r.version_no), effectiveFrom: iso(r.effective_from)!, ...rateOf(r) });

/** pos.settings.edit through the platform's ONE permission rule (role grants are stored un-prefixed: 'settings.edit') */
const canEditSettings = (ctx: GrCtx): boolean => hasPermission({ userId: ctx.userId, tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, role: ctx.role ?? '', permissions: ctx.permissions ?? [] } as Parameters<typeof hasPermission>[0], 'pos.settings.edit');

export const purchaseRow = (x: Row) => ({ id: String(x.id), tenantId: String(x.tenant_id), tokenCents: n(x.token_cents), amountCents: n(x.amount_cents), feeCents: n(x.fee_cents),
  status: x.status as PurchaseStatus, pending: isPending(String(x.status)), provider: x.provider, providerRefLast6: x.provider_ref ? String(x.provider_ref).slice(-6) : null,
  failureCode: x.failure_code ?? null, createdAt: iso(x.created_at), confirmedAt: iso(x.confirmed_at), fundedAt: iso(x.funded_at) });

export type ResolveResult = { ok: true; rule: EffectiveEarningRule; program: ProgramPolicy } | { ok: false; code: string; reason: string; program: ProgramPolicy | null };

export class GlobalRewardsRepository {
  constructor(private readonly db: Db) {}
  get database(): Db { return this.db; }

  /** Salon-scoped audit, in the caller's transaction (fail-closed: no row, no change). */
  private auditTenant(trx: Exec, ctx: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, action: string, summary: string,
    extra: { resourceType: string; resourceId?: string | null; before?: unknown; after?: unknown; reason?: string | null; metadata?: Record<string, unknown> }) {
    return recordAuditStrict(trx, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, userId: ctx.userId ?? null, role: ctx.role ?? null },
      { module: 'loyalty', action, summary, resourceType: extra.resourceType, resourceId: extra.resourceId ?? null, reason: extra.reason ?? null, metadata: extra.metadata ?? {},
        before: (extra.before ?? null) as Record<string, unknown> | null, after: (extra.after ?? null) as Record<string, unknown> | null });
  }
  /** Platform-wide (Super Admin) audit — audit_logs allows no salon — in the caller's transaction. */
  private async auditPlatform(trx: Exec, actorUserId: string, action: string, entityType: string, entityId: string | null, meta: Record<string, unknown>) {
    await recordPlatformAuditStrict(trx as Kysely<any>, { userId: actorUserId, role: 'super_admin' },
      { module: 'loyalty', action: action.replace(/^loyalty\./, ''), resourceType: entityType, resourceId: entityId, metadata: meta });
  }

  async program(x: Exec = this.db): Promise<ProgramPolicy> {
    const r = (await sql<Row>`SELECT ${PROGRAM_COLS} FROM global_rewards_program p WHERE p.id = 1`.execute(x)).rows[0];
    if (!r) throw new GlobalRewardsError('The rewards program is not configured.', 'LOYALTY_DISABLED', 503);
    return programOf(r);
  }
  flags(tenantId: string | null): Promise<GrFlagState> { return flagState(this.db, tenantId); }

  async enrollment(x: Exec, tenantId: string): Promise<{ status: 'enrolled' | 'suspended' | 'withdrawn' | 'not_enrolled'; earningSuspended: boolean; purchasingSuspended: boolean; termsVersion: string | null; enrolledAt: string | null }> {
    const r = (await sql<Row>`SELECT e.status, e.earning_suspended, e.purchasing_suspended, e.terms_version, e.enrolled_at FROM global_rewards_enrollments e WHERE e.tenant_id = ${tenantId}::uuid`.execute(x)).rows[0];
    if (!r) return { status: 'not_enrolled', earningSuspended: false, purchasingSuspended: false, termsVersion: null, enrolledAt: null };
    return { status: r.status, earningSuspended: !!r.earning_suspended, purchasingSuspended: !!r.purchasing_suspended, termsVersion: r.terms_version ?? null, enrolledAt: iso(r.enrolled_at) };
  }

  /** The global default version in force at `at` (read live — addendum §1.3). */
  async globalRuleAt(x: Exec, at: Date): Promise<EffectiveEarningRule | null> {
    const r = (await sql<Row>`SELECT ${GV_COLS} FROM global_earning_rule_versions g WHERE g.status = 'published' AND g.effective_from <= ${at.toISOString()}::timestamptz
      ORDER BY g.effective_from DESC, g.version_no DESC LIMIT 1`.execute(x)).rows[0];
    return r ? globalRuleOf(r) : null;
  }
  async globalVersions(x: Exec = this.db): Promise<(EffectiveEarningRule & { status: string; reason: string | null; createdAt: string | null })[]> {
    const r = await sql<Row>`SELECT ${GV_COLS} FROM global_earning_rule_versions g ORDER BY g.effective_from DESC, g.version_no DESC LIMIT 200`.execute(x);
    return r.rows.map((x2) => ({ ...globalRuleOf(x2), status: String(x2.status), reason: x2.reason ?? null, createdAt: iso(x2.created_at) }));
  }
  async tenantVersions(x: Exec, tenantId: string): Promise<(PolicyVersion & { reason: string | null; activatedAt: string | null; createdAt: string | null; recordVersion: number })[]> {
    const r = await sql<Row>`SELECT ${TV_COLS} FROM tenant_earning_policy_versions v WHERE v.tenant_id = ${tenantId}::uuid ORDER BY v.version_no DESC LIMIT 500`.execute(x);
    return r.rows.map((x2) => ({ ...versionOf(x2), reason: x2.reason ?? null, activatedAt: iso(x2.activated_at), createdAt: iso(x2.created_at), recordVersion: n(x2.record_version) }));
  }

  /**
   * THE earning-rule resolver (addendum §2.1–§2.4). Exactly one source per sale; the time is the sale's own completion
   * time, so a late worker or a retry resolves the rule that was in force THEN. Mandatory global gates (engine/earn
   * flags, program pause, enrollment, earning hold) apply to GLOBAL and CUSTOM alike. A tenant's insufficient wallet is
   * NOT decided here — funding never changes which rule applies (addendum §5.2).
   */
  async resolveEarningRule(x: Exec, trustedTenantId: string, effectiveAt: Date, flags?: GrFlagState): Promise<ResolveResult> {
    const program = await this.program(x);
    const f = flags ?? (await this.flags(trustedTenantId));
    if (!f.engine || !f.earn) return { ok: false, code: 'LOYALTY_DISABLED', reason: 'earning_flag_off', program };
    if (program.earnPaused) return { ok: false, code: 'LOYALTY_DISABLED', reason: 'program_earning_paused', program };
    const e = await this.enrollment(x, trustedTenantId);
    if (e.status !== 'enrolled') return { ok: false, code: 'MERCHANT_NOT_ENROLLED', reason: `merchant_${e.status}`, program };
    if (e.earningSuspended) return { ok: false, code: 'MERCHANT_NOT_ENROLLED', reason: 'merchant_earning_suspended', program };
    const t = (await sql<Row>`SELECT ${TV_COLS} FROM tenant_earning_policy_versions v WHERE v.tenant_id = ${trustedTenantId}::uuid AND v.status = 'ACTIVATED'
      AND v.effective_from <= ${effectiveAt.toISOString()}::timestamptz ORDER BY v.effective_from DESC, v.version_no DESC LIMIT 1`.execute(x)).rows[0];
    if (t && t.mode === 'CUSTOM') {
      // an impossible incomplete activated custom row is a safe error with an alert, never a guess (addendum §2.4)
      if (t.spend_increment_cents == null || t.point_tenths_per_increment == null) {
        logException(new Error('activated CUSTOM earning version is incomplete'), { where: 'global-rewards.resolve', tenantId: trustedTenantId, versionId: String(t.id) });
        return { ok: false, code: 'EARNING_RULE_INVALID', reason: 'custom_version_incomplete', program };
      }
      const { rate, clamped } = clampRateToPolicy(rateOf(t), program);   // C1 audit: today's platform limits win at issuance
      if (clamped) logException(new Error('active custom earning rate is outside the platform limits — issued at the limit'), { where: 'global-rewards.resolve', tenantId: trustedTenantId, versionId: String(t.id) });
      return { ok: true, program, rule: { source: 'TENANT_OVERRIDE', versionId: String(t.id), versionNo: n(t.version_no), effectiveFrom: iso(t.effective_from)!, ...rate } };
    }
    const g = await this.globalRuleAt(x, effectiveAt);
    if (!g) return { ok: false, code: 'LOYALTY_DISABLED', reason: 'no_global_rule', program };
    return { ok: true, program, rule: g };
  }

  // ── the owner's earning controls (addendum §3, §4) ────────────────────────────────────────────────────────────────
  async policyView(ctx: GrCtx, now = new Date()) {
    const T = ctx.tenantId;
    const [program, flags, enrollment, versions, globalNow] = await Promise.all([this.program(), this.flags(T), this.enrollment(this.db, T), this.tenantVersions(this.db, T), this.globalRuleAt(this.db, now)]);
    const nextGlobal = (await sql<Row>`SELECT ${GV_COLS} FROM global_earning_rule_versions g WHERE g.status = 'published' AND g.effective_from > ${now.toISOString()}::timestamptz
      ORDER BY g.effective_from ASC LIMIT 1`.execute(this.db)).rows[0];
    const d = policyDisplay(versions, now);
    const effective = d.current?.mode === 'CUSTOM' && d.current.rate
      ? { source: 'TENANT_OVERRIDE' as const, versionId: d.current.id, versionNo: d.current.versionNo, effectiveFrom: d.current.effectiveFrom, ...d.current.rate }
      : globalNow ? { ...globalNow } : null;
    const wallet = await this.walletSummary(T);
    const canEdit = canEditSettings(ctx);
    const show = (v: PolicyVersion) => ({ id: v.id, versionNo: v.versionNo, mode: v.mode, effectiveFrom: v.effectiveFrom, rate: v.rate, rateLabel: v.rate ? rateLabel(v.rate) : null });
    return {
      generatedAt: now.toISOString(),
      mode: d.mode,                                      // what is truly in force NOW
      effective: effective ? { ...effective, rateLabel: rateLabel(effective), sourceLabel: effective.source === 'TENANT_OVERRIDE' ? 'My Salon Custom Rule' : 'AI PowerSalon Global Default' } : null,
      globalNow: globalNow ? { ...globalNow, rateLabel: rateLabel(globalNow) } : null,
      globalNext: nextGlobal ? { ...globalRuleOf(nextGlobal), rateLabel: rateLabel(rateOf(nextGlobal)) } : null,
      scheduled: d.scheduled.map(show),
      drafts: d.drafts.map(show),
      program: { pointsPerRedeemBlock: program.pointsPerRedeemBlock, redeemBlockValueCents: program.redeemBlockValueCents, tokenValueCents: program.tokenValueCents,
        limits: { minSpendIncrementCents: program.customMinSpendIncrementCents, maxSpendIncrementCents: program.customMaxSpendIncrementCents,
          maxPointTenthsPerIncrement: program.customMaxPointTenthsPerIncrement, minEligibleFloorCents: program.customMinEligibleFloorCents, maxPointTenthsPerTicket: program.maxPointTenthsPerTicket },
        earnPaused: program.earnPaused, redeemPaused: program.redeemPaused, purchasesPaused: program.purchasesPaused,
        purchasePresetsTokens: program.purchasePresetsTokens, maxPurchaseTokens: program.maxPurchaseTokens, termsVersion: program.termsVersion },
      enrollment, wallet,
      flags: { engine: flags.engine, earn: flags.earn, redemption: flags.redemption, purchases: flags.purchases, customEarning: flags.customEarning },
      permissions: { canEdit, canActivate: canEdit && flags.customEarning && enrollment.status === 'enrolled', canBuyTokens: canEdit && flags.purchases && enrollment.status === 'enrolled' && !enrollment.purchasingSuspended && !program.purchasesPaused },
    };
  }

  async preview(ctx: GrCtx, input: Row, now = new Date()) {
    const program = await this.program();
    const proposed = validateCustomRate(input, program);
    const g = await this.globalRuleAt(this.db, now);
    if (!g) throw new GlobalRewardsError('No global earning rule is in force.', 'LOYALTY_DISABLED', 503);
    return { proposed: { ...proposed, rateLabel: rateLabel(proposed) }, global: { ...g, rateLabel: rateLabel(g) }, rows: previewRows(proposed, g, program).map((r) => ({ ...r, tokenCost: tokensLabel(r.tokenCostCents, program.tokenValueCents), globalTokenCost: tokensLabel(r.globalTokenCostCents, program.tokenValueCents) })) };
  }

  private async mustEditCustom(ctx: GrCtx): Promise<{ program: ProgramPolicy; flags: GrFlagState }> {
    if (!canEditSettings(ctx)) throw new GlobalRewardsError('Only the owner (or a manager given settings access) can change the earning rule.', 'PERMISSION_DENIED', 403);
    const [program, flags] = await Promise.all([this.program(), this.flags(ctx.tenantId)]);
    if (!flags.engine || !flags.customEarning) throw new GlobalRewardsError('Custom earning rules are not turned on for this salon.', 'CUSTOM_EARNING_DISABLED', 403);
    return { program, flags };
  }
  private async nextVersionNo(x: Exec, tenantId: string): Promise<number> {
    return n((await sql<Row>`SELECT coalesce(max(v.version_no), 0) + 1 AS nv FROM tenant_earning_policy_versions v WHERE v.tenant_id = ${tenantId}::uuid`.execute(x)).rows[0]?.nv);
  }

  /** Save (or update) a CUSTOM draft. A draft never changes the effective rule (T02). */
  async saveDraft(ctx: GrCtx, input: Row & { draftId?: string; expectedVersion?: number }) {
    const { program } = await this.mustEditCustom(ctx);
    const rate = validateCustomRate(input as Parameters<typeof validateCustomRate>[0], program);
    return this.db.transaction().execute(async (trx) => {
      await lockTenantPolicy(trx, ctx.tenantId);
      if (input.draftId) {
        const r = (await sql<Row>`UPDATE tenant_earning_policy_versions v SET spend_increment_cents = ${rate.spendIncrementCents}, point_tenths_per_increment = ${rate.pointTenthsPerIncrement},
            min_eligible_cents = ${rate.minEligibleCents}, per_ticket_cap_tenths = ${rate.perTicketCapTenths}, updated_by = ${actor(ctx.userId)}, updated_at = now(), record_version = v.record_version + 1
          WHERE v.tenant_id = ${ctx.tenantId}::uuid AND v.id = ${input.draftId}::uuid AND ${canMoveToSql(TENANT_EARNING_POLICY_VERSION, 'DRAFT', 'v')}
            AND (${input.expectedVersion ?? null}::int IS NULL OR v.record_version = ${input.expectedVersion ?? null}::int) RETURNING v.id, v.version_no, v.record_version`.execute(trx)).rows[0];
        if (!r) throw new GlobalRewardsError('That draft changed or is no longer a draft. Reload and try again.', 'EARNING_POLICY_CONFLICT', 409);
        await this.auditTenant(trx, ctx, 'loyalty.earning.draft_saved', `Custom earning draft updated: ${rateLabel(rate)}`, { resourceType: 'tenant_earning_policy_version', resourceId: String(r.id), after: { ...rate } });
        return { draftId: String(r.id), versionNo: n(r.version_no), recordVersion: n(r.record_version), rate };
      }
      const vn = await this.nextVersionNo(trx, ctx.tenantId);
      const r = (await sql<Row>`INSERT INTO tenant_earning_policy_versions (tenant_id, version_no, mode, spend_increment_cents, point_tenths_per_increment, min_eligible_cents, per_ticket_cap_tenths, status, created_by, updated_by)
        VALUES (${ctx.tenantId}::uuid, ${vn}, 'CUSTOM', ${rate.spendIncrementCents}, ${rate.pointTenthsPerIncrement}, ${rate.minEligibleCents}, ${rate.perTicketCapTenths}, 'DRAFT', ${actor(ctx.userId)}, ${actor(ctx.userId)})
        RETURNING id, version_no, record_version`.execute(trx)).rows[0];
      await this.auditTenant(trx, ctx, 'loyalty.earning.draft_saved', `Custom earning draft saved: ${rateLabel(rate)}`, { resourceType: 'tenant_earning_policy_version', resourceId: String(r.id), after: { ...rate } });
      return { draftId: String(r.id), versionNo: n(r.version_no), recordVersion: n(r.record_version), rate };
    });
  }

  async discardDraft(ctx: GrCtx, draftId: string) {
    if (!canEditSettings(ctx)) throw new GlobalRewardsError('Only the owner can change the earning rule.', 'PERMISSION_DENIED', 403);
    const r = (await sql<Row>`UPDATE tenant_earning_policy_versions v SET status = 'DISCARDED', updated_by = ${actor(ctx.userId)}, updated_at = now(), record_version = v.record_version + 1
      WHERE v.tenant_id = ${ctx.tenantId}::uuid AND v.id = ${draftId}::uuid AND ${canMoveToSql(TENANT_EARNING_POLICY_VERSION, 'DISCARDED', 'v')} RETURNING v.id`.execute(this.db)).rows[0];
    if (!r) throw new GlobalRewardsError('That draft was not found.', 'RESOURCE_NOT_FOUND', 404);
    return { discarded: String(r.id) };
  }

  /** The effective time of an activation: now, or a future moment — never the past (NO BACKDATED REPRICING). */
  private effectiveTime(raw: unknown, now: Date): Date {
    if (raw == null || raw === '') return now;
    const t = new Date(String(raw));
    if (Number.isNaN(t.getTime())) throw new GlobalRewardsError('The effective date/time is not valid.', 'VALIDATION_FAILED', 400, { field: 'effectiveFrom' });
    if (t.getTime() < now.getTime() - 60_000) throw new GlobalRewardsError('An earning rule cannot start in the past.', 'EARNING_RULE_INVALID', 400, { field: 'effectiveFrom' });
    if (t.getTime() > now.getTime() + 366 * 86_400_000) throw new GlobalRewardsError('An earning rule can be scheduled at most one year ahead.', 'EARNING_RULE_INVALID', 400, { field: 'effectiveFrom' });
    return t.getTime() < now.getTime() ? now : t;
  }

  /** Activate a CUSTOM rate (a state transition, not a field toggle — addendum §4.4). Caller: step-up + audit. */
  async activateCustom(ctx: GrCtx, input: Row & { draftId?: string; effectiveFrom?: string | null; reason?: string | null }, now = new Date()) {
    const { program } = await this.mustEditCustom(ctx);
    const e = await this.enrollment(this.db, ctx.tenantId);
    if (e.status !== 'enrolled') throw new GlobalRewardsError('This salon is not enrolled in the AI PowerSalon rewards network.', 'MERCHANT_NOT_ENROLLED', 403);
    const at = this.effectiveTime(input.effectiveFrom, now);
    return this.db.transaction().execute(async (trx) => {
      await lockTenantPolicy(trx, ctx.tenantId);
      const before = policyVersionAt(await this.tenantVersions(trx, ctx.tenantId), now);
      let row: Row | undefined;
      try {
        if (input.draftId) {
          const d = (await sql<Row>`SELECT ${TV_COLS} FROM tenant_earning_policy_versions v WHERE v.tenant_id = ${ctx.tenantId}::uuid AND v.id = ${input.draftId}::uuid FOR UPDATE`.execute(trx)).rows[0];
          if (!d || d.status !== 'DRAFT') throw new GlobalRewardsError('That draft was not found or was already used.', 'EARNING_POLICY_CONFLICT', 409);
          validateCustomRate(rateOf(d), program);   // the limits may have changed since the draft was saved
          row = (await sql<Row>`UPDATE tenant_earning_policy_versions v SET status = 'ACTIVATED', effective_from = ${at.toISOString()}::timestamptz, activated_by = ${actor(ctx.userId)},
              activated_at = now(), reason = ${input.reason ?? null}, updated_by = ${actor(ctx.userId)}, updated_at = now(), record_version = v.record_version + 1
            WHERE v.tenant_id = ${ctx.tenantId}::uuid AND v.id = ${input.draftId}::uuid AND ${canMoveToSql(TENANT_EARNING_POLICY_VERSION, 'ACTIVATED', 'v')} RETURNING ${TV_COLS}`.execute(trx)).rows[0];
        } else {
          const rate = validateCustomRate(input as Parameters<typeof validateCustomRate>[0], program);
          const vn = await this.nextVersionNo(trx, ctx.tenantId);
          row = (await sql<Row>`INSERT INTO tenant_earning_policy_versions AS v (tenant_id, version_no, mode, spend_increment_cents, point_tenths_per_increment, min_eligible_cents, per_ticket_cap_tenths,
              effective_from, status, reason, created_by, updated_by, activated_by, activated_at)
            VALUES (${ctx.tenantId}::uuid, ${vn}, 'CUSTOM', ${rate.spendIncrementCents}, ${rate.pointTenthsPerIncrement}, ${rate.minEligibleCents}, ${rate.perTicketCapTenths},
              ${at.toISOString()}::timestamptz, 'ACTIVATED', ${input.reason ?? null}, ${actor(ctx.userId)}, ${actor(ctx.userId)}, ${actor(ctx.userId)}, now()) RETURNING ${TV_COLS}`.execute(trx)).rows[0];
        }
      } catch (err: any) {
        if (String(err?.code) === '23505') throw new GlobalRewardsError('Another earning change starts at that exact time. Pick another time.', 'EARNING_POLICY_CONFLICT', 409);
        throw err;
      }
      if (!row) throw new GlobalRewardsError('That draft could not be activated.', 'EARNING_POLICY_CONFLICT', 409);
      const after = versionOf(row);
      await this.auditTenant(trx, ctx, 'loyalty.earning.custom_activated', `Custom earning rule ${after.rate ? rateLabel(after.rate) : ''} activated from ${at.toISOString()}`,
        { resourceType: 'tenant_earning_policy_version', resourceId: after.id, before: before ? { mode: before.mode, versionId: before.id, rate: before.rate } : { mode: 'GLOBAL' }, after: { mode: 'CUSTOM', versionId: after.id, rate: after.rate, effectiveFrom: at.toISOString() }, reason: input.reason ?? null });
      return { before, after: versionOf(row), effectiveFrom: at.toISOString(), scheduled: at.getTime() > now.getTime() + 1000 };
    });
  }

  /** Return to Global (addendum §4.5): a new versioned transition; history, points and tokens untouched. */
  async useGlobal(ctx: GrCtx, input: { effectiveFrom?: string | null; reason?: string | null; confirm?: boolean }, now = new Date()) {
    if (!canEditSettings(ctx)) throw new GlobalRewardsError('Only the owner can change the earning rule.', 'PERMISSION_DENIED', 403);
    if (input.confirm !== true) throw new GlobalRewardsError('Confirm the return to the AI PowerSalon global rules.', 'VALIDATION_FAILED', 400, { field: 'confirm' });
    const at = this.effectiveTime(input.effectiveFrom, now);
    return this.db.transaction().execute(async (trx) => {
      await lockTenantPolicy(trx, ctx.tenantId);
      const versions = await this.tenantVersions(trx, ctx.tenantId);
      const before = policyVersionAt(versions, now);
      const scheduledCustom = versions.some((v) => v.status === 'ACTIVATED' && v.mode === 'CUSTOM' && v.effectiveFrom && Date.parse(v.effectiveFrom) > now.getTime());
      if ((before?.mode ?? 'GLOBAL') === 'GLOBAL' && !scheduledCustom) throw new GlobalRewardsError('This salon already uses the global rules.', 'EARNING_POLICY_UNCHANGED', 409);
      const vn = await this.nextVersionNo(trx, ctx.tenantId);
      let row: Row | undefined;
      try {
        row = (await sql<Row>`INSERT INTO tenant_earning_policy_versions AS v (tenant_id, version_no, mode, effective_from, status, reason, created_by, updated_by, activated_by, activated_at)
          VALUES (${ctx.tenantId}::uuid, ${vn}, 'GLOBAL', ${at.toISOString()}::timestamptz, 'ACTIVATED', ${input.reason ?? null}, ${actor(ctx.userId)}, ${actor(ctx.userId)}, ${actor(ctx.userId)}, now())
          RETURNING ${TV_COLS}`.execute(trx)).rows[0];
      } catch (err: any) {
        if (String(err?.code) === '23505') throw new GlobalRewardsError('Another earning change starts at that exact time. Pick another time.', 'EARNING_POLICY_CONFLICT', 409);
        throw err;
      }
      // C1 audit (Nov 4 2026): a custom rule scheduled to start AFTER this return would still have switched on at its time —
      // "Use Global Rules" cancels every scheduled custom change from this moment on (audited, through the machine)
      const superseded = (await sql<Row>`UPDATE tenant_earning_policy_versions v SET status = 'CANCELED', canceled_by = ${actor(ctx.userId)}, canceled_at = now(), updated_by = ${actor(ctx.userId)},
          updated_at = now(), record_version = v.record_version + 1
        WHERE v.tenant_id = ${ctx.tenantId}::uuid AND v.mode = 'CUSTOM' AND v.effective_from > ${at.toISOString()}::timestamptz AND v.id <> ${String(row!.id)}::uuid
          AND ${canMoveToSql(TENANT_EARNING_POLICY_VERSION, 'CANCELED', 'v')} RETURNING v.id`.execute(trx)).rows.map((r) => String(r.id));
      for (const id of superseded) await this.auditTenant(trx, ctx, 'loyalty.earning.change_canceled', 'Scheduled custom earning change canceled by the return to global rules', { resourceType: 'tenant_earning_policy_version', resourceId: id, before: { status: 'ACTIVATED' }, after: { status: 'CANCELED' } });
      await this.auditTenant(trx, ctx, 'loyalty.earning.global_selected', `Return to AI PowerSalon global rules from ${at.toISOString()}`,
        { resourceType: 'tenant_earning_policy_version', resourceId: String(row!.id), before: before ? { mode: before.mode, versionId: before.id, rate: before.rate } : { mode: 'GLOBAL' }, after: { mode: 'GLOBAL', effectiveFrom: at.toISOString() }, reason: input.reason ?? null });
      return { before, after: versionOf(row!), effectiveFrom: at.toISOString(), scheduled: at.getTime() > now.getTime() + 1000 };
    });
  }

  /** Cancel an activated transition that has not started yet. One that is in force can only be followed by a new one. */
  async cancelScheduled(ctx: GrCtx, versionId: string, now = new Date()) {
    if (!canEditSettings(ctx)) throw new GlobalRewardsError('Only the owner can change the earning rule.', 'PERMISSION_DENIED', 403);
    return this.db.transaction().execute(async (trx) => {
      await lockTenantPolicy(trx, ctx.tenantId);
      const r = (await sql<Row>`UPDATE tenant_earning_policy_versions v SET status = 'CANCELED', canceled_by = ${actor(ctx.userId)}, canceled_at = now(), updated_by = ${actor(ctx.userId)},
          updated_at = now(), record_version = v.record_version + 1
        WHERE v.tenant_id = ${ctx.tenantId}::uuid AND v.id = ${versionId}::uuid AND v.effective_from > ${now.toISOString()}::timestamptz
          AND ${canMoveToSql(TENANT_EARNING_POLICY_VERSION, 'CANCELED', 'v')} RETURNING ${TV_COLS}`.execute(trx)).rows[0];
      if (!r) throw new GlobalRewardsError('Only a change that has not started yet can be canceled.', 'EARNING_POLICY_CONFLICT', 409);
      await this.auditTenant(trx, ctx, 'loyalty.earning.change_canceled', `Scheduled ${String(r.mode).toLowerCase()} earning change canceled`, { resourceType: 'tenant_earning_policy_version', resourceId: String(r.id), before: { status: 'ACTIVATED' }, after: { status: 'CANCELED' } });
      return { canceled: versionOf(r) };
    });
  }

  async history(ctx: GrCtx, now = new Date()) {
    const versions = await this.tenantVersions(this.db, ctx.tenantId);
    const inForce = policyVersionAt(versions, now);
    return { items: versions.map((v) => ({ id: v.id, versionNo: v.versionNo, mode: v.mode, state: versionDisplayState(v, inForce, now), effectiveFrom: v.effectiveFrom,
      rate: v.rate, rateLabel: v.rate ? rateLabel(v.rate) : null, reason: v.reason, activatedAt: v.activatedAt, createdAt: v.createdAt })) };
  }

  // ── wallet ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async walletSummary(tenantId: string, x: Exec = this.db) {
    const program = await this.program(x);
    const w = (await sql<Row>`SELECT w.available_cents, w.lifetime_funded_cents, w.lifetime_allocated_cents, w.deficit_cents, w.status, w.alert_level, w.updated_at, w.low_balance_cents_override, w.critical_balance_cents_override
      FROM tenant_token_wallets w WHERE w.tenant_id = ${tenantId}::uuid`.execute(x)).rows[0];
    const pend = (await sql<Row>`SELECT coalesce(sum(i.token_cents), 0) AS pending, count(*) AS n FROM token_purchase_intents i
      WHERE i.tenant_id = ${tenantId}::uuid AND i.status IN ('REQUESTED', 'PROCESSING', 'UNKNOWN', 'PAYMENT_CONFIRMED', 'SETTLEMENT_PENDING')`.execute(x)).rows[0];
    // "this month" is the SALON's month (its first branch's zone), never the server's UTC month
    const tzRow = (await sql<Row>`SELECT b.timezone FROM branches b WHERE b.tenant_id = ${tenantId}::uuid AND b.deleted_at IS NULL ORDER BY b.created_at LIMIT 1`.execute(x)).rows[0];
    const tz = tzRow?.timezone && isValidTimeZone(String(tzRow.timezone)) ? String(tzRow.timezone) : 'America/New_York';
    const monthStart = new Date(monthStartMs(tz)).toISOString();
    const month = (await sql<Row>`SELECT coalesce(-sum(l.delta_cents), 0) AS used FROM token_wallet_ledger l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.entry_type = 'earn_allocation' AND l.created_at >= ${monthStart}::timestamptz`.execute(x)).rows[0];
    const available = n(w?.available_cents);
    const branchUsage = await this.branchUsage(tenantId, monthStart, n(month?.used), x);
    // extras GLOBAL LOYALTY REWARDS 03 (round 10): the funding forecast from VERIFIED history — the wallet's own earn_allocation
    // ledger rows over the last FORECAST_BASIS_DAYS (a rolling window, not the calendar month), never a guess; nothing is bought
    const basis = (await sql<Row>`SELECT coalesce(-sum(l.delta_cents), 0) AS used, min(l.created_at) AS first_at FROM token_wallet_ledger l
      WHERE l.tenant_id = ${tenantId}::uuid AND l.entry_type = 'earn_allocation' AND l.created_at >= now() - make_interval(days => ${FORECAST_BASIS_DAYS})`.execute(x)).rows[0];
    const forecast = walletFundingForecast(available, n(pend?.pending), n(basis?.used), FORECAST_BASIS_DAYS, walletLevels(program, w).lowBalanceCents);
    return {
      // wallet amounts are money cents: 1 token = tokenValueCents cents, so the funded dollar value IS availableCents
      exists: !!w, availableCents: available, available: tokensLabel(available, program.tokenValueCents), availableValueCents: available,
      pendingCents: n(pend?.pending), pendingPurchases: n(pend?.n), usedThisMonthCents: n(month?.used),
      lifetimeFundedCents: n(w?.lifetime_funded_cents), lifetimeAllocatedCents: n(w?.lifetime_allocated_cents), deficitCents: n(w?.deficit_cents),
      status: (w?.status as string) ?? 'active', alertLevel: alertLevel(available, walletLevels(program, w)), tokenValueCents: program.tokenValueCents, updatedAt: iso(w?.updated_at),
      // C1 audit §5.6: the warning levels in force (the salon's own when set) and the platform defaults
      lowBalanceCents: walletLevels(program, w).lowBalanceCents, criticalBalanceCents: walletLevels(program, w).criticalBalanceCents, levelsOwn: w?.low_balance_cents_override != null || w?.critical_balance_cents_override != null,
      platformLowBalanceCents: program.lowBalanceCents, platformCriticalBalanceCents: program.criticalBalanceCents,
      branchUsage, forecast, fundingVsLiability: await this.fundingVsLiability(tenantId, available, x),
    };
  }

  /** extras GLOBAL LOYALTY REWARDS 06 (round 10) — Funding vs Liability, side by side and NEVER combined: each figure is read
   *  from its own ledger — backed funding (this salon's token wallet balance), the points customers earned here and what
   *  backed them (global_points_ledger earn rows at this salon vs the wallet's earn_allocation debits), points HELD on open
   *  redemptions here (reward_redemptions HELD), and what the network still owes this salon (merchant_reimbursements not
   *  paid / offset). Read only. */
  async fundingVsLiability(tenantId: string, walletAvailableCents: number, x: Exec = this.db) {
    const earned = (await sql<Row>`SELECT coalesce(sum(g.delta_tenths), 0)::bigint AS tenths FROM global_points_ledger g
      WHERE g.tenant_id = ${tenantId}::uuid AND g.delta_tenths > 0 AND g.source_table = 'reward_earn_transactions'`.execute(x)).rows[0];
    const backed = (await sql<Row>`SELECT coalesce(-sum(l.delta_cents), 0)::bigint AS cents FROM token_wallet_ledger l WHERE l.tenant_id = ${tenantId}::uuid AND l.entry_type = 'earn_allocation'`.execute(x)).rows[0];
    const held = (await sql<Row>`SELECT count(*)::int AS n, coalesce(sum(r.point_tenths), 0)::bigint AS tenths, coalesce(sum(r.value_cents), 0)::bigint AS cents FROM reward_redemptions r
      WHERE r.tenant_id = ${tenantId}::uuid AND r.status = 'HELD'`.execute(x)).rows[0];
    const owed = (await sql<Row>`SELECT count(*)::int AS n, coalesce(sum(m.amount_cents + m.adjusted_cents), 0)::bigint AS cents FROM merchant_reimbursements m
      WHERE m.tenant_id = ${tenantId}::uuid AND m.status NOT IN ('PAID', 'OFFSET')`.execute(x)).rows[0];
    return {
      backedFundingCents: walletAvailableCents,
      pointsEarnedHereTenths: n(earned?.tenths), earnBackingCents: n(backed?.cents),
      heldRedemptions: n(held?.n), heldPointTenths: n(held?.tenths), heldValueCents: n(held?.cents),
      salonPayablesOpen: n(owed?.n), salonPayablesOwedCents: n(owed?.cents),
      combined: false as const,
    };
  }

  /** Extras (GLOBAL LOYALTY REWARDS 13): ONE salon wallet, truthfully attributed per branch for this salon month — the points each
   *  branch's earnings funded (from the wallet's own earn_allocation rows, joined to the earning that caused each one) and the
   *  rewards each branch accepted. Read-only. `matchesWallet` says the branch rows add up to the wallet's "used this month";
   *  `doubleFunded` counts earnings with more than one allocation (should be 0 — the same rule the books check uses). */
  async branchUsage(tenantId: string, monthStart: string, walletUsedCents: number, x: Exec = this.db) {
    const earn = (await sql<{ branch_id: string | null; branch_name: string | null; earns: number; tenths: number; funded: number }>`SELECT e.branch_id, b.name AS branch_name, count(DISTINCT e.id)::int AS earns,
        coalesce(sum(e.point_tenths), 0)::bigint AS tenths, coalesce(-sum(l.delta_cents), 0)::bigint AS funded
      FROM token_wallet_ledger l JOIN reward_earn_transactions e ON e.id::text = l.source_id AND e.tenant_id = l.tenant_id
      LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
      WHERE l.tenant_id = ${tenantId}::uuid AND l.entry_type = 'earn_allocation' AND l.created_at >= ${monthStart}::timestamptz
      GROUP BY e.branch_id, b.name`.execute(x)).rows;
    const red = (await sql<{ branch_id: string | null; branch_name: string | null; c: number; v: number }>`SELECT r.branch_id, rb.name AS branch_name, count(*)::int AS c, coalesce(sum(r.value_cents), 0)::bigint AS v
      FROM reward_redemptions r LEFT JOIN branches rb ON rb.id = r.branch_id AND rb.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.status = 'CONFIRMED_REDEEMED' AND r.confirmed_at >= ${monthStart}::timestamptz
      GROUP BY r.branch_id, rb.name`.execute(x)).rows;
    const dup = (await sql<{ c: number }>`SELECT count(*)::int AS c FROM (SELECT l.source_id FROM token_wallet_ledger l WHERE l.tenant_id = ${tenantId}::uuid AND l.entry_type = 'earn_allocation'
      AND l.created_at >= ${monthStart}::timestamptz GROUP BY l.source_id HAVING count(*) > 1) d`.execute(x)).rows[0];
    const by = new Map<string, { branchId: string | null; branchName: string | null; earnings: number; pointTenths: number; fundedCents: number; redemptions: number; redeemedValueCents: number }>();
    const row = (id: string | null, name: string | null) => { const k = id ?? ''; if (!by.has(k)) by.set(k, { branchId: id, branchName: name, earnings: 0, pointTenths: 0, fundedCents: 0, redemptions: 0, redeemedValueCents: 0 }); return by.get(k)!; };
    for (const e of earn) { const r = row(e.branch_id ? String(e.branch_id) : null, e.branch_name ?? null); r.earnings += n(e.earns); r.pointTenths += n(e.tenths); r.fundedCents += n(e.funded); }
    for (const d of red) { const r = row(d.branch_id ? String(d.branch_id) : null, d.branch_name ?? null); r.redemptions += n(d.c); r.redeemedValueCents += n(d.v); }
    const rows = [...by.values()].sort((a, b) => b.fundedCents - a.fundedCents || (a.branchName ?? '').localeCompare(b.branchName ?? ''));
    const totalFundedCents = rows.reduce((a, r) => a + r.fundedCents, 0);
    return { since: monthStart, rows, totalFundedCents, walletUsedCents, matchesWallet: totalFundedCents === walletUsedCents, doubleFunded: n(dup?.c) };
  }

  /** C1 audit (Nov 4 2026) LoyaltyTokens §5.6: the salon's own low / critical warning levels (null = the platform default).
   *  Owner (settings.edit) only; critical never above low; audited with before / after. The alert level is recomputed. */
  async setWalletLevels(ctx: GrCtx, input: { lowBalanceCents?: unknown; criticalBalanceCents?: unknown }) {
    if (!canEditSettings(ctx)) throw new GlobalRewardsError('Only the owner can change the warning levels.', 'PERMISSION_DENIED', 403);
    const val = (v: unknown, field: string): number | null => {
      if (v == null || v === '') return null;
      const x = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(x) || x < 0 || x > 1_000_000) throw new GlobalRewardsError(`${field} must be a whole number of cents from 0 to 1,000,000.`, 'VALIDATION_FAILED', 400, { field });
      return x;
    };
    const low = val(input.lowBalanceCents, 'lowBalanceCents'), crit = val(input.criticalBalanceCents, 'criticalBalanceCents');
    const program = await this.program();
    if ((crit ?? program.criticalBalanceCents) > (low ?? program.lowBalanceCents)) throw new GlobalRewardsError('The critical level must be at or below the low level.', 'VALIDATION_FAILED', 400, { field: 'criticalBalanceCents' });
    return this.db.transaction().execute(async (trx) => {
      await sql`INSERT INTO tenant_token_wallets (tenant_id) VALUES (${ctx.tenantId}::uuid) ON CONFLICT (tenant_id) DO NOTHING`.execute(trx);
      const before = (await sql<Row>`SELECT w.available_cents, w.low_balance_cents_override, w.critical_balance_cents_override FROM tenant_token_wallets w WHERE w.tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
      const next = { low_balance_cents_override: low, critical_balance_cents_override: crit };
      await sql`UPDATE tenant_token_wallets w SET low_balance_cents_override = ${low}, critical_balance_cents_override = ${crit},
          alert_level = ${alertLevel(n(before?.available_cents), walletLevels(program, next))}, version = w.version + 1, updated_at = now() WHERE w.tenant_id = ${ctx.tenantId}::uuid`.execute(trx);
      await this.auditTenant(trx, ctx, 'loyalty.wallet.alert_levels_set', `Token balance warnings: low ${low ?? 'platform default'}, critical ${crit ?? 'platform default'} (cents)`,
        { resourceType: 'tenant_token_wallet', resourceId: ctx.tenantId, before: { lowBalanceCents: before?.low_balance_cents_override ?? null, criticalBalanceCents: before?.critical_balance_cents_override ?? null }, after: { lowBalanceCents: low, criticalBalanceCents: crit } });
      return { lowBalanceCents: low, criticalBalanceCents: crit, effective: walletLevels(program, next) };
    });
  }

  /** Credit the wallet (FUNDS_VERIFIED purchase, an earn reversal). Row lock + ledger + journal in the caller's transaction. */
  async creditWallet(trx: Transaction<any>, a: { tenantId: string; branchId?: string | null; cents: number; entryType: 'purchase_funded' | 'earn_reversal'; sourceTable: string; sourceId: string; actorUserId?: string | null; reason?: string | null; journal: { entryType: string; lines: JournalLine[]; memo?: string } }): Promise<{ duplicate: boolean; balanceAfterCents: number }> {
    if (!(a.cents > 0) || !Number.isInteger(a.cents)) throw new GlobalRewardsError('A wallet credit must be a positive whole number of cents.', 'VALIDATION_FAILED', 500);
    await sql`INSERT INTO tenant_token_wallets (tenant_id) VALUES (${a.tenantId}::uuid) ON CONFLICT (tenant_id) DO NOTHING`.execute(trx);
    const w = (await sql<Row>`SELECT w.available_cents, w.low_balance_cents_override, w.critical_balance_cents_override FROM tenant_token_wallets w WHERE w.tenant_id = ${a.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
    const after = n(w.available_cents) + a.cents;
    const led = (await sql<Row>`INSERT INTO token_wallet_ledger (tenant_id, branch_id, entry_type, delta_cents, balance_after_cents, source_table, source_id, actor_user_id, reason)
      VALUES (${a.tenantId}::uuid, ${a.branchId ?? null}, ${a.entryType}, ${a.cents}, ${after}, ${a.sourceTable}, ${a.sourceId}, ${actor(a.actorUserId)}, ${a.reason ?? null})
      ON CONFLICT (tenant_id, source_table, source_id, entry_type) DO NOTHING RETURNING id`.execute(trx)).rows[0];
    if (!led) return { duplicate: true, balanceAfterCents: n(w.available_cents) };
    const program = await this.program(trx);
    await sql`UPDATE tenant_token_wallets w SET available_cents = ${after}, lifetime_funded_cents = w.lifetime_funded_cents + ${a.entryType === 'purchase_funded' ? a.cents : 0},
        lifetime_allocated_cents = w.lifetime_allocated_cents - ${a.entryType === 'earn_reversal' ? a.cents : 0}, alert_level = ${alertLevel(after, walletLevels(program, w))}, version = w.version + 1, updated_at = now()
      WHERE w.tenant_id = ${a.tenantId}::uuid`.execute(trx);
    await postJournal(trx, { entryType: a.journal.entryType, tenantId: a.tenantId, sourceTable: a.sourceTable, sourceId: a.sourceId, memo: a.journal.memo ?? null, lines: a.journal.lines });
    return { duplicate: false, balanceAfterCents: after };
  }

  /** Debit the wallet for funded points (earn). Refuses — never overdraws — when the balance is short. */
  async debitWallet(trx: Transaction<any>, a: { tenantId: string; branchId?: string | null; cents: number; sourceTable: string; sourceId: string; reason?: string | null }): Promise<{ ok: true; balanceAfterCents: number; duplicate: boolean } | { ok: false; availableCents: number; walletStatus: string }> {
    const w = (await sql<Row>`SELECT w.available_cents, w.status, w.low_balance_cents_override, w.critical_balance_cents_override FROM tenant_token_wallets w WHERE w.tenant_id = ${a.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
    const avail = n(w?.available_cents);
    if (!w || w.status !== 'active' || avail < a.cents) return { ok: false, availableCents: avail, walletStatus: String(w?.status ?? 'none') };
    const after = avail - a.cents;
    const led = (await sql<Row>`INSERT INTO token_wallet_ledger (tenant_id, branch_id, entry_type, delta_cents, balance_after_cents, source_table, source_id, reason)
      VALUES (${a.tenantId}::uuid, ${a.branchId ?? null}, 'earn_allocation', ${-a.cents}, ${after}, ${a.sourceTable}, ${a.sourceId}, ${a.reason ?? null})
      ON CONFLICT (tenant_id, source_table, source_id, entry_type) DO NOTHING RETURNING id`.execute(trx)).rows[0];
    if (!led) return { ok: true, balanceAfterCents: avail, duplicate: true };
    const program = await this.program(trx);
    await sql`UPDATE tenant_token_wallets w SET available_cents = ${after}, lifetime_allocated_cents = w.lifetime_allocated_cents + ${a.cents}, alert_level = ${alertLevel(after, walletLevels(program, w))},
        version = w.version + 1, updated_at = now() WHERE w.tenant_id = ${a.tenantId}::uuid AND w.available_cents >= ${a.cents}`.execute(trx);
    return { ok: true, balanceAfterCents: after, duplicate: false };
  }

  async walletLedger(tenantId: string, page = 1, pageSize = 20) {
    const size = Math.max(1, Math.min(50, Math.floor(pageSize) || 20)); const p = Math.max(1, Math.min(10_000, Math.floor(page) || 1));
    const total = n((await sql<Row>`SELECT count(*) AS c FROM token_wallet_ledger l WHERE l.tenant_id = ${tenantId}::uuid`.execute(this.db)).rows[0]?.c);
    const r = await sql<Row>`SELECT l.id, l.entry_type, l.delta_cents, l.balance_after_cents, l.source_table, l.source_id, l.branch_id, l.reason, l.created_at FROM token_wallet_ledger l
      WHERE l.tenant_id = ${tenantId}::uuid ORDER BY l.created_at DESC, l.id DESC LIMIT ${size} OFFSET ${(p - 1) * size}`.execute(this.db);
    return { total, page: p, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)), totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), items: r.rows.map((x) => ({ id: String(x.id), entryType: x.entry_type, deltaCents: n(x.delta_cents),
      balanceAfterCents: n(x.balance_after_cents), sourceTable: x.source_table, sourceId: String(x.source_id), branchId: x.branch_id ?? null, reason: x.reason ?? null, at: iso(x.created_at) })) };
  }

  // ── Buy Tokens (guide §5.2–§5.4) ───────────────────────────────────────────────────────────────────────────────
  async purchaseGates(tenantId: string) {
    const [program, flags, e, w] = await Promise.all([this.program(), this.flags(tenantId), this.enrollment(this.db, tenantId),
      sql<Row>`SELECT w.status FROM tenant_token_wallets w WHERE w.tenant_id = ${tenantId}::uuid`.execute(this.db)]);
    const walletStatus = (w.rows[0]?.status as string) ?? 'active';
    const reason = !flags.engine || !flags.purchases ? 'LOYALTY_DISABLED' : e.status !== 'enrolled' ? 'MERCHANT_NOT_ENROLLED' : e.purchasingSuspended || walletStatus !== 'active' ? 'WALLET_SUSPENDED'
      : program.purchasesPaused ? 'LOYALTY_DISABLED' : null;
    return { program, reason };
  }

  /** One logical purchase per idempotency key; a retry with the same key returns the same intent (never a new charge). */
  async createPurchase(ctx: GrCtx, input: { tokens: unknown; idempotencyKey: string; provider: string }) {
    if (!canEditSettings(ctx)) throw new GlobalRewardsError('Only the owner (or a manager given settings access) can buy tokens.', 'PERMISSION_DENIED', 403);
    const key = String(input.idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 120) throw new GlobalRewardsError('A purchase needs a request key.', 'VALIDATION_FAILED', 400, { field: 'idempotencyKey' });
    const { program, reason } = await this.purchaseGates(ctx.tenantId);
    if (reason) throw new GlobalRewardsError(reason === 'WALLET_SUSPENDED' ? 'Token purchases are suspended for this salon.' : reason === 'MERCHANT_NOT_ENROLLED' ? 'This salon is not enrolled in the rewards network.' : 'Token purchases are not available right now.', reason, 403);
    const q = purchaseQuantity(input.tokens, program);
    const existing = (await sql<Row>`SELECT i.id, i.token_cents, i.status FROM token_purchase_intents i WHERE i.tenant_id = ${ctx.tenantId}::uuid AND i.idempotency_key = ${key}`.execute(this.db)).rows[0];
    if (existing) {
      if (n(existing.token_cents) !== q.tokenCents) throw new GlobalRewardsError('That request key was already used for a different purchase.', 'IDEMPOTENCY_KEY_REUSED', 409);
      return { intentId: String(existing.id), created: false };
    }
    try {
      return await this.db.transaction().execute(async (trx) => {
        const r = (await sql<Row>`INSERT INTO token_purchase_intents (tenant_id, token_cents, amount_cents, fee_cents, status, idempotency_key, provider, policy_snapshot, initiated_by, updated_by)
          VALUES (${ctx.tenantId}::uuid, ${q.tokenCents}, ${q.amountCents}, 0, 'REQUESTED', ${key}, ${input.provider},
            ${JSON.stringify({ tokenValueCents: program.tokenValueCents, programVersion: program.version, termsVersion: program.termsVersion })}::jsonb, ${actor(ctx.userId)}, ${actor(ctx.userId)})
          ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`.execute(trx)).rows[0];
        if (!r) return { intentId: String((await sql<Row>`SELECT i.id FROM token_purchase_intents i WHERE i.tenant_id = ${ctx.tenantId}::uuid AND i.idempotency_key = ${key}`.execute(trx)).rows[0]?.id), created: false };
        await sql`INSERT INTO token_purchase_events (tenant_id, intent_id, from_status, to_status, source, actor_user_id) VALUES (${ctx.tenantId}::uuid, ${r.id}::uuid, NULL, 'REQUESTED', 'owner', ${actor(ctx.userId)})`.execute(trx);
        await this.auditTenant(trx, ctx, 'loyalty.tokens.purchase_requested', `Buy ${tokensLabel(q.tokenCents, program.tokenValueCents)} tokens requested`,
          { resourceType: 'token_purchase_intent', resourceId: String(r.id), after: { status: 'REQUESTED', tokenCents: q.tokenCents, amountCents: q.amountCents, provider: input.provider } });
        return { intentId: String(r.id), created: true };
      });
    } catch (err: any) {
      if (String(err?.code) === '23505') {
        const inflight = (await sql<Row>`SELECT i.id FROM token_purchase_intents i WHERE i.tenant_id = ${ctx.tenantId}::uuid AND i.status IN ('REQUESTED', 'PROCESSING', 'UNKNOWN') LIMIT 1`.execute(this.db)).rows[0];
        throw new GlobalRewardsError('A token purchase is still being verified. Wait for it before buying again.', 'PURCHASE_PENDING_VERIFICATION', 409, { intentId: inflight ? String(inflight.id) : null });
      }
      throw err;
    }
  }

  /**
   * Move a purchase through its lifecycle (guarded by the machine). FUNDS_VERIFIED credits the wallet exactly once in
   * the same transaction (ledger unique per intent + journal: Dr settlement cash / Cr merchant prepaid liability).
   */
  async movePurchase(intentId: string, to: PurchaseStatus, a: { tenantId: string; source: string; providerRef?: string | null; failureCode?: string | null; actorUserId?: string | null; detail?: Record<string, unknown> }) {
    return this.db.transaction().execute(async (trx) => {
      const cur = (await sql<Row>`SELECT i.id, i.tenant_id, i.status, i.token_cents, i.amount_cents, i.provider_ref FROM token_purchase_intents i WHERE i.id = ${intentId}::uuid
        AND i.tenant_id = ${a.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
      if (!cur) throw new GlobalRewardsError('That token purchase was not found.', 'RESOURCE_NOT_FOUND', 404);
      if (cur.status === to) return { intentId, status: to, changed: false };
      const upd = (await sql<Row>`UPDATE token_purchase_intents i SET status = ${to}, provider_ref = coalesce(${a.providerRef ?? null}, i.provider_ref), failure_code = coalesce(${a.failureCode ?? null}, i.failure_code),
          confirmed_at = CASE WHEN ${to} = 'PAYMENT_CONFIRMED' THEN now() ELSE i.confirmed_at END, funded_at = CASE WHEN ${to} = 'FUNDS_VERIFIED' THEN now() ELSE i.funded_at END,
          updated_by = ${actor(a.actorUserId)}, updated_at = now()
        WHERE i.id = ${intentId}::uuid AND i.tenant_id = ${cur.tenant_id}::uuid AND ${canMoveToSql(TOKEN_PURCHASE_INTENT, to, 'i')} RETURNING i.id`.execute(trx)).rows[0];
      if (!upd) throw new GlobalRewardsError(`A ${String(cur.status).toLowerCase()} purchase cannot become ${to.toLowerCase()}.`, 'INVALID_STATE_TRANSITION', 409);
      await sql`INSERT INTO token_purchase_events (tenant_id, intent_id, from_status, to_status, source, detail, actor_user_id)
        VALUES (${cur.tenant_id}::uuid, ${intentId}::uuid, ${cur.status}, ${to}, ${a.source}, ${JSON.stringify(a.detail ?? {})}::jsonb, ${actor(a.actorUserId)})`.execute(trx);
      await this.auditTenant(trx, { tenantId: String(cur.tenant_id), userId: a.actorUserId ?? null }, 'loyalty.tokens.purchase_status', `Token purchase ${String(cur.status)} → ${to}`,
        { resourceType: 'token_purchase_intent', resourceId: intentId, before: { status: cur.status }, after: { status: to }, metadata: { source: a.source, tokenCents: n(cur.token_cents) } });
      if (to === 'FUNDS_VERIFIED') {
        const cents = n(cur.token_cents);
        await this.creditWallet(trx, { tenantId: String(cur.tenant_id), cents, entryType: 'purchase_funded', sourceTable: 'token_purchase_intents', sourceId: intentId, actorUserId: a.actorUserId ?? null,
          reason: 'Token purchase funds verified', journal: { entryType: 'token_purchase_funded', memo: `Token purchase ${intentId}`, lines: [
            { account: 'settlement_cash', tenantId: null, debit: n(cur.amount_cents) }, { account: 'merchant_prepaid_liability', tenantId: String(cur.tenant_id), credit: cents },
            ...(n(cur.amount_cents) !== cents ? [{ account: 'funding_deficit_receivable' as const, tenantId: String(cur.tenant_id), ...(n(cur.amount_cents) < cents ? { debit: cents - n(cur.amount_cents) } : { credit: n(cur.amount_cents) - cents }) }] : []),
          ] } });
      }
      if (to === 'REVERSED' || to === 'CHARGED_BACK') await this.clawBackPurchase(trx, { tenantId: String(cur.tenant_id), intentId, tokenCents: n(cur.token_cents), amountCents: n(cur.amount_cents), to, actorUserId: a.actorUserId ?? null });
      return { intentId, status: to, changed: true, tenantId: String(cur.tenant_id) };
    });
  }

  /**
   * LoyaltyTokens guide (Nov 3 audit, P0): a purchase reversed or charged back AFTER it funded the wallet takes its tokens
   * back. Whatever is still in the wallet is debited (ledger 'purchase_reversal'); tokens already spent backing points
   * cannot be un-issued, so the shortfall is booked as funding_deficit_receivable and the wallet is LOCKED (no further
   * earning) until finance resolves it. The settlement cash goes back out. Exactly once per intent (ledger + journal unique).
   */
  private async clawBackPurchase(trx: Transaction<any>, a: { tenantId: string; intentId: string; tokenCents: number; amountCents: number; to: string; actorUserId: string | null }) {
    const funded = (await sql<Row>`SELECT 1 AS x FROM token_wallet_ledger l WHERE l.tenant_id = ${a.tenantId}::uuid AND l.source_table = 'token_purchase_intents'
      AND l.source_id = ${a.intentId} AND l.entry_type = 'purchase_funded'`.execute(trx)).rows[0];
    if (!funded) return; // never credited: nothing to take back
    const w = (await sql<Row>`SELECT w.available_cents, w.low_balance_cents_override, w.critical_balance_cents_override FROM tenant_token_wallets w WHERE w.tenant_id = ${a.tenantId}::uuid FOR UPDATE`.execute(trx)).rows[0];
    const avail = n(w?.available_cents);
    const clawed = Math.min(avail, a.tokenCents);
    const shortfall = a.tokenCents - clawed;
    if (clawed > 0) {
      const led = (await sql<Row>`INSERT INTO token_wallet_ledger (tenant_id, entry_type, delta_cents, balance_after_cents, source_table, source_id, actor_user_id, reason)
        VALUES (${a.tenantId}::uuid, 'purchase_reversal', ${-clawed}, ${avail - clawed}, 'token_purchase_intents', ${a.intentId}, ${actor(a.actorUserId)}, ${`Token purchase ${a.to.toLowerCase().replace('_', ' ')}`})
        ON CONFLICT (tenant_id, source_table, source_id, entry_type) DO NOTHING RETURNING id`.execute(trx)).rows[0];
      if (!led) return; // already clawed back
    }
    const program = await this.program(trx);
    await sql`UPDATE tenant_token_wallets w SET available_cents = w.available_cents - ${clawed}, lifetime_funded_cents = greatest(0, w.lifetime_funded_cents - ${a.tokenCents}),
        alert_level = ${alertLevel(avail - clawed, walletLevels(program, w))}, version = w.version + 1, updated_at = now()
      WHERE w.tenant_id = ${a.tenantId}::uuid`.execute(trx);
    if (shortfall > 0) await sql`UPDATE tenant_token_wallets w SET status = 'locked', updated_at = now()
      WHERE w.tenant_id = ${a.tenantId}::uuid AND ${canMoveToSql(TENANT_TOKEN_WALLET, 'locked', 'w')}`.execute(trx);
    const deficit = a.amountCents - clawed; // what the salon still owes the network (spent tokens, and any funding difference)
    await postJournal(trx, { entryType: 'purchase_reversed', tenantId: a.tenantId, sourceTable: 'token_purchase_intents', sourceId: a.intentId, memo: `Token purchase ${a.intentId} ${a.to.toLowerCase()}`, lines: [
      { account: 'settlement_cash', tenantId: null, credit: a.amountCents },
      ...(clawed > 0 ? [{ account: 'merchant_prepaid_liability' as const, tenantId: a.tenantId, debit: clawed }] : []),
      ...(deficit > 0 ? [{ account: 'funding_deficit_receivable' as const, tenantId: a.tenantId, debit: deficit }] : deficit < 0 ? [{ account: 'funding_deficit_receivable' as const, tenantId: a.tenantId, credit: -deficit }] : []),
    ] });
    await this.auditTenant(trx, { tenantId: a.tenantId, userId: a.actorUserId }, 'loyalty.tokens.purchase_clawed_back', `Token purchase ${a.to.toLowerCase()}: ${clawed} cents taken back${shortfall > 0 ? `, ${shortfall} cents already spent — wallet locked` : ''}`,
      { resourceType: 'token_purchase_intent', resourceId: a.intentId, metadata: { clawedCents: clawed, shortfallCents: shortfall, walletLocked: shortfall > 0 } });
  }

  async purchases(tenantId: string, page = 1, pageSize = 20) {
    const size = Math.max(1, Math.min(50, Math.floor(pageSize) || 20)); const p = Math.max(1, Math.min(10_000, Math.floor(page) || 1));
    const total = n((await sql<Row>`SELECT count(*) AS c FROM token_purchase_intents i WHERE i.tenant_id = ${tenantId}::uuid`.execute(this.db)).rows[0]?.c);
    const r = await sql<Row>`SELECT i.id, i.tenant_id, i.token_cents, i.amount_cents, i.fee_cents, i.status, i.provider, i.provider_ref, i.failure_code, i.initiated_by, i.created_at, i.confirmed_at, i.funded_at
      FROM token_purchase_intents i WHERE i.tenant_id = ${tenantId}::uuid ORDER BY i.created_at DESC, i.id DESC LIMIT ${size} OFFSET ${(p - 1) * size}`.execute(this.db);
    return { total, page: p, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)), totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), items: r.rows.map(purchaseRow) };
  }
  async purchase(tenantId: string, id: string) {
    const r = (await sql<Row>`SELECT i.id, i.tenant_id, i.token_cents, i.amount_cents, i.fee_cents, i.status, i.provider, i.provider_ref, i.failure_code, i.created_at, i.confirmed_at, i.funded_at
      FROM token_purchase_intents i WHERE i.id = ${id}::uuid AND i.tenant_id = ${tenantId}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new GlobalRewardsError('That token purchase was not found.', 'RESOURCE_NOT_FOUND', 404);
    const ev = await sql<Row>`SELECT e.from_status, e.to_status, e.source, e.created_at FROM token_purchase_events e WHERE e.intent_id = ${id}::uuid AND e.tenant_id = ${r.tenant_id}::uuid ORDER BY e.created_at, e.id`.execute(this.db);
    return { id: String(r.id), tenantId: String(r.tenant_id), tokenCents: n(r.token_cents), amountCents: n(r.amount_cents), feeCents: n(r.fee_cents), status: r.status as PurchaseStatus,
      pending: isPending(String(r.status)), spendable: r.status === 'FUNDS_VERIFIED', provider: r.provider, providerRefLast6: r.provider_ref ? String(r.provider_ref).slice(-6) : null, providerRef: r.provider_ref ?? null,
      failureCode: r.failure_code ?? null, createdAt: iso(r.created_at), confirmedAt: iso(r.confirmed_at), fundedAt: iso(r.funded_at),
      events: ev.rows.map((e) => ({ from: e.from_status ?? null, to: e.to_status, source: e.source, at: iso(e.created_at) })) };
  }

  // ── Super Admin: program, global rules, enrollment ─────────────────────────────────────────────────────────────
  async publishGlobalRule(input: Row & { effectiveFrom?: string | null; reason?: string | null }, actorUserId: string, now = new Date()) {
    const program = await this.program();
    const rate = validateGlobalRate(input as Parameters<typeof validateGlobalRate>[0], program);
    const at = this.effectiveTime(input.effectiveFrom, now);
    const reason = String(input.reason ?? '').trim();
    if (reason.length < 10) throw new GlobalRewardsError('Give a reason of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'reason' });
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('gr-global-rules'))`.execute(trx);
      const before = await this.globalRuleAt(trx, now);
      const vn = n((await sql<Row>`SELECT coalesce(max(g.version_no), 0) + 1 AS nv FROM global_earning_rule_versions g`.execute(trx)).rows[0]?.nv);
      try {
        const r = (await sql<Row>`INSERT INTO global_earning_rule_versions AS g (version_no, spend_increment_cents, point_tenths_per_increment, min_eligible_cents, per_ticket_cap_tenths, effective_from, status, reason, published_by)
          VALUES (${vn}, ${rate.spendIncrementCents}, ${rate.pointTenthsPerIncrement}, ${rate.minEligibleCents}, ${rate.perTicketCapTenths}, ${at.toISOString()}::timestamptz, 'published', ${reason}, ${actor(actorUserId)})
          RETURNING ${GV_COLS}`.execute(trx)).rows[0];
        await this.auditPlatform(trx, actorUserId, 'loyalty.global_rule.published', 'global_earning_rule_version', String(r.id),
          { before: before ? { versionNo: before.versionNo, rate: rateLabel(before) } : null, after: { versionNo: n(r.version_no), rate: rateLabel(rate), effectiveFrom: at.toISOString() }, reason });
        return { before, after: globalRuleOf(r), scheduled: at.getTime() > now.getTime() + 1000 };
      } catch (err: any) {
        if (String(err?.code) === '23505') throw new GlobalRewardsError('Another global rule starts at that exact time.', 'EARNING_POLICY_CONFLICT', 409);
        throw err;
      }
    });
  }
  async cancelGlobalRule(versionId: string, actorUserId: string, now = new Date()) {
    const r = (await sql<Row>`UPDATE global_earning_rule_versions g SET status = 'canceled', canceled_by = ${actor(actorUserId)}, canceled_at = now()
      WHERE g.id = ${versionId}::uuid AND g.effective_from > ${now.toISOString()}::timestamptz AND ${canMoveToSql(GLOBAL_EARNING_RULE_VERSION, 'canceled', 'g')} RETURNING ${GV_COLS}`.execute(this.db)).rows[0];
    if (!r) throw new GlobalRewardsError('Only a global rule that has not started yet can be canceled.', 'EARNING_POLICY_CONFLICT', 409);
    await this.auditPlatform(this.db, actorUserId, 'loyalty.global_rule.canceled', 'global_earning_rule_version', String(r.id), { versionNo: n(r.version_no) });
    return { canceled: globalRuleOf(r) };
  }
  /** How many salons a global change reaches (global-mode) vs. leaves alone (custom) — the editor's impact preview. */
  async globalImpact(now = new Date()) {
    const r = (await sql<Row>`WITH cur AS (
        SELECT DISTINCT ON (v.tenant_id) v.tenant_id, v.mode FROM tenant_earning_policy_versions v
        WHERE v.status = 'ACTIVATED' AND v.effective_from <= ${now.toISOString()}::timestamptz ORDER BY v.tenant_id, v.effective_from DESC, v.version_no DESC)
      SELECT count(*) FILTER (WHERE coalesce(c.mode, 'GLOBAL') = 'GLOBAL') AS global_mode, count(*) FILTER (WHERE c.mode = 'CUSTOM') AS custom_mode
      FROM global_rewards_enrollments e LEFT JOIN cur c ON c.tenant_id = e.tenant_id WHERE e.status = 'enrolled'`.execute(this.db)).rows[0];
    return { globalModeTenants: n(r?.global_mode), customModeTenants: n(r?.custom_mode) };
  }

  async updateProgram(patch: Row, expectedVersion: number, actorUserId: string) {
    // every column the Super Admin may change, spelled out (no identifier is ever built from input)
    const COLS: Record<string, { bool: boolean; set: (v: any) => ReturnType<typeof sql> }> = {
      earn_paused: { bool: true, set: (v) => sql`earn_paused = ${v}` }, redeem_paused: { bool: true, set: (v) => sql`redeem_paused = ${v}` },
      purchases_paused: { bool: true, set: (v) => sql`purchases_paused = ${v}` }, reimbursements_paused: { bool: true, set: (v) => sql`reimbursements_paused = ${v}` },
      custom_min_spend_increment_cents: { bool: false, set: (v) => sql`custom_min_spend_increment_cents = ${v}` },
      custom_max_spend_increment_cents: { bool: false, set: (v) => sql`custom_max_spend_increment_cents = ${v}` },
      custom_max_point_tenths_per_increment: { bool: false, set: (v) => sql`custom_max_point_tenths_per_increment = ${v}` },
      custom_min_eligible_floor_cents: { bool: false, set: (v) => sql`custom_min_eligible_floor_cents = ${v}` },
      max_point_tenths_per_ticket: { bool: false, set: (v) => sql`max_point_tenths_per_ticket = ${v}` },
      low_balance_cents: { bool: false, set: (v) => sql`low_balance_cents = ${v}` }, critical_balance_cents: { bool: false, set: (v) => sql`critical_balance_cents = ${v}` },
      reservation_ttl_seconds: { bool: false, set: (v) => sql`reservation_ttl_seconds = ${v}` }, max_purchase_tokens: { bool: false, set: (v) => sql`max_purchase_tokens = ${v}` },
    };
    const allowed = Object.keys(COLS);
    const sets = [] as ReturnType<typeof sql>[];
    for (const k of allowed) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (COLS[k].bool) { if (typeof v !== 'boolean') throw new GlobalRewardsError(`${k} must be true or false.`, 'VALIDATION_FAILED', 400, { field: k }); }
      else if (!Number.isInteger(v) || v < 0) throw new GlobalRewardsError(`${k} must be a whole number.`, 'VALIDATION_FAILED', 400, { field: k });
      sets.push(COLS[k].set(v));
    }
    if (!sets.length) throw new GlobalRewardsError('Nothing to change.', 'VALIDATION_FAILED', 400);
    return this.db.transaction().execute(async (trx) => {
      const before = await this.program(trx);
      let r: Row | undefined;
      try {
        r = (await sql<Row>`UPDATE global_rewards_program p SET ${sql.join(sets, sql`, `)}, version = p.version + 1, updated_by = ${actor(actorUserId)}, updated_at = now()
          WHERE p.id = 1 AND p.version = ${expectedVersion} RETURNING ${PROGRAM_COLS}`.execute(trx)).rows[0];
      } catch (err: any) {
        if (String(err?.code) === '23514') throw new GlobalRewardsError('Those limits are not consistent with each other.', 'VALIDATION_FAILED', 400);
        throw err;
      }
      if (!r) throw new GlobalRewardsError('The program settings changed meanwhile. Reload and try again.', 'EARNING_POLICY_CONFLICT', 409);
      await this.auditPlatform(trx, actorUserId, 'loyalty.program.updated', 'global_rewards_program', null, { changed: Object.keys(patch).filter((k) => allowed.includes(k)), patch });
      return { before, after: programOf(r) };
    });
  }

  async setEnrollment(tenantId: string, to: 'enrolled' | 'suspended' | 'withdrawn', a: { earningSuspended?: boolean; purchasingSuspended?: boolean; reason: string; actorUserId: string }) {
    if (String(a.reason ?? '').trim().length < 10) throw new GlobalRewardsError('Give a reason of at least 10 characters.', 'VALIDATION_FAILED', 400, { field: 'reason' });
    const program = await this.program();
    return this.db.transaction().execute(async (trx) => {
      const t = (await sql<Row>`SELECT t.id FROM tenants t WHERE t.id = ${tenantId}::uuid`.execute(trx)).rows[0];
      if (!t) throw new GlobalRewardsError('That salon was not found.', 'RESOURCE_NOT_FOUND', 404);
      const before = await this.enrollment(trx, tenantId);
      if (before.status === 'not_enrolled') {
        if (to !== 'enrolled') throw new GlobalRewardsError('Enroll the salon first.', 'MERCHANT_NOT_ENROLLED', 409);
        await sql`INSERT INTO global_rewards_enrollments (tenant_id, status, earning_suspended, purchasing_suspended, terms_version, enrolled_by, reason, updated_by)
          VALUES (${tenantId}::uuid, 'enrolled', ${!!a.earningSuspended}, ${!!a.purchasingSuspended}, ${program.termsVersion}, ${actor(a.actorUserId)}, ${a.reason}, ${actor(a.actorUserId)})`.execute(trx);
        await sql`INSERT INTO tenant_token_wallets (tenant_id) VALUES (${tenantId}::uuid) ON CONFLICT (tenant_id) DO NOTHING`.execute(trx);
      } else {
        const r = (await sql<Row>`UPDATE global_rewards_enrollments e SET status = ${to}, earning_suspended = coalesce(${a.earningSuspended ?? null}::boolean, e.earning_suspended),
            purchasing_suspended = coalesce(${a.purchasingSuspended ?? null}::boolean, e.purchasing_suspended), reason = ${a.reason}, updated_by = ${actor(a.actorUserId)}, updated_at = now(),
            enrolled_at = CASE WHEN e.status = 'withdrawn' AND ${to} = 'enrolled' THEN now() ELSE e.enrolled_at END
          WHERE e.tenant_id = ${tenantId}::uuid AND ${canMoveToSql(GLOBAL_REWARDS_ENROLLMENT, to, 'e')} RETURNING e.tenant_id`.execute(trx)).rows[0];
        if (!r) throw new GlobalRewardsError(`A ${before.status} salon cannot become ${to}.`, 'INVALID_STATE_TRANSITION', 409);
      }
      const after = await this.enrollment(trx, tenantId);
      await this.auditTenant(trx, { tenantId, userId: a.actorUserId, role: 'super_admin' }, 'loyalty.enrollment.changed', `Rewards network participation: ${before.status} → ${after.status}`,
        { resourceType: 'global_rewards_enrollment', resourceId: tenantId, before, after, reason: a.reason });
      return { before, after };
    });
  }

  async enrollments(q: { search?: string | null; page?: number; pageSize?: number }, now = new Date()) {
    const program = await this.program();   // the alert level is derived from the live balance (never a stale stored label)
    const size = Math.max(1, Math.min(50, Math.floor(Number(q.pageSize)) || 20)); const p = Math.max(1, Math.min(10_000, Math.floor(Number(q.page)) || 1));
    const s = String(q.search ?? '').trim().slice(0, 100);
    const where = s ? sql`(t.display_name ILIKE ${'%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} OR t.tenant_code ILIKE ${s + '%'} OR t.id::text = ${s})` : sql`true`;
    const total = n((await sql<Row>`SELECT count(*) AS c FROM tenants t WHERE ${where}`.execute(this.db)).rows[0]?.c);
    const r = await sql<Row>`SELECT t.id, t.display_name, t.tenant_code, e.status, e.earning_suspended, e.purchasing_suspended, e.enrolled_at, w.available_cents, w.alert_level, w.deficit_cents, w.low_balance_cents_override, w.critical_balance_cents_override,
        (SELECT v.mode FROM tenant_earning_policy_versions v WHERE v.tenant_id = t.id AND v.status = 'ACTIVATED' AND v.effective_from <= ${now.toISOString()}::timestamptz
          ORDER BY v.effective_from DESC, v.version_no DESC LIMIT 1) AS mode
      FROM tenants t LEFT JOIN global_rewards_enrollments e ON e.tenant_id = t.id LEFT JOIN tenant_token_wallets w ON w.tenant_id = t.id
      WHERE ${where} ORDER BY (e.tenant_id IS NULL), t.display_name, t.id LIMIT ${size} OFFSET ${(p - 1) * size}`.execute(this.db);
    return { total, page: p, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)), totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), items: r.rows.map((x) => ({ tenantId: String(x.id), name: x.display_name ?? null, code: x.tenant_code ?? null,
      enrollment: x.status ?? 'not_enrolled', earningSuspended: !!x.earning_suspended, purchasingSuspended: !!x.purchasing_suspended, enrolledAt: iso(x.enrolled_at),
      mode: x.mode === 'CUSTOM' ? 'CUSTOM' : 'GLOBAL', availableCents: n(x.available_cents), alertLevel: alertLevel(n(x.available_cents), walletLevels(program, x)), deficitCents: n(x.deficit_cents) })) };
  }

}

// ── journal ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type JournalAccount = 'settlement_cash' | 'merchant_prepaid_liability' | 'rewards_liability' | 'reimbursement_payable' | 'funding_deficit_receivable' | 'merchant_recovery_receivable';   // 734
export interface JournalLine { account: JournalAccount; tenantId: string | null; debit?: number; credit?: number }
/** One balanced journal entry (the deferred trigger refuses an unbalanced one at commit). Idempotent per source. */
export async function postJournal(trx: Transaction<any>, e: { entryType: string; tenantId: string | null; sourceTable: string; sourceId: string; memo: string | null; lines: JournalLine[] }): Promise<boolean> {
  const d = e.lines.reduce((s, l) => s + (l.debit ?? 0), 0), c = e.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (d !== c || d <= 0) throw new GlobalRewardsError('A rewards journal entry must balance.', 'VALIDATION_FAILED', 500);
  const ent = (await sql<Row>`INSERT INTO rewards_journal_entries (entry_type, tenant_id, source_table, source_id, memo) VALUES (${e.entryType}, ${e.tenantId}, ${e.sourceTable}, ${e.sourceId}, ${e.memo})
    ON CONFLICT (source_table, source_id, entry_type) DO NOTHING RETURNING id`.execute(trx)).rows[0];
  if (!ent) return false;
  for (const l of e.lines) {
    if (!(l.debit ?? 0) && !(l.credit ?? 0)) continue;
    await sql`INSERT INTO rewards_journal_lines (entry_id, account, tenant_id, debit_cents, credit_cents) VALUES (${ent.id}::uuid, ${l.account}, ${l.tenantId}, ${l.debit ?? 0}, ${l.credit ?? 0})`.execute(trx);
  }
  return true;
}
// re-exported for the earn processor and tests
export { computeEarn };
