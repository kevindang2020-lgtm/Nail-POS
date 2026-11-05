// loyalty-ledger.service.ts — BUILD_PLAN Phase 10 (Constitution 1 §19–§21; audit bugs 3 and 4): the ONE way a loyalty
// balance changes.
//
// Every writer — the payment consumer (earn), skip-line checkout (earn), the customer app (redeem), checkout refund / void
// (reverse), `PATCH /customers/:id/loyalty` and the register's adjust button (adjust, reason required), customer merge
// (merge) — calls `applyLoyaltyEntry(trx, …)` inside ITS OWN transaction, so the business write and the points move
// together or not at all. Inside:
//   1. pg_advisory_xact_lock(hashtext(tenant:customer)) — two registers / two deliveries for one customer serialise,
//      including the very first entry, when there is no profile row yet to lock (the duplicate-profile bug);
//   2. a business source (source_table, source_id, entry_type) is applied at most once — the second call returns the
//      first one's result (`duplicate: true`), backed by migration 540's unique index;
//   3. the profile is inserted if missing (one per tenant + customer, unique since 538/540);
//   4. ONE loyalty_ledger row with the balance after it, and the profile's points_balance set to that balance.
// So points_balance = sum(delta) for every profile; `reconcileLoyaltyBalances` (the daily `loyalty.reconcile` job)
// checks it and repairs the profile from the ledger, with an owner alert, if anything ever wrote around this.
import { sql, type Kysely } from 'kysely';
import { getContext } from '@aipowersalon/observability';
import { branchTimeZone } from '@aipowersalon/database';
import { dayStartMs } from '@aipowersalon/date-time';

export const LOYALTY_ENTRY_TYPES = ['earn', 'redeem', 'adjust', 'reverse', 'merge'] as const;
export type LoyaltyEntryType = (typeof LOYALTY_ENTRY_TYPES)[number];

export interface LoyaltyEntryInput {
  tenantId: string;
  branchId?: string | null;
  customerId: string;
  entryType: LoyaltyEntryType;
  /** Signed points: earn > 0, redeem < 0, reverse <= 0, adjust / merge either way. */
  delta: number;
  /** Required for `adjust`; stored on the row (and in the legacy `description`). */
  reason?: string | null;
  /** The business fact this entry belongs to, e.g. ('payments', paymentId). Applied at most once per entry type. */
  sourceTable?: string | null;
  sourceId?: string | null;
  actorUserId?: string | null;
  /** Defaults to the current request's id (observability context). */
  requestId?: string | null;
  /** A reversal takes back at most what the customer still has (points already spent stay spent). */
  clampToBalance?: boolean;
  /** Merge moves balances between two profiles of one person; only it may leave a profile at any value. */
  allowNegative?: boolean;
  /** The finer legacy `type` (e.g. 'earn_purchase', 'redeem_reward') kept for the customer-facing history. */
  legacyType?: string;
  /** The legacy `source` channel ('pos', 'customer_app', …). */
  legacySource?: string;
  /** Tier for a profile created by this entry. */
  newProfileTier?: string;
}

export interface LoyaltyEntryResult {
  applied: boolean;
  duplicate: boolean;
  delta: number;
  balanceAfter: number;
  ledgerId: string | null;
  profileId: string | null;
}

