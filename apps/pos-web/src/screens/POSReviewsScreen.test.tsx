// POSReviewsScreen — Reviews & Reputation guide (Oct 30 2026): the original KPI cards / distribution / At a Glance / feed stay;
// N/A (never 0.0) with no verified reviews; the search text never goes into the URL; filters + page size are server queries;
// the overlay has Close + Open Booking (disabled for an anonymous review); Hide needs a reason and sends the loaded version +
// a request key; a 1–2★ review offers no "Other" reason; Hide is manager-only; a 403 shows the permission message.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, navigate, perms } = vi.hoisted(() => ({
  api: { summary: vi.fn(), reviews: vi.fn(), options: vi.fn(), review: vi.fn(), moderate: vi.fn(), insights: vi.fn(), check: vi.fn(), checkRun: vi.fn(), checkLast: vi.fn(), staff: vi.fn(), assign: vi.fn() },
  navigate: vi.fn(), perms: { list: ['marketing.view', 'marketing.manage'] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posReviewsCenterApi', () => ({ posReviewsCenterApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => perms.list.includes(p) }));
import { POSReviewsScreen } from './POSReviewsScreen';

const SUM = { totalReviews: 4, verifiedReviews: 4, averageRating: 5, receivedReviews: 4, averageAllReceived: 5, publicCount: 4, hiddenCount: 0, spamCount: 0, hiddenLowStarCount: 0,
  withCommentCount: 0, starOnlyCount: 4, needsAttention: 0, fiveStarPercent: 100, ratingDistribution: [5, 4, 3, 2, 1].map((star) => ({ star, count: star === 5 ? 4 : 0 })), scope: {}, today: '2026-10-31' };
const ROW = (o: any = {}) => ({ id: 'r1', rating: 5, comment: null, starOnly: true, source: 'internal', external: false, isPublic: true, isHidden: false, isSpam: false, visibility: 'public', moderationVersion: 0,
  submittedAt: '2026-09-14T16:00:00Z', technician: { id: 't1', name: 'Vishal verma' }, customer: null, serviceName: null, responded: false, needsAttention: false, ...o });
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, basis: 'submitted', range: null, today: '2026-10-31' });
const mount = () => render(<MemoryRouter initialEntries={['/tenant/marketing/reviews']}><POSReviewsScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(api), navigate]) f.mockReset();
  perms.list = ['marketing.view', 'marketing.manage'];
  api.staff.mockResolvedValue({ items: [{ id: 'u1', name: 'Fran Desk', role: 'FRONT_DESK' }] }); api.checkLast.mockResolvedValue(null); api.assign.mockResolvedValue({ id: 'r1', assignedUserId: 'u1' });
  api.summary.mockResolvedValue(SUM); api.reviews.mockResolvedValue(page([ROW(), ROW({ id: 'r2' })])); api.options.mockResolvedValue({ technicians: [], services: [], sources: [] });
});

