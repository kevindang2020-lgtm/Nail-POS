// rewards-apps.ts — Customer App "My Rewards" + explicit opt-in (Final Completion guide §10) and Owner App "Rewards" (§11).
// English only (both apps are English-only). Every read is scoped by the SESSION: a customer sees only their own global
// account (resolved from their own identity link at this salon); an owner sees only their own salon.
import { sql, type Kysely } from 'kysely';
import { recordAuditStrict } from '@aipowersalon/audit';
import { GlobalRewardsError, centsPerPointTenth, tenthsLabel } from './global-rewards-core';
import { GlobalRewardsRepository } from './global-rewards.repository';
import { flagState } from './global-rewards-flags';

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
export interface AppCtx { tenantId: string; branchId?: string | null; userId: string; role?: string | null }

/** The PROGRAM terms the customer accepts (versioned). Changing the text means a new version and a fresh opt-in. */
export const REWARDS_TERMS = {
  title: 'AI PowerSalon Rewards',
  summary: [
    'Earn points on what you pay for services and products at participating salons (not on tax, tips or gift cards).',
    'Use points at any participating salon: 10 points = $1 off.',
    'Points are held for a short time while a checkout is in progress and spent only when the ticket is paid.',
    'Your phone number must be verified. Salons only see rewards activity that happened at their own salon.',
    'You can leave at any time. Leaving stops new earning and spending; your points are kept under the program policy, not erased.',
  ],
  privacyPath: '/legal/privacy',
};

/** the customer's own verified identity (via THEIR user at this salon) */
async function identityOf(db: Kysely<any>, c: AppCtx): Promise<{ identityId: string; verified: boolean } | null> {
  const r = (await sql<Row>`SELECT ci.id, ci.phone_verified_at FROM customer_identity_links l JOIN customer_identities ci ON ci.id = l.identity_id
    WHERE l.tenant_id = ${c.tenantId}::uuid AND l.user_id = ${c.userId}::uuid ORDER BY ci.phone_verified_at DESC NULLS LAST LIMIT 1`.execute(db)).rows[0];
  return r ? { identityId: String(r.id), verified: !!r.phone_verified_at } : null;
}
const mustBeCustomer = (c: AppCtx) => { if (String(c.role ?? '').toUpperCase() !== 'CUSTOMER') throw new GlobalRewardsError('This is for customers.', 'PERMISSION_DENIED', 403); };

