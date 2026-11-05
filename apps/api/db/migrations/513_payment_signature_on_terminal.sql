-- 513_payment_signature_on_terminal.sql — Kevin's decision (Oct 6 2026): the cardholder signs ONCE, on the Clover card
-- terminal. The customer display no longer asks for a signature (it used to ask after every approved card payment, so a
-- customer whose terminal also asked signed twice). When the display's own terminal charge comes back with the
-- signature the terminal captured, it is kept here, one row per payment as before, marked captured_on = 'terminal'.
-- Rows the display captured before this change stay as they are ('customer_display') — the front desk can still view them.
-- signature_png holds an image data URL: a PNG drawn on the display (older rows), or the terminal's image (a bitmap or
-- PNG, decoded from what the terminal sent). Idempotent.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'payment_signatures'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%captured_on%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE payment_signatures DROP CONSTRAINT %I', c); END IF;
END $$;
ALTER TABLE payment_signatures ADD CONSTRAINT payment_signatures_captured_on_check CHECK (captured_on IN ('customer_display', 'terminal'));
ALTER TABLE payment_signatures ALTER COLUMN captured_on SET DEFAULT 'terminal';
COMMENT ON COLUMN payment_signatures.signature_png IS 'image data URL: a PNG drawn on the customer display (rows before Oct 6 2026) or the card terminal''s signature image';
