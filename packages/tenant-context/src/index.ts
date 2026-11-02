// @aipowersalon/tenant-context — Constitution 13 §72–74. Foundation package: no dependencies, no framework, no global
// mutable state. The API's middleware and every worker build their context THROUGH this package, never on their own.
export { contextFromSession, branchOrNull, systemContext, isSystemContext, SYSTEM_ROLE, realmOfRole, type SecurityRealm, type TenantContext, type BranchContext, type RequestContext, type VerifiedSession, type SystemContext } from './context';
