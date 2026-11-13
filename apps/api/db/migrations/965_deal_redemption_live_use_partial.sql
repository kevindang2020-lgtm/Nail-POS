-- 965_deal_redemption_live_use_partial.sql — round 11 (Deals live-use count, Nov 13 2026): a deal use that was PARTLY
-- reversed (some of its discounted lines refunded) is still a live use — its place stays taken, its count stays, the
-- customer kept part of the service. The live-use unique index from 522 covered 'applied' / 'redeemed' only, so a ticket
-- whose use was partly reversed could take the same offer a second time (two completed uses of one offer on one ticket,
-- the case Check Deal System lists as ticket_repeat_use). A fully reversed or released use is NOT live and stays out.
-- The ledger now refuses that repeat itself (deals-ledger.kysely.ts apply, LIVE_USE_STATUSES); this index is the
-- database's own guarantee.
-- A salon that already has such a pair (made before this fix) cannot get the unique index until a person resolves it —
-- the pair is never edited automatically. Then the old index stays, the ledger's own check still refuses new repeats,
-- and ticket_repeat_use keeps listing the pair. Re-running this migration after the pair is resolved installs the index.
-- PG16, no pgcrypto.
-- Rollback: DROP INDEX IF EXISTS uq_deal_redemption_ticket_live;
--           CREATE UNIQUE INDEX uq_deal_redemption_ticket_live ON deal_redemptions (ticket_id, deal_id)
--             WHERE status IN ('applied','redeemed') AND ticket_id IS NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM deal_redemptions
     WHERE status IN ('applied', 'redeemed', 'partially_reversed') AND ticket_id IS NOT NULL
     GROUP BY ticket_id, deal_id HAVING count(*) > 1
  ) THEN
    RAISE WARNING '965: deal uses completed twice on one ticket exist (see Check Deal System ticket_repeat_use); the live-use index was left as it was';
  ELSE
    DROP INDEX IF EXISTS uq_deal_redemption_ticket_live;
    CREATE UNIQUE INDEX uq_deal_redemption_ticket_live ON deal_redemptions (ticket_id, deal_id)
      WHERE status IN ('applied', 'redeemed', 'partially_reversed') AND ticket_id IS NOT NULL;
  END IF;
END $$;
