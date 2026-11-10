// ai-center.repository.ts — repo contract for the AI Center aggregate. Scope ALWAYS comes from the session ctx,
// never the client. The in-memory repo is the dev/offline/test default (honest nulls + an optional seed input).
import type { AiCenterRawInputs } from './ai-center.dto';

/** batch 9 guide 14: the salon-day window (a preset or from–to); absent = today */
export interface AiCenterScope { tenantId: string; branchId: string | null; range?: { preset?: 'today' | 'week' | 'month' | 'year'; from?: string; to?: string } }

export interface AiCenterRepo {
  load(scope: AiCenterScope): Promise<AiCenterRawInputs>;
}

export const emptyRawInputs: AiCenterRawInputs = {
  bookingsToday: null, aiBookingsToday: null, bookingsCompletedToday: null, appointmentFillRatePct: null, rebookingsToday: null, aiConversationsToday: null, weekConversations: null, aiSuccessRatePct: null, recentActivity: null, suggestedUpsellRevenueTodayCents: null, aiCallsHandledToday: null, missedCallsRecoveredToday: null, callToBookingRatePct: null, workflowStats: null, campaignsSent: null, campaignBookings: null, campaignRevenueCents: null, remindersSentToday: null, reminderSuccessRatePct: null, outboundSentToday: null, automationSuccessRatePct: null, sentimentAvg: null, sentimentSampleSize: 0, assistantsActive: null, insightsCount: null,
};

/** Dev/offline/test repo. Returns honest nulls unless a seed is supplied (used by the dev fixture only). */
export class InMemoryAiCenterRepo implements AiCenterRepo {
  constructor(private readonly seed: Partial<AiCenterRawInputs> = {}) {}
  async load(_scope: AiCenterScope): Promise<AiCenterRawInputs> {
    return { ...emptyRawInputs, ...this.seed };
  }
}
