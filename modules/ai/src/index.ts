// modules/ai — the ai domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { AiGovernanceModule } from './ai-governance/ai-governance.module';
export { AiSubscriptionBillingModule } from './ai/ai-subscription-billing.service';
export { AiModule, platformAiKillSwitchReader } from './ai/ai.module';   // Constitution 7 §34: the AI platform kill switch reader
export * from './ai-governance/ai-governance.dto';
export { AiAccessSnapshot, accessReasonLabel, evaluateAiAccess } from './ai/ai-access-gate';   // used by the API today
export { KyselyAiAccessRepo, KyselyAiUsageLogger } from './ai/ai-access.kysely.repository';   // used by the API today
export { AiAssistantService } from './ai/ai-assistant.service';   // used by the API today
export { verifyWebhookSignature } from './ai/ai-billing-webhook-verify';   // used by the API today
export { AI_PACKAGES, AI_PACKAGE_CODES, AiUsageUnit, getAiPackage, isAiPackageCode } from './ai/ai-catalog';   // used by the API today
export { AiGatewayService, AiProvider, AiUsageLogger, MockAiProvider, resolveAiProvider } from './ai/ai-gateway';   // used by the API today
export { AI_PLANS, AiBillingPeriod, AiDiscountType, effectivePlanPriceCents, getAiPlan, isAiPlanCode, planFullPriceCents, planPackages, planPeriodPriceCents, proratePlanPriceCents } from './ai/ai-plans';   // used by the API today
export { render } from './ai/ai-prompt-registry';   // used by the API today
export { ProviderCircuitBreakers } from './ai/ai-provider-health';   // used by the API today
export { KyselyAiSettingsStore } from './ai/ai-settings-store';   // used by the API today
// joined by --into (ai-entitlement):
export { AiEntitlementGuard, AiEntitlementRepo, RequiresAiPackage, aiPackageSource, AI_PACKAGE_KIND } from './ai-entitlement/ai-entitlement.guard';   // used by the API today; Phase 12: the 'ai_package' entitlement source
// joined by --into (ai-inventory, ai-analytics-forecasting, ai-scheduling-optimizer, ai-marketing, ai-money-protection, ai-queue-assignment, ai-readiness, ai-revenue):
export { AiAnalyticsForecastingModule } from './ai-analytics-forecasting/ai-analytics-forecasting.module';
export { AiInventoryModule } from './ai-inventory/ai-inventory.module';
export { AiMarketingSendModule } from './ai-marketing/ai-marketing-send.module';
export { AiMarketingModule } from './ai-marketing/ai-marketing.module';
export { MoneyProtectionModule } from './ai-money-protection/ai-money-protection.module';
export { QueueAssignmentModule } from './ai-queue-assignment/ai-queue-assignment.module';
export { AiReadinessModule } from './ai-readiness/ai-readiness.service';
export { AiRevenueModule } from './ai-revenue/ai-revenue.module';
export { AiSchedulingModule } from './ai-scheduling-optimizer/ai-scheduling.module';
export { AiSchedulingService } from './ai-scheduling-optimizer/ai-scheduling.service';   // Phase 7: B's receptionist / copilot / jobs inject the engine
export * from './ai-analytics-forecasting/ai-analytics-forecasting.dto';
export * from './ai-inventory/ai-inventory.dto';
export * from './ai-marketing/ai-marketing.dto';
export * from './ai-money-protection/ai-money-protection-investigations.dto';
export * from './ai-money-protection/ai-money-protection.dto';
export * from './ai-queue-assignment/ai-queue-assignment.dto';
export * from './ai-revenue/ai-revenue.dto';
// joined by --into (ai-review-reputation):
export { AiReviewReputationModule } from './ai-review-reputation/ai-review-reputation.module';
export { ReviewRequestService } from './ai-review-reputation/ai-review-reputation-requests.service';   // used by the API today
export { CheckoutReviewRequestHook } from './ai-review-reputation/ai-review-reputation.integrations';   // used by the API today
export { KyselySettings } from './ai-review-reputation/ai-review-reputation.kysely';   // used by the API today
// joined by --into (voice-booking):
export { VoiceBookingModule } from './voice-booking/voice-booking.module';
export { ProvisioningMetricsService } from './voice-booking/provisioning-metrics.service';   // used by the API today
export { VoiceCallOutcomeService } from './voice-booking/voice-call-outcome.service';   // used by the API today
export { VoiceFleetService } from './voice-booking/voice-fleet.service';   // used by the API today
export { VoiceGatewayMetricsService } from './voice-booking/voice-gateway-metrics.service';   // used by the API today
export { VoiceKeyService } from './voice-booking/voice-key.service';   // used by the API today
export { LearningError, VoiceLearningService } from './voice-booking/voice-learning.service';   // used by the API today
// joined by --into (ai-voice-transcription, call-intelligence, workflow, workflow-runs):
export { VoiceTranscriptionModule } from './ai-voice-transcription/ai-voice-transcription.module';
export { CallIntelligenceModule } from './call-intelligence/call-intelligence.module';
export { WorkflowRunsModule } from './workflow-runs/workflow-runs.module';
export * from './ai-voice-transcription/ai-voice-transcription.dto';
export * from './call-intelligence/call-intelligence.dto';
export * from './workflow-runs/workflow-runs.dto';
export * from './workflow/workflow.dto';
// Two different redactText functions live in this module (the AI context builder's and the call-transcript one);
// the transcript redactor is exported under its own name so neither is ambiguous (Constitution 13).
export { redactText as redactTranscriptText, type RedactionCategory } from './ai-voice-transcription/ai-voice-transcription-redaction';
// joined by --into (cache, ai-center):
export { AiCenterModule } from './ai-center/ai-center.module';
export * from './ai-center/ai-center.dto';
export { AiCenterCtx, AiCenterService } from './ai-center/ai-center.service';   // used by the API today
export { ActionLedgerRepo } from './ai-center/reception-copilot-action.service';   // used by the API today
export { ReceptionCopilotContextService } from './ai-center/reception-copilot-context.service';   // used by the API today
export { CachePort, InMemoryCache } from './cache/cache-port';   // used by the API today
export { RedisCache, makeCacheRedis } from './cache/cache-redis';   // used by the API today
// joined by --into (ai-customer-profile):
export { AiCustomerProfileModule } from './ai-customer-profile/ai-customer-profile.module';
// ai-customer-profile.dto re-exports api-contracts types (Confidence among them) that ai-money-protection.dto also exports;
// nothing outside the module imports its DTO names, so it is not re-exported wholesale (an ambiguous export * fails tsc).
export { AiCustomerProfileService } from './ai-customer-profile/ai-customer-profile.service';   // used by the API today
// BUILD_PLAN Phase 6 (ai_queue_assignment): the ONE queue detection core (wait levels, congestion, stuck records …) —
// the Super Admin live-queue monitor computes with these same functions and the salon defaults (audit "parallel
// implementations" 2). A namespace so its names (CongestionLevel, WaitLevel …) never collide with other exports.
import * as QueueDetection from './ai-queue-assignment/ai-queue-assignment-detection';
export { QueueDetection };
export * from './ai-lifecycles';   // BUILD_PLAN Phase 12 (#27): the AI lifecycles (TENANT_AI_SUBSCRIPTION is shared with modules/super-admin)