describe('POSReviewsScreen', () => {
  it('keeps the original modules and shows the server numbers', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Reviews & Reputation' })).toBeInTheDocument();
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Rating Distribution')).toBeInTheDocument();
    expect(screen.getByText('0 of 4 reviews include a written comment.')).toBeInTheDocument();
    expect(screen.getAllByText('No written comment').length).toBe(2);
    expect(screen.getAllByText('Vishal verma').length).toBe(2);
  });
  it('shows N/A, not 0.0, when there are no verified reviews', async () => {
    api.summary.mockResolvedValue({ ...SUM, totalReviews: 0, verifiedReviews: 0, averageRating: null, fiveStarPercent: null, ratingDistribution: [5, 4, 3, 2, 1].map((star) => ({ star, count: 0 })) });
    api.reviews.mockResolvedValue(page([]));
    mount();
    expect((await screen.findAllByText('N/A')).length).toBeGreaterThan(0);
  });
  it('search and filters are server queries; changing a filter resets to page 1; page size 50', async () => {
    mount(); await screen.findAllByText('Vishal verma');
    fireEvent.change(screen.getByTestId('rvw-search'), { target: { value: 'Ava' } });
    await waitFor(() => expect(api.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Ava', page: 1 })));
    fireEvent.change(screen.getByTestId('flt-rating'), { target: { value: '2' } });
    await waitFor(() => expect(api.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ rating: '2', page: 1 })));
    fireEvent.change(screen.getByTestId('rvw-pagesize'), { target: { value: '50' } });
    await waitFor(() => expect(api.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 })));
  });
  it('the overlay: Close works; Open Booking is disabled for an anonymous review and prefilled for a linked one', async () => {
    api.review.mockResolvedValue({ review: { ...ROW(), tags: [], branch: { name: 'Main' }, createdAt: '2026-09-14T16:00:00Z', updatedAt: '2026-09-14T16:00:00Z' }, metric: { why: 'Counted.' }, moderationScope: 'x', customer: null, anonymous: true, technician: null, visit: null, response: { draft: null, versions: [], approvals: [], publications: [], publishable: 'internal_only' }, moderation: [] });
    mount(); fireEvent.click((await screen.findAllByTestId('rvw-row'))[0]);
    expect(await screen.findByTestId('ov-book')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ov-close'));
    await waitFor(() => expect(screen.queryByTestId('rvw-overlay')).toBeNull());
    api.review.mockResolvedValue({ review: { ...ROW({ customer: { id: 'c1', name: 'Ava Kim' } }), tags: [], branch: { name: 'Main' } }, metric: { why: '' }, moderationScope: '', customer: { id: 'c1', name: 'Ava Kim', canBook: true, priorReviews: [] }, anonymous: false, technician: null, visit: null, response: { draft: null, versions: [], approvals: [], publications: [], publishable: 'internal_only' }, moderation: [] });
    fireEvent.click(screen.getAllByTestId('rvw-row')[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Booking' }));
    expect(navigate).toHaveBeenCalledWith('/booking/new?customerId=c1&from=reviews');
  });
  it('Hide needs a reason and sends the loaded version + a request key; a 1★ review offers no "Other"', async () => {
    api.reviews.mockResolvedValue(page([ROW({ rating: 1, moderationVersion: 3 })]));
    api.moderate.mockResolvedValue({ isHidden: true });
    mount(); fireEvent.click(await screen.findByTestId('rvw-hide'));
    expect(await screen.findByTestId('mod-low')).toBeInTheDocument();
    expect(screen.getByTestId('mod-confirm')).toBeDisabled();
    expect([...(screen.getByTestId('mod-reason') as HTMLSelectElement).options].map((o) => o.value)).not.toContain('other');
    fireEvent.change(screen.getByTestId('mod-reason'), { target: { value: 'abusive_language' } });
    fireEvent.click(screen.getByTestId('mod-confirm'));
    await waitFor(() => expect(api.moderate).toHaveBeenCalledWith('r1', expect.objectContaining({ action: 'hide', reasonCode: 'abusive_language', expectedVersion: 3, idempotencyKey: expect.any(String) })));
  });
  it('Hide is manager-only', async () => {
    perms.list = ['marketing.view'];
    mount(); await screen.findAllByTestId('rvw-row');
    expect(screen.queryByTestId('rvw-hide')).toBeNull();
  });
  it('a 403 shows the permission message', async () => {
    api.summary.mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' });
    mount();
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
  it('A17 Nov 6: the Assigned to filter goes to the server; the overlay assigns the review and lists the customer’s messages', async () => {
    mount();
    fireEvent.change(await screen.findByTestId('flt-assignee'), { target: { value: 'me' } });
    await waitFor(() => expect(api.reviews).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: 'me' })));
    api.review.mockResolvedValue({ review: { ...ROW({ customer: { id: 'c1', name: 'Ava Kim' } }), tags: [], branch: { name: 'Main' } }, metric: { why: '' }, moderationScope: '', anonymous: false, assignment: null,
      customer: { id: 'c1', name: 'Ava Kim', canBook: true, priorReviews: [] }, communications: { messages: [{ id: 'n1', channel: 'sms', status: 'sent', at: '2026-11-01T12:00:00Z', preview: 'Thanks for visiting!' }], reviewRequests: [] },
      technician: null, visit: null, response: { draft: null, versions: [], approvals: [], publications: [], publishable: 'internal_only' }, moderation: [] });
    fireEvent.click((await screen.findAllByTestId('rvw-row'))[0]);
    fireEvent.change(await screen.findByTestId('ov-assign-select'), { target: { value: 'u1' } });
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith('r1', 'u1'));
    fireEvent.click(screen.getByTestId('ov-tab-communication'));
    expect(await screen.findByTestId('ov-comm-messages')).toHaveTextContent('Thanks for visiting!');
  });
  it('Reviews & Reputation 05: the check names unusual review activity in the screen language and changes nothing', async () => {
    api.checkRun.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-12T15:00:00Z', checks: [
      { key: 'anomalies', state: 'WARNING', title: 'Unusual review activity', evidence: '1 burst day(s) in the last 30 days (2026-11-09: 6)', active: true, action: 'x', actionCode: 'anomalies_investigate', checkedAt: '2026-11-12T15:00:00Z' }] });
    mount();
    fireEvent.click(await screen.findByTestId('rvw-check'));
    const c = await screen.findByTestId('chk-anomalies');
    expect(c).toHaveTextContent('Unusual review activity');
    expect(c).toHaveTextContent('Open the flagged reviews and investigate; nothing is hidden, merged or removed automatically.');
    expect(api.moderate).not.toHaveBeenCalled();
  });
  it('extras Reviews 02 / 03 (round 10): fair distribution (sample, raw incl. hidden, source mix) and the resolution timeline with its outcome', async () => {
    api.summary.mockResolvedValue({ ...SUM, verifiedReviews: 3, sample: { verified: 3, minimum: 10, sufficient: false },
      rawDistribution: [5, 4, 3, 2, 1].map((star) => ({ star, count: star === 1 ? 1 : star === 5 ? 3 : 0 })), sourceMix: [{ source: 'internal', count: 3, hidden: 1 }, { source: 'google', count: 1, hidden: 0 }] });
    mount();
    expect(await screen.findByTestId('dist-sample')).toHaveTextContent('Small sample: 3 verified ratings (fewer than 10)');
    expect(screen.getByTestId('dist-raw')).toHaveTextContent('1★ 1');
    expect(screen.getByTestId('dist-sources')).toHaveTextContent('1 hidden'); expect(screen.getByTestId('dist-sources').textContent).not.toMatch(/internal|google/);
    api.review.mockResolvedValue({ review: { ...ROW({ customer: { id: 'c1', name: 'Ava Kim' } }), tags: [], branch: { name: 'Main' } }, metric: { why: '' }, moderationScope: '', anonymous: false, assignment: null,
      customer: { id: 'c1', name: 'Ava Kim', canBook: true, priorReviews: [] }, communications: { messages: [], reviewRequests: [] }, technician: null, visit: null,
      response: { draft: null, versions: [], approvals: [], publications: [], publishable: 'internal_only' }, moderation: [],
      timeline: [{ at: '2026-11-01T12:00:00Z', kind: 'visit', detail: 'Gel Manicure' }, { at: '2026-11-02T12:00:00Z', kind: 'review', detail: '2' }, { at: '2026-11-02T13:00:00Z', kind: 'assigned', detail: 'Owner One' }, { at: '2026-11-03T13:00:00Z', kind: 'message', detail: 'sms' }],
      outcome: { resolution: 'resolved', escalation: 'none', owner: 'Owner One' } });
    fireEvent.click((await screen.findAllByTestId('rvw-row'))[0]);
    fireEvent.click(await screen.findByTestId('ov-tab-timeline'));
    const items = await screen.findAllByTestId('ov-timeline-item');
    expect(items.map((x) => x.textContent)).toEqual([expect.stringContaining('Visit paid · Gel Manicure'), expect.stringContaining('Review received · 2★'), expect.stringContaining('Assigned for follow-up · Owner One'), expect.stringContaining('Message to the customer')]);
    expect(screen.getByTestId('ov-outcome')).toHaveTextContent('Outcome: Resolved · Follow-up owner: Owner One');
  });
});
