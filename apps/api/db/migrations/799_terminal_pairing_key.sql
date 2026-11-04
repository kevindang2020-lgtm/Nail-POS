-- 799_terminal_pairing_key.sql — Payment Terminals guide (Nov 4 2026) §07 "Protect against double submission": the request key
-- of the pairing that paired this terminal. A repeated Pair (double tap, retry after a timeout) with the same key returns
-- the terminal it paired instead of "already paired"; a different key still gets the conflict.
ALTER TABLE pos_payment_terminals ADD COLUMN IF NOT EXISTS pair_request_key TEXT;
