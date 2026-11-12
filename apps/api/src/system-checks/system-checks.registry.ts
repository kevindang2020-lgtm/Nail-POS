// system-checks.registry.ts — the read-only checks behind each page's "Check … System" (extras arc, Nov 9 2026).
//
// Every check is ONE count of problem rows in the salon's own data (tenant_id from the session; the person's branch when the
// request has one). Nothing here writes. A check's severity says what a non-zero count means: FAILED = money or stock is
// wrong and a person must look; WARNING = needs attention. The wording (what it checks, how to fix) lives in the POS
// catalogues under syschk.<domain>.<key>.
//
// A rule the table already enforces (a CHECK, a foreign key) is NOT repeated here — it can never find anything.
// Values used below are the tables' own CHECK lists (read from Postgres 16, Nov 9 2026), e.g. payments.status,
// invoices.status, expenses.duplicate_status, deals.status, customer_memberships.status.
import { sql, type RawBuilder } from 'kysely';
import type { SystemCheckDomain } from '@aipowersalon/api-contracts/tenant';

export type CheckSeverity = 'WARNING' | 'FAILED';
/** t = tenant id, b = branch id or null (every branch). Returns one row { n }. */
export interface CheckDef { key: string; severity: CheckSeverity; count: (t: string, b: string | null) => RawBuilder<{ n: number }> }
export interface DomainDef { permission: string; checks: CheckDef[] }

/** each table alias's branch column, written out (no identifier is ever built from data) */
const BRANCH_COL = {
  e: sql`e.branch_id`, i: sql`i.branch_id`, s: sql`s.branch_id`, d: sql`d.branch_id`, p: sql`p.branch_id`, r: sql`r.branch_id`,
  a: sql`a.branch_id`, l: sql`l.branch_id`, m: sql`m.branch_id`, u: sql`u.branch_id`, x: sql`x.branch_id`,
  k: sql`k.branch_id`, t: sql`t.branch_id`, q: sql`q.branch_id`, c: sql`c.branch_id`, v: sql`v.branch_id`, w: sql`w.branch_id`, f: sql`f.branch_id`, g: sql`g.branch_id`, h: sql`h.branch_id`,
} as const;
type Alias = keyof typeof BRANCH_COL;
/** `AND <alias>.branch_id = b` when the request is for one branch */
const br = (alias: Alias, b: string | null) => (b ? sql`AND ${BRANCH_COL[alias]}::text = ${b}` : sql``);   // ::text — a few older tables keep ids as text
/** the SALON's calendar day for that row — its branch's time zone, never the server's UTC day */
const today = (alias: Alias, t: string) => sql`(now() AT TIME ZONE coalesce((SELECT bz.timezone FROM branches bz WHERE bz.tenant_id = ${t}::uuid AND bz.id::text = ${BRANCH_COL[alias]}::text), 'UTC'))::date`;
const n = (q: RawBuilder<unknown>) => sql<{ n: number }>`SELECT count(*)::int AS n FROM (${q}) x`;

const PAY_OK = sql`('approved','captured','completed','settled','succeeded','partially_refunded','refunded')`;
const PAY_OPEN = sql`('created','open','pending','processing','requires_action')`;
const INV_OPEN = sql`('open','sent','pending','partially_paid','past_due')`;

/** a live add-on line on a ticket (k = ticket_service_lines) / a live base service line under another alias */
const ADDON_LINE = sql`coalesce(k.line_kind, CASE WHEN k.is_add_on THEN 'add_on' ELSE 'service' END) = 'add_on' AND k.removed_at IS NULL AND coalesce(k.status, '') NOT IN ('cancelled', 'removed', 'voided')`;
const BASE_LINE = (alias: 'sv') => (alias === 'sv'
  ? sql`coalesce(sv.line_kind, CASE WHEN sv.is_add_on THEN 'add_on' ELSE 'service' END) = 'service' AND sv.removed_at IS NULL AND coalesce(sv.status, '') NOT IN ('cancelled', 'removed', 'voided')`
  : sql`false`);

