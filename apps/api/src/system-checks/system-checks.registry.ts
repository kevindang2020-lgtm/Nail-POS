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
  k: sql`k.branch_id`, q: sql`q.branch_id`, c: sql`c.branch_id`, v: sql`v.branch_id`, w: sql`w.branch_id`, f: sql`f.branch_id`, g: sql`g.branch_id`, h: sql`h.branch_id`,
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
  ] },

  // ── Membership Overview (/pos/memberships) ────────────────────────────────────────────────────────────────────────
  memberships: { permission: 'pos.memberships.view', checks: [
    { key: 'cancelled_still_billing', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status IN ('canceled', 'cancelled', 'expired', 'archived') AND m.next_billing_at > now()`) },
    { key: 'renew_without_consent', severity: 'FAILED', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.auto_renew AND m.auto_renew_consent_at IS NULL AND NOT coalesce(m.comped, false)
        AND m.status IN ('active', 'trial', 'grace', 'past_due')`) },
    { key: 'billing_overdue', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status IN ('active', 'grace') AND m.next_billing_at < now() - interval '1 day' AND NOT coalesce(m.comped, false)`) },
    { key: 'active_past_period', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status = 'active' AND m.current_period_end < now() - interval '1 day'`) },
    { key: 'paused_past_resume', severity: 'WARNING', count: (t, b) => n(sql`SELECT 1 FROM customer_memberships m WHERE m.tenant_id = ${t}::uuid ${br('m', b)} AND m.status = 'paused' AND m.pause_resumes_at < now()`) },
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
};
