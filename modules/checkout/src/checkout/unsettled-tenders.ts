// unsettled-tenders.ts — Remaining-work mandate P1-3 / B-81 (Oct 23 2026): "no other tender while a card attempt is
// unsettled" must see EVERY place a card charge can be mid-air on a ticket, not only `payments` rows:
//   • payments           a straight POS card attempt claimed 'processing' (its answer lost / unknown);
//   • payment_attempts   a split's card reservation ('processing'), or a Tap to Pay attempt in flight / unresolved
//                        (the mobile attempt states that block a new attempt);
//   • payment_intents    a Skip-the-Line app charge whose card WAS sent to the processor (charge_started_at set) and whose
//                        answer is not back ('processing').
// One read, used by the POS checkout guard (cash / card / gift / split), the skip-line confirm and the mobile checkout.
// Pure SQL + a pure filter so the in-memory repository and PGlite tests share the same rule.
import { sql, type Kysely } from 'kysely';
import { IN_FLIGHT } from '../mobile-checkout/payment-attempt-state';

// Wire type owned by @aipowersalon/api-contracts/tenant (Constitution 13 §13).
import type { UnsettledTender } from '@aipowersalon/api-contracts/tenant';
export type { UnsettledTender };

export const APP_CARD_METHODS: readonly string[] = ['card', 'apple_pay', 'google_pay'];

/** An attempt row's status counts as unsettled when the money question is open: 'processing' (POS split), or any mobile
 *  state that blocks a new attempt (reader / authorization / unknown / reconciliation). */
export function attemptStatusUnsettled(status: string): boolean {
  return status === 'processing' || status === 'timed_out' || (IN_FLIGHT as ReadonlySet<string>).has(status);
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));

export async function unsettledTendersForTicket(db: Kysely<any>, tenantId: string, ticketId: string, opts: { exceptPaymentId?: string | null; exceptIntentId?: string | null } = {}): Promise<UnsettledTender[]> {
  // M6-6 (Secure Tap to Pay §33): 'timed_out' too — a Tap to Pay attempt can time out AFTER authorization was asked for
  // (authorization_pending → timed_out); until the recovery worker / Verify resolves it the card may have been charged
  const inflight = ['processing', 'timed_out', ...IN_FLIGHT];
  const [pay, att, intents] = await Promise.all([
    sql<any>`select id, method, status, amount_cents, created_at from payments where tenant_id = ${tenantId} and ticket_id = ${ticketId} and method = 'card' and status = 'processing'`.execute(db),
    sql<any>`select id, method, status, amount_cents, created_at, idempotency_key from payment_attempts where tenant_id = ${tenantId} and ticket_id = ${ticketId} and status in (${sql.join(inflight)})`.execute(db),
    sql<any>`select id, method, status, amount_cents, created_at from payment_intents where tenant_id = ${tenantId} and ticket_id = ${ticketId} and status = 'processing' and charge_started_at is not null and method in (${sql.join(APP_CARD_METHODS)})`.execute(db),
  ]);
  const out: UnsettledTender[] = [];
  for (const r of pay.rows) if (r.id !== opts.exceptPaymentId) out.push({ kind: 'payment', id: r.id, method: r.method, status: r.status, amountCents: Number(r.amount_cents), createdAt: iso(r.created_at) });
  for (const r of att.rows) out.push({ kind: 'attempt', id: r.id, method: r.method, status: r.status, amountCents: Number(r.amount_cents), createdAt: iso(r.created_at), idempotencyKey: r.idempotency_key ?? null });
  for (const r of intents.rows) if (r.id !== opts.exceptIntentId) out.push({ kind: 'app_intent', id: r.id, method: r.method, status: r.status, amountCents: Number(r.amount_cents), createdAt: iso(r.created_at) });
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** An unsettled tender with the ticket it sits on — the board-wide form of the rule above. */
export type BranchUnsettledTender = UnsettledTender & { ticketId: string };

/**
 * Checkout One-Screen mandate §15–§16 / §34 (Oct 28 2026): the SAME rule as unsettledTendersForTicket, for every ticket
 * of one branch — what the board's "Pending Payments" counts and what "Transactions Needing Attention" lists. Any age:
 * a card answer lost yesterday is still a money question today. `branchId` null = the tenant's branch-less rows only
 * (a branch-scoped board never sees another branch's attempts). Bounded: the board shows the oldest `limit`.
 */
export async function unsettledTendersForBranch(db: Kysely<any>, tenantId: string, branchId: string | null, limit = 200): Promise<BranchUnsettledTender[]> {
  const inflight = ['processing', 'timed_out', ...IN_FLIGHT];
  const br = () => (branchId ? sql`branch_id = ${branchId}` : sql`branch_id is null`);   // all three tables name it branch_id
  const [pay, att, intents] = await Promise.all([
    sql<any>`select id, ticket_id, method, status, amount_cents, created_at from payments where tenant_id = ${tenantId} and ${br()} and method = 'card' and status = 'processing' order by created_at limit ${limit}`.execute(db),
    sql<any>`select id, ticket_id, method, status, amount_cents, created_at, idempotency_key from payment_attempts where tenant_id = ${tenantId} and ${br()} and status in (${sql.join(inflight)}) order by created_at limit ${limit}`.execute(db),
    sql<any>`select id, ticket_id, method, status, amount_cents, created_at from payment_intents where tenant_id = ${tenantId} and ${br()} and status = 'processing' and charge_started_at is not null and method in (${sql.join(APP_CARD_METHODS)}) order by created_at limit ${limit}`.execute(db),
  ]);
  const out: BranchUnsettledTender[] = [];
  for (const r of pay.rows) if (r.ticket_id) out.push({ kind: 'payment', id: r.id, ticketId: r.ticket_id, method: r.method, status: r.status, amountCents: Number(r.amount_cents), createdAt: iso(r.created_at) });
  for (const r of att.rows) if (r.ticket_id) out.push({ kind: 'attempt', id: r.id, ticketId: r.ticket_id, method: r.method, status: r.status, amountCents: Number(r.amount_cents), createdAt: iso(r.created_at), idempotencyKey: r.idempotency_key ?? null });
  for (const r of intents.rows) if (r.ticket_id) out.push({ kind: 'app_intent', id: r.id, ticketId: r.ticket_id, method: r.method, status: r.status, amountCents: Number(r.amount_cents), createdAt: iso(r.created_at) });
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
}

/** §34 "void / refund uncertainty": a refund sent to the processor whose answer is not back (or the sweep stranded it). */
export interface UncertainRefund { refundId: string; paymentId: string; ticketId: string | null; amountCents: number; status: string; createdAt: string; stranded: boolean }
export async function uncertainRefundsForBranch(db: Kysely<any>, tenantId: string, branchId: string | null, limit = 50): Promise<UncertainRefund[]> {
  const br = branchId ? sql`r.branch_id = ${branchId}` : sql`r.branch_id is null`;
  const rows = await sql<any>`select r.id, r.payment_id, p.ticket_id, r.amount_cents, r.status, r.created_at, r.stranded_at
      from payment_refunds r left join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
     where r.tenant_id = ${tenantId} and ${br} and (r.status = 'processing' or (r.stranded_at is not null and r.status in ('pending', 'reserved')))
     order by r.created_at limit ${limit}`.execute(db);
  return rows.rows.map((r: any) => ({ refundId: r.id, paymentId: r.payment_id, ticketId: r.ticket_id ?? null, amountCents: Number(r.amount_cents), status: r.status, createdAt: iso(r.created_at), stranded: !!r.stranded_at }));
}
