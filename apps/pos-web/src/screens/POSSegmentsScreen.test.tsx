// POSSegmentsScreen — Customer Segments Complete Build Guide (Oct 30 2026): the original Returning default and the columns,
// the six tabs (New = exactly 1 visit; Never Visited separate), server-side search / paging / page sizes in the query,
// Why This Segment?, the overlay's Open Booking handoff, the Audience Builder's no-send draft, and the 403 state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, camp, navigate } = vi.hoisted(() => ({
  api: { summary: vi.fn(), members: vi.fn(), qualification: vi.fn(), overlay: vi.fn(), snapshotDay: vi.fn(), createDraft: vi.fn(), draft: vi.fn(), recheck: vi.fn(), discard: vi.fn(), linkCampaign: vi.fn() },
  camp: { create: vi.fn() }, navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posSegmentsApi', () => ({ posSegmentsApi: api }));
vi.mock('../api/posCampaignsApi', () => ({ posCampaignsApi: camp }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
import { POSSegmentsScreen } from './POSSegmentsScreen';

const period = { preset: 'month', from: '2026-10-01', to: '2026-10-31', today: '2026-10-30', timeZone: 'America/New_York' };
const SUM = { ruleset: 'segments-v1', settingsVersion: 0, timeZone: 'America/New_York', today: '2026-10-30', inactiveDays: 60, evaluatedAt: '2026-10-30T13:00:00Z', period,
  scope: { branches: [{ branchId: 'b1', name: 'Main' }], selectedBranchId: null, label: 'tenant_wide' },
  counts: { all: 48, new: 8, returning: 11, vip: 1, never: 29, inactive: 1 }, overlaps: { vipReturning: 0, vipNew: 1, vipNever: 0, vipInactive: 0 },
  vipRule: { text: 'x' }, health: { unknownBranchVisits: 0, walkInVisitsWithoutCustomer: 0, sharedPhoneGroups: 1, lastVisitRecordedAt: null, lastSnapshot: null } };
const row = (o: Record<string, unknown> = {}) => ({ customerId: 'c1', customerName: 'Vishaal kumar', maskedPhone: '(•••) •••-9624', maskedEmail: null, visits: 15, visitClass: 'returning', isVip: false, inactive: false,
  loyaltyTier: 'Regular', lastVisitAt: '2026-10-29T19:00:00Z', firstVisitAt: '2026-06-25T19:00:00Z', lifetimeSpendCents: 44076, createdAt: '2025-09-05T00:00:00Z', smsStatus: 'eligible', emailStatus: 'eligible', segments: ['returning'], ...o });
const list = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, sort: 'created_desc', segment: 'returning', period, filters: { basis: 'none' }, ...o });
const mount = (url = '/tenant/marketing/segments') => render(<MemoryRouter initialEntries={[url]}><POSSegmentsScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(api), camp.create, navigate]) f.mockReset();
  api.summary.mockResolvedValue(SUM);
  api.members.mockImplementation(async (q: any) => list([row()], { segment: q.segment }));
});

describe('POSSegmentsScreen', () => {
  it('opens on Returning with the original columns, formatted Last Visit and the server counts', async () => {
    mount();
    expect(await screen.findByText('Vishaal kumar')).toBeInTheDocument();
    expect(api.members).toHaveBeenCalledWith(expect.objectContaining({ segment: 'returning', page: 1, pageSize: 10 }));
    expect(screen.getByText('$440.76')).toBeInTheDocument();
    expect(screen.getByText('Regular')).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-29T/)).not.toBeInTheDocument();
    expect(screen.getByTestId('sg-tab-never')).toHaveTextContent('29');
  });
  it('the tabs ask the server for each segment; search is sent to the server', async () => {
    mount(); await screen.findByText('Vishaal kumar');
    fireEvent.click(screen.getByTestId('sg-tab-never'));
    await waitFor(() => expect(api.members).toHaveBeenCalledWith(expect.objectContaining({ segment: 'never' })));
    fireEvent.change(screen.getByTestId('sg-search'), { target: { value: '7762599624' } });
    await waitFor(() => expect(api.members).toHaveBeenCalledWith(expect.objectContaining({ q: '7762599624' })), { timeout: 2000 });
  });
  it('page size 20 and page 2 come from the URL view state', async () => {
    mount('/tenant/marketing/segments?segment=all&size=20&page=2');
    await waitFor(() => expect(api.members).toHaveBeenCalledWith(expect.objectContaining({ segment: 'all', pageSize: 20, page: 2 })));
  });
  it('Why this segment? shows the facts; the overlay books with the customer preselected', async () => {
    api.qualification.mockResolvedValue({ customerId: 'c1', customerName: 'Vishaal kumar', ruleset: 'segments-v1', settingsVersion: 0, evaluatedAt: '2026-10-30T13:00:00Z', isVip: false, loyaltyTier: 'Regular', vipSince: null,
      facts: { qualifyingVisits: 15, firstVisitAt: null, lastVisitAt: null, daysAway: 1, lifetimeSpendCents: 44076, refundedCents: 0 }, thresholds: { inactiveDays: 60 },
      reasons: [{ segment: 'returning', met: true }, { segment: 'vip', met: false }] });
    mount(); await screen.findByText('Vishaal kumar');
    fireEvent.click(screen.getByTestId('sg-why'));
    expect(await screen.findByTestId('sg-why-facts')).toHaveTextContent('15');
    expect(screen.getByTestId('sg-why-vip')).toHaveTextContent(/loyalty tier/);
  });
  it('the Audience Builder creates a draft only and says nothing is sent', async () => {
    api.createDraft.mockResolvedValue({ draftId: 'd1', status: 'draft', channel: 'sms', selected: 1, eligible: 1, excluded: 0, excludedReasons: {}, members: [], expiresAt: '2026-10-31T13:00:00Z', campaignId: null, messagePreview: null });
    mount(); await screen.findByText('Vishaal kumar');
    fireEvent.click(screen.getByTestId('sg-create-campaign'));
    expect(await screen.findByTestId('sg-aud-nosend')).toHaveTextContent(/Nothing is sent/);
    fireEvent.click(screen.getByTestId('sg-aud-build'));
    await waitFor(() => expect(api.createDraft).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', selectionMode: 'all_matching' })));
    expect(camp.create).not.toHaveBeenCalled();
  });
  it('shows the server refusal (e.g. 403) instead of an empty list', async () => {
    api.members.mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED', message: 'You do not have permission to do that.' });
    mount();
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});
