-- 370_booking_verification_source.sql -- record WHERE a code request came from.
--
-- The fraud engine's two most valuable signals are both about the SOURCE, not the phone:
--
--   * how many DISTINCT numbers has this IP asked about?   (spray / enumeration)
--   * how many codes has this device taken?                (scripted abuse)
--
-- Neither could be answered, because `booking_verification_sessions` records no source at all. My first version
-- of the counter query papered over that by comparing `correlation_id::text = <ip>` -- and correlation_id is a
-- UUID. An IP is not a UUID, so that predicate could NEVER match, and every IP-based signal was permanently 0.
--
-- That is the same failure as the POS "Service Done" badge (`status = 'sent_to_service_done'` on a column that
-- never holds it): a query that cannot match a row, returning 0 forever, with nothing to indicate it is broken.
-- It passed tsc. It passed the unit tests, which mock the counters. It even passed a pgtest, because the pgtest
-- asserted the query RUNS -- not that it can ever be true.
--
-- So: store the source.

-- The requesting IP. TEXT, not INET: an IP arrives from a proxy header as a string, may be IPv6, may be a
-- comma-separated forwarding chain, and a cast failure on a fraud signal must not 500 a booking.
ALTER TABLE booking_verification_sessions ADD COLUMN IF NOT EXISTS request_ip TEXT;

-- The client's device/session id. Distinct from booking_session_id, which is OURS: a single device may run many
-- booking sessions, and that is exactly the pattern a script produces.
ALTER TABLE booking_verification_sessions ADD COLUMN IF NOT EXISTS device_id TEXT;

-- The velocity queries: "this source, in the last hour".
CREATE INDEX IF NOT EXISTS idx_bvs_source_ip
  ON booking_verification_sessions (tenant_id, request_ip, created_at);

CREATE INDEX IF NOT EXISTS idx_bvs_source_device
  ON booking_verification_sessions (tenant_id, device_id, created_at);
