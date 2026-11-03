// ticket-money.ts — what a ticket is worth, read the way Checkout actually writes it (Payments & Money guides, Nov 3 2026).
//
// Two facts the finance read models had wrong:
//  1. `tickets.subtotal_cents` is written ONCE, at payment, and it is ALREADY net of the discount (checkout `effSubtotal`
//     → setFinalTotals). Subtracting `discount_cents` from it again counted every discount twice; skip-line checkout never
//     writes it at all (those tickets read $0). Sales are therefore taken from the ticket's live lines — the same source the
//     Sales Report uses — and net sales are lines − discount, never below 0.
//  2. `tickets.total_cents` is written only at payment and `locked_total_cents` is the REMAINING amount due at the last card
//     attempt — neither is "what this unpaid ticket costs". The amount still due on an unpaid ticket is computed here in
//     TypeScript with THE tax function (@aipowersalon/money taxCents — one-tax rule) and the salon's effective tax rate:
//     net sales + tax + tip − what was collected toward it (card surcharge excluded: it is charged on top, never owed).
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { taxCents } from '@aipowersalon/money';

/** Σ live line totals of the ticket aliased `t` (service + retail, before discount). */
export const TICKET_LINES_T: RawBuilder<number> =
  sql<number>`(select coalesce(sum(l.line_total_cents), 0) from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null)`;
/** Net sales of the ticket aliased `t`: its lines less its discount, never below zero. */
export const TICKET_NET_SALES_T: RawBuilder<number> = sql<number>`greatest(0, ${TICKET_LINES_T} - coalesce(t.discount_cents, 0))`;

/** The checkout default when a salon never saved a tax setting (checkout-display.dto DEFAULT_CHECKOUT_SETTINGS). Kept in step
 *  by checkout's own test (checkout-settings-tax-parity.vitest.spec.ts). */
export const DEFAULT_TAX_RATE_PERCENT = 7.75;

/** The effective sales-tax rate for a branch — branch 'tax' row over the salon row, `enabled:false` → 0 — the same rule as
 *  checkout's resolveCheckoutSettings. Returns a function so many tickets in many branches cost one query. */
export async function taxRates(db: Kysely<any>, tenantId: string): Promise<(branchId: string | null) => number> {
  const rows = (await sql<{ branch_id: string | null; settings_json: any }>`select branch_id, settings_json from tenant_settings where tenant_id = ${tenantId} and category = 'tax'`.execute(db)).rows;
  const rateOf = (j: any): number | null => {
    if (!j || typeof j !== 'object') return null;
    if (j.enabled === false) return 0;
    const x = Number(j.taxRatePercent); return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const salon = rows.find((r) => r.branch_id == null);
  const salonRate = salon ? (rateOf(salon.settings_json) ?? DEFAULT_TAX_RATE_PERCENT) : DEFAULT_TAX_RATE_PERCENT;
  const byBranch = new Map(rows.filter((r) => r.branch_id != null).map((r) => [String(r.branch_id), r.settings_json]));
  return (branchId) => {
    if (!branchId || !byBranch.has(branchId)) return salonRate;
    const j = byBranch.get(branchId);
    if (j && typeof j === 'object' && j.enabled === false) return 0;
    const x = Number(j?.taxRatePercent); return Number.isFinite(x) && x >= 0 ? x : salonRate;
  };
}

export interface TicketDueInput { branchId: string | null; status: string; netSalesCents: number; tipCents: number; collectedCents: number; collectedSurchargeCents: number; paidTotalCents?: number | null }
export interface TicketDue { totalCents: number; dueCents: number; taxCents: number }

/** Total owed and still due. A PAID ticket owes nothing more; its total is what was collected (written at payment). */
export function ticketDue(x: TicketDueInput, rate: number): TicketDue {
  const tax = taxCents(Math.max(0, x.netSalesCents), rate);
  if (x.status === 'paid') {
    const total = x.paidTotalCents != null && x.paidTotalCents > 0 ? x.paidTotalCents : x.collectedCents;
    return { totalCents: total, dueCents: 0, taxCents: tax };
  }
  const total = Math.max(0, x.netSalesCents) + tax + Math.max(0, x.tipCents);
  return { totalCents: total, dueCents: Math.max(0, total - (x.collectedCents - x.collectedSurchargeCents)), taxCents: tax };
}

/** Every UNPAID ticket that has collected something (partly paid), with its exact total and amount still due — computed
 *  here, once per request, so SQL screens can join the answer instead of guessing it. `scope` narrows to a location. */
export async function openTicketDues(db: Kysely<any>, tenantId: string, confirmed: readonly string[], branchId?: string | null): Promise<Map<string, TicketDue>> {
  const rows = (await sql<any>`select t.id, t.branch_id, t.status, coalesce(t.tip_cents, 0)::bigint as tip, ${TICKET_NET_SALES_T}::bigint as net,
        pay.collected, pay.surcharge
      from tickets t join lateral (select coalesce(sum(p.amount_cents), 0)::bigint as collected, coalesce(sum(p.surcharge_cents), 0)::bigint as surcharge, count(*) as n
        from payments p where p.tenant_id = t.tenant_id and p.ticket_id = t.id and p.status in (${sql.join([...confirmed])})) pay on pay.n > 0
     where t.tenant_id = ${tenantId} and t.status <> 'paid' and t.removed_at is null and t.status not in ('void', 'voided', 'canceled', 'cancelled')
       and ${branchId ? sql`(t.branch_id = ${branchId}::uuid or t.branch_id is null)` : sql`true`}
     order by t.created_at desc limit 5000`.execute(db)).rows;
  const rate = await taxRates(db, tenantId);
  const out = new Map<string, TicketDue>();
  for (const r of rows) out.set(String(r.id), ticketDue({ branchId: r.branch_id ?? null, status: String(r.status), netSalesCents: Number(r.net), tipCents: Number(r.tip), collectedCents: Number(r.collected), collectedSurchargeCents: Number(r.surcharge) }, rate(r.branch_id ?? null)));
  return out;
}
/** The dues as a joinable `(values …) od(id, total_cents, due_cents)` — an empty map still yields a typed empty relation. */
export function duesRelation(m: Map<string, TicketDue>): RawBuilder<unknown> {
  if (!m.size) return sql`(select null::uuid as id, 0::bigint as total_cents, 0::bigint as due_cents where false)`;
  return sql`(values ${sql.join([...m].map(([id, d]) => sql`(${id}::uuid, ${d.totalCents}::bigint, ${d.dueCents}::bigint)`))})`;
}
