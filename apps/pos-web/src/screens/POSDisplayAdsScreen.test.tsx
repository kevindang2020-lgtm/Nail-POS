// POSDisplayAdsScreen.test.tsx — Marketing & Growth → Customer Display Advertising (23-inch dual-screen spec §48–§78,
// §108–§111). The screen shows the SERVER's statuses and playlist, sends the version it was shown (so a concurrent edit is
// a conflict, not an overwrite), asks before destroying, hides what a branch manager may not do, and never calls a
// display a "view".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { DisplayAdsState, DisplayAdView } from '@aipowersalon/api-contracts/tenant';
import { POSDisplayAdsScreen } from './POSDisplayAdsScreen';

const api = {
  state: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), act: vi.fn(), remove: vi.fn(), uploadMedia: vi.fn(),
  playlist: vi.fn(), analytics: vi.fn(), branchAnalytics: vi.fn(), saveSettings: vi.fn(), saveBranchSettings: vi.fn(), setDevice: vi.fn(),
};
vi.mock('../api/posDisplayAdsApi', () => ({ posDisplayAdsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => (api as any)[k](...a) }), mediaUrl: (u: string) => u }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
const prepare = vi.fn();
vi.mock('./display-ads/adImagePipeline', () => ({ prepareAdImage: (...a: any[]) => prepare(...a) }));

const B1 = 'b1', B2 = 'b2';
const media = { id: 'm1', mimeType: 'image/png', width: 1080, height: 1620, bytes: 52_000, totalBytes: 90_000, thumb: { url: '/media/t.webp', width: 213, height: 320 }, medium: { url: '/media/m.webp', width: 720, height: 1080 }, large: { url: '/media/l.webp', width: 1080, height: 1620 }, suggestedFocalX: 0.4, suggestedFocalY: 0.3, createdAt: '2026-10-05T00:00:00Z' };
const ad = (o: Partial<DisplayAdView>): DisplayAdView => ({
  id: 'a1', version: 3, name: 'Fall pedicure', status: 'ACTIVE', storedStatus: 'published', showingNow: true, media, fullscreenMedia: null,
  headline: 'Deluxe spa pedicure', subheadline: null, description: null, ctaText: null, qr: null, fitMode: 'cover', focalX: 0.5, focalY: 0.5,
  startDate: '2026-10-01', endDate: '2026-11-30', daysOfWeek: [1, 2, 3, 4, 5], dailyStartTime: '10:00', dailyEndTime: '17:00',
  displayDurationSeconds: null, effectiveDurationSeconds: 10, priority: 0, allBranches: false, branchIds: [B1], canManage: true,
  publishedAt: '2026-10-01T12:00:00Z', pausedAt: null, archivedAt: null, createdAt: '2026-09-30T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', ...o,
});
const state = (o: Partial<DisplayAdsState> = {}): DisplayAdsState => ({
  salonName: 'Luxury Nails', availability: { active: true, reason: null, detail: null },
  limits: { maxAds: 50, maxFileBytes: 8 * 1024 * 1024, storageLimitBytes: 500 * 1024 * 1024, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], fullScreenIdleAllowed: true },
  usage: { adCount: 2, storageBytes: 3 * 1024 * 1024 }, canManageAllBranches: true, authorizedBranchIds: [B1, B2],
  branches: [{ id: B1, name: 'Cherry Hill', timeZone: 'America/New_York' }, { id: B2, name: 'Marlton', timeZone: 'America/New_York' }],
  settings: { tenant: { enabled: true, defaultDurationSeconds: 10, fullScreenIdleAdsEnabled: false, fullScreenIdleAfterSeconds: 60 }, branches: { [B1]: { enabled: null, fullScreenIdleAdsEnabled: null }, [B2]: { enabled: null, fullScreenIdleAdsEnabled: null } }, canEditTenant: true },
  ads: [ad({}), ad({ id: 'a2', version: 1, name: 'Gift cards', status: 'DRAFT', storedStatus: 'draft', showingNow: false, allBranches: true, branchIds: [], startDate: null, endDate: null, daysOfWeek: null, dailyStartTime: null, dailyEndTime: null })],
  devices: [{ id: 'd1', name: 'Front desk display', branchId: B1, adsEnabled: true, lastSeenAt: null, lastAdShownAt: null }],
  timeZone: 'America/New_York', now: '2026-10-05T15:00:00Z', ...o,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  prepare.mockReset();
  api.state.mockResolvedValue(state());
});

