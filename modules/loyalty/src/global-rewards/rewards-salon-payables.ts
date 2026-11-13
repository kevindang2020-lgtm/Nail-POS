// rewards-salon-payables.ts — the SALON's own view of what the rewards network owes it (extras GLOBAL LOYALTY REWARDS 07 + 10).
// Read-only and tenant-scoped: every query is keyed by the session's tenant. Nothing here moves a payable, requests a payout
// or touches a journal — payouts stay Super Admin + a verified provider callback (rewards-payouts.ts).
//
//   07 Reimbursement drill-down  each payable with its stage (PAYABLE / PROCESSING / PAID / EXCEPTION / CLOSED), WHY it is in
//                                that stage, the payout attempts the provider answered (status, settlement reference,
//                                signature-verified, settled time, failure code), the append-only adjustments, and the journal
//                                lines on this salon's own accounts (reimbursement_payable, merchant_recovery_receivable) —
//                                evidence as recorded, nothing inferred.
//   10 Stale-provider indicator  whether a payout provider is connected at all, the last VERIFIED settlement for this salon,
//                                and payouts waiting on the provider (SUBMITTED / REQUESTED) counted apart from payouts whose
//                                provider answer is UNKNOWN (no answer — never assumed sent or failed).
import { sql, type Kysely } from 'kysely';
import { payoutProviderFromEnv } from './rewards-payouts';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

export const SALON_PAYABLE_STATUSES = ['ACCRUED_OWED', 'PAYOUT_ELIGIBLE', 'PAYOUT_PENDING', 'PAID', 'PAYOUT_FAILED', 'ON_HOLD', 'ADJUSTED', 'OFFSET'] as const;
export type SalonPayableStatus = (typeof SALON_PAYABLE_STATUSES)[number];
export type SalonPayableStage = 'PAYABLE' | 'PROCESSING' | 'PAID' | 'EXCEPTION' | 'CLOSED';

/** the plain stage a stored status is in — the screen's PAYABLE / PROCESSING / PAID words come from here, never from the client */
export function payableStage(status: string): SalonPayableStage {
  if (status === 'ACCRUED_OWED' || status === 'PAYOUT_ELIGIBLE') return 'PAYABLE';
  if (status === 'PAYOUT_PENDING') return 'PROCESSING';
  if (status === 'PAID') return 'PAID';
  if (status === 'PAYOUT_FAILED' || status === 'ON_HOLD') return 'EXCEPTION';
  return 'CLOSED';   // ADJUSTED (reversed before payout) / OFFSET (recovery claim after payout)
}

/** a code for why the payable is where it is (the screen translates it); built only from the recorded rows */
export function payableWhy(status: string, lastAttempt: { status: string } | null, providerConnected: boolean): string {
  switch (status) {
    case 'ACCRUED_OWED': return providerConnected ? 'owed_awaiting_review' : 'owed_no_provider';
    case 'PAYOUT_ELIGIBLE': return providerConnected ? 'eligible_awaiting_payout' : 'eligible_no_provider';
    case 'PAYOUT_PENDING': return lastAttempt?.status === 'UNKNOWN' ? 'pending_provider_unknown' : 'pending_provider_answer';
    case 'PAID': return 'paid_verified_settlement';
    case 'PAYOUT_FAILED': return 'payout_failed_still_owed';
    case 'ON_HOLD': return 'on_hold_finance_review';
    case 'ADJUSTED': return 'adjusted_refund_before_payout';
    default: return 'offset_refund_after_payout';
  }
}

export interface SalonPayablesQuery { status?: string | null; page?: number; pageSize?: number }

