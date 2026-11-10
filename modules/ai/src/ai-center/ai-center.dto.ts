import type { Metric, AiActivityRow, AiCenterSection, AiCenterOverview, AiCenterKpis } from '@aipowersalon/api-contracts/tenant';
export type { Metric, AiActivityRow, AiCenterSection, AiCenterOverview, AiCenterKpis };   // owned by packages/api-contracts (Constitution 13 §13)


export const real = (value: number, source: string, unit?: string): Metric => ({ tracked: true, value, unit, source });
/** A transparent ESTIMATE (not a measured value): tracked, but flagged so the UI labels it '(est.)'. */
export const est = (value: number, source: string, unit?: string): Metric => ({ tracked: true, value, unit, source, estimated: true });

/** Documented, conservative, tenant-configurable minutes-saved assumptions for the AI Time Saved estimate. */
export const EST_MINUTES = { perAiConversation: 3, perAiCall: 5, perAutomatedSend: 0.5 } as const;
export const untracked = (source: string, route?: string): Metric => ({ tracked: false, value: null, source, route });

/** Raw inputs the repo resolves from real tables (or honest nulls). */
export interface AiCenterRawInputs {
  /** appointments with start_time today, scoped to tenant/branch, excluding cancelled. null => table/source unavailable. */
  bookingsToday: number | null;
  /** appointments today with source='ai' (AI-attributed bookings), scoped. null => source unavailable. */
  aiBookingsToday: number | null;
  /** appointments completed today (status='completed'), scoped. */
  bookingsCompletedToday: number | null;
  /** appointment fill rate % today (booked duration / capacity), scoped. null => source unavailable. */
  /** batch 9 guide 14: the salon-day window every period figure covers, and the 7-day window ending on its last day */
  window?: { from: string; to: string; timezone: string; weekFrom: string };
  appointmentFillRatePct: number | null;
  /** appointments today rescheduled from a prior one (rebooking assistance), scoped. */
  rebookingsToday: number | null;
  /** successful AI invocations today (ai_usage_logs). null => usage-log source unavailable. */
  aiConversationsToday: number | null;
  /** successful AI invocations over trailing 7d. */
  weekConversations: number | null;
  /** AI invocation success rate % over 7d (success / attempts). null => no attempts / source unavailable. */
  aiSuccessRatePct: number | null;
  /** most-recent AI activity rows (ai_usage_logs). null => source unavailable; [] => none yet. */
  recentActivity: AiActivityRow[] | null;
  /** average review rating (1..5) over the trailing window, scoped. null => no reviews / source unavailable. */
  sentimentAvg: number | null;
  /** count of reviews in the window (sample size for sentimentAvg). */
  sentimentSampleSize: number;
  /** AI-influenced revenue today in cents (ai_revenue_attributions), scoped. null => source unavailable. */
  suggestedUpsellRevenueTodayCents: number | null;
  /** answered_ai calls today (call_intelligence_events), scoped. null => call-intel source unavailable. */
  aiCallsHandledToday: number | null;
  /** recovered calls today (outcome='recovered'). */
  missedCallsRecoveredToday: number | null;
  /** call-to-booking rate % today (booked+recovered / answered inbound). null => no answered calls. */
  callToBookingRatePct: number | null;
  /** per-workflow run stats from workflow_runs keyed by workflow_key. null => source unavailable. */
  workflowStats: Record<string, { sentToday: number; successRatePct: number | null }> | null;
  /** real marketing-campaign aggregates from the campaigns table (non-draft), scoped. null => source unavailable. */
  campaignsSent: number | null;
  campaignBookings: number | null;
  campaignRevenueCents: number | null;
  /** appointment reminder sends today (appointment_reminder_attempts status='sent'), scoped. */
  remindersSentToday: number | null;
  /** appointment reminder success rate % over 7d (sent / sent+failed). null => no attempts. */
  reminderSuccessRatePct: number | null;
  /** outbound messages sent today (communication_messages, direction='outbound'), scoped. */
  outboundSentToday: number | null;
  /** outbound messaging success rate % over 7d (delivered/sent/read over all outbound). null => no sends. */
  automationSuccessRatePct: number | null;
  /** number of AI assistant packages the tenant currently has access to (active or trialing). */
  assistantsActive: number | null;
  /** count of active AI insights generated for the tenant. null => source unavailable. */
  insightsCount: number | null;
}




