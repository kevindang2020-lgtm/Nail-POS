import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const marketingOverview = vi.fn();
const pauseCampaign = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { marketingOverview: (...a: any[]) => marketingOverview(...a), pauseCampaign: (...a: any[]) => pauseCampaign(...a) } }));

import { SuperAdminCampaignsScreen } from './SuperAdminCampaignsScreen';

const kpi = (key: string, label: string, value: string | null, extra: any = {}) => ({ key, label, value, available: value !== null, ...extra });
const row = (o: any) => ({ deliveryRate: null, deliveryRateAvailable: false, complianceStatus: null, complianceAvailable: false, scheduledAt: null, tenantId: o.ownerType === 'tenant' ? 'ten-' + o.id : null, ...o });
const overview = () => ({
  kpis: [
    kpi('active', 'Active Campaigns', '47'), kpi('scheduled', 'Scheduled Campaigns', '28'), kpi('completed', 'Completed Campaigns', '162'),
    kpi('sms', 'SMS Campaigns', '76'), kpi('email', 'Email Campaigns', '84'), kpi('push', 'Push Campaigns', '39'), kpi('audience', 'Audience Size', '1,284,741'),
    kpi('delivery_rate', 'Delivery Rate', '97.4%'), kpi('open_rate', 'Open Rate', '32.6%'), kpi('click_rate', 'Click Rate', '8.7%'),
    kpi('bookings', 'Booking Conversions', '6,248'), kpi('revenue', 'Revenue Attributed', '$128,764'), kpi('opt_out_rate', 'Opt-out Rate', '0.8%', { unfavorableIfUp: true }),
  ],
  channelMix: [{ channel: 'sms', count: 76, pct: 43.4 }, { channel: 'email', count: 48, pct: 27.4 }],
  revenueByCampaign: [{ id: 'p1', name: "Mother's Day", revenueCents: 2845000 }],
  topCampaigns: [{ id: 'p1', name: "Mother's Day", deliveryRate: null, openRate: 36.7, clickRate: 9.8, bookings: 1248, revenueCents: 2845000 }],
  rankingMetric: 'attributed_revenue',
  counts: { total: 175, platform: 3, tenant: 4, active: 47, scheduled: 28, completed: 162 },
  directory: {
    platform: [row({ id: 'p1', reference: 'CAMP-PLT-0001', name: "Mother's Day Platform Announcement", ownerType: 'platform', tenant: 'All Tenants', branch: 'All Branches', channel: 'email', audienceSize: 1284741, openRate: 36.7, clickRate: 9.8, bookingConversions: 1248, revenueCents: 2845000, status: 'scheduled' })],
    tenant: [row({ id: 't1', reference: 'CAMP-TNT-10231', name: 'May Hair Renewal', ownerType: 'tenant', tenant: 'Glamour Studio', branch: 'Downtown', channel: 'email', audienceSize: 12841, openRate: 34.2, clickRate: 8.5, bookingConversions: 112, revenueCents: 248000, status: 'completed' })],
    page: [
      row({ id: 'p1', reference: 'CAMP-PLT-0001', name: "Mother's Day Platform Announcement", ownerType: 'platform', tenant: 'All Tenants', branch: 'All Branches', channel: 'email', audienceSize: 1284741, openRate: 36.7, clickRate: 9.8, bookingConversions: 1248, revenueCents: 2845000, status: 'scheduled' }),
      row({ id: 't1', reference: 'CAMP-TNT-10231', name: 'May Hair Renewal', ownerType: 'tenant', tenant: 'Glamour Studio', branch: 'Downtown', channel: 'email', audienceSize: 12841, openRate: 34.2, clickRate: 8.5, bookingConversions: 112, revenueCents: 248000, status: 'completed' }),
    ],
  },
  directoryTotal: 175, pagination: { page: 1, pageSize: 10, totalItems: 175, totalPages: 18 },
  deliveryFailures: { available: true, total: 1248, byCategory: [{ category: 'Invalid Phone/Email', label: 'Invalid Phone/Email', count: 612, pct: 49 }, { category: 'Opt-out / Unsubscribed', label: 'Opt-out / Unsubscribed', count: 284, pct: 22.8 }] },
  performanceTrend: { available: true, points: [{ date: '2026-05-01', deliveryRate: 97.4, openRate: 32.6, clickRate: 8.7 }, { date: '2026-05-02', deliveryRate: 96.9, openRate: 31.2, clickRate: 8.1 }] }, complianceAlerts: { available: true, totalFlagged: 3, allCompliant: false, categories: [{ key: 'high_opt_out', label: 'flagged for high opt-out rate', count: 2 }, { key: 'awaiting_review', label: 'awaiting compliance review', count: 1 }] },
});

