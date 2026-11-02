// integration-permissions.ts — granular Super Admin permissions for Integrations, under the repo's `super_admin.*`
// convention (mapping the spec's `integrations.*` keys). Enforcement is self-contained here + the guard, so the shared
// rbac/security-core is untouched. Backward-compatible: an UNRESTRICTED super-admin token (no integration permissions
// listed) keeps full access; a RESTRICTED token (that scopes integration access) is enforced key-by-key. Highly
// sensitive capabilities are kept SEPARATE — the `super_admin.integrations.*` wildcard never auto-grants them; they
// require an explicit grant (or a `super_admin.*` / `*` superuser token).
import { isPlatformPrincipal } from '@aipowersalon/permissions';

export const P = {
  view: 'super_admin.integrations.view',
  search: 'super_admin.integrations.search',
  detailsView: 'super_admin.integrations.details.view',
  create: 'super_admin.integrations.create',
  edit: 'super_admin.integrations.edit',
  enable: 'super_admin.integrations.enable',
  disable: 'super_admin.integrations.disable',
  connectionTest: 'super_admin.integrations.connection.test',
  authRefresh: 'super_admin.integrations.authentication.refresh',
  syncView: 'super_admin.integrations.sync.view',
  syncRetry: 'super_admin.integrations.sync.retry',
  webhooksView: 'super_admin.integrations.webhooks.view',
  webhooksDetailsView: 'super_admin.integrations.webhooks.details.view',
  errorsView: 'super_admin.integrations.errors.view',
  apiHealthView: 'super_admin.integrations.api_health.view',
  tenantAccessView: 'super_admin.integrations.tenant_access.view',
  marketplaceView: 'super_admin.integrations.marketplace.view',
  export: 'super_admin.integrations.export',
  auditView: 'super_admin.integrations.audit.view',
  // ── highly sensitive (kept separate; require explicit grant) ──
  compromisedDisable: 'super_admin.integrations.compromised.disable',
  crossTenantView: 'super_admin.integrations.cross_tenant.view',
  crossTenantExport: 'super_admin.integrations.cross_tenant.export',
  credentialsView: 'super_admin.integrations.credentials.view',
  credentialsManage: 'super_admin.integrations.credentials.manage',
  credentialsRotate: 'super_admin.integrations.credentials.rotate',
  rawPayloadView: 'super_admin.integrations.raw_payload.view',
  sharedConnectionManage: 'super_admin.integrations.shared_connection.manage',
  productionWebhookManage: 'super_admin.integrations.production_webhook.manage',
  tenantAccessManage: 'super_admin.integrations.tenant_access.manage',
} as const;

export const SENSITIVE: ReadonlySet<string> = new Set([
  P.compromisedDisable, P.crossTenantView, P.crossTenantExport, P.credentialsView, P.credentialsManage,
  P.credentialsRotate, P.rawPayloadView, P.sharedConnectionManage, P.productionWebhookManage, P.tenantAccessManage,
]);

export const ALL_PERMISSIONS: readonly string[] = Object.values(P);
const WILDCARD = 'super_admin.integrations.*';

export type PermCtx = { role?: string; permissions?: string[] };

// Backend enforcement is mandatory; this is the single decision point.
export function checkIntegrationPermission(ctx: PermCtx | undefined, key: string): boolean {
  if (!ctx || !isPlatformPrincipal(ctx)) return false;
  const perms = ctx.permissions || [];
  if (perms.indexOf('*') >= 0 || perms.indexOf('super_admin.*') >= 0) return true; // superuser
  if (perms.indexOf(key) >= 0) return true;                                        // explicit grant
  const restricted = perms.some((p) => p === WILDCARD || p.indexOf('super_admin.integrations.') === 0);
  if (!restricted) return true;                                                    // unrestricted super admin → full
  if (perms.indexOf(WILDCARD) >= 0 && !SENSITIVE.has(key)) return true;            // wildcard grants non-sensitive only
  return false;                                                                     // restricted + not granted
}
