-- 801_po_line_pack_size.sql — audit D9 (Nov 4 2026): "receiving ignores units_per_purchase_unit". A purchase-order line is
-- ordered in the supplier's purchase unit (a case of 6). The pack size is snapshotted on the line when the order is written
-- (a later change to the supplier link never changes what an order already placed delivers); receiving N purchase units
-- now puts N × pack bottles on the shelf, each at the line cost ÷ pack. Existing lines are 1 (what they were treated as).
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS units_per_purchase_unit INTEGER NOT NULL DEFAULT 1 CHECK (units_per_purchase_unit >= 1);
