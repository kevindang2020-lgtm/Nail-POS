import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InsightDetailsDrawer } from './AiInsightsDetails';

const aiInsight = vi.fn();
const reviewInsights = vi.fn();
const dismissInsight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  aiInsight: (...a: any[]) => aiInsight(...a),
  reviewInsights: (...a: any[]) => reviewInsights(...a),
  dismissInsight: (...a: any[]) => dismissInsight(...a),
} }));

const detail = (over: any = {}) => ({ ok: true, insight: {
  id: '1', insightReference: 'AI-BKG-0001', title: 'Declining bookings', summary: 'Bookings down 12%.', category: 'BOOKING_DECLINE',
  severity: 'high', confidence: 84, confidenceMethod: 'calibrated_probability', status: 'new', tenantName: 'Glamour Studio', branchName: 'Downtown',
  generatedAt: '2026-05-06T10:15:00Z', lastEvaluatedAt: '2026-05-06T10:15:00Z', freshness: 'current', recommendation: 'Launch re-engagement.',
  modelProvider: 'internal', modelName: 'insight-detector', modelVersion: 'v1.4', promptVersion: 'p2', churnRiskScore: null, flaggedAmountCents: null, ...over,
} });

describe('InsightDetailsDrawer', () => {
  beforeEach(() => {
    aiInsight.mockReset(); aiInsight.mockResolvedValue(detail());
    reviewInsights.mockReset(); reviewInsights.mockResolvedValue({ ok: true, reviewed: 1 });
    dismissInsight.mockReset(); dismissInsight.mockResolvedValue({ ok: true });
  });

  it('shows evidence, confidence method, model + prompt version, and freshness', async () => {
    render(<InsightDetailsDrawer id="1" onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('Declining bookings')).toBeInTheDocument();
    expect(screen.getByText(/84% · High/)).toBeInTheDocument();
    expect(screen.getByText('Calibrated Probability')).toBeInTheDocument();
    expect(screen.getByText('v1.4')).toBeInTheDocument();
    expect(screen.getByText('p2')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText(/recommendation only/i)).toBeInTheDocument();
  });

  it('shows Not Available when confidence is null', async () => {
    aiInsight.mockResolvedValue(detail({ confidence: null, confidenceMethod: null }));
    render(<InsightDetailsDrawer id="1" onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('Not Available')).toBeInTheDocument();
  });

  it('frames a transaction flag as review, not confirmed fraud', async () => {
    aiInsight.mockResolvedValue(detail({ category: 'UNUSUAL_TRANSACTION', flaggedAmountCents: 8700000 }));
    render(<InsightDetailsDrawer id="1" onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText(/flagged for review, not confirmed fraud/)).toBeInTheDocument();
  });

  it('marks reviewed', async () => {
    const onChanged = vi.fn();
    render(<InsightDetailsDrawer id="1" onClose={() => {}} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Mark Reviewed'));
    await waitFor(() => expect(reviewInsights).toHaveBeenCalledWith(['1']));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.stringMatching(/reviewed/)));
  });

  it('requires a reason to dismiss', async () => {
    render(<InsightDetailsDrawer id="1" onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Dismiss'));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'seasonal variation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(dismissInsight).toHaveBeenCalledWith('1', 'seasonal variation'));
  });
});
