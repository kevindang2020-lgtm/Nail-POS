// rewards-payouts.ts — salon reimbursement PAYOUTS (Final Completion guide §05 highlighted rule; LoyaltyTokens.pdf §7.4).
// PLATFORM-WIDE by design: a payout provider's settlement callback names its own payout / event id, not a salon, and Super
// Admin acts on a payable by id. Reached only from Super Admin (SuperAdminGuard + super_admin.billing.manage + step-up) and
// from a payout provider adapter's signature-verified callback — no salon route calls anything here. Reviewed in
// check:tenant's baseline as a platform-only file. PAID is reachable ONLY through applyPayoutSettlement with a verified
// signature, a matching amount and a settlement reference; the database refuses anything else (trg_mr_paid_guard,
// ck_pa_settled_proof). No payout provider is approved: payoutProviderFromEnv() → null (BLOCKED_EXTERNAL).
import { sql, type Transaction, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { GlobalRewardsError, dollarsLabel } from './global-rewards-core';
import { postJournal } from './global-rewards.repository';
import { MERCHANT_REIMBURSEMENT, PAYOUT_ATTEMPT } from './global-rewards-lifecycles';

type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export interface PayoutProvider {
  readonly name: string;
  submit(p: { attemptId: string; tenantId: string; amountCents: number; idempotencyKey: string }): Promise<{ status: 'SUBMITTED' | 'FAILED' | 'UNKNOWN'; providerPayoutId: string | null; failureCode?: string | null }>;
}
export const PAYOUT_PROVIDER = 'RewardsPayoutProvider';
/** No payout provider is approved (BLOCKED_EXTERNAL). There is deliberately no sandbox payout that can mark anything PAID. */
export function payoutProviderFromEnv(): PayoutProvider | null { return null; }

/** ACCRUED_OWED / PAYOUT_FAILED / ON_HOLD → PAYOUT_ELIGIBLE (Super Admin, after the books check passes). */
export async function markPayoutEligible(trx: Transaction<any>, a: { reimbursementId: string; actorUserId: string }): Promise<boolean> {
  const r = (await sql<Row>`UPDATE merchant_reimbursements m SET status = 'PAYOUT_ELIGIBLE', eligible_at = now(), hold_reason = NULL, version = m.version + 1, updated_by = ${a.actorUserId}::uuid, updated_at = now()
    WHERE m.id = ${a.reimbursementId}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'PAYOUT_ELIGIBLE', 'm')} AND m.adjusted_cents < m.amount_cents RETURNING m.id`.execute(trx)).rows[0];
  return !!r;
}
export async function holdPayable(trx: Transaction<any>, a: { reimbursementId: string; actorUserId: string; reason: string }): Promise<boolean> {
  const r = (await sql<Row>`UPDATE merchant_reimbursements m SET status = 'ON_HOLD', hold_reason = ${a.reason}, version = m.version + 1, updated_by = ${a.actorUserId}::uuid, updated_at = now()
    WHERE m.id = ${a.reimbursementId}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'ON_HOLD', 'm')} RETURNING m.id`.execute(trx)).rows[0];
  return !!r;
}

/** PAYOUT_ELIGIBLE → PAYOUT_PENDING through an approved provider. Without one: PAYOUT_PROVIDER_UNAVAILABLE, nothing changes. */
export async function requestPayout(db: Kysely<any>, provider: PayoutProvider | null, a: { reimbursementId: string; actorUserId: string; idempotencyKey: string }) {
  if (!provider) throw new GlobalRewardsError('Salon payouts are not set up yet: no approved payout provider is connected. The amount stays owed.', 'PAYOUT_PROVIDER_UNAVAILABLE', 503);
  const at = await db.transaction().execute(async (trx) => {
    const m = (await sql<Row>`SELECT m.id, m.tenant_id, m.amount_cents, m.adjusted_cents FROM merchant_reimbursements m WHERE m.id = ${a.reimbursementId}::uuid AND m.status = 'PAYOUT_ELIGIBLE' FOR UPDATE`.execute(trx)).rows[0];
    if (!m) throw new GlobalRewardsError('Only an eligible payable can be paid out.', 'EARNING_POLICY_CONFLICT', 409);
    const amount = n(m.amount_cents) - n(m.adjusted_cents);
    const row = (await sql<Row>`INSERT INTO payout_attempts (tenant_id, reimbursement_id, provider, idempotency_key, amount_cents, requested_by) VALUES (${m.tenant_id}::uuid, ${m.id}::uuid, ${provider.name}, ${a.idempotencyKey}, ${amount}, ${a.actorUserId}::uuid)
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`.execute(trx)).rows[0];
    if (!row) return null;
    await sql`UPDATE merchant_reimbursements m SET status = 'PAYOUT_PENDING', payout_attempt_id = ${row.id}::uuid, version = m.version + 1, updated_by = ${a.actorUserId}::uuid, updated_at = now()
      WHERE m.id = ${m.id}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'PAYOUT_PENDING', 'm')}`.execute(trx);
    return { attemptId: String(row.id), tenantId: String(m.tenant_id), amountCents: amount };
  });
  if (!at) return { replay: true };
  let res: Awaited<ReturnType<PayoutProvider['submit']>>;
  try { res = await provider.submit({ ...at, idempotencyKey: a.idempotencyKey }); } catch { res = { status: 'UNKNOWN', providerPayoutId: null, failureCode: 'PROVIDER_NO_ANSWER' }; }
  await db.transaction().execute(async (trx) => {
    await sql`UPDATE payout_attempts pa SET status = ${res.status}, provider_payout_id = ${res.providerPayoutId}, failure_code = ${res.failureCode ?? null}, updated_at = now()
      WHERE pa.id = ${at.attemptId}::uuid AND ${canMoveToSql(PAYOUT_ATTEMPT, res.status, 'pa')}`.execute(trx);
    if (res.status === 'FAILED') await sql`UPDATE merchant_reimbursements m SET status = 'PAYOUT_FAILED', version = m.version + 1, updated_at = now() WHERE m.id = ${a.reimbursementId}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'PAYOUT_FAILED', 'm')}`.execute(trx);
  });
  return { attemptId: at.attemptId, status: res.status };
}

/**
 * The ONLY path to PAID: a payout provider's callback whose signature the adapter has VERIFIED. Duplicates (same provider
 * event) change nothing; a settlement whose amount does not match the attempt puts the payable ON_HOLD for finance and
 * never marks it paid; a failure moves it to PAYOUT_FAILED (still owed).
 */
export async function applyPayoutSettlement(trx: Transaction<any>, ev: { provider: string; providerEventId: string; providerPayoutId: string; outcome: 'SETTLED' | 'FAILED'; settlementRef: string | null; amountCents: number; signatureVerified: boolean }): Promise<{ outcome: 'paid' | 'failed' | 'duplicate' | 'mismatch' | 'unknown_payout' | 'unverified' }> {
  if (!ev.signatureVerified) return { outcome: 'unverified' };
  // extras GLOBAL LOYALTY REWARDS 09 (round 10): a REPLAYED callback still changes nothing, but one that claims something
  // different from what was already applied (another outcome, amount or settlement reference for a payout that is final) is
  // raised review-first as 'duplicate_callback' (dedupe per provider event) — an identical replay (an ordinary retry) is not
  const replayConflict = async (stored: Row) => {
    const claimed = { outcome: ev.outcome, amountCents: ev.amountCents, settlementRef: ev.settlementRef ?? null };
    const had = { outcome: String(stored.status), amountCents: stored.settled_amount_cents == null ? n(stored.amount_cents) : n(stored.settled_amount_cents), settlementRef: stored.settlement_ref ?? null };
    const differs = (stored.status === 'SETTLED' || stored.status === 'FAILED') && (claimed.outcome !== had.outcome || (claimed.outcome === 'SETTLED' && (claimed.amountCents !== had.amountCents || claimed.settlementRef !== had.settlementRef)));
    if (!differs) return;
    await sql`INSERT INTO loyalty_fraud_alerts (signal, severity, confidence, dedupe_key, tenant_id, evidence)
      VALUES ('duplicate_callback', 'high', 0.85, ${'callback_replay:' + ev.provider + ':' + ev.providerEventId}, ${stored.tenant_id}::uuid,
        ${JSON.stringify({ attemptId: String(stored.id), providerEventId: ev.providerEventId, applied: had, claimed })}::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING`.execute(trx);
  };
  const dup = (await sql<Row>`SELECT pa.id, pa.tenant_id, pa.status, pa.amount_cents, pa.settled_amount_cents, pa.settlement_ref FROM payout_attempts pa WHERE pa.provider = ${ev.provider} AND pa.provider_event_id = ${ev.providerEventId}`.execute(trx)).rows[0];
  if (dup) { await replayConflict(dup); return { outcome: 'duplicate' }; }
  const pa = (await sql<Row>`SELECT pa.id, pa.tenant_id, pa.reimbursement_id, pa.amount_cents, pa.status, pa.settled_amount_cents, pa.settlement_ref FROM payout_attempts pa WHERE pa.provider = ${ev.provider} AND pa.provider_payout_id = ${ev.providerPayoutId} FOR UPDATE`.execute(trx)).rows[0];
  if (!pa) return { outcome: 'unknown_payout' };
  if (pa.status === 'SETTLED' || pa.status === 'FAILED') { await replayConflict(pa); return { outcome: 'duplicate' }; }
  if (ev.outcome === 'FAILED') {
    await sql`UPDATE payout_attempts pa SET status = 'FAILED', provider_event_id = ${ev.providerEventId}, updated_at = now() WHERE pa.id = ${pa.id}::uuid AND ${canMoveToSql(PAYOUT_ATTEMPT, 'FAILED', 'pa')}`.execute(trx);
    await sql`UPDATE merchant_reimbursements m SET status = 'PAYOUT_FAILED', version = m.version + 1, updated_at = now() WHERE m.id = ${pa.reimbursement_id}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'PAYOUT_FAILED', 'm')}`.execute(trx);
    return { outcome: 'failed' };
  }
  if (!ev.settlementRef || ev.amountCents !== n(pa.amount_cents)) {
    await sql`UPDATE merchant_reimbursements m SET status = 'ON_HOLD', hold_reason = 'Provider settlement did not match the payout', version = m.version + 1, updated_at = now()
      WHERE m.id = ${pa.reimbursement_id}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'ON_HOLD', 'm')}`.execute(trx);
    await sql`INSERT INTO loyalty_fraud_alerts (signal, severity, confidence, dedupe_key, tenant_id, evidence)
      VALUES ('payout_anomaly', 'high', 0.90, ${'payout_mismatch:' + String(pa.id)}, ${pa.tenant_id}::uuid, ${JSON.stringify({ attemptId: String(pa.id), expectedCents: n(pa.amount_cents), reportedCents: ev.amountCents, hasSettlementRef: !!ev.settlementRef })}::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING`.execute(trx);
    return { outcome: 'mismatch' };
  }
  await sql`UPDATE payout_attempts pa SET status = 'SETTLED', provider_event_id = ${ev.providerEventId}, settlement_ref = ${ev.settlementRef}, settled_amount_cents = ${ev.amountCents},
      signature_verified = true, settled_at = now(), updated_at = now() WHERE pa.id = ${pa.id}::uuid AND ${canMoveToSql(PAYOUT_ATTEMPT, 'SETTLED', 'pa')}`.execute(trx);
  const paid = (await sql<Row>`UPDATE merchant_reimbursements m SET status = 'PAID', provider = ${ev.provider}, provider_ref = ${ev.settlementRef}, paid_at = now(), version = m.version + 1, updated_at = now()
    WHERE m.id = ${pa.reimbursement_id}::uuid AND ${canMoveToSql(MERCHANT_REIMBURSEMENT, 'PAID', 'm')} RETURNING m.id`.execute(trx)).rows[0];
  if (!paid) {
    // the money moved but the payable was no longer payable (put ON_HOLD / adjusted meanwhile): it used to be silently left as it was
    // while the attempt said SETTLED and the journal booked the cash out. Finance decides; nothing is booked against the payable.
    await sql`INSERT INTO loyalty_fraud_alerts (signal, severity, confidence, dedupe_key, tenant_id, evidence)
      VALUES ('payout_anomaly', 'high', 0.95, ${'payout_state:' + String(pa.id)}, ${pa.tenant_id}::uuid, ${JSON.stringify({ attemptId: String(pa.id), reason: 'settled_but_payable_not_payable', settledCents: ev.amountCents })}::jsonb)
      ON CONFLICT (dedupe_key) DO NOTHING`.execute(trx);
    return { outcome: 'mismatch' };
  }
  await postJournal(trx, { entryType: 'reimbursement_paid', tenantId: String(pa.tenant_id), sourceTable: 'payout_attempts', sourceId: String(pa.id), memo: `Payout settled ${dollarsLabel(ev.amountCents)}`,
    lines: [{ account: 'reimbursement_payable', tenantId: String(pa.tenant_id), debit: ev.amountCents }, { account: 'settlement_cash', tenantId: null, credit: ev.amountCents }] });
  return { outcome: 'paid' };
}

