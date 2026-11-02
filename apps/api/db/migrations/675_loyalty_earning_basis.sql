-- 675_loyalty_earning_basis.sql — D3 loyalty basis (Oct 22 2026, Kevin: "use the recommended"): points on every PAID
-- tender, none for buying a gift card, net of refunds.
--   excluded_cents  — the part of this payment that bought gift-card value (a sale or a reload hold on the ticket) and
--                     therefore earned nothing; amount_cents keeps the ELIGIBLE base, so points = floor(amount_cents / 100)
--                     stays true for every row (the pilot's own check).
--   reversed_points — points of this earning given back by refunds / voids; a reversal can never exceed what the
--                     payment earned (before: floor(refunded / 100) was reversed, even for money that never earned).
-- Expand only; both default to 0 so every existing row reads as before.
ALTER TABLE loyalty_point_earnings ADD COLUMN IF NOT EXISTS excluded_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE loyalty_point_earnings ADD COLUMN IF NOT EXISTS reversed_points INTEGER NOT NULL DEFAULT 0;