export async function salonPayables(db: Kysely<any>, tenantId: string, q: SalonPayablesQuery, providerConnected: boolean = payoutProviderFromEnv() !== null) {
  const size = Math.max(1, Math.min(25, Math.floor(Number(q.pageSize)) || 10));
  const page = Math.max(1, Math.min(10_000, Math.floor(Number(q.page)) || 1));
  const status = q.status && (SALON_PAYABLE_STATUSES as readonly string[]).includes(q.status) ? q.status : null;
  const statusWhere = status ? sql`m.status = ${status}` : sql`true`;

  const byStatus = (await sql<{ status: string; c: string | number; owed: string | number | null }>`SELECT m.status, count(*) AS c, sum(m.amount_cents - m.adjusted_cents) AS owed
    FROM merchant_reimbursements m WHERE m.tenant_id = ${tenantId}::uuid GROUP BY m.status ORDER BY m.status`.execute(db)).rows;
  const total = n((await sql<{ c: string | number }>`SELECT count(*) AS c FROM merchant_reimbursements m WHERE m.tenant_id = ${tenantId}::uuid AND ${statusWhere}`.execute(db)).rows[0]?.c);

  // stale-provider indicator: the last VERIFIED settlement, and waiting vs unknown provider answers (this salon only)
  const fresh = (await sql<{ last_verified: Date | string | null; waiting: string | number; unknown: string | number; oldest_waiting: Date | string | null; oldest_unknown: Date | string | null }>`SELECT
      max(pa.settled_at) FILTER (WHERE pa.status = 'SETTLED' AND pa.signature_verified) AS last_verified,
      count(*) FILTER (WHERE pa.status IN ('REQUESTED', 'SUBMITTED')) AS waiting,
      count(*) FILTER (WHERE pa.status = 'UNKNOWN') AS unknown,
      min(pa.created_at) FILTER (WHERE pa.status IN ('REQUESTED', 'SUBMITTED')) AS oldest_waiting,
      min(pa.created_at) FILTER (WHERE pa.status = 'UNKNOWN') AS oldest_unknown
    FROM payout_attempts pa WHERE pa.tenant_id = ${tenantId}::uuid`.execute(db)).rows[0];

  const rows = (await sql<{ id: string; redemption_id: string; ticket_id: string | null; amount_cents: string | number; adjusted_cents: string | number; status: string; hold_reason: string | null; provider_ref: string | null; paid_at: Date | string | null; created_at: Date | string; eligible_at: Date | string | null }>`SELECT
      m.id, m.redemption_id, m.ticket_id, m.amount_cents, m.adjusted_cents, m.status, m.hold_reason, m.provider_ref, m.paid_at, m.created_at, m.eligible_at
    FROM merchant_reimbursements m WHERE m.tenant_id = ${tenantId}::uuid AND ${statusWhere}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`.execute(db)).rows;
  const ids = rows.map((r) => String(r.id));

  const attempts = ids.length ? (await sql<{ id: string; reimbursement_id: string; status: string; provider: string; amount_cents: string | number; settlement_ref: string | null; settled_at: Date | string | null; signature_verified: boolean; failure_code: string | null; created_at: Date | string }>`SELECT
      pa.id, pa.reimbursement_id, pa.status, pa.provider, pa.amount_cents, pa.settlement_ref, pa.settled_at, pa.signature_verified, pa.failure_code, pa.created_at
    FROM payout_attempts pa WHERE pa.tenant_id = ${tenantId}::uuid AND pa.reimbursement_id = ANY(${ids}::uuid[]) ORDER BY pa.created_at, pa.id`.execute(db)).rows : [];
  const adjustments = ids.length ? (await sql<{ reimbursement_id: string; kind: string; amount_cents: string | number; source_table: string; source_id: string; created_at: Date | string }>`SELECT
      ra.reimbursement_id, ra.kind, ra.amount_cents, ra.source_table, ra.source_id, ra.created_at
    FROM reimbursement_adjustments ra WHERE ra.tenant_id = ${tenantId}::uuid AND ra.reimbursement_id = ANY(${ids}::uuid[]) ORDER BY ra.created_at`.execute(db)).rows : [];

  // journal evidence: lines on THIS salon's own accounts whose entry came from the payable's redemption,
  // one of its payout attempts, or one of its adjustments' refunds
  const srcKey = (t: string, s: string) => `${t}:${s}`;
  const owner = new Map<string, string>();
  for (const r of rows) owner.set(srcKey('reward_redemptions', String(r.redemption_id)), String(r.id));
  for (const a of attempts) owner.set(srcKey('payout_attempts', String(a.id)), String(a.reimbursement_id));
  for (const a of adjustments) owner.set(srcKey(a.source_table, String(a.source_id)), String(a.reimbursement_id));
  const keys = [...owner.keys()];
  const journal = keys.length ? (await sql<{ entry_type: string; account: string; source_table: string; source_id: string; created_at: Date | string; debit: string | number; credit: string | number }>`SELECT
      je.entry_type, jl.account, je.source_table, je.source_id, je.created_at, jl.debit_cents AS debit, jl.credit_cents AS credit
    FROM rewards_journal_entries je JOIN rewards_journal_lines jl ON jl.entry_id = je.id
    WHERE jl.account IN ('reimbursement_payable', 'merchant_recovery_receivable') AND jl.tenant_id = ${tenantId}::uuid AND (je.source_table || ':' || je.source_id) = ANY(${keys}::text[])
    ORDER BY je.created_at, je.id, jl.account`.execute(db)).rows : [];

  return {
    provider: { connected: providerConnected, state: (providerConnected ? 'CONNECTED' : 'BLOCKED_EXTERNAL') as 'CONNECTED' | 'BLOCKED_EXTERNAL' },
    settlement: {
      lastVerifiedAt: iso(fresh?.last_verified),
      waitingOnProvider: n(fresh?.waiting), oldestWaitingSince: iso(fresh?.oldest_waiting),
      unknownAnswer: n(fresh?.unknown), oldestUnknownSince: iso(fresh?.oldest_unknown),
    },
    totals: byStatus.map((s) => ({ status: s.status, stage: payableStage(s.status), count: n(s.c), owedCents: n(s.owed) })),
    total, page, pageSize: size, pageCount: Math.max(1, Math.ceil(total / size)),
    items: rows.map((r) => {
      const mine = attempts.filter((a) => String(a.reimbursement_id) === String(r.id));
      const last = mine.length ? mine[mine.length - 1] : null;
      return {
        id: String(r.id), redemptionId: String(r.redemption_id), ticketId: r.ticket_id ? String(r.ticket_id) : null,
        amountCents: n(r.amount_cents), adjustedCents: n(r.adjusted_cents), owedCents: n(r.amount_cents) - n(r.adjusted_cents),
        status: r.status, stage: payableStage(r.status), why: payableWhy(r.status, last, providerConnected),
        holdReason: r.hold_reason ?? null, settlementRef: r.provider_ref ?? null, paidAt: iso(r.paid_at), eligibleAt: iso(r.eligible_at), createdAt: iso(r.created_at),
        attempts: mine.map((a) => ({ id: String(a.id), status: a.status, provider: a.provider, amountCents: n(a.amount_cents), settlementRef: a.settlement_ref ?? null,
          signatureVerified: !!a.signature_verified, settledAt: iso(a.settled_at), failureCode: a.failure_code ?? null, requestedAt: iso(a.created_at) })),
        adjustments: adjustments.filter((a) => String(a.reimbursement_id) === String(r.id)).map((a) => ({ kind: a.kind, amountCents: n(a.amount_cents), at: iso(a.created_at) })),
        journal: journal.filter((j) => owner.get(srcKey(j.source_table, String(j.source_id))) === String(r.id))
          .map((j) => ({ entryType: j.entry_type, account: j.account, debitCents: n(j.debit), creditCents: n(j.credit), at: iso(j.created_at) })),
      };
    }),
  };
}

