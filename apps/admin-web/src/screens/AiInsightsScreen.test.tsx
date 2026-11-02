import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const aiInsightsOverview = vi.fn();
const aiInsights = vi.fn();
const aiInsightFeedback = vi.fn();
const aiInsightFeedbackRecent = vi.fn();
const reviewInsights = vi.fn();
const dismissInsight = vi.fn();
const aiInsight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  aiInsightsOverview: (...a: any[]) => aiInsightsOverview(...a),
  aiInsights: (...a: any[]) => aiInsights(...a),
  reviewInsights: (...a: any[]) => reviewInsights(...a),
  assignInsights: vi.fn(),
  dismissInsight: (...a: any[]) => dismissInsight(...a),
  aiInsight: (...a: any[]) => aiInsight(...a),
  aiInsightFeedback: (...a: any[]) => aiInsightFeedback(...a),
  aiInsightFeedbackRecent: (...a: any[]) => aiInsightFeedbackRecent(...a),
} }));

import { AiInsightsScreen } from './AiInsightsScreen';

const kpi = (key: string, label: string, value: string | null, extra: any = {}) => ({ key, label, value, available: value !== null, ...extra });
const overview = () => ({
  total: 186,
  kpis: [
    kpi('open', 'Open Insights', '186'), kpi('critical', 'Critical Insights', '24', { unfavorableIfUp: true }), kpi('reviewed_today', 'Reviewed Today', '92'),
    kpi('follow_up', 'Follow-Up Assigned', '37'), kpi('tenants_flagged', 'Tenants Flagged', '14'), kpi('branches_flagged', 'Branches Flagged', '29'),
    kpi('model_confidence', 'Model Confidence', '87%'), kpi('receptionist_issues', 'AI Receptionist Issues', '11'), kpi('churn_risks', 'Customer Churn Risks', '32', { unfavorableIfUp: true }),
    kpi('staffing', 'Staffing Shortages', '16'), kpi('marketing', 'Marketing Opportunities', '28'), kpi('unusual_txn', 'Unusual Txn Alerts', '19', { unfavorableIfUp: true }),
  ],
  byCategory: [{ category: 'BOOKING_DECLINE', label: 'Booking Decline', count: 41 }, { category: 'WAIT_TIME', label: 'Wait Time', count: 24 }],
  bySeverity: [{ severity: 'critical', count: 24 }, { severity: 'high', count: 46 }, { severity: 'medium', count: 72 }, { severity: 'low', count: 44 }],
  volumeTrend: { available: true, points: [{ date: '2026-05-05', count: 201 }, { date: '2026-05-06', count: 186 }] },
  tenantRisk: [{ tenant: 'Glamour Studio', tenantId: 't1', flaggedBranches: 4, openInsights: 18, churnRisk: 32, status: 'At Risk' }],
  highPriority: [
    { key: 'BOOKING_DECLINE', label: 'Declining Bookings', branches: 18 }, { key: 'CANCELLATION_RISK', label: 'High Cancellation Rates', branches: 14 },
    { key: 'WAIT_TIME', label: 'Long Wait Times', branches: 22 }, { key: 'TECHNICIAN_UTILIZATION', label: 'Low Tech Utilization', branches: 17 },
    { key: 'UNUSUAL_TRANSACTION', label: 'Unusual Transactions', branches: 19, flaggedCents: 8700000 }, { key: 'AI_RECEPTIONIST_ISSUE', label: 'AI Receptionist Issues', branches: 11 },
  ],
  categoryPanel: [{ category: 'BOOKING_DECLINE', label: 'Tenants with Declining Bookings', count: 18 }, { category: 'WAIT_TIME', label: 'Long Customer Wait Times', count: 22 }],
  bookingsRiskChurn: { available: false },
});
const directory = () => ({
  rows: [
    { id: '1', reference: 'AI-BKG-0001', title: 'Declining bookings at Glamour Studio Downtown', tenant: 'Glamour Studio', branch: 'Downtown', category: 'BOOKING_DECLINE', severity: 'high', confidence: 84, confidenceMethod: 'calibrated_probability', recommendation: 'Launch re-engagement campaign.', status: 'new', updatedAt: '2026-05-06T10:15:00Z', freshness: 'current' },
    { id: '5', reference: 'AI-TXN-0005', title: 'Unusual transaction activity at Radiant Beauty', tenant: 'Radiant Beauty', branch: 'Westside', category: 'UNUSUAL_TRANSACTION', severity: 'high', confidence: null, confidenceMethod: null, recommendation: 'Review flagged transactions.', status: 'follow_up_assigned', updatedAt: '2026-05-06T08:30:00Z', freshness: 'current' },
  ],
  total: 2, pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
});

