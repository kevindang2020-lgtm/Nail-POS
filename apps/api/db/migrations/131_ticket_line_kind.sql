-- 127_ticket_line_kind.sql — canonical line classification for upsell analytics. Additive only.
-- ticket_service_lines.line_kind distinguishes base services from upsell lines so the Checkout "Upsell Mix" buckets
-- (add_on / retail / upgrade) and the retail slice of "Potential Revenue Ready for Checkout" are real instead of
-- derived only from the coarse is_add_on boolean. Values: 'service' (base) | 'add_on' | 'retail' | 'upgrade'.
-- Left nullable; the read path coalesces a null to add_on/service from the existing is_add_on flag, so existing rows
-- and any write path that hasn't been updated yet still classify correctly. Backfill seeds historical rows.

ALTER TABLE ticket_service_lines ADD COLUMN IF NOT EXISTS line_kind TEXT;

UPDATE ticket_service_lines
   SET line_kind = CASE WHEN is_add_on THEN 'add_on' ELSE 'service' END
 WHERE line_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_lines_kind ON ticket_service_lines (ticket_id, line_kind);
