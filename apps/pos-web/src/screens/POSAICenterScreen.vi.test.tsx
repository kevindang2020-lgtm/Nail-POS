// POSAICenterScreen.vi.test — English + Vietnamese POS mandate (WP-C3): the AI Center reads in Vietnamese (assistant groups,
// KPI sources, statuses); package names are product names (data). Same mocked API as POSAICenterScreen.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSAICenterScreen } from './POSAICenterScreen';

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    packages: vi.fn().mockResolvedValue({
      packages: [
        { code: 'ai_booking_assistant', name: 'AI Booking Assistant', description: '', usageUnit: 'bookings', category: 'front_desk', monthlyPriceCents: 4900, includedUsageLimit: 500, subscription: { status: 'active', usageLimit: 500 }, used: 142, remainingUsage: 358, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false },
        { code: 'ai_marketing_assistant', name: 'AI Marketing Assistant', description: '', usageUnit: 'messages', category: 'insights', monthlyPriceCents: 3900, includedUsageLimit: 1000, subscription: { status: 'trialing', usageLimit: 1000 }, used: 50, remainingUsage: 950, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false },
        { code: 'ai_fraud_money_protection', name: 'AI Fraud / Money Protection', description: '', usageUnit: 'checks', category: 'growth', monthlyPriceCents: 2900, includedUsageLimit: 0, subscription: null, used: 0, remainingUsage: 0, accessible: false, lockReason: 'no_subscription', lockLabel: 'Locked', trialAvailable: true },
      ],
    }),
    centerOverview: vi.fn().mockResolvedValue({
      generatedAt: new Date().toISOString(),
      kpis: {
        aiCallsHandled: {tracked:true,value:0,source:'call_intelligence_events'},
        bookingsCapturedByAi: {tracked:true,value:0,source:'appointments'},
        missedCallsRecovered: {tracked:true,value:0,source:'call_intelligence_events'},
        aiConversationsToday: {tracked:true,value:0,source:'ai_usage_logs'},
        automationSuccessRate: {tracked:false,value:null,source:'pending'},
        customerSentiment: {tracked:false,value:null,source:'no reviews'},
        suggestedUpsellRevenueCents: {tracked:true,value:0,source:'ai_revenue_attributions'},
        aiTimeSavedMinutes: {tracked:false,value:null,source:'pending'},
      },
      sections: [],
      activity: [],
      performance: { totalConversations: {tracked:true,value:0,source:'live'}, aiSuccessRatePct: {tracked:false,value:null,source:'pending'} },
      automation: { sentToday: {tracked:true,value:0,source:'live'}, successRatePct: {tracked:false,value:null,source:'pending'} },
      workflows: [{ name: 'Appointment Reminders', sentToday: {tracked:true,value:0,source:'live'}, successRatePct: {tracked:false,value:null,source:'pending'}, tracked: true }],
      campaigns: { sent: {tracked:true,value:0,source:'live'}, bookings: {tracked:true,value:0,source:'live'}, revenueCents: {tracked:true,value:0,source:'live'}, conversionPct: {tracked:false,value:null,source:'pending'} },
      callIntelligence: { callsHandled: {tracked:true,value:0,source:'live'}, recovered: {tracked:true,value:0,source:'live'}, callToBookingRatePct: {tracked:false,value:null,source:'pending'} },
      bookingAssistant: { completed: {tracked:true,value:0,source:'live'}, aiBookings: {tracked:true,value:0,source:'live'}, rebookings: {tracked:true,value:0,source:'live'} },
      live: {
        appointmentsToday: {tracked:true,value:0,source:'appointments'},
        aiBookingsToday: {tracked:true,value:0,source:'appointments'},
        aiConversationsToday: {tracked:true,value:0,source:'ai_usage_logs'},
        customerSentiment: {tracked:false,value:null,source:'no reviews'},
        assistantsActive: {tracked:true,value:2,source:'access'},
      },
    }),
    controlModes: vi.fn().mockResolvedValue([{ assistantKey: 'ai_booking_assistant', mode: 'recommendation_only', label: 'Recommendation only', updatedByUserId: null, updatedAt: null }]),
    setControlMode: vi.fn(),
    aiRevenueSummary: vi.fn().mockResolvedValue({ todayCents: 12500, weekCents: 84000, byKindToday: { rebooking: 12500 } }),
    workflowRunsSummary: vi.fn().mockResolvedValue({ rebooking: { key: 'rebooking', sentToday: 4, successRatePct: 75 } }),
    callIntelligenceSummary: vi.fn().mockResolvedValue({
      totalToday: 0, aiHandledToday: 0, missedToday: 0, recoveredToday: 0, qualifiedToday: 0,
      callToBookingRatePct: null, avgDurationSeconds: null, missedQueue: [], recovered: [],
    }),
  },
}));

afterEach(async () => { await setLanguage('en'); });

describe('POSAICenterScreen in Vietnamese', () => {
  it('the command center reads in Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = render(<MemoryRouter><POSAICenterScreen /></MemoryRouter>);
    await screen.findAllByText('AI Booking Assistant');
    for (const en of ['Front Desk', 'Insights', 'Growth', 'Open Customer Insights']) expect(screen.queryByText(en), en).toBeNull();
    // package / workflow names and the server's own mode label are product data
    expect(leftoverEnglish(container, ['AI Booking Assistant', 'AI Marketing Assistant', 'AI Fraud / Money Protection', 'Appointment Reminders', 'Recommendation only']).join(' | ')).toBe('');
  });
});
