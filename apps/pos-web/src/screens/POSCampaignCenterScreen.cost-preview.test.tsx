// Campaign Center — wave 3 PAYI §81: Activate on a large SMS campaign shows the server's cost preview (recipients,
// opted-out, segments, cost) and sends only after an explicit inline confirmation; a small campaign activates directly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { m } = vi.hoisted(() => ({ m: { getState: vi.fn(), create: vi.fn(), schedule: vi.fn(), activate: vi.fn(), complete: vi.fn(), cancel: vi.fn(), costPreview: vi.fn() } }));
vi.mock('../api/posCampaignsApi', () => ({ posCampaignsApi: m }));
import { POSCampaignCenterScreen } from './POSCampaignCenterScreen';

const state = (audienceSize: number) => ({
  kpis: { totalCampaigns: 1, activeCampaigns: 0, totalSent: 0, campaignRevenueCents: 0, avgRoi: 0, avgOpenRate: 0 },
  campaigns: [{ id: 'c1', name: 'Fall Gel', offer: '20% off', channel: 'sms', audienceLabel: 'Lapsed', audienceSize, status: 'draft', sentCount: 0, openRate: 0, clickRate: 0, replyRate: 0, bookingCount: 0, revenueCents: 0, roi: 0 }],
  pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
});
const preview = (over: Record<string, unknown> = {}) => ({ campaignId: 'c1', channel: 'sms', recipients: 400, optedOut: 25, deliverable: 375, segmentsPerMessage: 1, encoding: 'GSM-7', estimatedSegments: 375, includedRemaining: null, estimatedOverageSegments: 375, unitPriceCents: 2, estimatedCostCents: 750, requiresConfirmation: true, confirmationThreshold: 50, ...over });
beforeEach(() => { for (const f of Object.values(m)) (f as any).mockReset(); m.activate.mockResolvedValue({}); });

describe('campaign cost preview + confirmation', () => {
  it('a large SMS campaign: Activate shows the preview, nothing is sent until "Confirm and send"', async () => {
    m.getState.mockResolvedValue(state(400)); m.costPreview.mockResolvedValue(preview());
    render(<MemoryRouter><POSCampaignCenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Activate'));
    const dlg = await screen.findByRole('alertdialog', { name: 'Confirm campaign cost' });
    expect(dlg.textContent).toMatch(/375/); expect(dlg.textContent).toMatch(/25 opted out/); expect(dlg.textContent).toMatch(/375 segments/); expect(dlg.textContent).toMatch(/\$7\.50/);
    expect(m.activate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm and send'));
    await waitFor(() => expect(m.activate).toHaveBeenCalledWith('c1', { confirmEstimate: true }));
  });
  it('an unpriced platform says so instead of inventing a cost', async () => {
    m.getState.mockResolvedValue(state(400)); m.costPreview.mockResolvedValue(preview({ unitPriceCents: null, estimatedCostCents: null, estimatedOverageSegments: null }));
    render(<MemoryRouter><POSCampaignCenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Activate'));
    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/not priced yet/);
  });
  it('a small campaign activates directly (the preview does not require confirmation)', async () => {
    m.getState.mockResolvedValue(state(20)); m.costPreview.mockResolvedValue(preview({ recipients: 20, deliverable: 20, estimatedSegments: 20, requiresConfirmation: false }));
    render(<MemoryRouter><POSCampaignCenterScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Activate'));
    await waitFor(() => expect(m.activate).toHaveBeenCalledWith('c1', { confirmEstimate: false }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
