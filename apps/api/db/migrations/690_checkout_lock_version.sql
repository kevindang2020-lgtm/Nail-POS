-- 690_checkout_lock_version.sql — Secure Tap to Pay mandate §21 / §22 / §31 / §58 / §66 (Oct 23 2026, M6-6): a checkout
-- claim remembers the checkout VERSION it was made against. When the POS changes the ticket afterwards (services, discount,
-- tip, a split tender recorded at the desk) the version moves on and the phone's old claim is STALE: proceed / a new payment
-- intent from it is refused CHECKOUT_STALE until the phone re-opens the ticket (re-claim = the authoritative amount again).
--  • checkout_version: the ticket version string the canonical checkout reports (MobileTicketDetail.version). Nullable —
--    a POS / display lock, or a claim taken before this migration, carries nothing to compare (no staleness is invented).
--  • A heartbeat (lock refresh) keeps the version; only a (re-)claim sets it.
ALTER TABLE checkout_locks ADD COLUMN IF NOT EXISTS checkout_version TEXT;