describe('AiInsightsScreen', () => {
  beforeEach(() => {
    aiInsightsOverview.mockReset(); aiInsightsOverview.mockResolvedValue(overview());
    aiInsights.mockReset(); aiInsights.mockResolvedValue(directory());
    aiInsightFeedback.mockReset(); aiInsightFeedback.mockResolvedValue({ ok: true, feedback: { id: 'fb1', insightId: '1', insightReference: 'AI-BKG-0001', insightTitle: 'Declining bookings', verdict: 'not_helpful', comment: null, modelVersion: 'gpt-x', promptVersion: 'v12', createdAt: '2026-07-28T10:00:00Z' } });
    aiInsightFeedbackRecent.mockReset(); aiInsightFeedbackRecent.mockResolvedValue({ ok: true, feedback: [] });
    reviewInsights.mockReset(); reviewInsights.mockResolvedValue({ ok: true, reviewed: 1 });
    dismissInsight.mockReset(); dismissInsight.mockResolvedValue({ ok: true });
    aiInsight.mockReset(); aiInsight.mockResolvedValue({ ok: true, insight: { id: '1', insightReference: 'AI-BKG-0001', title: 'Declining bookings at Glamour Studio Downtown', summary: null, category: 'BOOKING_DECLINE', severity: 'high', confidence: 84, confidenceMethod: 'calibrated_probability', status: 'new', tenantName: 'Glamour Studio', branchName: 'Downtown', generatedAt: '2026-05-06T10:15:00Z', lastEvaluatedAt: '2026-05-06T10:15:00Z', freshness: 'current', recommendation: 'Launch.', modelProvider: 'internal', modelName: 'd', modelVersion: 'v1.4', promptVersion: 'p2', churnRiskScore: null, flaggedAmountCents: null } });
  });

  it('renders the recommendations-only banner, 12 KPIs, and title', async () => {
    render(<AiInsightsScreen />);
    expect(await screen.findByText('AI Insights', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText(/recommendations only\. No automatic destructive actions/)).toBeInTheDocument();
    expect(screen.getByText('Open Insights')).toBeInTheDocument();
    expect(screen.getByText('Unusual Txn Alerts')).toBeInTheDocument();
  });

  it('renders high-priority findings, category + severity, and the findings table', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    expect(screen.getByText('Declining Bookings')).toBeInTheDocument();
    expect(screen.getByText('Insights by Category')).toBeInTheDocument();
    expect(screen.getByText('Insight Severity')).toBeInTheDocument();
    expect(screen.getByText('Declining bookings at Glamour Studio Downtown')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument(); // confidence not available on the txn insight
  });

  it('marks selected insights reviewed', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    fireEvent.click(screen.getByLabelText('Select Declining bookings at Glamour Studio Downtown'));
    fireEvent.click(screen.getByText('✓ Mark Reviewed'));
    await waitFor(() => expect(reviewInsights).toHaveBeenCalledWith(['1']));
  });

  it('requires a reason to dismiss (recommendations-only, preserved)', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    fireEvent.click(screen.getByLabelText('Select Declining bookings at Glamour Studio Downtown'));
    fireEvent.click(screen.getByText('✕ Dismiss Insight'));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'seasonal variation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(dismissInsight).toHaveBeenCalledWith('1', 'seasonal variation'));
  });

  it('opens the details drawer when a finding title is clicked', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    fireEvent.click(screen.getByText('Declining bookings at Glamour Studio Downtown'));
    await waitFor(() => expect(aiInsight).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('Insight Details')).toBeInTheDocument();
  });

  it('Bookings Risk & Churn stays NotConnected; the Model Feedback Log is LIVE with an honest empty state', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    expect(screen.getByText('Bookings Risk & Churn Signals')).toBeInTheDocument();
    expect(screen.getByText('Model Feedback Log')).toBeInTheDocument();
    expect(await screen.findByText(/No feedback recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/A feedback store is not built yet/i)).not.toBeInTheDocument();
  });

  // Jul 28, 2026 — Submit Feedback used to say "Feedback recorded against the selected insight" while this same
  // screen's Model Feedback Log panel said the store isn't built. Nothing was recorded. A control must never claim
  // an action the system cannot perform.
  // Jul 28, 2026 (later the same day): the store now EXISTS (migration 424). The pin flips — the button must open
  // a real form, the recording must be a real api call, and the success message must state human-review-only. The
  // one thing that must never return is a claim without a call.
  it('Submit Feedback records through the real store and states the never-auto-retrains stance', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Submit Feedback/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Record Feedback/ }));
    await screen.findByText(/never auto-retrains the model/i);
    expect(aiInsightFeedback).toHaveBeenCalledTimes(1);
    expect(aiInsightFeedbackRecent.mock.calls.length).toBeGreaterThanOrEqual(2); // log refreshed after recording
  });

  it('Submit Feedback with no selection asks for a selection and records nothing', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    fireEvent.click(screen.getByRole('button', { name: /Submit Feedback/ }));
    expect(await screen.findByText(/Select exactly one insight/i)).toBeInTheDocument();
    expect(aiInsightFeedback).not.toHaveBeenCalled();
  });

  it('the review buttons do not claim a queue "opened" — the list below IS the queue', async () => {
    render(<AiInsightsScreen />);
    await screen.findByText('AI Insights', { selector: 'h1' });
    fireEvent.click(screen.getAllByRole('button', { name: /Review All Recommendations/ })[0]);
    expect(await screen.findByText(/already listed below/i)).toBeInTheDocument();
    expect(screen.queryByText(/queue opened/i)).not.toBeInTheDocument();
  });
});
