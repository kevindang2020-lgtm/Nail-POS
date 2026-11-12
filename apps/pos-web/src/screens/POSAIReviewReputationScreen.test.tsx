// POSAIReviewReputationScreen — Review & Reputation guide (Nov 1 2026). The title, eight tabs and six cards stay; the cards come
// from /pos/reputation/summary (Awaiting approval / Response rate are real, not always 0); a failed read is an error, not
// zero; filters are server queries; the overlay runs Draft → Send for approval → Approve / Reject (reason required) → Publish
// on the existing routes and never sends review text from the browser; a role without manage sees no workflow buttons;
// Review Requests says nothing is sent automatically; the check renders localized text.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { rp, ap, perms } = vi.hoisted(() => ({
  rp: { summary: vi.fn(), reviews: vi.fn(), review: vi.fn(), approvals: vi.fn(), complaints: vi.fn(), trends: vi.fn(), branches: vi.fn(), requests: vi.fn(), integrations: vi.fn(), check: vi.fn() },
  ap: { draft: vi.fn(), requestApproval: vi.fn(), approve: vi.fn(), reject: vi.fn(), publish: vi.fn(), addNote: vi.fn(), acknowledge: vi.fn(), resolveEscalation: vi.fn() },
  perms: { deny: [] as string[] } }));
vi.mock('../api/posReputationApi', () => ({ posReputationApi: rp }));
vi.mock('../api/posAiReviewReputationApi', () => ({ posAiReviewReputationApi: ap }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSAIReviewReputationScreen } from './POSAIReviewReputationScreen';

const M = { reviews: 12, classifiedReviews: 10, averageRating: 4.2, negativeShare: 20, awaitingApproval: 3, seriousComplaints: 1, responseRate: 50 };
const SUM = { metrics: M, period: { today: '2026-11-02' }, sampleNote: false, freshness: { lastSyncAt: null, newestReviewAt: '2026-11-01T10:00:00Z' },
  recent: [{ id: 'r1', rating: 2, source: 'google', at: '2026-11-01T10:00:00Z', excerpt: 'Waited 40 minutes', response: 'unanswered' }] };
const ROW = { id: 'r1', at: '2026-11-01T10:00:00Z', reviewer: 'Ann', source: 'google', branch: 'Main', rating: 2, excerpt: 'Waited 40 minutes', truncated: false, response: 'unanswered', complaint: 'none' };
const page = (items: any[], extra = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, ...extra });
const DETAIL = (state: string | null) => ({ id: 'r1', rating: 2, source: 'google', at: '2026-11-01T10:00:00Z', text: 'Waited 40 minutes', reviewer: 'Ann', branch: 'Main', externalId: 'g-1',
  importedAt: '2026-11-01T11:00:00Z', lastSyncAt: null, reviewerUrl: null, customer: { restricted: true }, analysis: null,
  response: { state: state ?? 'unanswered', draftStatus: state, text: state ? 'Thank you, we are sorry.' : null, version: state ? 1 : null, canPublishToProvider: false, approvals: [] },
  complaint: null, notes: [], recovery: [] });
const mount = () => render(<POSAIReviewReputationScreen />);
beforeEach(() => {
  for (const f of [...Object.values(rp), ...Object.values(ap)]) f.mockReset();
  perms.deny = [];
  rp.summary.mockResolvedValue(SUM); rp.reviews.mockResolvedValue(page([ROW])); rp.review.mockResolvedValue(DETAIL(null));
  rp.approvals.mockResolvedValue(page([], { counts: {} })); rp.requests.mockResolvedValue(page([], { counts: {}, overdueNotSent: 2 }));
  for (const f of Object.values(ap)) f.mockResolvedValue({});
});