export const SYSTEM_CHECKS: Record<SystemCheckDomain, DomainDef> = {
  // ── Expenses (/owner/finance/expenses) ─────────────────────────────────────────────────────────────────────────────
  expenses: { permission: 'owner.expenses.view', checks: [
    { key: 'parts_mismatch', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM expenses e WHERE e.tenant_id = ${t}::uuid ${br('e', b)} AND e.status <> 'voided' AND e.subtotal_cents IS NOT NULL
        AND e.subtotal_cents + coalesce(e.tax_cents, 0) + coalesce(e.tip_cents, 0) + coalesce(e.fee_cents, 0) - coalesce(e.discount_cents, 0) <> e.amount_cents`) },
    { key: 'future_dated', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM expenses e WHERE e.tenant_id = ${t}::uuid ${br('e', b)} AND e.status <> 'voided' AND e.incurred_on > ${today('e', t)} + 1`) },
    { key: 'possible_duplicates', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM expenses e WHERE e.tenant_id = ${t}::uuid ${br('e', b)} AND e.duplicate_status IN ('possible', 'exact') AND e.status NOT IN ('voided', 'rejected')`) },
    { key: 'bills_past_due', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM expenses e WHERE e.tenant_id = ${t}::uuid ${br('e', b)} AND e.kind = 'bill' AND e.bill_status IN ('open', 'partially_paid') AND e.due_date < ${today('e', t)}`) },
    { key: 'review_waiting', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM expenses e WHERE e.tenant_id = ${t}::uuid ${br('e', b)} AND e.status = 'pending_review' AND e.created_at < now() - interval '7 days'`) },
  ] },

  // ── Invoices (/pos/invoices) ───────────────────────────────────────────────────────────────────────────────────────
  invoices: { permission: 'pos.checkout.view', checks: [
    { key: 'total_mismatch', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.status NOT IN ('void', 'voided', 'cancelled', 'draft')
        AND coalesce(i.subtotal_cents, 0) + coalesce(i.tax_cents, 0) - coalesce(i.discount_cents, 0) <> coalesce(i.total_cents, 0)`) },
    { key: 'paid_not_covered', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.status = 'paid'
        AND coalesce((SELECT sum(p.amount_cents) FROM invoice_payments p WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id), 0) < coalesce(i.total_cents, 0)`) },
    { key: 'overpaid', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.status NOT IN ('refunded', 'credited', 'void', 'voided')
        AND coalesce((SELECT sum(p.amount_cents) FROM invoice_payments p WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id), 0) > coalesce(i.total_cents, 0)`) },
    { key: 'due_before_issue', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.due_date < i.issue_date`) },
    { key: 'open_past_due', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.status IN ${INV_OPEN} AND i.due_date < ${today('i', t)}`) },
    { key: 'missing_bill_to', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.status <> 'draft' AND i.customer_id IS NULL AND coalesce(btrim(i.bill_to_name), '') = ''`) },
    { key: 'void_without_reason', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM invoices i WHERE i.tenant_id = ${t}::uuid ${br('i', b)} AND i.status IN ('void', 'voided') AND coalesce(btrim(i.void_reason), '') = ''`) },
  ] },

  // ── Deposits & Settlements / Deposit Reconciliation (/pos/deposit-reconciliation) ─────────────────────────────────
  settlements: { permission: 'reconciliation.view', checks: [
    { key: 'duplicate_batch', severity: 'FAILED', count: (t, b) => n(sql`SELECT s.processor_type, s.settlement_id FROM payment_settlements s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND coalesce(s.settlement_id, '') <> ''
        GROUP BY s.processor_type, s.settlement_id HAVING count(*) > 1`) },
    { key: 'missing_batch_id', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM payment_settlements s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND coalesce(btrim(s.settlement_id), '') = ''`) },
    { key: 'deposit_overdue', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM payment_settlements s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND s.actual_deposit_date IS NULL AND s.expected_deposit_date < ${today('s', t)} - 2
        AND s.status NOT IN ('failed', 'not_applicable', 'returned')`) },
    { key: 'deposit_difference', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM payment_settlements s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND coalesce(s.signed_difference_cents, 0) <> 0`) },
    { key: 'bank_unmatched', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM bank_deposits d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.matched_settlement_id IS NULL AND d.deposit_date < ${today('d', t)} - 3`) },
    { key: 'refunds_stuck', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM payment_refunds r WHERE r.tenant_id = ${t}::uuid ${br('r', b)} AND r.status IN ('pending', 'processing', 'reserved') AND r.created_at < now() - interval '1 day'`) },
    { key: 'refund_over_payment', severity: 'FAILED', count: (t, b) => n(sql`SELECT p.id FROM payments p JOIN payment_refunds r ON r.tenant_id = p.tenant_id AND r.payment_id = p.id
        WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND r.status NOT IN ('failed', 'cancelled', 'voided')
        GROUP BY p.id, p.amount_cents HAVING sum(r.amount_cents) > p.amount_cents`) },
  ] },

  // ── Payments & Money / Transactions (/pos/payments) ────────────────────────────────────────────────────────────────
  payments: { permission: 'pos.reports.view', checks: [
    { key: 'stuck_in_progress', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM payments p WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND p.status IN ${PAY_OPEN} AND p.created_at < now() - interval '1 hour' AND NOT coalesce(p.is_test, false)`) },
    { key: 'stranded', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM payments p WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND p.stranded_at IS NOT NULL AND p.status IN ${PAY_OPEN}`) },
    { key: 'duplicate_processor_txn', severity: 'FAILED', count: (t, b) => n(sql`SELECT p.processor, p.processor_transaction_id FROM payments p WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND coalesce(p.processor_transaction_id, '') <> ''
        AND p.status IN ${PAY_OK} GROUP BY p.processor, p.processor_transaction_id HAVING count(*) > 1`) },
    { key: 'negative_amount', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM payments p WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND (p.amount_cents < 0 OR coalesce(p.tip_cents, 0) < 0 OR coalesce(p.surcharge_cents, 0) < 0)`) },
    { key: 'test_payments', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM payments p WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND coalesce(p.is_test, false) AND p.status IN ${PAY_OK} AND p.created_at > now() - interval '30 days'`) },
    // extras (PAYMENTS & MONEY 04 cash-to-settlement trace): cash is counted by the cash drawer and gift cards by their own
    // ledger — a cash or gift-card tender tied to a PROCESSOR settlement batch would be counted a second time in the payout
    { key: 'non_card_in_processor_batch', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM payments p WHERE p.tenant_id = ${t}::uuid ${br('p', b)} AND p.settlement_batch_id IS NOT NULL
        AND lower(coalesce(p.method, '')) IN ('cash', 'gift_card', 'gift') AND p.status IN ${PAY_OK}`) },
  ] },

  // ── Discounts / Deals / Coupons (/pos/discounts) ──────────────────────────────────────────────────────────────────
  discounts: { permission: 'pos.marketing.view', checks: [
    { key: 'over_redeemed', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM deals d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.max_redemptions IS NOT NULL AND coalesce(d.redemption_count, 0) > d.max_redemptions`) },
    // 1–100 is enforced by the table; a percent deal with NO percent is not
    { key: 'percent_missing', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM deals d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.discount_type = 'percent' AND d.discount_percent IS NULL
        AND d.status NOT IN ('archived', 'canceled', 'rejected', 'draft')`) },
    { key: 'fixed_over_price', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM deals d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.discount_type = 'fixed' AND d.original_price_cents IS NOT NULL AND d.discount_cents > d.original_price_cents
        AND d.status NOT IN ('archived', 'canceled', 'rejected', 'draft')`) },
    { key: 'ends_before_starts', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM deals d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.ends_at IS NOT NULL AND d.starts_at IS NOT NULL AND d.ends_at < d.starts_at`) },
    { key: 'active_but_ended', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM deals d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.status IN ('active', 'scheduled', 'approved') AND d.ends_at < now()`) },
    { key: 'waiting_approval_started', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM deals d WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.status = 'pending_approval' AND d.starts_at IS NOT NULL AND d.starts_at < now()`) },
    // extras (Discounts #04 Redemption Integrity · #12 repeated coupon commits · Coupons #04): the deal_redemptions ledger
    // (applied on the ticket → redeemed when it is paid → released / reversed). The table already refuses two live uses of
    // one deal on one ticket (uq_deal_redemption_ticket_live) and a reused key per deal (uq_deal_redemption_idem), so those
    // are not repeated; these find what the ledger alone cannot stop.
    // pending vs confirmed: still "applied" (pending) although its ticket was paid more than 10 minutes ago — markTicketPaid missed it
    { key: 'redemption_pending_on_paid', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM deal_redemptions r JOIN tickets k ON k.tenant_id = r.tenant_id AND k.id = r.ticket_id
        WHERE r.tenant_id = ${t}::uuid ${br('r', b)} AND r.status = 'applied' AND k.paid_at IS NOT NULL AND k.paid_at < now() - interval '10 minutes'`) },
    // counted as redeemed although its ticket was never paid
    { key: 'redeemed_ticket_unpaid', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM deal_redemptions r JOIN tickets k ON k.tenant_id = r.tenant_id AND k.id = r.ticket_id
        WHERE r.tenant_id = ${t}::uuid ${br('r', b)} AND r.status IN ('redeemed', 'partially_reversed') AND k.paid_at IS NULL`) },
    // bad timestamps: redeemed before it was applied, reversed before it was applied, redeemed with no redeemed time, applied in the future
    { key: 'redemption_bad_timestamps', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM deal_redemptions r WHERE r.tenant_id = ${t}::uuid ${br('r', b)}
        AND (r.redeemed_at < r.applied_at - interval '1 minute' OR r.reversed_at < r.applied_at - interval '1 minute'
          OR (r.status IN ('redeemed', 'partially_reversed') AND r.redeemed_at IS NULL) OR r.applied_at > now() + interval '10 minutes')`) },
    // a coupon code's use counter disagrees with its live uses in the ledger (a repeated commit counted twice, or a release not given back)
    { key: 'coupon_use_count_drift', severity: 'FAILED', count: (t, b) => n(sql`SELECT c.id FROM deal_coupon_codes c JOIN deals d ON d.tenant_id = c.tenant_id AND d.id = c.deal_id
        WHERE c.tenant_id = ${t}::uuid ${br('d', b)}
          AND c.use_count <> (SELECT count(*) FROM deal_redemptions u WHERE u.tenant_id = c.tenant_id AND u.coupon_code_id = c.id AND u.status IN ('applied', 'redeemed', 'partially_reversed'))`) },
    // a single-use code live on more than one ticket — a duplicate use
    { key: 'single_use_code_reused', severity: 'FAILED', count: (t, b) => n(sql`SELECT c.id FROM deal_coupon_codes c JOIN deals d ON d.tenant_id = c.tenant_id AND d.id = c.deal_id
        JOIN deal_redemptions u ON u.tenant_id = c.tenant_id AND u.coupon_code_id = c.id AND u.status IN ('applied', 'redeemed', 'partially_reversed')
        WHERE c.tenant_id = ${t}::uuid ${br('d', b)} AND c.single_use GROUP BY c.id HAVING count(*) > 1`) },
    // extras (Discounts #14 Configuration Drift Monitor): a deal shown as live while the config it depends on is not —
    // its branch is closed / removed, or a service it applies to is archived, inactive or gone from the catalog
    { key: 'live_deal_branch_closed', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM deals d JOIN branches bx ON bx.tenant_id = d.tenant_id AND bx.id = d.branch_id
        WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.status IN ('active', 'scheduled', 'approved') AND (bx.status <> 'active' OR bx.deleted_at IS NOT NULL)`) },
    { key: 'live_deal_service_unavailable', severity: 'WARNING', count: (t, b) => n(sql`SELECT DISTINCT d.id FROM deals d JOIN deal_services ds ON ds.tenant_id = d.tenant_id AND ds.deal_id = d.id
        LEFT JOIN services sv ON sv.tenant_id = ds.tenant_id AND sv.id = ds.service_id
        WHERE d.tenant_id = ${t}::uuid ${br('d', b)} AND d.status IN ('active', 'scheduled', 'approved')
          AND (sv.id IS NULL OR sv.archived_at IS NOT NULL OR sv.status <> 'active')`) },
  ] },

  // ── Services / Categories / Pricing / Add-ons (/pos/services) ─────────────────────────────────────────────────────
  catalog: { permission: 'pos.services.view', checks: [
    { key: 'active_without_price', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM services s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND s.status = 'active' AND s.archived_at IS NULL AND coalesce(s.price_cents, 0) <= 0`) },
    { key: 'zero_duration', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM services s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND s.status = 'active' AND s.archived_at IS NULL AND coalesce(s.duration_minutes, 0) <= 0`) },
    { key: 'missing_category', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM services s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND s.category_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM service_categories c WHERE c.tenant_id = s.tenant_id AND c.id = s.category_id)`) },
    { key: 'in_closed_category', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM services s JOIN service_categories c ON c.tenant_id = s.tenant_id AND c.id = s.category_id
        WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND s.status = 'active' AND s.archived_at IS NULL AND c.status IN ('archived', 'inactive', 'merged')`) },
    { key: 'duplicate_names', severity: 'WARNING', count: (t, b) => n(sql`SELECT s.branch_id, lower(btrim(s.name)) FROM services s WHERE s.tenant_id = ${t}::uuid ${br('s', b)} AND s.status = 'active' AND s.archived_at IS NULL
        GROUP BY s.branch_id, lower(btrim(s.name)) HAVING count(*) > 1`) },
    { key: 'addon_negative_price', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM service_add_ons a WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.price_cents < 0`) },
    // extras (ADD-ONS MANAGEMENT 05 checkout wiring): a sold add-on line must be one charge, on a ticket that has the
    // service it adds to, allocated to a technician who worked that ticket. Lines removed / cancelled / voided never count.
    { key: 'addon_paid_no_technician', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM ticket_service_lines k JOIN tickets tk ON tk.tenant_id = k.tenant_id AND tk.id = k.ticket_id
        WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND ${ADDON_LINE} AND tk.paid_at IS NOT NULL AND k.technician_id IS NULL`) },
    { key: 'addon_technician_not_on_ticket', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM ticket_service_lines k
        WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND ${ADDON_LINE} AND k.technician_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM ticket_service_lines sv WHERE sv.tenant_id = k.tenant_id AND sv.ticket_id = k.ticket_id AND ${BASE_LINE('sv')})
          AND NOT EXISTS (SELECT 1 FROM ticket_service_lines sv WHERE sv.tenant_id = k.tenant_id AND sv.ticket_id = k.ticket_id AND ${BASE_LINE('sv')} AND sv.technician_id = k.technician_id)`) },
    { key: 'addon_without_base_service', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM ticket_service_lines k
        WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND ${ADDON_LINE}
          AND NOT EXISTS (SELECT 1 FROM ticket_service_lines sv WHERE sv.tenant_id = k.tenant_id AND sv.ticket_id = k.ticket_id AND ${BASE_LINE('sv')})`) },
    { key: 'addon_duplicate_charge', severity: 'WARNING', count: (t, b) => n(sql`SELECT k.ticket_id FROM ticket_service_lines k
        WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND ${ADDON_LINE}
        GROUP BY k.ticket_id, lower(btrim(k.service_name_snapshot)), k.technician_id HAVING count(*) > 1`) },
    { key: 'addon_on_archived_service', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM service_add_ons a JOIN services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
        WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.is_active AND (s.archived_at IS NOT NULL OR s.status <> 'active')`) },
  ] },

  // ── Inventory / Products / Stock Alerts (/tenant/inventory) ───────────────────────────────────────────────────────
  inventory: { permission: 'inventory.view', checks: [
    { key: 'available_over_on_hand', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM inventory_location_stock l WHERE l.tenant_id = ${t}::uuid ${br('l', b)} AND l.quantity_available > l.quantity_on_hand`) },
    { key: 'movement_math', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM inventory_stock_movements m WHERE m.tenant_id = ${t}::uuid ${br('m', b)}
        AND m.quantity_before IS NOT NULL AND m.quantity_after IS NOT NULL AND m.quantity_before + m.quantity_change <> m.quantity_after`) },
    { key: 'below_reorder', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM inventory_location_stock l JOIN inventory_products p ON p.tenant_id = l.tenant_id AND p.id = l.product_id
        WHERE l.tenant_id = ${t}::uuid ${br('l', b)} AND p.active AND p.archived_at IS NULL AND coalesce(l.reorder_level_override, p.reorder_level) IS NOT NULL
          AND l.quantity_on_hand <= coalesce(l.reorder_level_override, p.reorder_level)`) },
    { key: 'archived_with_stock', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM inventory_location_stock l JOIN inventory_products p ON p.tenant_id = l.tenant_id AND p.id = l.product_id
        WHERE l.tenant_id = ${t}::uuid ${br('l', b)} AND (p.archived_at IS NOT NULL OR NOT p.active) AND l.quantity_on_hand > 0`) },
    { key: 'usage_without_technician', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM product_usage_events u WHERE u.tenant_id = ${t}::uuid ${br('u', b)} AND u.status = 'confirmed' AND u.technician_id IS NULL`) },
    { key: 'usage_duplicate_key', severity: 'FAILED', count: (t, b) => n(sql`SELECT u.idempotency_key FROM product_usage_events u WHERE u.tenant_id = ${t}::uuid ${br('u', b)} AND coalesce(u.idempotency_key, '') <> '' AND u.status = 'confirmed'
        GROUP BY u.idempotency_key HAVING count(*) > 1`) },
    // extras (Inventory #03 technician usage integrity, #04 duplicate stock movement)
    { key: 'usage_without_movement', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM product_usage_events u WHERE u.tenant_id = ${t}::uuid ${br('u', b)} AND u.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM inventory_stock_movements m WHERE m.tenant_id = u.tenant_id AND m.related_type = 'product_usage_event' AND m.related_id = u.id)`) },
    { key: 'usage_technician_not_in_salon', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM product_usage_events u WHERE u.tenant_id = ${t}::uuid ${br('u', b)}
        AND NOT EXISTS (SELECT 1 FROM technicians te WHERE te.tenant_id = u.tenant_id AND te.id = u.technician_id)`) },
    { key: 'usage_used_after_recorded', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM product_usage_events u WHERE u.tenant_id = ${t}::uuid ${br('u', b)} AND u.status = 'confirmed'
        AND u.occurred_at > u.created_at + interval '10 minutes'`) },
    { key: 'duplicate_usage_movement', severity: 'FAILED', count: (t, b) => n(sql`SELECT m.related_type, m.related_id, m.product_id, m.movement_type FROM inventory_stock_movements m
        WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.related_type = 'ticket_line' AND m.movement_type = 'service_usage'   -- a usage EVENT is already one movement (uq_inv_movements_usage_source, 716)
        GROUP BY m.related_type, m.related_id, m.product_id, m.movement_type HAVING count(*) > 1`) },
    // extras (Services & Products 2 · 04 inventory alert reconciliation): the dashboard's inventory card counts every live
    // low product; the sidebar badge / Open Alerts leave out the ones acknowledged in this episode; the persisted alert rows
    // keep the workflow. These two name the rows where those surfaces can disagree with the canonical stock.
    { key: 'acknowledged_still_low', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM inventory_alerts a
        JOIN inventory_products ip ON ip.tenant_id = a.tenant_id AND ip.id = a.product_id
        LEFT JOIN inventory_location_stock ls ON ls.tenant_id = a.tenant_id AND ls.product_id = a.product_id AND ls.branch_id = a.branch_id
        WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.resolved_at IS NULL AND a.acknowledged_at IS NOT NULL
          AND ip.active = true AND ip.archived_at IS NULL AND coalesce(ls.reorder_level_override, ip.reorder_level, 0) > 0
          AND coalesce(ls.quantity_on_hand, 0) <= coalesce(ls.reorder_level_override, ip.reorder_level, 0)`) },
    { key: 'open_alert_not_live', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM inventory_alerts a
        LEFT JOIN inventory_products ip ON ip.tenant_id = a.tenant_id AND ip.id = a.product_id
        LEFT JOIN inventory_location_stock ls ON ls.tenant_id = a.tenant_id AND ls.product_id = a.product_id AND ls.branch_id = a.branch_id
        WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.resolved_at IS NULL
          AND NOT (coalesce(ip.active, false) = true AND ip.archived_at IS NULL AND coalesce(ls.reorder_level_override, ip.reorder_level, 0) > 0
                   AND coalesce(ls.quantity_on_hand, 0) <= coalesce(ls.reorder_level_override, ip.reorder_level, 0))`) },
    // extras (Stock Alerts 05 product-to-service consumption review): recipes are deducted automatically at Service Done for
    // every salon (D4, RecipeUsageConsumer — not a per-salon setting), so what can go wrong is the recipe itself or the stock
    { key: 'recipe_inactive_product', severity: 'WARNING', count: (t) => n(sql`SELECT 1 FROM service_product_recipes rp JOIN inventory_products p ON p.tenant_id = rp.tenant_id AND p.id = rp.product_id
        WHERE rp.tenant_id = ${t}::uuid AND (p.archived_at IS NOT NULL OR NOT p.active)`) },
    { key: 'recipe_short_deduction', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM inventory_stock_movements m WHERE m.tenant_id = ${t}::uuid ${br('m', b)}
        AND m.movement_type = 'service_usage' AND m.related_type = 'ticket_line' AND m.created_at >= now() - interval '30 days'
        AND coalesce((m.metadata_json->>'shortHundredths')::numeric, 0) > 0`) },
    { key: 'received_over_ordered_lines', severity: 'FAILED', count: (t, b) => n(sql`SELECT m.related_id, m.product_id FROM inventory_stock_movements m
        WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.movement_type = 'purchase_received' AND m.related_type = 'purchase_order'
        GROUP BY m.related_id, m.product_id
        HAVING sum(m.quantity_change) > coalesce((SELECT sum(l.quantity_received * l.units_per_purchase_unit) FROM purchase_order_lines l
          WHERE l.tenant_id = ${t}::uuid AND l.purchase_order_id = m.related_id AND l.product_id = m.product_id), 0)`) },
  ] },

  // ── Suppliers & Purchasing (/tenant/inventory/vendors) — extras: supplier data accuracy, purchase-order integrity,
  //    receiving & stock. Suppliers are salon-wide (no branch); purchase orders are the branch's. A line can never be
  //    over-received (chk_po_line_not_over_received) — not repeated here.
  suppliers: { permission: 'inventory.view', checks: [
    { key: 'duplicate_supplier_names', severity: 'WARNING', count: (t) => n(sql`SELECT lower(btrim(v.name)) FROM inventory_vendors v WHERE v.tenant_id = ${t}::uuid AND v.active
        GROUP BY lower(btrim(v.name)) HAVING count(*) > 1`) },
    { key: 'supplier_no_contact', severity: 'WARNING', count: (t) => n(sql`SELECT 1 FROM inventory_vendors v WHERE v.tenant_id = ${t}::uuid AND v.active
        AND coalesce(btrim(v.phone), '') = '' AND coalesce(btrim(v.email), '') = ''
        AND NOT EXISTS (SELECT 1 FROM inventory_vendor_contacts vc WHERE vc.tenant_id = v.tenant_id AND vc.vendor_id = v.id)`) },
    { key: 'po_missing_supplier', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status NOT IN ('draft', 'cancelled')
        AND (q.vendor_id IS NULL OR NOT EXISTS (SELECT 1 FROM inventory_vendors v WHERE v.tenant_id = q.tenant_id AND v.id = q.vendor_id))`) },
    { key: 'open_po_inactive_supplier', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q JOIN inventory_vendors v ON v.tenant_id = q.tenant_id AND v.id = q.vendor_id
        WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status IN ('approved', 'ordered', 'partial') AND NOT v.active`) },
    { key: 'po_total_mismatch', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status <> 'cancelled'
        AND (q.subtotal_cents <> coalesce((SELECT sum(l.quantity_ordered::bigint * l.unit_cost_cents) FROM purchase_order_lines l WHERE l.tenant_id = q.tenant_id AND l.purchase_order_id = q.id), 0)
          OR q.total_cents <> q.subtotal_cents + q.shipping_cents + q.tax_cents)`) },
    { key: 'po_past_expected', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status IN ('approved', 'ordered', 'partial')
        AND q.expected_date < ${today('q', t)}`) },
    { key: 'po_status_vs_received', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND (
        (q.status = 'received' AND EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.tenant_id = q.tenant_id AND l.purchase_order_id = q.id AND l.quantity_received < l.quantity_ordered))
        OR (q.status IN ('draft', 'approved', 'ordered') AND EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.tenant_id = q.tenant_id AND l.purchase_order_id = q.id AND l.quantity_received > 0)))`) },
    { key: 'received_without_movement', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q WHERE q.tenant_id = ${t}::uuid ${br('q', b)}
        AND EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.tenant_id = q.tenant_id AND l.purchase_order_id = q.id AND l.quantity_received > 0)
        AND NOT EXISTS (SELECT 1 FROM inventory_stock_movements m WHERE m.tenant_id = q.tenant_id AND m.related_type = 'purchase_order' AND m.related_id = q.id)`) },
    { key: 'stale_drafts', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM purchase_orders q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status = 'draft' AND q.created_at < now() - interval '30 days'`) },
  ] },

  // ── Technicians Management Center (/pos/technicians) ──────────────────────────────────────────────────────────────
  technicians: { permission: 'pos.technicians.view', checks: [
    { key: 'active_but_archived', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.is_active AND x.archived_at IS NOT NULL`) },
    { key: 'missing_name', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.archived_at IS NULL AND coalesce(btrim(x.full_name), btrim(concat_ws(' ', x.first_name, x.last_name)), '') = ''`) },
    { key: 'duplicate_phone', severity: 'WARNING', count: (t, b) => n(sql`SELECT x.normalized_phone FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.archived_at IS NULL AND coalesce(x.normalized_phone, '') <> ''
        GROUP BY x.normalized_phone HAVING count(*) > 1`) },
    { key: 'split_out_of_range', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.archived_at IS NULL
        AND x.default_commission_split_percent IS NOT NULL AND (x.default_commission_split_percent < 0 OR x.default_commission_split_percent > 100)`) },
    { key: 'no_app_account', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.is_active AND x.archived_at IS NULL AND x.user_id IS NULL`) },
    // extras (Team Management #08 Approvals / Training): unresolved requests, missing training links, real certification dates
    // an open training assignment past its due date (the branch's own calendar day)
    { key: 'training_overdue', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM team_training_assignments a WHERE a.tenant_id = ${t}::uuid ${br('a', b)}
        AND a.status IN ('assigned', 'in_progress') AND a.due_date IS NOT NULL AND a.due_date < ${today('a', t)}`) },
    // a completed course that awards a certification, but the completion links to no certification record
    { key: 'training_certificate_unlinked', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM team_training_assignments a
        JOIN team_training_courses co ON co.tenant_id = a.tenant_id AND co.id = a.course_id
        WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.status = 'completed' AND coalesce(btrim(co.certification_name), '') <> ''
          AND a.technician_certification_id IS NULL AND a.staff_certification_id IS NULL`) },
    // a VERIFIED certification with no issue date — "verified" needs a real date behind it. Staff (non-technician)
    // certifications belong to a person, not a branch, so they are counted only for the every-branch scope.
    { key: 'verified_certificate_no_date', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM technician_certifications tc
        JOIN technicians x ON x.tenant_id = ${t}::uuid AND x.id = tc.technician_id
        WHERE (tc.tenant_id = ${t}::uuid OR tc.tenant_id IS NULL) ${br('x', b)} AND x.archived_at IS NULL AND tc.verification_status = 'VERIFIED' AND tc.issued_at IS NULL
        ${b ? sql`` : sql`UNION ALL SELECT 1 FROM team_staff_certifications sc WHERE sc.tenant_id = ${t}::uuid AND sc.verification_status = 'VERIFIED' AND sc.issued_on IS NULL`}`) },
    // a certification still shown as VERIFIED after its expiry date (the technician's branch day; a staff certification uses
    // the salon's first branch day — it has no branch of its own)
    { key: 'verified_certificate_expired', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM technician_certifications tc
        JOIN technicians x ON x.tenant_id = ${t}::uuid AND x.id = tc.technician_id
        WHERE (tc.tenant_id = ${t}::uuid OR tc.tenant_id IS NULL) ${br('x', b)} AND x.archived_at IS NULL AND tc.verification_status = 'VERIFIED' AND tc.expires_at < ${today('x', t)}
        ${b ? sql`` : sql`UNION ALL SELECT 1 FROM team_staff_certifications sc WHERE sc.tenant_id = ${t}::uuid AND sc.verification_status = 'VERIFIED'
          AND sc.expires_on < (now() AT TIME ZONE coalesce((SELECT bz.timezone FROM branches bz WHERE bz.tenant_id = ${t}::uuid ORDER BY bz.created_at, bz.id LIMIT 1), 'UTC'))::date`}`) },
    // a held public-profile change of one of this salon's technicians, waiting more than 7 days for a decision
    { key: 'profile_change_waiting', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM tech_profile_change_requests pr WHERE pr.status = 'pending' AND pr.created_at < now() - interval '7 days'
        AND EXISTS (SELECT 1 FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.archived_at IS NULL AND x.global_tech_profile_id = pr.global_tech_profile_id)`) },
    // extras Unfinished POS Modules 06 (Team Integrity): clock state, skills and training — counts only, never a change
    { key: 'clocked_in_not_active', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM technician_workforce_state w JOIN technicians x ON x.id = w.technician_id AND x.tenant_id = w.tenant_id
        WHERE w.tenant_id = ${t}::uuid ${br('x', b)} AND w.clock_status IN ('CLOCKED_IN', 'ON_BREAK') AND (x.archived_at IS NOT NULL OR NOT coalesce(x.is_active, true) OR coalesce(x.status, 'active') <> 'active')`) },
    { key: 'punch_open_past_day', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM technician_shifts x WHERE x.tenant_id = ${t}::uuid ${br('x', b)}
        AND x.start_time IS NOT NULL AND x.end_time IS NULL AND x.shift_date < ${today('x', t)}`) },
    { key: 'no_service_mapping', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM technicians x WHERE x.tenant_id = ${t}::uuid ${br('x', b)} AND x.is_active AND x.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM technician_services ts WHERE ts.tenant_id = x.tenant_id AND ts.technician_id = x.id)`) },
    { key: 'certification_expired', severity: 'WARNING', count: (t, b) => n(sql`SELECT DISTINCT x.id FROM technician_certifications c JOIN technicians x ON x.id = c.technician_id AND x.tenant_id = c.tenant_id
        WHERE c.tenant_id = ${t}::uuid ${br('x', b)} AND x.is_active AND x.archived_at IS NULL AND c.revoked_reason IS NULL AND c.expires_at IS NOT NULL AND c.expires_at < ${today('x', t)}`) },
  ] },

  // ── Membership Overview (/pos/memberships) ────────────────────────────────────────────────────────────────────────
  memberships: { permission: 'pos.memberships.view', checks: [
    { key: 'cancelled_still_billing', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status IN ('canceled', 'cancelled', 'expired', 'archived') AND m.next_billing_at > now()`) },
    { key: 'renew_without_consent', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.auto_renew AND m.auto_renew_consent_at IS NULL AND NOT coalesce(m.comped, false)
        AND m.status IN ('active', 'trial', 'grace', 'past_due')`) },
    { key: 'billing_overdue', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status IN ('active', 'grace') AND m.next_billing_at < now() - interval '1 day' AND NOT coalesce(m.comped, false)`) },
    { key: 'active_past_period', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status = 'active' AND m.current_period_end < now() - interval '1 day'`) },
    { key: 'paused_past_resume', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status = 'paused' AND m.pause_resumes_at < now()`) },
    // ── benefit redemption integrity (extras Membership Overview 13 · 08 / 16 · 03): issue → reserve → redeem → release / reversal.
    // The balance is the one creditBalance() (memberships-core) derives from the append-only ledger: granted − redeemed − expired
    // − open holds + adjustments, per membership and benefit. Below zero = more was used than the member ever had.
    { key: 'benefit_balance_negative', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM membership_credit_ledger l JOIN customer_memberships m ON m.tenant_id = l.tenant_id AND m.id = l.customer_membership_id
        WHERE l.tenant_id = ${t}::uuid ${br('m', b)} AND l.benefit_id IS NOT NULL
        GROUP BY l.customer_membership_id, l.benefit_id
        HAVING sum(CASE WHEN l.entry_type IN ('issued', 'rolled_over', 'restored', 'adjusted') THEN l.quantity WHEN l.entry_type IN ('redeemed', 'expired') THEN -l.quantity ELSE 0 END)
                 - greatest(0, sum(CASE WHEN l.entry_type = 'reserved' THEN l.quantity WHEN l.entry_type = 'released' THEN -l.quantity WHEN l.entry_type = 'redeemed' AND l.reservation_ref IS NOT NULL THEN -l.quantity ELSE 0 END)) < 0
            OR sum(CASE WHEN l.entry_type IN ('issued', 'rolled_over', 'restored', 'adjusted') THEN l.amount_cents WHEN l.entry_type IN ('redeemed', 'expired') THEN -l.amount_cents ELSE 0 END)
                 - greatest(0, sum(CASE WHEN l.entry_type = 'reserved' THEN l.amount_cents WHEN l.entry_type = 'released' THEN -l.amount_cents WHEN l.entry_type = 'redeemed' AND l.reservation_ref IS NOT NULL THEN -l.amount_cents ELSE 0 END)) < 0`) },
    // a redeem writes BOTH an immutable redemption snapshot and a 'redeemed' ledger entry (redeemBenefit, one lock): per member,
    // benefit and ticket the two counts must agree — a snapshot with no ledger entry left the credit unspent, and the reverse
    // spent a credit with no record of the service it paid for
    { key: 'redemption_ledger_mismatch', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM (
          SELECT r.customer_membership_id AS mid, r.benefit_id AS bid, r.ticket_id AS tid, count(*) AS c, 0 AS l FROM membership_redemptions r WHERE r.tenant_id = ${t}::uuid AND r.benefit_id IS NOT NULL GROUP BY 1, 2, 3
          UNION ALL
          SELECT l.customer_membership_id, l.benefit_id, l.ticket_id, 0, count(*) FROM membership_credit_ledger l WHERE l.tenant_id = ${t}::uuid AND l.entry_type = 'redeemed' AND l.benefit_id IS NOT NULL AND l.ticket_id IS NOT NULL GROUP BY 1, 2, 3
        ) z JOIN customer_memberships m ON m.tenant_id = ${t}::uuid AND m.id = z.mid
        WHERE true ${br('m', b)} GROUP BY z.mid, z.bid, z.tid HAVING sum(z.c) <> sum(z.l)`) },
    // a hold that was never redeemed or released although its ticket is already closed (paid or voided): the credit stays held
    { key: 'reservation_open_on_closed_ticket', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM membership_credit_ledger l
        JOIN customer_memberships m ON m.tenant_id = l.tenant_id AND m.id = l.customer_membership_id
        JOIN tickets k ON k.tenant_id = l.tenant_id AND k.id = l.ticket_id
        WHERE l.tenant_id = ${t}::uuid ${br('m', b)} AND l.entry_type = 'reserved' AND l.reservation_ref IS NOT NULL
          AND (k.paid_at IS NOT NULL OR k.status IN ('void', 'voided', 'cancelled', 'canceled'))
          AND NOT EXISTS (SELECT 1 FROM membership_credit_ledger c WHERE c.tenant_id = l.tenant_id AND c.reservation_ref = l.reservation_ref AND c.entry_type IN ('released', 'redeemed'))`) },
    // a benefit consumed on a ticket that was later voided, with no reversal (restored / released / adjusted) for that ticket
    { key: 'redeemed_on_voided_ticket', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM membership_redemptions r
        JOIN customer_memberships m ON m.tenant_id = r.tenant_id AND m.id = r.customer_membership_id
        JOIN tickets k ON k.tenant_id = r.tenant_id AND k.id = r.ticket_id
        WHERE r.tenant_id = ${t}::uuid ${br('m', b)} AND k.status IN ('void', 'voided', 'cancelled', 'canceled')
          AND NOT EXISTS (SELECT 1 FROM membership_credit_ledger c WHERE c.tenant_id = r.tenant_id AND c.customer_membership_id = r.customer_membership_id
                          AND c.ticket_id = r.ticket_id AND c.entry_type IN ('restored', 'released', 'adjusted'))`) },
    // ── billing (extras Membership Overview 16 · 02, part): a charge still "pending" a day later never got its provider result
    { key: 'payment_pending_stuck', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM membership_payments p JOIN customer_memberships m ON m.tenant_id = p.tenant_id AND m.id = p.customer_membership_id
        WHERE p.tenant_id = ${t}::uuid ${br('m', b)} AND p.status = 'pending' AND p.created_at < now() - interval '1 day'`) },
    // a renewal or installment collected AFTER the membership was cancelled
    { key: 'charged_after_cancel', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM membership_payments p JOIN customer_memberships m ON m.tenant_id = p.tenant_id AND m.id = p.customer_membership_id
        WHERE p.tenant_id = ${t}::uuid ${br('m', b)} AND p.status = 'succeeded' AND p.kind IN ('renewal', 'installment') AND m.canceled_at IS NOT NULL AND p.created_at > m.canceled_at`) },
    // ── finance reconciliation (extras Membership Overview 13 · 12, part): a membership collection must stand on the salon's
    // own payment ledger, never on a shadow total. A collection paid by an invoice (processor 'invoice', processor_ref = the
    // invoice id — collectFirstPayment) is only real while that invoice is still 'paid' in the Invoices ledger …
    { key: 'invoice_collection_not_paid', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM membership_payments p JOIN customer_memberships m ON m.tenant_id = p.tenant_id AND m.id = p.customer_membership_id
        WHERE p.tenant_id = ${t}::uuid ${br('m', b)} AND p.status = 'succeeded' AND p.processor = 'invoice'
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = p.tenant_id AND i.id::text = p.processor_ref AND i.status = 'paid')`) },
    // … and may never claim more than that invoice collected (the enrol step refuses it; a later edit of either side is drift)
    { key: 'invoice_collection_over_invoice', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM membership_payments p JOIN customer_memberships m ON m.tenant_id = p.tenant_id AND m.id = p.customer_membership_id
        JOIN invoices i ON i.tenant_id = p.tenant_id AND i.id::text = p.processor_ref
        WHERE p.tenant_id = ${t}::uuid ${br('m', b)} AND p.status IN ('succeeded', 'refunded') AND p.processor = 'invoice' AND p.amount_cents > i.total_cents`) },
    // a card collection or refund with no processor reference cannot be matched to the provider's batch or settlement
    // ('recorded' / 'manual' entries are staff-recorded and carry none by design)
    { key: 'card_collection_without_ref', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM membership_payments p JOIN customer_memberships m ON m.tenant_id = p.tenant_id AND m.id = p.customer_membership_id
        WHERE p.tenant_id = ${t}::uuid ${br('m', b)} AND p.status IN ('succeeded', 'refunded') AND p.processor NOT IN ('invoice', 'recorded', 'manual')
          AND coalesce(btrim(p.processor_ref), '') = ''`) },
  ] },

  // ── Live Operations / Serving / Service Done (the service flow: queue → serving → done → paid) ───────────────────
  'service-flow': { permission: 'pos.serving.view', checks: [
    { key: 'serving_too_long', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM tickets k WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND k.serving_started_at < now() - interval '8 hours'
        AND k.service_done_at IS NULL AND k.paid_at IS NULL AND k.payment_status IS DISTINCT FROM 'paid'`) },
    { key: 'done_not_paid', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM tickets k WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND k.service_done_at < now() - interval '1 day'
        AND k.paid_at IS NULL AND k.payment_status IS DISTINCT FROM 'paid' AND coalesce(k.total_cents, 0) > 0`) },
    { key: 'paid_state_mismatch', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM tickets k WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND ((k.payment_status = 'paid') <> (k.paid_at IS NOT NULL))`) },
    { key: 'paid_without_payment', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM tickets k WHERE k.tenant_id = ${t}::uuid ${br('k', b)} AND k.payment_status = 'paid' AND coalesce(k.total_cents, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id = k.tenant_id AND p.ticket_id = k.id AND p.status IN ${PAY_OK})`) },
    { key: 'queue_waiting_long', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM pos_queue_items q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status IN ('waiting', 'called', 'assigned', 'ready_for_tech')
        AND q.checked_in_at < now() - interval '3 hours'`) },
    { key: 'in_service_without_ticket', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM pos_queue_items q WHERE q.tenant_id = ${t}::uuid ${br('q', b)} AND q.status = 'in_service' AND q.ticket_id IS NULL`) },
  ] },


  // ── Payment Terminals (the terminal records on file — readiness only; nothing is sent to a device) ─────────────
  terminals: { permission: 'settings.view', checks: [
    { key: 'not_seen_day', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM pos_payment_terminals w WHERE w.tenant_id = ${t} ${br('w', b)} AND w.disabled_at IS NULL
        AND coalesce(w.last_seen_at, w.last_ping_at, w.paired_at) < now() - interval '1 day'`) },
    { key: 'last_ping_failed', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM pos_payment_terminals w WHERE w.tenant_id = ${t} ${br('w', b)} AND w.disabled_at IS NULL AND w.last_ping_ok = false`) },
    { key: 'never_verified', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM pos_payment_terminals w WHERE w.tenant_id = ${t} ${br('w', b)} AND w.disabled_at IS NULL AND w.verified_at IS NULL`) },
    { key: 'duplicate_serial', severity: 'FAILED', count: (t, b) => n(sql`SELECT coalesce(w.serial_number, w.hsn) FROM pos_payment_terminals w WHERE w.tenant_id = ${t} ${br('w', b)} AND w.disabled_at IS NULL
        AND coalesce(w.serial_number, w.hsn, '') <> '' GROUP BY coalesce(w.serial_number, w.hsn) HAVING count(*) > 1`) },
  ] },




  // ── Approvals Management & Authorization Center ───────────────────────────────────────────────────────────────────
  approvals: { permission: 'approvals.view', checks: [
    { key: 'pending_expired', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM tenant_approval_requests a WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.status = 'pending' AND a.expires_at < now()`) },
    { key: 'approved_not_executed', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM tenant_approval_requests a WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.status = 'approved' AND a.executed_at IS NULL
        AND a.decided_at < now() - interval '1 hour'`) },
    { key: 'execution_failed', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM tenant_approval_requests a WHERE a.tenant_id = ${t}::uuid ${br('a', b)} AND a.status = 'execution_failed'`) },
  ] },
  // ── Reports / Daily Summary (SUNMI batch 9, Nov 10 2026: the guide's "Report Accuracy / Health Checker") ──────────────
  // The figures the report adds up must agree with the money and the lines underneath them.
  reports: { permission: 'pos.reports.view', checks: [
    // a paid ticket's total against its collected payments (approved / captured / settled …, incl. later-refunded originals);
    // a gift-card or deposit edge case can differ legitimately, so this asks a person to look rather than calling it wrong
    { key: 'charged_vs_collected', severity: 'WARNING', count: (tn, b) => n(sql`SELECT 1 FROM tickets t WHERE t.tenant_id = ${tn}::uuid ${br('t', b)} AND t.paid_at IS NOT NULL
        AND coalesce(t.total_cents, 0) <> coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.tenant_id = t.tenant_id AND p.ticket_id = t.id AND p.status IN ${PAY_OK}), 0)`) },
    { key: 'surcharge_not_card', severity: 'FAILED', count: (tn, b) => n(sql`SELECT 1 FROM payments p WHERE p.tenant_id = ${tn}::uuid ${br('p', b)} AND coalesce(p.surcharge_cents, 0) > 0
        AND p.method IN ('cash', 'gift_card', 'cash_to_technician', 'global_reward', 'deposit')`) },
    // batch 9 guide 2 §16 source coverage: Revenue by Service can only file a sale under a category its line names
    { key: 'unmapped_service_lines', severity: 'WARNING', count: (tn, b) => n(sql`SELECT 1 FROM ticket_service_lines l JOIN tickets t ON t.id = l.ticket_id AND t.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tn}::uuid ${br('l', b)} AND (t.paid_at IS NOT NULL OR t.status = 'paid') AND l.removed_at IS NULL AND l.service_id IS NOT NULL AND nullif(trim(l.category_snapshot), '') IS NULL
        AND NOT EXISTS (SELECT 1 FROM services s JOIN service_categories c ON c.id = s.category_id AND c.tenant_id = s.tenant_id WHERE s.id = l.service_id AND s.tenant_id = l.tenant_id)`) },
    { key: 'paid_without_service_lines', severity: 'WARNING', count: (tn, b) => n(sql`SELECT 1 FROM tickets t WHERE t.tenant_id = ${tn}::uuid ${br('t', b)} AND (t.paid_at IS NOT NULL OR t.status = 'paid')
        AND EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id = t.tenant_id AND p.ticket_id = t.id AND p.status IN ${PAY_OK} AND p.amount_cents > 0)
        AND NOT EXISTS (SELECT 1 FROM ticket_service_lines l WHERE l.tenant_id = t.tenant_id AND l.ticket_id = t.id AND l.removed_at IS NULL)`) },
  ] },
};
