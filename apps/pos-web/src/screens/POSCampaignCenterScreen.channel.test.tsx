import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { getStateMock } = vi.hoisted(() => ({ getStateMock: vi.fn() }));
vi.mock('../api/posCampaignsApi', () => ({ posCampaignsApi: { getState: getStateMock, create: vi.fn(), schedule: vi.fn(), activate: vi.fn(), complete: vi.fn(), cancel: vi.fn() } }));
import { POSCampaignCenterScreen } from './POSCampaignCenterScreen';
beforeEach(() => { getStateMock.mockReset(); getStateMock.mockResolvedValue({ kpis: { totalCampaigns: 0, activeCampaigns: 0, totalSent: 0, campaignRevenueCents: 0, avgRoi: 0, avgOpenRate: 0 }, campaigns: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } }); });

describe('POSCampaignCenterScreen defaultChannel', () => {
  it('pre-filters the campaign list to the given channel (sms)', async () => {
    render(<MemoryRouter><POSCampaignCenterScreen defaultChannel="sms" /></MemoryRouter>);
    await waitFor(() => expect(getStateMock).toHaveBeenCalled());
    expect(getStateMock.mock.calls.some((c) => c[0]?.channel === 'sms')).toBe(true);
  });
  it('defaults to all channels when no prop (unchanged behavior)', async () => {
    render(<MemoryRouter><POSCampaignCenterScreen /></MemoryRouter>);
    await waitFor(() => expect(getStateMock).toHaveBeenCalled());
    expect(getStateMock.mock.calls.every((c) => c[0]?.channel === undefined)).toBe(true);
  });
});