describe('POSAIReviewReputationScreen', () => {
  it('keeps the title, the eight tabs and the six cards — Awaiting approval and Response rate come from the summary', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'AI Review and Reputation' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(8);
    expect(await screen.findByTestId('kpi-awaiting')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-response')).toHaveTextContent('50%');
    expect(screen.getByTestId('kpi-avg')).toHaveTextContent('4.2');
    expect(screen.getByTestId('kpi-reviews')).toHaveTextContent('12');
    expect(screen.getByTestId('kpi-negative')).toHaveTextContent('20%');
    expect(screen.getByTestId('kpi-serious')).toHaveTextContent('1');
  });

  it('a failed summary read is an error with retry, never zero', async () => {
    rp.summary.mockRejectedValue({ status: 500 });
    mount();
    expect(await screen.findByText(/not "no reviews"/)).toBeInTheDocument();
    expect(screen.getByTestId('kpi-awaiting')).toHaveTextContent('—');
  });

  it('inbox search, filters and dates are server queries', async () => {
    mount();
    fireEvent.click(screen.getByTestId('tab-inbox'));
    expect(await screen.findByTestId('rpx-row')).toHaveTextContent('Waited 40 minutes');
    fireEvent.change(screen.getByTestId('rpx-search'), { target: { value: 'wait' } });
    fireEvent.submit(screen.getByTestId('rpx-search').closest('form')!);
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'wait', page: 1 })));
    fireEvent.change(screen.getByTestId('rpx-rating'), { target: { value: '1' } });
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ rating: '1' })));
    fireEvent.change(screen.getByTestId('rpx-response'), { target: { value: 'awaiting_approval' } });
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ response: 'awaiting_approval' })));
    fireEvent.click(screen.getByTestId('preset-last_30'));
    await waitFor(() => expect(rp.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last_30' })));
  });

  it('the overlay drafts from the stored review (no text sent) and sends for approval', async () => {
    rp.review.mockResolvedValueOnce(DETAIL(null)).mockResolvedValue(DETAIL('draft_generated'));
    mount();
    fireEvent.click(await screen.findByTestId('rpx-recent'));
    expect(await screen.findByTestId('rpx-text')).toHaveTextContent('Waited 40 minutes');
    expect(screen.getByTestId('rpx-customer')).toHaveTextContent(/your role cannot see who/);
    fireEvent.click(screen.getByTestId('rpx-draft'));
    await waitFor(() => expect(ap.draft).toHaveBeenCalledWith('r1', 'generate'));
    expect(ap.draft.mock.calls[0]).toHaveLength(2);
    fireEvent.click(await screen.findByTestId('rpx-submit'));
    await waitFor(() => expect(ap.requestApproval).toHaveBeenCalledWith('r1'));
    expect(ap.publish).not.toHaveBeenCalled();
  });

  it('reject requires a reason; an approved draft without provider publishing shows no Publish button', async () => {
    rp.review.mockResolvedValue(DETAIL('awaiting_approval'));
    mount();
    fireEvent.click(await screen.findByTestId('rpx-recent'));
    fireEvent.click(await screen.findByTestId('rpx-reject'));
    expect(screen.getByTestId('rpx-reject-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('rpx-reject-reason'), { target: { value: 'Too long' } });
    fireEvent.click(screen.getByTestId('rpx-reject-save'));
    await waitFor(() => expect(ap.reject).toHaveBeenCalledWith('r1', 'Too long'));
    rp.review.mockResolvedValue(DETAIL('approved'));
    fireEvent.click(screen.getByTestId('rpx-close'));
    fireEvent.click(await screen.findByTestId('rpx-recent'));
    expect(await screen.findByTestId('rpx-ov-state')).toHaveTextContent('Approved');
    expect(screen.queryByTestId('rpx-publish')).toBeNull();
  });

  it('a workflow error is shown in the overlay; a role without manage sees no workflow buttons', async () => {
    ap.draft.mockRejectedValue({ body: { code: 'DRAFT_UNSAFE' } });
    mount();
    fireEvent.click(await screen.findByTestId('rpx-recent'));
    fireEvent.click(await screen.findByTestId('rpx-draft'));
    expect(await screen.findByTestId('rpx-act-err')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rpx-close'));
    perms.deny = ['pos.ai_review_reputation.manage'];
    fireEvent.click(screen.getByTestId('rpx-recent'));
    await screen.findByTestId('rpx-text');
    expect(screen.queryByTestId('rpx-draft')).toBeNull();
    expect(screen.queryByTestId('rpx-note')).toBeNull();
  });

  it('Review Requests says nothing is sent automatically and shows overdue scheduled requests', async () => {
    mount();
    fireEvent.click(screen.getByTestId('tab-requests'));
    expect(await screen.findByTestId('rpx-requests-note')).toBeInTheDocument();
    expect(await screen.findByTestId('rpx-overdue')).toHaveTextContent('2');
  });

  it('extras Review Reputation 17: Feedback Trends shows the rating distribution and recurring complaint topics in words, with the no-cause note', async () => {
    rp.trends.mockResolvedValue({ months: [{ month: '2026-11', reviews: 5, averageRating: 3, negativeShare: 40, responseRate: 0, sample: 'too_few' }], note: 'x',
      ratingDistribution: { from: '2025-12-01', reviews: 5, stars: [1, 2, 3, 4, 5].map((k) => ({ stars: k, count: k === 1 ? 3 : 1 })), unrated: 1 },
      recurringTopics: { classifiedReviews: 2, basis: 'latest_saved_classification', items: [
        { topic: 'long_wait', reviews: 2, negative: 2, recurring: true }, { topic: 'not_a_known_topic', reviews: 1, negative: 0, recurring: false }] } });
    mount();
    fireEvent.click(screen.getByTestId('tab-trends'));
    const rows = await screen.findAllByTestId('rpx-dist-row');
    expect(rows.map((r) => r.textContent)).toEqual(['5 ★1', '4 ★1', '3 ★1', '2 ★1', '1 ★3']);
    expect(screen.getByTestId('rpx-dist')).toHaveTextContent('1 reviews have no star rating.');
    const topics = screen.getAllByTestId('rpx-topic');
    expect(topics[0]).toHaveTextContent('Long wait'); expect(topics[0]).toHaveTextContent('Recurring'); expect(topics[0]).toHaveTextContent('2 reviews · 2 negative');
    expect(topics[1].textContent).not.toMatch(/not_a_known_topic/);
    expect(screen.getByTestId('rpx-topics')).toHaveTextContent('not proof of a cause');
    expect(screen.getByTestId('rpx-topics')).toHaveTextContent('latest saved classification of 2 reviews');
  });
  it('the check renders localized detail text', async () => {
    rp.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [{ key: 'requests_delivery', state: 'WARNING', count: 2 }] });
    mount();
    fireEvent.click(screen.getByTestId('rpx-check'));
    expect(await screen.findByTestId('chk-requests_delivery')).toHaveTextContent(/no sender is running/);
  });
});