export async function customerRewards(db: Kysely<any>, c: AppCtx) {
  mustBeCustomer(c);
  const program = await new GlobalRewardsRepository(db).program();
  const f = await flagState(db, c.tenantId);
  const cpt = centsPerPointTenth(program);
  const base = { program: { available: f.engine, pointsPerRedeemBlock: program.pointsPerRedeemBlock, redeemBlockValueCents: program.redeemBlockValueCents }, terms: { version: program.termsVersion, ...REWARDS_TERMS } };
  const id = await identityOf(db, c);
  if (!id) return { ...base, state: 'NO_IDENTITY' as const, account: null, earned: [], redemptions: [] };
  const a = (await sql<Row>`SELECT ga.status, ga.available_tenths, ga.reserved_tenths, ga.lifetime_earned_tenths, ga.lifetime_redeemed_tenths, ga.opted_in_at, ga.withdrawn_at, ga.terms_version
    FROM global_rewards_accounts ga WHERE ga.identity_id = ${id.identityId}::uuid`.execute(db)).rows[0];
  const state = !id.verified ? 'NOT_VERIFIED' : !a || !a.opted_in_at ? 'NOT_JOINED' : a.withdrawn_at ? 'WITHDRAWN' : a.status !== 'active' ? 'SUSPENDED' : 'ACTIVE';
  if (!a) return { ...base, state, account: null, earned: [], redemptions: [] };
  // the customer's OWN activity across salons: salon name, date, points, rate, a short reference — nothing else about any salon
  // Extras · GLOBAL LOYALTY 05: each earning also says which rule version applied (the network rate or the salon's own rate, by
  // its version number — read from the snapshot taken at earn time, never today's rule) and since when the points were
  // spendable (credited to the balance at earn time; nothing is spendable from a fully refunded earning).
  const earned = (await sql<Row>`SELECT e.id, t.display_name, e.created_at, e.point_tenths, e.eligible_cents, e.spend_increment_cents, e.point_tenths_per_increment, e.status, e.reversed_tenths,
      e.rule_source, coalesce(gv.version_no, tv.version_no) AS rule_version_no
    FROM reward_earn_transactions e JOIN tenants t ON t.id = e.tenant_id
    LEFT JOIN global_earning_rule_versions gv ON e.rule_source = 'GLOBAL_DEFAULT' AND gv.id = e.rule_version_id
    LEFT JOIN tenant_earning_policy_versions tv ON e.rule_source = 'TENANT_OVERRIDE' AND tv.id = e.rule_version_id AND tv.tenant_id = e.tenant_id WHERE e.identity_id = ${id.identityId}::uuid AND e.status IN ('EARNED', 'PARTIALLY_REVERSED', 'REVERSED')
    ORDER BY e.created_at DESC LIMIT 50`.execute(db)).rows;
  const reds = (await sql<Row>`SELECT r.id, t.display_name, r.created_at, r.confirmed_at, r.point_tenths, r.value_cents, r.status, r.release_reason, r.ticket_id
    FROM reward_redemptions r JOIN tenants t ON t.id = r.tenant_id WHERE r.identity_id = ${id.identityId}::uuid ORDER BY r.created_at DESC LIMIT 50`.execute(db)).rows;
  const available = n(a.available_tenths), held = n(a.reserved_tenths);
  return {
    ...base, state,
    account: { availablePoints: tenthsLabel(available), heldPoints: tenthsLabel(held), availableTenths: available, heldTenths: held, redemptionValueCents: available * cpt,
      lifetimeEarnedPoints: tenthsLabel(n(a.lifetime_earned_tenths)), lifetimeRedeemedPoints: tenthsLabel(n(a.lifetime_redeemed_tenths)), joinedAt: iso(a.opted_in_at), termsVersion: a.terms_version, withdrawnAt: iso(a.withdrawn_at), expires: null },
    earned: earned.map((e) => ({ ref: 'E-' + String(e.id).slice(-6).toUpperCase(), salon: e.display_name ?? 'Salon', at: iso(e.created_at), points: tenthsLabel(n(e.point_tenths) - n(e.reversed_tenths)), eligibleCents: n(e.eligible_cents),
      rate: `$${(n(e.spend_increment_cents) / 100).toFixed(2)} = ${tenthsLabel(n(e.point_tenths_per_increment))} ${n(e.point_tenths_per_increment) === 10 ? 'point' : 'points'}`, status: e.status,
      rule: e.rule_source ? { kind: e.rule_source === 'TENANT_OVERRIDE' ? 'salon' as const : 'network' as const, versionNo: e.rule_version_no == null ? null : n(e.rule_version_no) } : null,
      spendableFrom: e.status === 'REVERSED' ? null : iso(e.created_at) })),
    redemptions: reds.map((r) => ({ ref: 'R-' + String(r.id).slice(-6).toUpperCase(), salon: r.display_name ?? 'Salon', at: iso(r.confirmed_at ?? r.created_at), points: tenthsLabel(n(r.point_tenths)), valueCents: n(r.value_cents),
      status: r.status, reason: r.status === 'RELEASED' ? 'Removed at checkout' : r.status === 'EXPIRED' ? 'Checkout not completed in time' : r.status === 'REVERSED' ? 'Refunded — points returned' : null, ticketRef: 'T-' + String(r.ticket_id).slice(-6).toUpperCase() })),
  };
}

/** Explicit opt-in (§10): an affirmative choice on the CURRENT terms version, recorded with time + source. Never automatic. */
export async function customerOptIn(db: Kysely<any>, c: AppCtx, a: { termsVersion: string; accept: boolean }) {
  mustBeCustomer(c);
  if (a.accept !== true) throw new GlobalRewardsError('Tick the box to join.', 'VALIDATION_FAILED', 400, { field: 'accept' });
  const program = await new GlobalRewardsRepository(db).program();
  if (a.termsVersion !== program.termsVersion) throw new GlobalRewardsError('The program terms changed. Review them and join again.', 'VALIDATION_FAILED', 409, { field: 'termsVersion', current: program.termsVersion });
  const id = await identityOf(db, c);
  if (!id || !id.verified) throw new GlobalRewardsError('Verify your phone number first.', 'REWARDS_IDENTITY_NOT_VERIFIED', 403);
  return db.transaction().execute(async (trx) => {
    await sql`INSERT INTO global_rewards_accounts (identity_id, terms_version, enrolled_via, opted_in_at, consent_source) VALUES (${id.identityId}::uuid, ${program.termsVersion}, 'customer_app', now(), 'customer_app')
      ON CONFLICT (identity_id) DO UPDATE SET terms_version = excluded.terms_version, opted_in_at = now(), consent_source = 'customer_app', withdrawn_at = NULL, withdrawal_reason = NULL,
        version = global_rewards_accounts.version + 1, updated_at = now()
      WHERE global_rewards_accounts.opted_in_at IS NULL OR global_rewards_accounts.withdrawn_at IS NOT NULL OR global_rewards_accounts.terms_version <> excluded.terms_version`.execute(trx);
    await recordAuditStrict(trx, { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: 'CUSTOMER' }, { module: 'loyalty', action: 'loyalty.rewards_opt_in',
      summary: `Joined AI PowerSalon Rewards (terms ${program.termsVersion})`, resourceType: 'global_rewards_account', resourceId: id.identityId, reason: null, metadata: { termsVersion: program.termsVersion, source: 'customer_app' }, before: null, after: { optedIn: true } });
    return { joined: true, termsVersion: program.termsVersion };
  });
}

