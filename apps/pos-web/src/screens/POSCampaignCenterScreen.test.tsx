// POSCampaignCenterScreen — Campaign Center Complete Build Guide (Oct 30 2026). The original modules stay (six KPI cards, the
// eleven table columns, funnel / channel mix / revenue, four related cards, seven Quick Actions); "spring into glow" shows its
// typed-in audience as an estimate with an explicit "no messages were sent" outcome; untracked opens / clicks / replies and
// ROI without cost say N/A (never 0); /marketing/sms pre-filters SMS; Launch needs approval AND a ticked confirmation; the
// assistant and the health check never send. (Merged the former .channel and .cost-preview tests: the cost estimate is now the
// wizard's Review step and the server refuses an unconfirmed launch.)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, camp, navigate } = vi.hoisted(() => ({
  api: { overview: vi.fn(), list: vi.fn(), searchRecipients: vi.fn(), audienceSources: vi.fn(), detail: vi.fn(), recipients: vi.fn(), events: vi.fn(), audit: vi.fn(), create: vi.fn(), update: vi.fn(),
    setAudience: vi.fn(), preview: vi.fn(), submit: vi.fn(), approve: vi.fn(), launch: vi.fn(), unschedule: vi.fn(), duplicate: vi.fn(), healthCheck: vi.fn(), suggest: vi.fn(), saveSuggestion: vi.fn() },
  camp: { cancel: vi.fn() }, navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posCampaignCenterApi', () => ({ posCampaignCenterApi: api }));
vi.mock('../api/posCampaignsApi', () => ({ posCampaignsApi: camp }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
import { POSCampaignCenterScreen } from './POSCampaignCenterScreen';

const period = { preset: 'all', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' };
const counts = (o: Record<string, unknown> = {}) => ({ selected: 50, selectedIsEstimate: true, eligible: null, excluded: null, queued: 0, attempted: 0, submitted: 0, skippedAtSend: 0, failed: 0, delivered: 0, unknown: 0, simulated: 0,
  booked: 0, redemptions: 0, discountCents: 0, associatedRevenueCents: 0, legacyRevenueCents: 0, legacySentCount: 0, actualCostCents: null, roi: null, roiNote: 'Not available: nothing was sent, so there is no cost.', ...o });
const spring = { id: 'c1', name: 'spring into glow', goal: null, description: null, offer: '20% off', channel: 'sms', branchId: null, status: 'completed', displayStatus: 'completed', outcome: 'completed_no_send_record', origin: 'manual',
  audienceLabel: 'Lapsed', audienceSource: 'manual_estimate', snapshotVersion: 0, dealId: null, dealName: null, messageBody: null, emailSubject: null, messageVersion: 1, budgetCents: 0,
  createdAt: '2026-10-27T13:00:00Z', updatedAt: '2026-10-27T13:00:00Z', scheduledAt: null, startedAt: '2026-10-27T13:00:00Z', completedAt: null, createdBy: 'Owner', submittedAt: null, approvedAt: null, approvedBy: null, approvalCurrent: false, counts: counts() };
const OV = { period, basis: 'created', generatedAt: '2026-10-30T13:00:00Z', kpis: { campaignRevenueCents: 0, activeCampaigns: 0, totalSent: 0, avgRoi: null, avgOpenRate: null, totalBookings: 0, totalCampaigns: 1, legacyEstimateCampaigns: 1 },
  funnel: ['selected', 'eligible', 'attempted', 'submitted', 'delivered', 'engaged', 'booked', 'completed_paid'].map((key) => ({ key, value: key === 'engaged' ? null : 0, note: '' })), legacyEstimateTotal: 50, channelMix: [], revenueByCampaign: [] };
const mount = (props: Record<string, string> = {}, url = '/tenant/marketing/campaigns') => render(<MemoryRouter initialEntries={[url]}><POSCampaignCenterScreen {...props} /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(api), camp.cancel, navigate]) f.mockReset();
  api.overview.mockResolvedValue(OV);
  api.list.mockResolvedValue({ items: [spring], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 }, period, basis: 'created', sort: 'newest' });
});

