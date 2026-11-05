-- 415_residual_applicable_costs.sql — Net-Revenue-first residual math (per the Fiserv Schedule A model).
-- The residual pool must be NET of applicable processor/card-network pass-through costs: costs are deducted
-- from the processor-reported residual BEFORE any split is calculated. Statements whose reported residual is
-- already net of costs simply leave this at 0 (the default), which preserves the behavior of every existing row.
alter table residual_statements add column if not exists applicable_costs_cents bigint not null default 0;

comment on column residual_statements.applicable_costs_cents is
  'Applicable processor/card-network pass-through costs for this statement period, in integer cents. Deducted from processing_residual_cents to form the Net Revenue pool BEFORE any revenue split.';
