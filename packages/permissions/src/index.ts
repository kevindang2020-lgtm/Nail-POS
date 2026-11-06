// @aipowersalon/permissions — the authorization kernel and the role→permission catalog (Constitution 13 §76–77).
// Framework-free: nothing here imports NestJS, so core specs, workers and packages can use it. The Nest guards and the
// @RequirePermission decorator live behind the './guards' entry (§113) — see ./guards/index.ts for why.
export * from './rbac';
export { isTenantRole, requiredCapability, PAYMENT_PERMISSION_ALIASES, hasPermission, okSameTenant, okSameBranch, tenantScopeFilter, stripClientTenantKeys, routeFirstSegment, canAccessRoutePrefix, resolveLandingRoute, type Ctx, type ScopeFilter, type AuthzContextState } from './security-core';
export { TECH_PERMISSION_KEYS, effectiveTechPermissions, type TechPermissionKey } from './tech-permissions';
export * from './platform-roles';   // Constitution 7: platform roles + in-plane default deny
export * from './suspension-policy';   // Constitution 7 §19
export * from './field-policy';   // Constitution 7 §82: field-level minimisation
export { DEFAULT_ROLE_TEMPLATES, ACCESS_SCOPES, CUSTOM_ROLE_BASES, templatePermissions, findRoleTemplate, validateCustomRole, defaultScopeForRole, enterableBranches, type AccessScope, type RoleTemplate, type CustomRoleInput, type CustomRoleCheck } from './role-templates';   // Functional Decision 12
export { decide, effectivePermissions, overrideActive, overrideApplies, grantHolds, type AuthzDecision, type AuthzReason, type AuthzOverride, type AuthzPrincipal, type AuthzResource, type DecideOptions } from './decision';   // BUILD_PLAN Phase 9: the decision object
export { policy, runPolicies, sameBranch, ownRecord, requesterNotApprover, amountWithinLimit, POLICY_HANDLERS, type PolicyName, type PolicyResult, type PolicyPrincipal, type AuthzPolicyCheck } from './policies';   // BUILD_PLAN Phase 9: typed policy handlers
// BUILD_PLAN Phase 9 (Constitution 2): the permission metadata registry (+ docs/PERMISSIONS.md), the plane helpers, the
// worker service principals
export { PERMISSION_REGISTRY, EXPLICIT_PERMISSION_METADATA, definitionOf, catalogKeyFor, isHighRiskPermission, requiresStepUp, rolesHolding, permissionDomains, derivedSensitivity, HIGH_RISK_SENSITIVITIES, type PermissionDefinition, type PermissionSensitivity, type PermissionScope, type PermissionRealm } from './permission-registry';
export { isPlatformPrincipal, isCustomerPrincipal, isDevicePrincipal, isStaffPrincipal, hasTenantWideScope, TENANT_WIDE_READ_KEY } from './principal';
export { WORKER_GRANTS, workerPrincipal, isWorkerPrincipal, invalidWorkerGrant, type WorkerJob, type WorkerPrincipal } from './worker-principals';
export * from './feature-entitlement';   // BUILD_PLAN Phase 12 (#13): the ONE entitlement decision + service
export * from './request-schema';   // BUILD_PLAN Phase 12 (#17): the ONE request-body validation mechanism
export { POS_ROUTE_KEY_ALIASES } from './permission-aliases.generated';   // Nov 5 2026: the scheduled AI Business evaluator builds a role's session keys
export { routeResourceScope, ROUTE_RESOURCE_SCOPES, RESOURCE_SCOPE_META, isRouteResourceScope, type RouteResourceScope, type RouteScopeSource, type RouteScopeInput, type RouteScopeOutput } from './route-resource-scope';   // Security Deep Scan §38