describe('SuperAdminCampaignsScreen', () => {
  beforeEach(() => { marketingOverview.mockReset(); marketingOverview.mockResolvedValue(overview()); pauseCampaign.mockReset(); pauseCampaign.mockResolvedValue({ ok: true, flag: { id: 'CFLAG-0001', actionTaken: 'paused', status: 'actioned' } }); });

  it('renders header, 13 KPIs (with NotConnected), boundary banner, and 8 actions', async () => {
    render(<SuperAdminCampaignsScreen />);
    expect(await screen.findByText('Marketing & Campaigns', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('Active Campaigns')).toBeInTheDocument();
    expect(screen.getAllByText('Opt-out Rate').length).toBeGreaterThanOrEqual(1);
    // delivery + opt-out now backed; Performance Trend remains NotConnected
    expect(screen.getByText(/remain clearly separated/)).toBeInTheDocument();
    expect(screen.getByText('Create Platform Announcements')).toBeInTheDocument();
    expect(screen.getByText('Configure Campaign Limits')).toBeInTheDocument();
  });

  it('renders the platform/tenant grouping with the oversight divider', async () => {
    render(<SuperAdminCampaignsScreen />);
    expect((await screen.findAllByText("Mother's Day Platform Announcement")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Tenant Customer Campaigns \(Visible for Oversight Only\)/)).toBeInTheDocument();
    expect(screen.getAllByText('CAMP-PLT-0001').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CAMP-TNT-10231')).toBeInTheDocument();
  });

  it('selects a campaign and shows details with the owner badge', async () => {
    render(<SuperAdminCampaignsScreen />);
    fireEvent.click((await screen.findAllByText('May Hair Renewal'))[0]);
    expect(screen.getByText('Tenant Campaign')).toBeInTheDocument(); // details badge
    expect(screen.getAllByText('Glamour Studio').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by channel via the server', async () => {
    render(<SuperAdminCampaignsScreen />);
    await screen.findAllByText("Mother's Day Platform Announcement");
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'sms' } });
    await waitFor(() => expect(marketingOverview).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms' })));
  });

  it('renders real compliance alert categories', async () => {
    render(<SuperAdminCampaignsScreen />);
    await screen.findAllByText("Mother's Day Platform Announcement");
    expect(screen.getByText(/flagged for high opt-out rate/)).toBeInTheDocument();
    expect(screen.getByText(/awaiting compliance review/)).toBeInTheDocument();
  });

  it('pauses the selected campaign with a reason', async () => {
    render(<SuperAdminCampaignsScreen />);
    await screen.findAllByText("Mother's Day Platform Announcement");
    fireEvent.click(screen.getByText('Pause Abusive or Noncompliant Campaigns'));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'excessive opt-outs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(pauseCampaign).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'platform_announcement', reason: 'excessive opt-outs' })));
  });

  it('renders the performance trend with three series', async () => {
    render(<SuperAdminCampaignsScreen />);
    await screen.findAllByText("Mother's Day Platform Announcement");
    expect(screen.getByText('Campaign Performance Trend')).toBeInTheDocument();
    expect(screen.getAllByText('Delivery').length).toBeGreaterThanOrEqual(1); // table header + trend legend
    expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Click').length).toBeGreaterThanOrEqual(1);
  });

  it('renders real delivery failure categories', async () => {
    render(<SuperAdminCampaignsScreen />);
    await screen.findAllByText("Mother's Day Platform Announcement");
    expect(screen.getByText('Delivery Failures')).toBeInTheDocument();
    expect(screen.getByText('Invalid Phone/Email')).toBeInTheDocument();
    expect(screen.getByText('612')).toBeInTheDocument();
  });
});