const UPSTREAM = {
  callFeed: 'AI call-intelligence feed (missed calls, recovered bookings, call summary) — not tracked yet',
  activityFeed: 'AI activity/event stream (per-action log + usage) — not tracked yet',
  automation: 'automation workflow run-history + success-rate telemetry — not tracked yet',
  attribution: 'AI booking/revenue attribution service — not tracked yet',
  sentimentSeries: 'sentiment time-series pipeline — not tracked yet',
};

/** Pure assembler: raw inputs -> typed honest overview. Unit-tested in ai-center-core.spec.ts. */
/** Build one Automation Workflows row from workflow_runs stats (real when the source resolved, honest pending otherwise). */
function wfRow(name: string, key: string, stats: Record<string, { sentToday: number; successRatePct: number | null }> | null) {
  if (stats == null) return { name, sentToday: untracked('workflow_runs source unavailable', '/tenant/communications/reminders'), successRatePct: untracked('workflow_runs source unavailable'), tracked: false };
  const st = stats[key];
  const sent: Metric = real(st?.sentToday ?? 0, `workflow_runs ${key} today`);
  const rate: Metric = st && st.successRatePct != null ? real(st.successRatePct, `workflow_runs ${key} 7d`, '%') : untracked('no runs in window');
  return { name, sentToday: sent, successRatePct: rate, tracked: true };
}

