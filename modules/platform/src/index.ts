// modules/platform — the platform domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { SuperAdminAutomationModule } from './super-admin-automation/super-admin-automation.module';
export { SuperAdminPlansModule } from './super-admin-plans/super-admin-plans.module';
export { AutomationEngineService } from './super-admin-automation/automation-engine.service';   // used by the API today
export { EntitlementsService, LimitExceededError } from './super-admin-plans/entitlements.service';   // used by the API today
export { isAiEnabled, effectiveAiFeatures, AI_FEATURE_KEYS} from './super-admin-plans/ai-features';   // AI plan entitlements (tenant settings + the control plane)
export { UsageAlertSweep, thresholdsReached } from './super-admin-plans/usage-alerts';   // Constitution 7 §41
export { PlatformApprovals } from './platform-approvals/platform-approvals';   // Constitution 7 §119
export { FeatureRegistry, platformLayers } from './super-admin-plans/feature-registry';   // Constitution 7 §30-33
export { PlanFeatureSource, loadFeatureFacts, createEntitlementService, invalidateOnWrite } from './super-admin-plans/plan-feature-source';   // BUILD_PLAN Phase 12 (#13)
export { KyselyEntitlementsRepo } from './super-admin-plans/entitlements.kysely.repository';   // Phase 12 pgtest wiring
export { FeatureEntitlementsModule } from './super-admin-plans/feature-entitlements.module';   // BUILD_PLAN Phase 12 (#13)
export { PLATFORM_APPROVAL, AUTOMATION_RULE, AUTOMATION_FAILURE, AUTOMATION_EXECUTION, PLATFORM_FEATURE, SUBSCRIPTION_PLAN_VERSION, TENANT_SUBSCRIPTION, SUBSCRIPTION_CHANGE, TENANT_ADD_ON } from './platform-lifecycles';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
