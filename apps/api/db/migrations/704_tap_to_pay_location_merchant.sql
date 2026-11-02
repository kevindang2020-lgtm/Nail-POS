-- 704_tap_to_pay_location_merchant.sql — Secure Tap §24 / §22, Kevin's decision (Oct 28 2026): each location charges Tap to
-- Pay through ITS OWN CommerceHub merchant account.
--
-- Until now every salon's Tap to Pay charge was sent with one platform MID from env (COMMERCEHUB_TTP_MERCHANT_ID). The
-- CommerceHub API key / secret stay the platform's (the ISV credentials); the merchant id and the terminal id now belong to
-- the location's merchant account (payment_merchant_accounts, migration 638) — or the salon's default merchant
-- (tenant_payment_config) for a salon whose locations share one account. Neither is a secret (a MID is masked on every read,
-- like merchant_id). Additive, nullable: a location with neither is refused Tap to Pay with MERCHANT_NOT_CONFIGURED in
-- production (never another salon's MID); a sandbox may still use the env MID.
ALTER TABLE payment_merchant_accounts
  ADD COLUMN IF NOT EXISTS tap_to_pay_merchant_id TEXT,
  ADD COLUMN IF NOT EXISTS tap_to_pay_terminal_id TEXT;

ALTER TABLE tenant_payment_config
  ADD COLUMN IF NOT EXISTS tap_to_pay_merchant_id TEXT,
  ADD COLUMN IF NOT EXISTS tap_to_pay_terminal_id TEXT;
