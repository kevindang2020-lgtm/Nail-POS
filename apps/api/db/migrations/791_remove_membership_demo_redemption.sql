-- 791_remove_membership_demo_redemption.sql — Nov 4 2026 (D6 Membership audit): migration 193 wrote ONE fake "redeemed" entry
-- (1 credit, $49.00, reason 'demo_redeemed_while_past_due') into the first past-due membership of whatever salon the database
-- held, to make the suspicious-redemption review show something. On a live database that is a real member's ledger: it lowered
-- that member's balance and flagged them as suspicious for a redemption that never happened. This removes exactly those rows
-- (the marker reason, no benefit, the fixed demo amounts). 193 stays as written (an applied migration is never edited); on a new
-- database 193 inserts the row and this removes it in the same run.
DELETE FROM membership_credit_ledger
 WHERE reason = 'demo_redeemed_while_past_due' AND entry_type = 'redeemed' AND benefit_id IS NULL AND quantity = 1 AND amount_cents = 4900;