// ── extras GLOBAL LOYALTY REWARDS 16 / Global Loyalty Rewards 16: the owner's finance audit trail export ──────────────────────
// ONE CSV of this salon's backed token purchases, wallet allocations (points funded, refunds returned …), reimbursement
// payables with their payout evidence, and an `exception` flag on rows finance must look at. Every row carries its source
// table + id, the date basis (created time in the salon's zone), and for an allocation the earning rule that applied.
// Provider references are cut to their last 6 characters; no customer identity is exported. Formula-injection safe. The
// export is audited (loyalty.network_finance_exported) in the same call; nothing else is written.
const PURCHASE_EXCEPTION = new Set(['UNKNOWN', 'FAILED', 'DECLINED', 'REVERSED', 'CHARGED_BACK']);
const PAYABLE_EXCEPTION = new Set(['ON_HOLD', 'PAYOUT_FAILED', 'OFFSET']);
export const FINANCE_EXPORT_COLUMNS = ['record_type', 'record_id', 'occurred_at_utc', 'salon_day', 'date_basis', 'status', 'exception', 'amount_usd', 'balance_after_usd',
  'source_table', 'source_id', 'rule', 'provider_ref_last6', 'note'] as const;
const csvCell = (v: unknown): string => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const usd = (c: unknown): string => { const v = Math.round(n(c)); const a = Math.abs(v); return `${v < 0 ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`; };
const last6 = (v: unknown): string => (v == null || v === '' ? '' : String(v).slice(-6));

