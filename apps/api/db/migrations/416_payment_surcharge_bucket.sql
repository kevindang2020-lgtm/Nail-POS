-- 416_payment_surcharge_bucket.sql — the card surcharge as a FIRST-CLASS ledger figure on each payment.
-- Four accounting buckets stay separate and are never mixed in the ledger: (1) customer card surcharge —
-- this column; (2) Fiserv processing residuals — residual_statements/partner_payouts; (3) tenant incentives —
-- tenant_incentives; (4) hardware financing/subsidies — the hardware-payment tables. Related in reporting only.
-- Existing rows default 0; the ticket-level surcharge_cents and derived KPIs continue to work unchanged.
alter table payments add column if not exists surcharge_cents bigint not null default 0;

comment on column payments.surcharge_cents is
  'Card surcharge collected on THIS payment, integer cents (0 for non-card / surcharge-off). Included in amount_cents; broken out here so the surcharge bucket is auditable per payment, never back-derived.';
