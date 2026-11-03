// POSAIReviewAssistantScreen — AI Review / Reputation Assistant guide (Nov 3 2026). The add-on header stays and shows ONE honest state
// (a trial that ended is never "On trial" next to "trial ended"); below it the cards come from Reviews & Reputation, the review list is
// a server query (search, reply state, rating, complaint, presets, pages), Check AI Review System renders the module's localized
// checks, and a failed read is an error, not "no reviews". Nothing here drafts, approves, posts or sends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { rp, pkg } = vi.hoisted(() => ({ rp: { summary: vi.fn(), reviews: vi.fn(), check: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posReputationApi', () => ({ posReputationApi: rp }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
import { POSAIReviewAssistantScreen } from './POSAIReviewAssistantScreen';

const CARD = { package: { code: 'ai_review_reputation_assistant', name: 'AI Review / Reputation Assistant', description: 'Drafts review replies.', category: 'Growth', posArea: 'Reviews / feedback', state: 'trial_expired', storedStatus: 'trialing',
  disabledReason: null, price: { cents: 3900, period: 'monthly', source: 'catalog_list' }, usage: { used: null, limit: 1000, unit: 'generations', percent: null, level: 'not_metered', periodStart: null, periodEnd: null, remaining: null },
  trial: { days: 14, endsAt: '2026-10-20T00:00:00Z', daysLeft: null, eligible: false }, actions: ['view_details'] } };
const SUM = { metrics: { reviews: 12, averageRating: 4.25, negativeReviews: 2, negativeShare: 0.1667, awaitingApproval: 1, seriousComplaints: 1, responseRate: 0.5 }, period: { today: '2026-11-03' } };
const ROW = { id: 'r1', rating: 2, source: 'google', reviewer: 'Jane D.', excerpt: 'Polish chipped after two days', truncated: false, at: '2026-11-02T15:00:00Z', response: 'awaiting_approval', complaint: 'open' };
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' }, ...o });
const wrap = () => render(<MemoryRouter><POSAIReviewAssistantScreen /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  pkg.detail.mockResolvedValue(CARD); rp.summary.mockResolvedValue(SUM); rp.reviews.mockResolvedValue(page([ROW]));
});

describe('AI Review / Reputation Assistant', () => {
  it('RA-01 one honest package state; the cards come from Reviews & Reputation; a review row with reply state and complaint', async () => {
    wrap();
    expect(await screen.findByTestId('pkg-state')).toHaveTextContent('Trial expired');
    expect(screen.queryByText(/^On trial$/)).toBeNull();
    expect(await screen.findByTestId('as-kpi-avg')).toHaveTextContent('4.3');
    expect(screen.getByTestId('as-kpi-negative')).toHaveTextContent('2 · 16.7%');
    const row = await screen.findByTestId('as-row');
    expect(row).toHaveTextContent('2 stars'); expect(row).toHaveTextContent('Jane D.'); expect(row).toHaveTextContent('Google');
    expect(within(row).getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.getByTestId('as-open')).toHaveAttribute('href', '/tenant/ai/reputation');
  });
  it('RA-02 search, filters, presets, sort and rows reach the server; Clear resets', async () => {
    wrap();
    await screen.findByTestId('as-row');
    fireEvent.change(screen.getByTestId('as-search'), { target: { value: 'chipped' } });
    fireEvent.submit(screen.getByTestId('as-search').closest('form')!);
    fireEvent.change(screen.getByTestId('as-f-response'), { target: { value: 'unanswered' } });
    fireEvent.change(screen.getByTestId('as-f-rating'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('as-preset-last_30'));
    fireEvent.change(screen.getByTestId('as-sort'), { target: { value: 'rating_low' } });
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'chipped', response: 'unanswered', rating: '1', preset: 'last_30', sort: 'rating_low', page: 1 })));
    fireEvent.change(screen.getByTestId('as-rows'), { target: { value: '50' } });
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 })));
    fireEvent.click(screen.getByTestId('as-clear'));
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ response: '', rating: '', q: undefined })));
  });
  it('RA-03 empty says why; a failed read is an error, not "no reviews"', async () => {
    rp.reviews.mockResolvedValueOnce(page([]));
    const { unmount } = wrap();
    expect(await screen.findByText(/No reviews are on record yet/)).toBeInTheDocument();
    unmount();
    rp.reviews.mockRejectedValue({ status: 500 });
    wrap();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No reviews are on record yet/)).toBeNull();
  });
  it('RA-04 Check AI Review System renders the module\'s localized checks; a refused check is an error, never a pass', async () => {
    rp.check.mockResolvedValueOnce({ overall: 'WARNING', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'provider_connected', state: 'WARNING' }, { key: 'tenant_isolation', state: 'PASSED' }] })
      .mockRejectedValueOnce({ status: 403 });
    wrap();
    fireEvent.click(await screen.findByTestId('as-check'));
    const k = await screen.findByTestId('as-chk-provider_connected');
    expect(k).toHaveTextContent('Warning');
    expect(k.textContent).not.toContain('rpx.');
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByTestId('as-check'));
    expect(await screen.findByText(/cannot see this information/)).toBeInTheDocument();
  });
});