describe('Customer Display Advertising', () => {
  it('lists the ads with the server\'s status, "showing now", schedule and branches', async () => {
    render(<POSDisplayAdsScreen />);
    const card = (await screen.findByText('Fall pedicure')).closest('[data-testid="dads-card"]') as HTMLElement;
    expect(within(card).getByText('Active')).toBeInTheDocument();
    expect(within(card).getByText('● Showing now')).toBeInTheDocument();
    expect(within(card).getByText(/Mon, Tue, Wed, Thu, Fri · 10:00 AM–5:00 PM/)).toBeInTheDocument();
    expect(within(card).getByText('Cherry Hill')).toBeInTheDocument();
    const draft = screen.getByText('Gift cards').closest('[data-testid="dads-card"]') as HTMLElement;
    expect(within(draft).getByText('Draft')).toBeInTheDocument();
    expect(within(draft).getByText('All branches')).toBeInTheDocument();
    expect(screen.getByText(/2 of 50 ads · 3\.0 of 500 MB images/)).toBeInTheDocument();
  });

  it('publishing sends the version the owner was looking at', async () => {
    api.act.mockResolvedValue(ad({ id: 'a2', name: 'Gift cards', status: 'ACTIVE', storedStatus: 'published', version: 2 }));
    render(<POSDisplayAdsScreen />);
    const draft = (await screen.findByText('Gift cards')).closest('[data-testid="dads-card"]') as HTMLElement;
    fireEvent.click(within(draft).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith('a2', 'publish', 1));
    expect(await screen.findByText(/"Gift cards" is now active and showing/)).toBeInTheDocument();
    expect(api.state).toHaveBeenCalledTimes(2);
  });

  it('archiving a live ad and deleting ask first — nothing happens until confirmed', async () => {
    api.act.mockResolvedValue(ad({ status: 'ARCHIVED', storedStatus: 'archived' }));
    render(<POSDisplayAdsScreen />);
    const card = (await screen.findByText('Fall pedicure')).closest('[data-testid="dads-card"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Archive' }));
    expect(api.act).not.toHaveBeenCalled();
    expect(screen.getByText(/stops showing on every display right away/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith('a1', 'archive', 3));
    // delete: same — the draft's Delete opens the confirmation, Cancel leaves it alone
    const draft = screen.getByText('Gift cards').closest('[data-testid="dads-card"]') as HTMLElement;
    fireEvent.click(within(draft).getByRole('button', { name: 'Delete' }));
    expect(within(screen.getByRole('alertdialog')).getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(draft).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('a2', 1));
  });

  it('a branch manager sees no actions on an ad that also plays elsewhere — and why', async () => {
    api.state.mockResolvedValue(state({ canManageAllBranches: false, authorizedBranchIds: [B1], ads: [ad({ canManage: false, allBranches: true, branchIds: [] })], settings: { ...state().settings, canEditTenant: false } }));
    render(<POSDisplayAdsScreen />);
    const card = (await screen.findByText('Fall pedicure')).closest('[data-testid="dads-card"]') as HTMLElement;
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).getByText(/only the salon owner can change it/)).toBeInTheDocument();
  });

  it('feature not available: says so, and + ADD ADVERTISEMENT is disabled', async () => {
    api.state.mockResolvedValue(state({ availability: { active: false, reason: 'NOT_ENTITLED', detail: 'Not in this salon\'s plan.' } }));
    render(<POSDisplayAdsScreen />);
    expect(await screen.findByText(/not available for your salon — Not in this salon's plan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ ADD ADVERTISEMENT' })).toBeDisabled();
  });

  it('§108 analytics counts DISPLAYS, and says plainly that is not a view', async () => {
    api.analytics.mockResolvedValue({ days: 30, since: '2026-09-05T00:00:00Z', branchId: null, totals: { active: 1, scheduled: 0, expired: 0, paused: 0, drafts: 1, displayCount: 1234, displaySeconds: 12_340, devicesShowingNow: 1, displaysRegistered: 2 }, byAd: [{ adId: 'a1', name: 'Fall pedicure', displayCount: 1234, displaySeconds: 12_340, lastShownAt: null }], byBranch: [{ branchId: B1, name: 'Cherry Hill', displayCount: 1234, displaySeconds: 12_340, displays: 1, devicesShowingNow: 1 }] });
    render(<POSDisplayAdsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Analytics' }));
    expect(await screen.findAllByText('1,234')).not.toHaveLength(0);
    expect(screen.getByText(/does not mean a customer looked at it/)).toBeInTheDocument();
    expect(screen.queryByText(/\bviews?\b/i)).toBeNull();   // ("Preview" is a tab, not a claim)
    expect(api.analytics).toHaveBeenCalledWith(30);
    expect(api.branchAnalytics).not.toHaveBeenCalled();
  });

  it('settings: an owner saves salon-wide; a manager cannot touch them', async () => {
    api.saveSettings.mockResolvedValue(state().settings);
    const { unmount } = render(<POSDisplayAdsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Default display time per ad'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ enabled: true, defaultDurationSeconds: 15, fullScreenIdleAdsEnabled: false, fullScreenIdleAfterSeconds: 60 }));
    unmount();
    api.state.mockResolvedValue(state({ settings: { ...state().settings, canEditTenant: false } }));
    render(<POSDisplayAdsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    expect(screen.getByText('Only the salon owner can change these.')).toBeInTheDocument();
    expect(screen.getByLabelText('Default display time per ad')).toBeDisabled();
  });

  it('the playlist tab shows what the display plays — or why it plays nothing', async () => {
    api.playlist.mockResolvedValue({ enabled: false, offReason: 'disabled_for_branch', ads: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, playlistVersion: 'x', generatedAt: '', refreshAfterSeconds: 900 });
    render(<POSDisplayAdsScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Playlist' }));
    expect(await screen.findByText(/turned off for this branch/)).toBeInTheDocument();
    expect(api.playlist).toHaveBeenCalledWith(B1);
  });

  it('§53 simple mode: upload → the name fills itself → Publish now (create, then publish)', async () => {
    prepare.mockResolvedValue({ form: new FormData(), width: 1080, height: 1620, focalX: 0.4, focalY: 0.3, previewUrl: 'blob:x', warnings: [] });
    api.uploadMedia.mockResolvedValue(media);
    api.create.mockResolvedValue(ad({ id: 'a9', version: 1, name: 'fall promo', status: 'DRAFT', storedStatus: 'draft', showingNow: false }));
    api.act.mockResolvedValue(ad({ id: 'a9', version: 2, name: 'fall promo' }));
    globalThis.URL.revokeObjectURL = vi.fn();
    render(<POSDisplayAdsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: '+ ADD ADVERTISEMENT' }));
    const dialog = screen.getByRole('dialog', { name: '+ Add advertisement' });
    expect(within(dialog).getByRole('button', { name: 'Publish now' })).toBeDisabled();   // no image yet
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'fall_promo.png', { type: 'image/png' });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalled());
    expect(await within(dialog).findByDisplayValue('fall promo')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(api.act).toHaveBeenCalledWith('a9', 'publish', 1));
    expect(api.create.mock.calls[0][0]).toMatchObject({ name: 'fall promo', mediaId: 'm1', headline: null, allBranches: true, branchIds: [], qr: null, displayDurationSeconds: null });
    expect(await screen.findByText(/"fall promo" is published and showing now/)).toBeInTheDocument();
  });

  it('a concurrent edit is a conflict with a way to reload — never a silent overwrite', async () => {
    api.update.mockRejectedValue(Object.assign(new Error('Someone else changed this advertisement. Refresh and try again.'), { code: 'VERSION_CONFLICT' }));
    api.get.mockResolvedValue(ad({ version: 4, name: 'Fall pedicure (edited)' }));
    render(<POSDisplayAdsScreen />);
    const card = (await screen.findByText('Fall pedicure')).closest('[data-testid="dads-card"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit advertisement' });
    fireEvent.change(within(dialog).getByLabelText('Ad name (only you see this)'), { target: { value: 'Mine' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('a1', expect.objectContaining({ name: 'Mine', expectedVersion: 3 })));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Reload latest' }));
    expect(await within(dialog).findByDisplayValue('Fall pedicure (edited)')).toBeInTheDocument();
  });
});