export async function salonFinanceExport(db: Kysely<any>, tenantId: string, range: { from: string; to: string }, tz: string) {
  const start = sql`(${range.from}::date)::timestamp AT TIME ZONE ${tz}`;
  const end = sql`((${range.to}::date + 1)::timestamp) AT TIME ZONE ${tz}`;
  const day = (col: 'i' | 'l' | 'm') => (col === 'i' ? sql`to_char(i.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD')` : col === 'l' ? sql`to_char(l.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD')` : sql`to_char(m.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD')`);
  const purchases = (await sql<{ id: string; created_at: Date | string; d: string; status: string; amount_cents: string | number; token_cents: string | number; provider_ref: string | null; failure_code: string | null }>`SELECT
      i.id, i.created_at, ${day('i')} AS d, i.status, i.amount_cents, i.token_cents, i.provider_ref, i.failure_code
    FROM token_purchase_intents i WHERE i.tenant_id = ${tenantId}::uuid AND i.created_at >= ${start} AND i.created_at < ${end} ORDER BY i.created_at, i.id LIMIT 20000`.execute(db)).rows;
  const ledger = (await sql<{ id: string; created_at: Date | string; d: string; entry_type: string; delta_cents: string | number; balance_after_cents: string | number; source_table: string | null; source_id: string | null; rule_source: string | null; rule_version_id: string | null }>`SELECT
      l.id, l.created_at, ${day('l')} AS d, l.entry_type, l.delta_cents, l.balance_after_cents, l.source_table, l.source_id, e.rule_source, e.rule_version_id
    FROM token_wallet_ledger l LEFT JOIN reward_earn_transactions e ON l.source_table = 'reward_earn_transactions' AND e.id::text = l.source_id::text AND e.tenant_id = l.tenant_id
    WHERE l.tenant_id = ${tenantId}::uuid AND l.created_at >= ${start} AND l.created_at < ${end} ORDER BY l.created_at, l.id LIMIT 20000`.execute(db)).rows;
  const payables = (await sql<{ id: string; created_at: Date | string; d: string; status: string; amount_cents: string | number; adjusted_cents: string | number; redemption_id: string; provider_ref: string | null; paid_at: Date | string | null; hold_reason: string | null; attempt_status: string | null }>`SELECT
      m.id, m.created_at, ${day('m')} AS d, m.status, m.amount_cents, m.adjusted_cents, m.redemption_id, m.provider_ref, m.paid_at, m.hold_reason,
      (SELECT pa.status FROM payout_attempts pa WHERE pa.tenant_id = m.tenant_id AND pa.reimbursement_id = m.id ORDER BY pa.created_at DESC, pa.id DESC LIMIT 1) AS attempt_status
    FROM merchant_reimbursements m WHERE m.tenant_id = ${tenantId}::uuid AND m.created_at >= ${start} AND m.created_at < ${end} ORDER BY m.created_at, m.id LIMIT 20000`.execute(db)).rows;
  const basis = `created (${tz})`;
  const lines: string[] = [FINANCE_EXPORT_COLUMNS.join(',')];
  const push = (cells: unknown[]) => lines.push(cells.map(csvCell).join(','));
  for (const p of purchases) push(['token_purchase', p.id, iso(p.created_at), p.d, basis, p.status, PURCHASE_EXCEPTION.has(p.status) ? 'yes' : 'no', usd(p.amount_cents), '', 'token_purchase_intents', p.id, '', last6(p.provider_ref),
    [`tokens_value_usd=${usd(p.token_cents)}`, p.failure_code ? `failure=${p.failure_code}` : ''].filter(Boolean).join('; ')]);
  for (const l of ledger) push(['wallet_' + l.entry_type, l.id, iso(l.created_at), l.d, basis, 'posted', 'no', usd(l.delta_cents), usd(l.balance_after_cents), l.source_table ?? '', l.source_id ?? '',
    l.rule_source ? `${l.rule_source}${l.rule_version_id ? ':' + l.rule_version_id : ''}` : '', '', '']);
  for (const m of payables) push(['reimbursement_payable', m.id, iso(m.created_at), m.d, basis, m.status, PAYABLE_EXCEPTION.has(m.status) ? 'yes' : 'no', usd(n(m.amount_cents) - n(m.adjusted_cents)), '', 'reward_redemptions', m.redemption_id, '', last6(m.provider_ref),
    [n(m.adjusted_cents) ? `reversed_usd=${usd(m.adjusted_cents)}` : '', m.attempt_status ? `last_payout_attempt=${m.attempt_status}` : '', m.paid_at ? `paid_at=${iso(m.paid_at)}` : '', m.hold_reason ? `hold_reason=${m.hold_reason}` : ''].filter(Boolean).join('; ')]);
  const counts = { purchases: purchases.length, allocations: ledger.length, payables: payables.length, exceptions: purchases.filter((p) => PURCHASE_EXCEPTION.has(p.status)).length + payables.filter((m) => PAYABLE_EXCEPTION.has(m.status)).length };
  return { csv: lines.join('\n') + '\n', rows: lines.length - 1, counts };
}
