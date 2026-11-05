-- 428_sms_subscription_pending_change.sql — §8/§27/§28 support (Jul 29, 2026, sms-packages P3).
-- A NEXT-CYCLE package change is stored ON the subscription row as a pending pair and promoted lazily by the
-- entitlement resolver the first time it runs at/after the effective moment — no cron, no missed promotion:
-- the same code path that needs the truth is the one that applies it. Immediate changes never touch these
-- columns. History lives in tenant_sms_package_changes (427); these two columns are only the not-yet-effective
-- head of that history.
ALTER TABLE tenant_sms_subscriptions ADD COLUMN IF NOT EXISTS pending_package_id UUID REFERENCES sms_verification_packages (id);
ALTER TABLE tenant_sms_subscriptions ADD COLUMN IF NOT EXISTS pending_effective_at TIMESTAMPTZ;
