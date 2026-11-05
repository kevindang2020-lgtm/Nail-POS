/**
 * ai-center-core.spec.ts — runnable assertions (esbuild -> node) for the AI Center aggregate:
 * canonical projection honesty (tracked vs untracked), real-metric math, and tenant-scope contract.
 */
import { assembleOverview, real, untracked } from './ai-center.dto';
import { AiCenterService } from './ai-center.service';
import { InMemoryAiCenterRepo } from './ai-center.repository';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

async function main(): Promise<void> {
  console.log('\n== honest projection ==');
  const empty = assembleOverview({ bookingsToday: null, aiBookingsToday: null, bookingsCompletedToday: null, rebookingsToday: null, aiConversationsToday: null, weekConversations: null, aiSuccessRatePct: null, recentActivity: null, suggestedUpsellRevenueTodayCents: null, aiCallsHandledToday: null, missedCallsRecoveredToday: null, callToBookingRatePct: null, workflowStats: null, campaignsSent: null, campaignBookings: null, campaignRevenueCents: null, remindersSentToday: null, reminderSuccessRatePct: null, outboundSentToday: null, automationSuccessRatePct: null, sentimentAvg: null, sentimentSampleSize: 0, assistantsActive: null });
  check('no sources -> every KPI tracked:false', Object.values(empty.kpis).every((m) => m.tracked === false && m.value === null));
  check('time-saved untracked when no activity counts at all', empty.kpis.aiTimeSavedMinutes.tracked === false);
  check('untracked KPI carries a source note', empty.kpis.aiCallsHandled.tracked === false && empty.kpis.aiCallsHandled.source.length > 0);
  check('call-intelligence section flagged untracked with needs+route', empty.sections.some((s) => s.key === 'call-intelligence' && !s.tracked && !!s.needs && !!s.route));

  console.log('\n== real metrics light up ==');
  const live = assembleOverview({ bookingsToday: 12, aiBookingsToday: 4, bookingsCompletedToday: 31, rebookingsToday: 6, aiConversationsToday: 0, weekConversations: 23, aiSuccessRatePct: 97.4, recentActivity: [{ at: '2026-06-26T18:31:00Z', assistant: 'ai_receptionist', action: 'invoke', status: 'success' }], suggestedUpsellRevenueTodayCents: 132000, aiCallsHandledToday: 42, missedCallsRecoveredToday: 7, callToBookingRatePct: 41, workflowStats: { birthday_campaign: { sentToday: 5, successRatePct: 96.2 }, review_request: { sentToday: 9, successRatePct: 94.4 } }, campaignsSent: 1200, campaignBookings: 84, campaignRevenueCents: 540000, remindersSentToday: 36, reminderSuccessRatePct: 98.1, outboundSentToday: 36, automationSuccessRatePct: 98.1, sentimentAvg: 4.66, sentimentSampleSize: 9, assistantsActive: 5 });
  check('AI calls handled real = 42', live.kpis.aiCallsHandled.tracked === true && live.kpis.aiCallsHandled.value === 42);
  // time-saved estimate: conv0 x3 + calls42 x5 + (rem36 + out36) x0.5 = 210 + 36 = 246, flagged estimated
  check('AI time saved is an ESTIMATE (246 min, estimated flag)', live.kpis.aiTimeSavedMinutes.tracked === true && live.kpis.aiTimeSavedMinutes.value === 246 && (live.kpis.aiTimeSavedMinutes as any).estimated === true);
  check('suggested upsell revenue real = 132000c ($1,320)', live.kpis.suggestedUpsellRevenueCents.tracked === true && live.kpis.suggestedUpsellRevenueCents.value === 132000);
  check('missed calls recovered real = 7', live.kpis.missedCallsRecovered.tracked === true && live.kpis.missedCallsRecovered.value === 7);
  check('call-to-booking rate real = 41', live.callIntelligence.callToBookingRatePct.value === 41);
  check('call-intelligence section tracked', live.sections.some((s) => s.key === 'call-intelligence' && s.tracked === true));
  check('automation success rate real = 98.1', live.kpis.automationSuccessRate.tracked === true && live.kpis.automationSuccessRate.value === 98.1);
  check('automation sentToday real = 36', live.automation.sentToday.value === 36);
  check('Appointment Reminders workflow row real', live.workflows[0].name === 'Appointment Reminders' && live.workflows[0].tracked === true && live.workflows[0].sentToday.value === 36);
  check('campaign performance real (1200 sent, 84 bookings, 7% conv)', live.campaigns.sent.value === 1200 && live.campaigns.bookings.value === 84 && live.campaigns.conversionPct.value === 7);
  check('Birthday Campaigns row real from workflow_runs', live.workflows[1].name === 'Birthday Campaigns' && live.workflows[1].tracked === true && live.workflows[1].sentToday.value === 5 && live.workflows[1].successRatePct.value === 96.2);
  check('AI Follow-Up row real-0 when source present but no runs', live.workflows[5].tracked === true && live.workflows[5].sentToday.value === 0);

  check('workflows section tracked when messaging telemetry present', live.sections.some((s) => s.key === 'workflows' && s.tracked === true));
  check('conversations tracked even when 0 (real zero, source exists)', live.kpis.aiConversationsToday.tracked === true && live.kpis.aiConversationsToday.value === 0);
  check('activity rows surfaced from usage log', live.activity.length === 1 && live.activity[0].assistant === 'ai_receptionist');
  check('performance week conversations real = 23', live.performance.totalConversations.tracked === true && live.performance.totalConversations.value === 23);
  check('performance success rate real = 97.4', live.performance.aiSuccessRatePct.value === 97.4);
  check('activity-log section tracked when feed present', live.sections.some((s) => s.key === 'activity-log' && s.tracked === true));
  check('AI-attributed bookings tracked = 4', live.kpis.bookingsCapturedByAi.tracked === true && live.kpis.bookingsCapturedByAi.value === 4);
  check('booking assistant completed real = 31', live.bookingAssistant.completed.tracked === true && live.bookingAssistant.completed.value === 31);
  check('booking assistant rebookings real = 6', live.bookingAssistant.rebookings.value === 6);
  check('sentiment tracked + rounded to 4.7/5', live.kpis.customerSentiment.tracked === true && live.kpis.customerSentiment.value === 4.7);
  check('appointmentsToday real = 12', live.live.appointmentsToday.tracked === true && live.live.appointmentsToday.value === 12);
  check('assistantsActive real = 5', live.live.assistantsActive.tracked === true && live.live.assistantsActive.value === 5);
  check('command-center section tracked when assistants present', live.sections.some((s) => s.key === 'command-center' && s.tracked === true));
  check('calls-handled untracked without call-intel source', empty.kpis.aiCallsHandled.tracked === false);

  console.log('\n== sentiment requires sample ==');
  const noSample = assembleOverview({ bookingsToday: 0, aiBookingsToday: null, bookingsCompletedToday: null, rebookingsToday: null, aiConversationsToday: null, weekConversations: null, aiSuccessRatePct: null, recentActivity: null, suggestedUpsellRevenueTodayCents: null, aiCallsHandledToday: null, missedCallsRecoveredToday: null, callToBookingRatePct: null, workflowStats: null, campaignsSent: null, campaignBookings: null, campaignRevenueCents: null, remindersSentToday: null, reminderSuccessRatePct: null, outboundSentToday: null, automationSuccessRatePct: null, sentimentAvg: 5, sentimentSampleSize: 0, assistantsActive: null });
  check('activity-log untracked when usage-log source unavailable', noSample.sections.some((s) => s.key === 'activity-log' && s.tracked === false));
  check('AI bookings untracked when source null', noSample.kpis.bookingsCapturedByAi.tracked === false);
  check('avg with zero sample -> untracked', noSample.kpis.customerSentiment.tracked === false);

  console.log('\n== helpers ==');
  check('real() shape', real(3, 's').tracked === true && real(3, 's').value === 3);
  check('untracked() shape', untracked('s', '/r').tracked === false && untracked('s').value === null);

  console.log('\n== service over in-memory repo (scope passthrough) ==');
  const svc = new AiCenterService(new InMemoryAiCenterRepo({ bookingsToday: 3, aiBookingsToday: 1, bookingsCompletedToday: 2, rebookingsToday: 0, aiConversationsToday: 7, weekConversations: 40, aiSuccessRatePct: 99, recentActivity: [], suggestedUpsellRevenueTodayCents: 0, aiCallsHandledToday: 1, missedCallsRecoveredToday: 0, callToBookingRatePct: null, workflowStats: null, campaignsSent: null, campaignBookings: null, campaignRevenueCents: null, remindersSentToday: 5, reminderSuccessRatePct: 95, outboundSentToday: 5, automationSuccessRatePct: 95, sentimentAvg: 4.2, sentimentSampleSize: 4, assistantsActive: 2 }));
  const ov = await svc.overview({ tenantId: 't1', branchId: 'b1' });
  check('service returns real bookings via repo', ov.live.appointmentsToday.value === 3);
  check('service returns tracked sentiment 4.2', ov.live.customerSentiment.value === 4.2);

  console.log(`\nai-center-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
