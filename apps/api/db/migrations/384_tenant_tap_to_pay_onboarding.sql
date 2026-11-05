-- 384_tenant_tap_to_pay_onboarding.sql — per-tenant record of the Tap to Pay on iPhone onboarding milestones.
--
-- Tap to Pay on iPhone needs two external processes that only Apple and Fiserv can complete: an Apple Tap to Pay
-- ENTITLEMENT (requested with PSP = Fiserv) and Fiserv COMMERCEHUB merchant onboarding. This table records where a
-- tenant stands in each. Readiness (mobile-checkout-readiness) flips Tap to Pay to `ok` for a tenant ONLY when this
-- record says Apple = 'approved' AND CommerceHub = 'active' AND the CommerceHub credentials are actually present —
-- so the switch reflects REAL recorded state, never a hardcoded default, and never fakes a charge.
--
-- No secrets live here: this is onboarding STATUS, not credentials. The CommerceHub keys stay in config/secrets
-- (ttp-config), exactly as the CardPointe rail keys do.
CREATE TABLE IF NOT EXISTS tenant_tap_to_pay_onboarding (
  tenant_id                UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  apple_entitlement_status TEXT NOT NULL DEFAULT 'not_started'
                             CHECK (apple_entitlement_status IN ('not_started', 'requested', 'approved', 'rejected')),
  commercehub_status       TEXT NOT NULL DEFAULT 'not_started'
                             CHECK (commercehub_status IN ('not_started', 'onboarding', 'active', 'suspended')),
  notes                    TEXT,
  updated_by               UUID,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
