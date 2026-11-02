CREATE TABLE IF NOT EXISTS loyalty_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    branch_id UUID,
    customer_id UUID NOT NULL,
    type TEXT NOT NULL,
    amount BIGINT NOT NULL,
    source TEXT NOT NULL,
    reference_id UUID,
    description TEXT,
    actor_id UUID,
    running_balance BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_tenant_customer ON loyalty_ledger (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_reference ON loyalty_ledger (reference_id);