export class LoyaltyLedgerError extends Error {
  constructor(message: string, readonly code: 'LOYALTY_INSUFFICIENT_POINTS' | 'LOYALTY_INVALID_ENTRY' | 'LOYALTY_NO_BRANCH') { super(message); this.name = 'LoyaltyLedgerError'; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/** The per-customer lock every loyalty write takes (transaction-scoped; released at commit / rollback). */
export async function lockLoyaltyCustomer(trx: Kysely<any>, tenantId: string, customerId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${tenantId + ':' + customerId}))`.execute(trx);
}

function validate(i: LoyaltyEntryInput): void {
  if (!LOYALTY_ENTRY_TYPES.includes(i.entryType)) throw new LoyaltyLedgerError(`Unknown loyalty entry type: ${i.entryType}`, 'LOYALTY_INVALID_ENTRY');
  if (!Number.isInteger(i.delta)) throw new LoyaltyLedgerError('Loyalty points must be a whole number', 'LOYALTY_INVALID_ENTRY');
  if (!uuidOrNull(i.tenantId) || !uuidOrNull(i.customerId)) throw new LoyaltyLedgerError('Loyalty entry needs a tenant and a customer', 'LOYALTY_INVALID_ENTRY');
  if (i.entryType === 'earn' && i.delta <= 0) throw new LoyaltyLedgerError('An earn entry adds points', 'LOYALTY_INVALID_ENTRY');
  if (i.entryType === 'redeem' && i.delta >= 0) throw new LoyaltyLedgerError('A redeem entry takes points', 'LOYALTY_INVALID_ENTRY');
  if (i.entryType === 'reverse' && i.delta > 0) throw new LoyaltyLedgerError('A reversal takes points back', 'LOYALTY_INVALID_ENTRY');
  if (i.entryType === 'adjust' && !String(i.reason ?? '').trim()) throw new LoyaltyLedgerError('A loyalty adjustment needs a reason', 'LOYALTY_INVALID_ENTRY');
  if ((i.sourceTable && !i.sourceId) || (!i.sourceTable && i.sourceId)) throw new LoyaltyLedgerError('A loyalty source needs both its table and its id', 'LOYALTY_INVALID_ENTRY');
  if (i.sourceId && !uuidOrNull(i.sourceId)) throw new LoyaltyLedgerError('A loyalty source id is a UUID', 'LOYALTY_INVALID_ENTRY');
}

/**
 * Apply one loyalty entry INSIDE the caller's transaction (pass the transaction, not the pool — the lock is
 * transaction-scoped). Throws LoyaltyLedgerError on a rule violation; the caller's transaction then rolls back.
 */
export async function applyLoyaltyEntry(trx: Kysely<any>, input: LoyaltyEntryInput): Promise<LoyaltyEntryResult> {
  validate(input);
  const { tenantId, customerId, entryType } = input;
  await lockLoyaltyCustomer(trx, tenantId, customerId);

  if (input.sourceId) {
    const prior = (await sql<{ id: string; delta: string; balance_after: string }>`
      select id, delta, balance_after from loyalty_ledger
       where tenant_id = ${tenantId} and source_table = ${input.sourceTable} and source_id = ${input.sourceId} and entry_type = ${entryType}
       limit 1`.execute(trx)).rows[0];
    if (prior) return { applied: false, duplicate: true, delta: Number(prior.delta), balanceAfter: Number(prior.balance_after), ledgerId: String(prior.id), profileId: null };
  }

  let profile = (await sql<{ id: string; branch_id: string; points_balance: number; total_earned_points: number; total_redeemed_points: number }>`
    select id, branch_id, points_balance, total_earned_points, total_redeemed_points from customer_loyalty_profiles
     where tenant_id = ${tenantId} and customer_id = ${customerId} order by created_at, id limit 1`.execute(trx)).rows[0];
  if (!profile) {
    // branch_id is NOT NULL on the profile: the entry's branch, else the customer's home branch
    const branchId = uuidOrNull(input.branchId) ?? (await sql<{ branch_id: string }>`select branch_id from customers where tenant_id = ${tenantId} and id = ${customerId}`.execute(trx)).rows[0]?.branch_id ?? null;
    if (!branchId) throw new LoyaltyLedgerError('A new loyalty profile needs a branch', 'LOYALTY_NO_BRANCH');
    profile = (await sql<any>`
      insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points)
      values (${tenantId}, ${branchId}, ${customerId}, ${input.newProfileTier ?? 'Regular'}, 0, 0, 0)
      returning id, branch_id, points_balance, total_earned_points, total_redeemed_points`.execute(trx)).rows[0];
  }

  const balance = Number(profile.points_balance || 0);
  let delta = input.delta;
  if (input.clampToBalance && delta < 0) delta = Math.max(delta, -Math.max(balance, 0));
  if (delta === 0 && input.delta !== 0) return { applied: false, duplicate: false, delta: 0, balanceAfter: balance, ledgerId: null, profileId: String(profile.id) };
  const balanceAfter = balance + delta;
  if (balanceAfter < 0 && !input.allowNegative) throw new LoyaltyLedgerError('Cannot reduce points below 0', 'LOYALTY_INSUFFICIENT_POINTS');

  let earned = Number(profile.total_earned_points || 0);
  let redeemed = Number(profile.total_redeemed_points || 0);
  if (entryType === 'earn' || (entryType === 'adjust' && delta > 0)) earned += delta;
  else if (entryType === 'redeem' || (entryType === 'adjust' && delta < 0)) redeemed += -delta;
  else if (entryType === 'reverse') earned = Math.max(0, earned + delta);

  await sql`update customer_loyalty_profiles set points_balance = ${balanceAfter}, total_earned_points = ${earned}, total_redeemed_points = ${redeemed}, updated_at = now()
             where id = ${profile.id}`.execute(trx);
  const reason = input.reason?.toString().trim() || null;
  const requestId = input.requestId ?? getContext()?.requestId ?? null;
  const row = (await sql<{ id: string }>`
    insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, reason, source_table, source_id,
                                actor_user_id, request_id, type, source)
    values (${tenantId}, ${uuidOrNull(input.branchId) ?? profile.branch_id}, ${customerId}, ${entryType}, ${delta}, ${balanceAfter}, ${reason},
            ${input.sourceTable ?? null}, ${input.sourceId ?? null}, ${uuidOrNull(input.actorUserId)}, ${requestId},
            ${input.legacyType ?? entryType}, ${input.legacySource ?? input.sourceTable ?? 'ledger'})
    returning id`.execute(trx)).rows[0];
  return { applied: true, duplicate: false, delta, balanceAfter, ledgerId: String(row.id), profileId: String(profile.id) };
}

export interface LoyaltyReconcileResult { checked: number; repaired: number; alerts: number }

/**
 * The daily `loyalty.reconcile` check: every profile whose points_balance differs from sum(delta) of its ledger is
 * repaired FROM the ledger (the ledger is the truth) under the customer lock, and the salon gets one owner alert per
 * profile per day saying so. Cross-tenant by design (a platform job); it changes nothing when the books agree.
 */
export async function reconcileLoyaltyBalances(db: Kysely<any>, opts: { tenantId?: string; limit?: number } = {}): Promise<LoyaltyReconcileResult> {
  const tenantSql = opts.tenantId ? sql`and p.tenant_id = ${opts.tenantId}` : sql``;
  const drift = (await sql<{ id: string; tenant_id: string; branch_id: string; customer_id: string }>`
    select p.id, p.tenant_id, p.branch_id, p.customer_id
      from customer_loyalty_profiles p
      left join (select tenant_id, customer_id, sum(delta) s from loyalty_ledger group by tenant_id, customer_id) l
             on l.tenant_id = p.tenant_id and l.customer_id = p.customer_id
     where p.points_balance <> coalesce(l.s, 0) ${tenantSql}
     limit ${opts.limit ?? 1000}`.execute(db)).rows;
  let repaired = 0; let alerts = 0;
  for (const d of drift) {
    await db.transaction().execute(async (trx) => {
      await lockLoyaltyCustomer(trx, d.tenant_id, d.customer_id);
      const cur = (await sql<{ points_balance: number; s: string | null }>`
        select p.points_balance, (select sum(delta) from loyalty_ledger l where l.tenant_id = p.tenant_id and l.customer_id = p.customer_id) s
          from customer_loyalty_profiles p where p.id = ${d.id}`.execute(trx)).rows[0];
      if (!cur) return;
      const truth = Number(cur.s ?? 0); const before = Number(cur.points_balance);
      if (truth === before) return;                                    // fixed by a writer between the scan and the lock
      await sql`update customer_loyalty_profiles set points_balance = ${truth}, updated_at = now() where id = ${d.id}`.execute(trx);
      repaired++;
      // one alert per profile per SALON day (the branch's own zone, not the database server's)
      const dayStart = new Date(dayStartMs(await branchTimeZone(trx, d.tenant_id, d.branch_id)));
      const already = (await sql`select 1 from owner_alerts where tenant_id = ${d.tenant_id} and category = 'loyalty_reconcile'
        and created_at >= ${dayStart} and metadata->>'profileId' = ${String(d.id)} limit 1`.execute(trx)).rows.length > 0;
      if (!already) {
        await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
          values (${d.tenant_id}, ${d.branch_id}, 'loyalty_reconcile', 'warning', 'new', 'Loyalty balance corrected',
                  ${`A customer's points balance (${before}) did not match their loyalty history (${truth}). The balance was corrected to match the history.`},
                  ${JSON.stringify({ profileId: String(d.id), customerId: String(d.customer_id), before, after: truth })}::jsonb, 'owner')`.execute(trx);
        alerts++;
      }
    });
  }
  return { checked: drift.length, repaired, alerts };
}

/** Thin injectable wrapper for callers that hold the pool rather than a transaction. */
export class LoyaltyLedgerService {
  constructor(private readonly db: Kysely<any>) {}
  apply(input: LoyaltyEntryInput, trx?: Kysely<any>): Promise<LoyaltyEntryResult> {
    return trx ? applyLoyaltyEntry(trx, input) : this.db.transaction().execute((t) => applyLoyaltyEntry(t as any, input));
  }
  reconcile(opts?: { tenantId?: string; limit?: number }): Promise<LoyaltyReconcileResult> { return reconcileLoyaltyBalances(this.db, opts); }
}
