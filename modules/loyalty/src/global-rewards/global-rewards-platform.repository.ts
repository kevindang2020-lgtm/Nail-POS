// global-rewards-platform.repository.ts — Super Admin's PLATFORM-WIDE reads of the Global Rewards Network (LoyaltyTokens.pdf
// §4, §7.5): the reconciliation totals across every salon and the all-salon purchase list. These queries span salons BY
// DESIGN and are reached only through SuperAdminGuard + super_admin.billing.view (global-rewards.controller.ts); nothing
// salon-scoped lives here (that is global-rewards.repository.ts, where every statement carries tenant_id). Reviewed in
// check:tenant's baseline as a platform-only file.
import { sql, type Kysely } from 'kysely';
import { GlobalRewardsRepository, purchaseRow } from './global-rewards.repository';
import { GlobalRewardsError } from './global-rewards-core';

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export class GlobalRewardsPlatformRepository {
  constructor(private readonly db: Kysely<any>, private readonly repo: GlobalRewardsRepository) {}

  async allPurchases(page = 1, pageSize = 20) {
    const size = Math.max(1, Math.min(50, Math.floor(pageSize) || 20)); const p = Math.max(1, Math.min(10_000, Math.floor(page) || 1));
    const total = n((await sql<Row>`SELECT count(*) AS c FROM token_purchase_intents i`.execute(this.db)).rows[0]?.c);
    const r = await sql<Row>`SELECT i.id, i.tenant_id, i.token_cents, i.amount_cents, i.fee_cents, i.status, i.provider, i.provider_ref, i.failure_code, i.initiated_by, i.created_at, i.confirmed_at, i.funded_at
      FROM token_purchase_intents i ORDER BY i.created_at DESC, i.id DESC LIMIT ${size} OFFSET ${(p - 1) * size}`.execute(this.db);
    return { total, page: p, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)), totalItems: total, totalPages: Math.max(1, Math.ceil(total / size)), items: r.rows.map(purchaseRow) };
  }
  /** the purchase's salon — a Super Admin action on a purchase id resolves the owning salon here, then acts tenant-scoped */
  async purchaseTenant(id: string): Promise<string> {
    const r = (await sql<Row>`SELECT i.tenant_id FROM token_purchase_intents i WHERE i.id = ${id}::uuid`.execute(this.db)).rows[0];
    if (!r) throw new GlobalRewardsError('That token purchase was not found.', 'RESOURCE_NOT_FOUND', 404);
    return String(r.tenant_id);
  }

  /** Daily reconciliation invariants (guide §7.5): balanced books, projections equal their ledgers, rewards liability
   *  equals the funded value of outstanding points. Any non-zero exception count is shown to Super Admin. */
  async reconciliation() {
    const program = await this.repo.program();
    const cpt = program.redeemBlockValueCents / (program.pointsPerRedeemBlock * 10);
    const acc = await sql<Row>`SELECT l.account, coalesce(sum(l.debit_cents), 0) AS d, coalesce(sum(l.credit_cents), 0) AS c FROM rewards_journal_lines l GROUP BY l.account`.execute(this.db);
    const balances: Record<string, number> = {};
    for (const r of acc.rows) balances[String(r.account)] = n(r.c) - n(r.d);   // liabilities shown as credit balances
    const unbalanced = n((await sql<Row>`SELECT count(*) AS c FROM (SELECT l.entry_id FROM rewards_journal_lines l GROUP BY l.entry_id HAVING sum(l.debit_cents) <> sum(l.credit_cents)) x`.execute(this.db)).rows[0]?.c);
    const walletMismatch = await sql<Row>`SELECT w.tenant_id, w.available_cents, coalesce((SELECT sum(l.delta_cents) FROM token_wallet_ledger l WHERE l.tenant_id = w.tenant_id), 0) AS ledger
      FROM tenant_token_wallets w WHERE w.available_cents <> coalesce((SELECT sum(l.delta_cents) FROM token_wallet_ledger l WHERE l.tenant_id = w.tenant_id), 0) LIMIT 50`.execute(this.db);
    const pointsMismatch = n((await sql<Row>`SELECT count(*) AS c FROM global_rewards_accounts ga WHERE ga.available_tenths + ga.reserved_tenths <>
      coalesce((SELECT sum(g.delta_tenths) FROM global_points_ledger g WHERE g.identity_id = ga.identity_id), 0)`.execute(this.db)).rows[0]?.c);
    const outstanding = n((await sql<Row>`SELECT coalesce(sum(ga.available_tenths + ga.reserved_tenths), 0) AS t FROM global_rewards_accounts ga`.execute(this.db)).rows[0]?.t);
    const payables = await sql<Row>`SELECT m.status, count(*) AS c, coalesce(sum(m.amount_cents), 0) AS v FROM merchant_reimbursements m GROUP BY m.status`.execute(this.db);
    const purchases = await sql<Row>`SELECT i.status, count(*) AS c, coalesce(sum(i.token_cents), 0) AS v FROM token_purchase_intents i GROUP BY i.status`.execute(this.db);
    const liability = balances.rewards_liability ?? 0;
    return {
      generatedAt: new Date().toISOString(), balances, unbalancedEntries: unbalanced,
      walletMismatches: walletMismatch.rows.map((r) => ({ tenantId: String(r.tenant_id), walletCents: n(r.available_cents), ledgerCents: n(r.ledger) })),
      pointsMismatches: pointsMismatch,
      rewardsLiabilityCents: liability, outstandingPointsValueCents: outstanding * cpt, liabilityMatchesPoints: liability === outstanding * cpt,
      payables: payables.rows.map((r) => ({ status: String(r.status), count: n(r.c), amountCents: n(r.v) })),
      purchases: purchases.rows.map((r) => ({ status: String(r.status), count: n(r.c), tokenCents: n(r.v) })),
      healthy: unbalanced === 0 && walletMismatch.rows.length === 0 && pointsMismatch === 0 && liability === outstanding * cpt,
    };
  }
}
