// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface IntentResult { intent: CopilotIntent; confidence: 'low' | 'medium' | 'high'; label: string; matched: string[] }

export interface CopilotSettings {
  enabled: boolean;          // master switch for the whole Copilot
  actionsEnabled: boolean;   // whether any write action is offered
  allowCreate: boolean;
  allowReschedule: boolean;
  allowCancel: boolean;
  allowSendMessage: boolean;
  // §47 additional categories — each gates a REAL capability (not a decorative toggle):
  allowDrafting: boolean;        // Drafting: offer message drafts at all
  showCustomerHistory: boolean;  // Customer Context / Privacy: surface visit history, favorites, loyalty
  allowAiPhoneActivity: boolean; // Live Calls: surface AI Phone Receptionist activity
  allowExplainServices: boolean; // Recommendations: offer service/policy explanations
  allowWaitlist: boolean;        // Recommendations: offer waitlist/standby suggestions
}

export type Metric =
  | { tracked: true; value: number; unit?: string; source: string; estimated?: boolean }
  | { tracked: false; value: null; source: string; route?: string };

/**
 * ai-center.dto.ts — canonical AI Center overview contract (spec §59 "Canonical Metric Definitions").
 *
 * INTEGRITY RULE: every metric is one of { tracked:true, value } or { tracked:false, value:null }.
 * A panel whose data source does not exist yet reports tracked:false + a `source` note and (optionally) a
 * `route` to where the work happens — it NEVER invents a number. This mirrors the honest stance already in
 * POSAICenterScreen and the project rule: surface gaps as null/—/NotConnected, never fabricate.
 */
export interface AiActivityRow { at: string; assistant: string; action: string; status: string }

export interface AiCenterSection {
  key: string;
  title: string;
  tracked: boolean;
  /** present when tracked:false — what real data source must be built to light this panel up. */
  needs?: string;
  route?: string;
}

export interface AiCenterOverview {
  generatedAt: string;
  /** batch 9 guide 14 (Nov 10 2026): the salon-day window the period figures cover; the 7-day figures end on `to` */
  window?: { from: string; to: string; timezone: string; weekFrom: string } | null;
  kpis: AiCenterKpis;
  /** the reference image's 12 modules, each flagged tracked/untracked honestly. */
  sections: AiCenterSection[];
  /** recent AI activity rows from the real usage log (empty when none logged yet). */
  activity: AiActivityRow[];
  /** AI performance snapshot from the real usage log. */
  performance: { totalConversations: Metric; aiSuccessRatePct: Metric };
  /** real outbound-messaging automation aggregate (per-workflow breakdown still needs a workflow dimension). */
  automation: { sentToday: Metric; successRatePct: Metric };
  /** per-workflow run-history. Appointment Reminders is real (appointment_reminder_attempts); others need their own telemetry. */
  workflows: { name: string; sentToday: Metric; successRatePct: Metric; tracked: boolean }[];
  /** real marketing-campaign performance (the campaigns table maintains these counts; not per-workflow-type). */
  campaigns: { sent: Metric; bookings: Metric; revenueCents: Metric; conversionPct: Metric };
  /** real call-intelligence headline (full missed-queue/recovered lists are served by /tenant/ai/call-intelligence/summary). */
  callIntelligence: { callsHandled: Metric; recovered: Metric; callToBookingRatePct: Metric };
  /** real AI booking assistant headline from appointments (fill-rate omitted: needs a technician-capacity model). */
  bookingAssistant: { completed: Metric; aiBookings: Metric; rebookings: Metric; fillRatePct: Metric };   // fillRatePct: developer, Sep 2026
  /** real, currently-trackable signals (so the UI can show *something* truthful). */
  live: {
    appointmentsToday: Metric;
    aiBookingsToday: Metric;
    aiConversationsToday: Metric;
    customerSentiment: Metric;
    assistantsActive: Metric;
  };
}

export type CopilotIntent = 'book_appointment' | 'reschedule_appointment' | 'cancel_appointment' | 'check_availability' | 'customer_lookup' | 'send_message' | 'queue_status' | 'general_question';

export interface AiCenterKpis {
  aiCallsHandled: Metric;
  bookingsCapturedByAi: Metric;
  missedCallsRecovered: Metric;
  aiConversationsToday: Metric;
  automationSuccessRate: Metric;
  customerSentiment: Metric;
  suggestedUpsellRevenueCents: Metric;
  aiTimeSavedMinutes: Metric;
}

// Round 2 H (Oct 12 2026): the Reception Copilot's "Hold this time". A hold reserves an EXACT slot for the salon's hold
// time; `holdToken` is the desk session sealed for the salon and the staff member — sent back to move the hold, to book
// from it (the booking converts it) or to release it. Holding is a write behind `pos.booking.create`.
export interface CopilotHoldRequest { date: string; startTime: string; serviceIds: string[]; technicianId?: string | null; customerId?: string | null; holdToken?: string | null }
export interface CopilotHoldResult {
  held: boolean; holdToken?: string; holdId?: string; expiresAt?: string; date?: string; startTime?: string; technicianId?: string | null;
  /** 'taken' = another booking holds / took it; 'unavailable' = holds are not configured here; 'invalid' = bad slot. */
  reason?: 'taken' | 'unavailable' | 'invalid';
}
export interface CopilotHoldReleaseRequest { holdToken: string }
export interface CopilotHoldReleaseResult { released: boolean }
