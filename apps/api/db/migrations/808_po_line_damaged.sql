-- 808_po_line_damaged.sql — D9 gaps (Nov 5 2026): bottles that arrive damaged. Receiving a purchase order can name how many
-- of the delivered bottles came damaged: they are counted as received (the supplier delivered them, the cost is real) and
-- go straight to Damaged, off hand. The line keeps the running total so the order shows what arrived broken.
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS quantity_damaged_units INTEGER NOT NULL DEFAULT 0 CHECK (quantity_damaged_units >= 0);
