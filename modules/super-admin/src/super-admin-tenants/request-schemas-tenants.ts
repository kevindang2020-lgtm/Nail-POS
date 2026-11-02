// super-admin-tenants/request-schemas-tenants.ts — BUILD_PLAN Phase 12 (#17): super-admin tenants (create / import /
// status / lifecycle / warning / support access / payment gateway / commission). Kept beside the controller because
// CreateTenantRequest carries the processor MID field (a provider name the §106 architecture check scopes to this dir).
// Clients: admin-web superAdminApi.ts (TenantsScreen, OwnerPortfolioPanels, PaymentGatewayPanel); fields from
// super-admin-tenants.dto.ts (CreateTenantRequest / ImportTenantsRequest) and UpsertGatewayInput (payments).
import { S, flag, id, ids, numish, obj, scalar, str, type BodySchema } from '../request-schemas-fields';

// ── tenants ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TEN_BULK_STATUS_BODY: BodySchema = obj({ tenantIds: ids(1000), status: str(20), reason: str(2000), reasonCode: str(60) });
export const TEN_CREATE_BODY: BodySchema = obj({
  legalName: str(200), displayName: str(200), tenantCode: str(40), code: str(40), slug: str(80),
  ownerName: str(200), ownerEmail: str(254), ownerPhone: str(40),
  owner: S.nullable(obj({ firstName: str(100), lastName: str(100), email: str(254), phone: str(40), initialCommissionPercent: numish })),
  branch: S.nullable(obj({ name: str(200), address: str(500), city: str(120), state: str(60), zip: str(20), phone: str(40) })),
  plan: str(60), planTier: str(60), aiPackage: str(60), paymentProcessor: str(60), fiservMid: str(64), status: str(20), state: str(60), city: str(120),
  initialCommissionPercent: numish,
});
export const TEN_SUSPEND_BODY: BodySchema = obj({ reason: str(2000) });
export const TEN_LIFECYCLE_BODY: BodySchema = obj({ state: scalar(30), reason: str(2000), reasonCode: str(60) });
export const TEN_STATUS_BODY: BodySchema = obj({ status: str(20), reason: str(2000), reasonCode: str(60) });
export const TEN_WARNING_BODY: BodySchema = obj({ warningType: str(40), severity: str(20), subject: str(300), message: str(5000), sendEmail: flag, sendSms: flag, showInTenantDashboard: flag, internalNote: str(2000) });
export const TEN_SUPPORT_ACCESS_BODY: BodySchema = obj({ reason: str(2000), source: str(60) });
/** Security Deep Scan C2: why (≥ 10 characters, audited) and which of the OWNER's own channels gets the temporary password */
export const TEN_RESET_OWNER_PASSWORD_BODY: BodySchema = obj({ reason: str(2000), deliveryMethod: S.nullable(S.enumOf(['auto', 'email', 'sms'])) });
const importRow: BodySchema = obj({ displayName: str(200), ownerEmail: str(254), ownerName: str(200), plan: str(60), state: str(60) });
export const TEN_IMPORT_BODY: BodySchema = obj({ rows: S.nullable(S.array(importRow, { maxItems: 5000 })) });
export const TEN_COMMISSION_CODE_BODY: BodySchema = obj({ tenantId: id, reason: str(2000) });
/** Vietnamese POS mandate WP-A §93: the salon's default POS language (English / Vietnamese only) and an optional reason (audited) */
export const TEN_POS_LANGUAGE_BODY: BodySchema = obj({ language: S.enumOf(['en', 'vi']), reason: str(500) }, ['language']);
export const TEN_COMMISSION_BODY: BodySchema = obj({ initialCommissionPercent: numish });
/** the salon's processor credentials (UpsertGatewayInput) — the resolver encrypts the secrets and returns them masked */
export const TEN_GATEWAY_BODY: BodySchema = obj({
  processorType: str(20), environment: str(20), baseUrl: str(500), merchantId: str(64), apiUsername: str(200), apiPassword: str(500),
  webhookSecret: str(500), boltBaseUrl: str(500), boltApiKey: str(500), status: str(30), onboardingStatus: str(30),
  ttpMerchantId: str(64), ttpTerminalId: str(64),   // migration 704: Tap to Pay MID / terminal id (not secrets)
});
// wave 3 PAYI §10: a branch's own merchant account (same credential fields + a display name / currency)
export const TEN_BRANCH_MERCHANT_BODY: BodySchema = obj({
  processorType: str(20), environment: str(20), baseUrl: str(500), merchantId: str(64), apiUsername: str(200), apiPassword: str(500),
  webhookSecret: str(500), boltBaseUrl: str(500), boltApiKey: str(500), status: str(30), displayName: str(120), currency: str(3),
  ttpMerchantId: str(64), ttpTerminalId: str(64),   // migration 704: this location's own Tap to Pay MID / terminal id
});
/** `reason`: the operator's note the Secure Tap pilot (S14) sends with a disable — accepted, not stored (the audit row records the action) */
export const TEN_BRANCH_MERCHANT_STATUS_BODY: BodySchema = obj({ action: str(20), reason: str(500) });
