import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

vi.mock('../api/posAiUsageApi', () => ({
  posAiUsageScreenApi: {
    reconcile: vi.fn().mockResolvedValue({
      monthStart: '2026-11-01', timeZone: 'America/New_York',
      old: { active: 1, onTrial: 11, running: 12 },
      now: { paidActive: 1, trialing: 0, trialExpired: 11, cancelled: 0, pastDue: 0, disabled: 0, canRunNow: 1, catalog: 15 },
      staleTrialRows: 11, monthEvents: 42, monthBlocked: 3, monthErrors: 0, gateMismatches: 0,
      enforcement: { modelCalls: 'always', featureRoutes: 'observe' },
      rows: [
        { code: 'ai_booking_assistant', state: 'active', storedStatus: 'active', gate: { allowed: true, reason: 'ok' } },
        { code: 'ai_marketing_assistant', state: 'trial_expired', storedStatus: 'trialing', gate: { allowed: false, reason: 'trial_expired' } },
      ],
    }),
    check: vi.fn().mockResolvedValue({ checks: [{ key: 'gate_matches_state', state: 'PASSED' }] }),
    detail: vi.fn().mockReturnValue(new Promise(() => {})),
    history: vi.fn().mockReturnValue(new Promise(() => {})),
  },
}));

describe('POSAICenterScreen — honest counts (AI Center guide, Nov 3 2026)', () => {
  it('never counts an ended trial as On Trial or Running, and explains the old 0/11/11', async () => {
    render(<MemoryRouter><POSAICenterScreen /></MemoryRouter>);
    const recon = await screen.findByTestId('aic-recon');
    expect(recon.textContent).toContain('counted 11 assistants as on trial');
    expect(recon.textContent).toContain('11 of those trials have ended');
    expect(recon.textContent).toContain('opened but watched');
    expect(screen.getByText('Paid & active')).toBeInTheDocument();
    expect(screen.getByText('1 / 15')).toBeInTheDocument(); // can run now
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /^1 running$/.test(el.textContent || ''))).toBeInTheDocument();
    expect(screen.getByText('Trial expired')).toBeInTheDocument();
  });
  it('Check AI System shows the gate check', async () => {
    render(<MemoryRouter><POSAICenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Check AI System'));
    expect(await screen.findByText('Gate agrees with this page')).toBeInTheDocument();
  });
  it('§07 every assistant card opens its details overlay; Usage & history opens the activity log in place', async () => {
    const { posAiUsageScreenApi } = await import('../api/posAiUsageApi');
    render(<MemoryRouter><POSAICenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('aic-card-ai_booking_assistant'));
    expect(posAiUsageScreenApi.detail).toHaveBeenCalledWith('ai_booking_assistant');
    fireEvent.click(screen.getByTestId('aic-history'));
    expect(posAiUsageScreenApi.history).toHaveBeenCalled();
  });
});
