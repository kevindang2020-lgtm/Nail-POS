-- 493_customer_default_salon.sql — customer self-signup picks a salon (list or nearby), and the customer can change their
-- default salon later (Kevin, Oct 3 2026). A person can hold a CUSTOMER account at more than one salon (one per salon
-- business); sign-in used to take whichever came first. customer_default_at marks the account the customer most recently
-- chose as their default — sign-in prefers it. Staff rows never use it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_default_at TIMESTAMPTZ;
COMMENT ON COLUMN users.customer_default_at IS 'CUSTOMER accounts only: when this salon account was chosen as the default (latest wins at sign-in).';