describe('Campaign Center', () => {
  it('keeps every original module and labels spring into glow honestly (estimate, 0 sent, no send record, N/A — never 50 reached)', async () => {
    mount();
    await screen.findByTestId('cc-row-c1');
    for (const id of ['kpi-revenue', 'kpi-active', 'kpi-sent', 'kpi-roi', 'kpi-open', 'kpi-bookings', 'cc-funnel', 'cc-mix', 'cc-revenue', 'cc-quick']) expect(screen.getByTestId(id)).toBeTruthy();
    const row = screen.getByTestId('cc-row-c1');
    expect(row.textContent).toMatch(/~50/);
    expect(screen.getByTestId('cc-outcome').textContent).toMatch(/no send record/i);
    expect(row.textContent).toMatch(/N\/A/);
    expect(screen.getByTestId('kpi-roi').textContent).not.toMatch(/0x/);
    expect(screen.getByTestId('cc-legacy-note').textContent).toMatch(/50/);
    expect(screen.getByTestId('cc-funnel-selected').textContent).toMatch(/0/);
    for (const label of ['Create Campaign', 'Send SMS', 'Send Email', 'Launch Promo', 'Issue Gift Card', 'Request Review', 'View Reports']) expect(screen.getByText(label)).toBeTruthy();
  });
  it('the SMS Marketing route pre-filters SMS on the server query; a search goes to the server with page 1', async () => {
    mount({ defaultChannel: 'sms' }, '/tenant/marketing/sms');
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(api.list.mock.calls[0][0]).toMatchObject({ channel: 'sms', page: 1, pageSize: 10 });
    fireEvent.change(screen.getByTestId('cc-search'), { target: { value: 'glow' } });
    await waitFor(() => expect(api.list.mock.calls.some((c) => c[0].q === 'glow' && c[0].page === 1)).toBe(true), { timeout: 2000 });
  });
  it('a row opens the details overlay with Close; the health check never sends', async () => {
    api.detail.mockResolvedValue({ ...spring, exclusionReasons: [], sendTimeReasons: [], providerErrors: [], readiness: null, definitions: {} });
    api.healthCheck.mockResolvedValue({ overall: 'attention_required', findings: [{ subsystem: 'execution', status: 'attention_required', summary: 'Marked Completed, but no send was ever recorded', evidence: 'ledger rows 0', nextStep: null, observedAt: '2026-10-30T13:00:00Z' }], trace: { ledgerRows: 0 }, sendsAnything: false, observedAt: '2026-10-30T13:00:00Z' });
    mount();
    fireEvent.click(await screen.findByTestId('cc-row-c1'));
    expect((await screen.findByTestId('cc-detail-outcome')).textContent).toMatch(/no send record/i);
    fireEvent.click(screen.getByTestId('cc-detail-health'));
    expect((await screen.findByTestId('cc-h-findings')).textContent).toMatch(/no send was ever recorded/);
    expect(api.launch).not.toHaveBeenCalled();
  });
  it('Launch is offered only when approved + ready, and only after the confirmation box is ticked', async () => {
    const ready = { ...spring, id: 'c2', status: 'draft', displayStatus: 'approved', outcome: null, audienceSource: 'segment_snapshot', snapshotVersion: 1, messageBody: 'Hi', approvedAt: '2026-10-30T12:00:00Z', approvedBy: 'Owner', approvalCurrent: true, submittedAt: '2026-10-30T11:00:00Z',
      counts: counts({ selected: 4, selectedIsEstimate: false, eligible: 2, excluded: 2 }), readiness: { ok: true, eligible: 2 }, exclusionReasons: [], sendTimeReasons: [], providerErrors: [], definitions: {} };
    api.detail.mockResolvedValue(ready); api.preview.mockResolvedValue({ asSent: 'Salon: Hi Reply STOP to opt out', selected: 4, eligible: 2, unknownVariables: [], costNote: '' }); api.audienceSources.mockResolvedValue({ items: [] });
    api.launch.mockResolvedValue({ status: 'scheduled' });
    api.list.mockResolvedValue({ items: [ready], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 }, period, basis: 'created', sort: 'newest' });
    mount();
    fireEvent.click(await screen.findByTestId('cc-row-c2'));
    fireEvent.click(await screen.findByTestId('cc-edit'));
    fireEvent.click(await screen.findByTestId('cc-step-approval'));
    const launch = await screen.findByTestId('cc-w-launch');
    expect((launch as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('cc-w-confirm'));
    fireEvent.click(launch);
    await waitFor(() => expect(api.launch).toHaveBeenCalledWith('c2', null));
  });
  it('the assistant only suggests and saves a draft', async () => {
    api.suggest.mockResolvedValue({ suggestedName: 'We miss you', audience: 'Inactive — never-visited NOT included', liveEligibleEstimate: 3, messageDraft: 'Hi', schedule: 'Tue', estimatedCostCents: null, costNote: 'Not available', risks: ['Consent is checked again'], isSuggestion: true, sends: false });
    api.saveSuggestion.mockResolvedValue({ id: 'c9' }); api.detail.mockResolvedValue({ ...spring, id: 'c9', status: 'draft', displayStatus: 'draft', readiness: { ok: false, code: 'CAMPAIGN_AUDIENCE_NOT_SELECTED', message: 'Choose an audience first.' } });
    mount();
    fireEvent.click(await screen.findByTestId('cc-open-assistant'));
    expect((await screen.findByTestId('cc-a-count')).textContent).toMatch(/3/);
    fireEvent.click(screen.getByTestId('cc-a-save'));
    await waitFor(() => expect(api.saveSuggestion).toHaveBeenCalledWith(expect.objectContaining({ goal: 'inactive' })));
    expect(api.launch).not.toHaveBeenCalled();
  });
});
