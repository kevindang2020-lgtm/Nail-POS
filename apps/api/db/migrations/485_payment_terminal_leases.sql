-- 485_payment_terminal_leases.sql — Functional Decision 34: one payment terminal may be shared by several POS devices,
-- but only ONE transaction may be active on it at a time.
--
-- Until now the reservation lived in a Map inside one API process (checkout.service `terminalLocks`), and the customer-
-- display terminal-capture path (the one that actually drives a physical CardPointe Bolt terminal) reserved nothing.
-- With more than one API instance — or simply two POS stations sharing the branch's single paired terminal — two charges
-- could start on the same device. A lease row per terminal is taken atomically (INSERT … ON CONFLICT … WHERE expired or
-- same holder), expires on its own so a crashed server can never hold a terminal forever, and is released only by its
-- holder. A second POS gets TERMINAL_BUSY.
CREATE TABLE IF NOT EXISTS payment_terminal_leases (
  tenant_id    TEXT        NOT NULL,
  terminal_id  TEXT        NOT NULL,
  holder       TEXT        NOT NULL,          -- what holds it: 'ticket:<id>' or 'display:<session id>'
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, terminal_id)
);