/** Withdrawal: stops new earning / spending; points are KEPT (no silent forfeiture). Refused while a hold is active. */
export async function customerWithdraw(db: Kysely<any>, c: AppCtx, a: { reason?: string | null }) {
  mustBeCustomer(c);
  const id = await identityOf(db, c);
  if (!id) throw new GlobalRewardsError('No rewards account was found.', 'RESOURCE_NOT_FOUND', 404);
  return db.transaction().execute(async (trx) => {
    const r = (await sql<Row>`UPDATE global_rewards_accounts ga SET withdrawn_at = now(), withdrawal_reason = ${a.reason ?? null}, version = ga.version + 1, updated_at = now()
      WHERE ga.identity_id = ${id.identityId}::uuid AND ga.withdrawn_at IS NULL AND ga.opted_in_at IS NOT NULL AND ga.reserved_tenths = 0 RETURNING ga.available_tenths`.execute(trx)).rows[0];
    if (!r) throw new GlobalRewardsError('You can leave once no checkout is holding your points.', 'REWARD_RESERVATION_CONFLICT', 409);
    await recordAuditStrict(trx, { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: 'CUSTOMER' }, { module: 'loyalty', action: 'loyalty.rewards_withdrawn',
      summary: 'Left AI PowerSalon Rewards (points kept)', resourceType: 'global_rewards_account', resourceId: id.identityId, reason: a.reason ?? null, metadata: { keptTenths: n(r.available_tenths) }, before: { optedIn: true }, after: { withdrawn: true } });
    return { withdrawn: true, keptPoints: tenthsLabel(n(r.available_tenths)) };
  });
}

