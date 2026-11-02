-- 453_secret_fingerprints.sql — Constitution 12 §45: observe WHEN high-entropy secrets were last rotated.
--
-- One row per secret NAME. `fingerprint` is the first 16 hex characters of SHA-256('aps-secret-fp:' || name || ':' ||
-- value) — enough to notice a change, useless for recovering a 256-bit key. Only secrets flagged highEntropy in
-- secrets-inventory.ts are tracked: a short hash of a guessable provider password could be brute-forced offline.
CREATE TABLE IF NOT EXISTS secret_fingerprints (
  name             TEXT PRIMARY KEY,
  fingerprint      TEXT NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_rotated_at  TIMESTAMPTZ,          -- NULL until a change is observed (the first value's age is unknown)
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
