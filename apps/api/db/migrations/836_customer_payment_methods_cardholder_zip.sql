-- 836_customer_payment_methods_cardholder_zip.sql — add cardholder_name, zip_code and card_type to customer_payment_methods
ALTER TABLE customer_payment_methods
  ADD COLUMN IF NOT EXISTS cardholder_name TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS card_type TEXT;
