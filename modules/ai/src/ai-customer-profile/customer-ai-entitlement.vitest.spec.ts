// customer-ai-entitlement — every Customer Profile AI screen carries the SAME AI subscription gate as the assistant
// (@RequiresAiPackage('ai_customer_profile_assistant')). Guides 4–7 (Intelligence, Churn Watch, Rebooking, Service
// Recommendations) first shipped without it, so an unsubscribed salon was not even recorded in observe mode.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { AI_PACKAGE_KEY } from '../ai-entitlement/ai-entitlement.guard';
import { AiCustomerProfileController } from './ai-customer-profile.controller';
import { CustomerIntelligenceCenterController } from './customer-intelligence-center.controller';
import { ChurnWatchCenterController } from './churn-watch-center.controller';
import { RebookingCenterController } from './rebooking-center.controller';
import { ServiceRecommendationsCenterController } from './service-recommendations-center.controller';

describe('Customer Profile AI — subscription gate on every controller', () => {
  it.each([
    ['AiCustomerProfileController', AiCustomerProfileController], ['CustomerIntelligenceCenterController', CustomerIntelligenceCenterController],
    ['ChurnWatchCenterController', ChurnWatchCenterController], ['RebookingCenterController', RebookingCenterController],
    ['ServiceRecommendationsCenterController', ServiceRecommendationsCenterController],
  ])('%s requires ai_customer_profile_assistant', (_n, C) => {
    expect(Reflect.getMetadata(AI_PACKAGE_KEY, C)).toBe('ai_customer_profile_assistant');
  });
});