export function assembleOverview(inp: AiCenterRawInputs, now: Date = new Date()): AiCenterOverview {
  const sentiment: Metric =
    inp.sentimentAvg != null && inp.sentimentSampleSize > 0
      ? real(Math.round(inp.sentimentAvg * 10) / 10, `reviews avg (n=${inp.sentimentSampleSize})`, '/5')
      : untracked('no reviews in window', '/reports');
  const appts: Metric =
    inp.bookingsToday != null ? real(inp.bookingsToday, 'appointments.start_time today') : untracked('appointments source unavailable');
  const aiBookings: Metric =
    inp.aiBookingsToday != null ? real(inp.aiBookingsToday, "appointments source='ai' today") : untracked(UPSTREAM.attribution, '/tenant/ai/booking');
  const bookingsCompleted: Metric =
    inp.bookingsCompletedToday != null ? real(inp.bookingsCompletedToday, "appointments status='completed' today") : untracked('appointments source unavailable', '/tenant/ai/booking');
  const fillRate: Metric =
    inp.appointmentFillRatePct != null ? real(inp.appointmentFillRatePct, 'appointment duration / scheduled capacity', '%') : untracked('capacity model unavailable', '/tenant/ai/booking');
  const rebookings: Metric =
    inp.rebookingsToday != null ? real(inp.rebookingsToday, 'appointments rescheduled_from today') : untracked('appointments source unavailable', '/tenant/ai/booking');
  const assistants: Metric =
    inp.assistantsActive != null ? real(inp.assistantsActive, 'tenant AI access state') : untracked('AI access source unavailable');
  // ai_usage_logs is a real, production-populated table -> a 0 here is a TRUE zero, so these are tracked when the source resolves.
  const conversations: Metric =
    inp.aiConversationsToday != null ? real(inp.aiConversationsToday, 'ai_usage_logs success today') : untracked(UPSTREAM.activityFeed, '/reports');
  const weekConvos: Metric =
    inp.weekConversations != null ? real(inp.weekConversations, 'ai_usage_logs success 7d') : untracked(UPSTREAM.activityFeed, '/reports');
  const successRate: Metric =
    inp.aiSuccessRatePct != null ? real(inp.aiSuccessRatePct, 'ai_usage_logs success/attempts 7d', '%') : untracked('no AI attempts in window', '/reports');
  const activity: AiActivityRow[] = inp.recentActivity ?? [];
  // AI Time Saved is an ESTIMATE from real activity counts x documented per-action assumptions (NOT measured).
  const haveActivity = inp.aiConversationsToday != null || inp.aiCallsHandledToday != null || inp.remindersSentToday != null || inp.outboundSentToday != null;
  const estMinutes = (inp.aiConversationsToday ?? 0) * EST_MINUTES.perAiConversation
    + (inp.aiCallsHandledToday ?? 0) * EST_MINUTES.perAiCall
    + ((inp.remindersSentToday ?? 0) + (inp.outboundSentToday ?? 0)) * EST_MINUTES.perAutomatedSend;
  const timeSaved: Metric = haveActivity
    ? est(Math.round(estMinutes), `estimate: conv x${EST_MINUTES.perAiConversation} + calls x${EST_MINUTES.perAiCall} + sends x${EST_MINUTES.perAutomatedSend} min`, 'min')
    : untracked(UPSTREAM.activityFeed, '/reports');
  const callsHandled: Metric =
    inp.aiCallsHandledToday != null ? real(inp.aiCallsHandledToday, 'call_intelligence_events answered_ai today') : untracked(UPSTREAM.callFeed, '/tenant/ai/reception-copilot');
  const recovered: Metric =
    inp.missedCallsRecoveredToday != null ? real(inp.missedCallsRecoveredToday, "call_intelligence_events recovered today") : untracked(UPSTREAM.callFeed, '/tenant/ai/reception-copilot');
  const upsellRevenue: Metric =
    inp.suggestedUpsellRevenueTodayCents != null ? real(inp.suggestedUpsellRevenueTodayCents, 'ai_revenue_attributions today', 'cents') : untracked(UPSTREAM.attribution, '/reports');
  const callToBooking: Metric =
    inp.callToBookingRatePct != null ? real(inp.callToBookingRatePct, 'call_intelligence_events booked/answered today', '%') : untracked('no answered calls today', '/tenant/ai/reception-copilot');
  const reminderSent: Metric =
    inp.remindersSentToday != null ? real(inp.remindersSentToday, "appointment_reminder_attempts sent today") : untracked(UPSTREAM.automation, '/tenant/communications/reminders');
  const reminderSuccess: Metric =
    inp.reminderSuccessRatePct != null ? real(inp.reminderSuccessRatePct, 'appointment_reminder_attempts sent/attempts 7d', '%') : untracked('no reminder attempts in window', '/tenant/communications/reminders');
  const autoSuccess: Metric =
    inp.automationSuccessRatePct != null ? real(inp.automationSuccessRatePct, 'communication_messages delivered/sent 7d', '%') : untracked(UPSTREAM.automation, '/tenant/communications/reminders');
  const sentToday: Metric =
    inp.outboundSentToday != null ? real(inp.outboundSentToday, 'communication_messages outbound today') : untracked(UPSTREAM.automation, '/tenant/communications/reminders');

  return {
    generatedAt: now.toISOString(),
    kpis: {
      // Only metrics with a real source are tracked. The rest are honestly null until their substrate exists.
      aiCallsHandled: callsHandled,
      bookingsCapturedByAi: aiBookings,
      missedCallsRecovered: recovered,
      aiConversationsToday: conversations,
      automationSuccessRate: autoSuccess,
      customerSentiment: sentiment,
      suggestedUpsellRevenueCents: upsellRevenue,
      aiTimeSavedMinutes: timeSaved,
    },
    sections: [
      { key: 'command-center', title: 'AI Command Center', tracked: assistants.tracked },
      { key: 'call-intelligence', title: 'AI Receptionist & Call Intelligence', tracked: inp.aiCallsHandledToday != null, needs: inp.aiCallsHandledToday != null ? undefined : UPSTREAM.callFeed, route: '/tenant/ai/reception-copilot' },
      { key: 'booking-assistant', title: 'AI Booking Assistant', tracked: inp.bookingsCompletedToday != null, route: '/tenant/ai/booking' },
      { key: 'recommendations', title: 'AI Recommendations', tracked: inp.insightsCount != null, needs: inp.insightsCount != null ? undefined : UPSTREAM.activityFeed, route: '/tenant/ai/customer-insights' },
      { key: 'workflows', title: 'Automation Workflows', tracked: inp.remindersSentToday != null || inp.automationSuccessRatePct != null, needs: (inp.remindersSentToday != null) ? 'Birthday/Review/Rebooking/Thank-You/Follow-Up rows need per-workflow telemetry' : UPSTREAM.automation, route: '/tenant/communications/reminders' },
      { key: 'insights', title: 'AI Insights', tracked: inp.insightsCount != null, needs: inp.insightsCount != null ? undefined : UPSTREAM.sentimentSeries, route: '/tenant/ai/customer-insights' },
      { key: 'knowledge', title: 'Knowledge & Prompt Controls', tracked: assistants.tracked, route: '/tenant/ai/plans' },
      { key: 'activity-log', title: 'Recent AI Activity Log', tracked: inp.recentActivity != null, needs: inp.recentActivity != null ? undefined : UPSTREAM.activityFeed, route: '/reports' },
      { key: 'performance', title: 'AI Performance Snapshot', tracked: inp.weekConversations != null, needs: inp.weekConversations != null ? undefined : UPSTREAM.activityFeed, route: '/reports' },
    ],
    activity,
    performance: { totalConversations: weekConvos, aiSuccessRatePct: successRate },
    automation: { sentToday, successRatePct: autoSuccess },
    campaigns: {
      sent: inp.campaignsSent != null ? real(inp.campaignsSent, 'campaigns sent_count (non-draft)') : untracked(UPSTREAM.automation, '/tenant/campaigns'),
      bookings: inp.campaignBookings != null ? real(inp.campaignBookings, 'campaigns booking_count') : untracked(UPSTREAM.automation, '/tenant/campaigns'),
      revenueCents: inp.campaignRevenueCents != null ? real(inp.campaignRevenueCents, 'campaigns revenue_cents', 'cents') : untracked(UPSTREAM.automation, '/tenant/campaigns'),
      conversionPct: (inp.campaignsSent != null && inp.campaignsSent > 0 && inp.campaignBookings != null)
        ? real(Math.round((inp.campaignBookings / inp.campaignsSent) * 1000) / 10, 'campaigns booking_count/sent_count', '%')
        : untracked('no campaign sends', '/tenant/campaigns'),
    },
    workflows: [
      { name: 'Appointment Reminders', sentToday: reminderSent, successRatePct: reminderSuccess, tracked: inp.remindersSentToday != null },
      wfRow('Birthday Campaigns', 'birthday_campaign', inp.workflowStats),
      wfRow('Review Requests', 'review_request', inp.workflowStats),
      wfRow('Rebooking Flows', 'rebooking_flow', inp.workflowStats),
      wfRow('Thank You Messages', 'thank_you', inp.workflowStats),
      wfRow('AI Follow-Up Sequences', 'ai_follow_up', inp.workflowStats),
    ],
    callIntelligence: { callsHandled, recovered, callToBookingRatePct: callToBooking },
    bookingAssistant: { completed: bookingsCompleted, aiBookings, rebookings, fillRatePct: fillRate },
    live: { appointmentsToday: appts, aiBookingsToday: aiBookings, aiConversationsToday: conversations, customerSentiment: sentiment, assistantsActive: assistants },
  };
}
