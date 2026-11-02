-- migrate: no-transaction
-- 693_outbox_open_rows_index.sql — 200-technician mandate §90 (Oct 26 2026, the realtime-first lane). The publisher's claim
-- (outbox-publisher.ts claimBatch) reads every OPEN row — publish_status 'pending' or 'claimed' — to find each aggregate's
-- head event. idx_outbox_due covers 'pending' / 'failed' only, so the claim sequentially scanned the whole outbox (every
-- published row still inside the retention window: 48k rows on the bench copy, 9–15 ms of a 25–100 ms claim) on every
-- batch. With the realtime-first lane the claim is on the realtime path (a batch's frames go out right after its claim),
-- so its cost is SSE lag: m4-outbox-burst-bench.mjs, 3,500 bookings, 2 cores under load — realtime lag p95 1.8–2.7 s
-- without this index, 1.3–1.6 s with it (PERFORMANCE_REPORT.md "Realtime-first lane"). Tiny: only open rows are indexed.
-- CONCURRENTLY: the outbox takes writes all day.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_open ON outbox_events (publish_status) WHERE publish_status IN ('pending', 'claimed');