/** Owner App "Rewards": ONLY the signed-in owner's salon — what it funded, issued, accepted, is owed, and what actually settled. */
export async function ownerRewards(db: Kysely<any>, c: AppCtx) {
  const T = c.tenantId;
  const repo = new GlobalRewardsRepository(db);
  const [wallet, enrollment, program, f] = await Promise.all([repo.walletSummary(T), repo.enrollment(db, T), repo.program(), flagState(db, T)]);
  const purchases = (await sql<Row>`SELECT i.status, count(*) AS c, coalesce(sum(i.token_cents), 0) AS v FROM token_purchase_intents i WHERE i.tenant_id = ${T}::uuid GROUP BY i.status`.execute(db)).rows;
  const issued = (await sql<Row>`SELECT e.rule_source, e.rule_version_id, count(*) AS c, coalesce(sum(e.point_tenths), 0) AS p, coalesce(sum(e.backing_cents), 0) AS b
    FROM reward_earn_transactions e WHERE e.tenant_id = ${T}::uuid AND e.status IN ('EARNED', 'PARTIALLY_REVERSED', 'REVERSED') GROUP BY e.rule_source, e.rule_version_id ORDER BY 3 DESC LIMIT 20`.execute(db)).rows;
  const blocked = n((await sql<Row>`SELECT count(*) AS c FROM reward_earn_transactions e WHERE e.tenant_id = ${T}::uuid AND e.status = 'BLOCKED_INSUFFICIENT_TOKENS'`.execute(db)).rows[0]?.c);
  const accepted = (await sql<Row>`SELECT r.id, r.ticket_id, r.point_tenths, r.value_cents, r.status, r.confirmed_at FROM reward_redemptions r WHERE r.tenant_id = ${T}::uuid AND r.status IN ('CONFIRMED_REDEEMED', 'REVERSED')
    ORDER BY r.confirmed_at DESC LIMIT 25`.execute(db)).rows;
  const owed = (await sql<Row>`SELECT m.id, m.amount_cents, m.adjusted_cents, m.status, m.hold_reason, m.created_at, m.paid_at, m.provider_ref FROM merchant_reimbursements m WHERE m.tenant_id = ${T}::uuid ORDER BY m.created_at DESC LIMIT 50`.execute(db)).rows;
  const now = Date.now(); const age = (d: unknown) => (now - Date.parse(String(d))) / 86_400_000;
  const owedRows = owed.filter((m) => !['PAID', 'ADJUSTED', 'OFFSET'].includes(String(m.status)));
  const sumOwed = (pred: (m: Row) => boolean) => owedRows.filter(pred).reduce((s, m) => s + n(m.amount_cents) - n(m.adjusted_cents), 0);
  const alerts = (await sql<Row>`SELECT a.id, a.severity, a.title, a.body, a.created_at FROM owner_alerts a WHERE a.tenant_id = ${T}::uuid AND a.category = 'loyalty' ORDER BY a.created_at DESC LIMIT 10`.execute(db)).rows;
  const findings = (await sql<Row>`SELECT f.check_type, f.outcome, f.detail, f.created_at FROM rewards_recon_findings f WHERE f.tenant_id = ${T}::uuid AND f.outcome = 'FAILED' AND f.review_status IN ('OPEN', 'INVESTIGATING') ORDER BY f.created_at DESC LIMIT 5`.execute(db)).rows;
  return {
    generatedAt: new Date().toISOString(), enrolled: enrollment.status === 'enrolled', networkOn: f.engine, tokenValueCents: program.tokenValueCents,
    wallet: { availableCents: wallet.availableCents, pendingCents: wallet.pendingCents, usedThisMonthCents: wallet.usedThisMonthCents, lifetimeFundedCents: wallet.lifetimeFundedCents, lifetimeAllocatedCents: wallet.lifetimeAllocatedCents, deficitCents: wallet.deficitCents, alertLevel: wallet.alertLevel,
      purchases: purchases.map((p) => ({ status: String(p.status), count: n(p.c), tokenCents: n(p.v) })) },
    // Buy Tokens lives behind the production payment-provider gate (§11): the Owner App shows the state, never a fake purchase
    buyTokens: { state: process.env.NODE_ENV === 'production' ? 'BLOCKED_EXTERNAL' : process.env.GLOBAL_REWARDS_SANDBOX_PROVIDER === 'on' ? 'TEST_SANDBOX' : 'NOT_CONFIGURED' },
    issued: { byRule: issued.map((r) => ({ source: r.rule_source, ruleVersionId: r.rule_version_id ? String(r.rule_version_id) : null, sales: n(r.c), points: tenthsLabel(n(r.p)), backingCents: n(r.b) })), blockedForTokens: blocked },
    accepted: accepted.map((r) => ({ ref: 'R-' + String(r.id).slice(-6).toUpperCase(), ticketId: String(r.ticket_id), points: tenthsLabel(n(r.point_tenths)), valueCents: n(r.value_cents), status: r.status, at: iso(r.confirmed_at) })),
    owed: { totalCents: sumOwed(() => true), under7dCents: sumOwed((m) => age(m.created_at) < 7), d7to30Cents: sumOwed((m) => age(m.created_at) >= 7 && age(m.created_at) < 30), over30Cents: sumOwed((m) => age(m.created_at) >= 30),
      onHoldCents: sumOwed((m) => m.status === 'ON_HOLD'), items: owed.map((m) => ({ id: String(m.id), amountCents: n(m.amount_cents) - n(m.adjusted_cents), status: m.status, holdReason: m.hold_reason ?? null, accruedAt: iso(m.created_at), paidAt: iso(m.paid_at), providerRef: m.provider_ref ?? null })) },
    payouts: { state: 'BLOCKED_EXTERNAL', settledCents: owed.filter((m) => m.status === 'PAID').reduce((s, m) => s + n(m.amount_cents) - n(m.adjusted_cents), 0) },
    alerts: [...alerts.map((a) => ({ kind: 'alert', severity: a.severity, title: a.title, body: a.body, at: iso(a.created_at) })), ...findings.map((x) => ({ kind: 'books', severity: 'high', title: 'Books check: ' + String(x.check_type).replace(/_/g, ' '), body: x.detail, at: iso(x.created_at) }))],
  };
}
