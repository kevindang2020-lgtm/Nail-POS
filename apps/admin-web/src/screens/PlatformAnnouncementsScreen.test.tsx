// PlatformAnnouncementsScreen — Super Admin POS Top-Bar Announcement mandate (Oct 22 2026) §14–§20, §50–§60, §118–§121,
// §128–§133: history with status filter + search, create a draft (nothing is published by saving), the header preview at
// 1920 and 1366, the confirmation for every-salon and high / critical messages, the selected-salon picker, version
// conflicts shown as the server's message, and pause / archive / duplicate sending the current version.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api/superAdminPlatformAnnouncementsApi', () => ({ platformAnnouncementsApi: {
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), publish: vi.fn(), pause: vi.fn(), resume: vi.fn(), archive: vi.fn(), duplicate: vi.fn(), tenants: vi.fn(), branches: vi.fn(),
} }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemStatusOverview: vi.fn() } }));
import { platformAnnouncementsApi as api } from '../api/superAdminPlatformAnnouncementsApi';
import { superAdminApi } from '../api/superAdminApi';
import { PlatformAnnouncementsScreen, HeaderPreview, suggestionsFromStatus } from './PlatformAnnouncementsScreen';

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ROW = { id: 'n1', title: null, message: 'Scheduled update tonight 11 PM – 11:15 PM.', type: 'update', priority: 'normal', audience: 'all_tenants', status: 'active', targetCount: 0,
  titleVi: null, messageVi: null, englishOnly: false, viReviewedBy: null, viReviewedAt: null, vietnamese: 'none', critical: false,
  startsAt: null, endsAt: null, updatedAt: '2026-10-22T10:00:00Z', publishedAt: '2026-10-22T10:00:00Z', version: 3 };
const DETAIL = (over: Record<string, unknown> = {}) => ({ ...ROW, dismissible: true, requiresAcknowledgement: false, contentVersion: 1, surfaces: ['pos'], createdAt: '2026-10-22T09:00:00Z',
  pausedAt: null, archivedAt: null, duplicatedFrom: null, targets: [], revisions: [{ version: 1, action: 'created', at: '2026-10-22T09:00:00Z', actorId: 'a1b2c3d4-0000' }, { version: 3, action: 'published', at: '2026-10-22T10:00:00Z', actorId: null }],
  stats: { delivered: 12, dismissed: 2, acknowledged: 0, tenantsReached: 4 }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  m.list.mockResolvedValue({ items: [ROW], total: 1, page: 1, pageSize: 25 });
  m.tenants.mockResolvedValue({ items: [{ id: 't1', name: 'Glow Nail Spa', code: 'GLOW', branches: 2 }, { id: 't2', name: 'Luxe Nails', code: 'LUXE', branches: 1 }], total: 2, page: 1, pageSize: 10 });
});
const newDraft = async () => { render(<PlatformAnnouncementsScreen />); await screen.findByText(ROW.message); fireEvent.click(screen.getByRole('button', { name: 'New Announcement' })); return screen.getByTestId('announcement-editor'); };

describe('PlatformAnnouncementsScreen', () => {
  it('§128 lists the history and filters by status on the server', async () => {
    render(<PlatformAnnouncementsScreen />);
    expect(await screen.findByText(ROW.message)).toBeInTheDocument();
    expect(screen.getByText('All tenants')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Paused' }));
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'paused', page: 1 })));
    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: 'Glow' } });
    await waitFor(() => expect(m.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Glow' })));
  });

  it('§14 / §118 saving creates a DRAFT, and the preview shows the message in a POS header at 1920 and 1366', async () => {
    m.create.mockResolvedValue(DETAIL({ status: 'draft', version: 1 }));
    const ed = await newDraft();
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'Card terminal maintenance at 3 PM.' } });
    for (const w of [1920, 1366]) expect(within(screen.getByTestId(`preview-${w}`)).getByText('Card terminal maintenance at 3 PM.')).toBeInTheDocument();
    expect(within(screen.getByTestId('preview-1920')).queryByText('More')).toBeNull();
    fireEvent.click(within(ed).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ message: 'Card terminal maintenance at 3 PM.', audience: 'all_tenants', tenantIds: null, branchIds: null, expectedVersion: null })));
    expect(m.publish).not.toHaveBeenCalled();
    expect(await screen.findByText(/Saved as a draft/)).toBeInTheDocument();
  });

  it('§32 a long message previews clamped with More', async () => {
    const ed = await newDraft();
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'x '.repeat(200) } });
    expect(within(screen.getByTestId('preview-1366')).getByText('More')).toBeInTheDocument();
    expect(within(ed).getByText('400 / 2,000')).toBeInTheDocument();
  });

  it('§120–§121 every salon + critical needs BOTH confirmations before Publish now is enabled, and sends confirm: true', async () => {
    m.create.mockResolvedValue(DETAIL({ status: 'draft', version: 1 }));
    m.publish.mockResolvedValue(DETAIL({ status: 'active', version: 2, priority: 'critical' }));
    const ed = await newDraft();
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'Payments are down — use cash.' } });
    fireEvent.change(within(ed).getByLabelText('Priority'), { target: { value: 'critical' } });
    expect((within(ed).getByLabelText(/Staff may dismiss it/) as HTMLInputElement).checked).toBe(false);   // critical defaults to non-dismissible
    fireEvent.click(within(ed).getAllByRole('button', { name: 'Publish now' })[0]);
    const confirm = screen.getByTestId('publish-confirm');
    const go = within(confirm).getByRole('button', { name: 'Publish now' });
    expect(go).toBeDisabled();
    fireEvent.click(within(confirm).getByLabelText(/every salon/));
    expect(go).toBeDisabled();
    fireEvent.click(within(confirm).getByLabelText(/critical message/));
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(m.publish).toHaveBeenCalledWith('n1', expect.objectContaining({ confirm: true, publishNow: true, expectedVersion: 1 })));
    expect(await screen.findByText(/Published — matching POS screens/)).toBeInTheDocument();
  });

  it('§53 Selected Tenants: the picker searches salons on the server and sends the chosen tenant ids', async () => {
    m.create.mockResolvedValue(DETAIL({ status: 'draft', version: 1, audience: 'selected_tenants' }));
    const ed = await newDraft();
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'Your payment setup needs one more step.' } });
    fireEvent.click(within(ed).getByLabelText(/Selected Tenants/));
    fireEvent.click(await within(ed).findByLabelText(/Glow Nail Spa/));
    expect(within(ed).getByText('1 salon chosen')).toBeInTheDocument();
    fireEvent.change(within(ed).getByLabelText('Search salons'), { target: { value: 'luxe' } });
    await waitFor(() => expect(m.tenants).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'luxe' })));
    fireEvent.click(within(ed).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ audience: 'selected_tenants', tenantIds: ['t1'] })));
  });

  it('§63 a version conflict shows the server\'s message and changes nothing', async () => {
    m.get.mockResolvedValue(DETAIL({ status: 'draft' }));
    m.update.mockRejectedValue(Object.assign(new Error('Someone else changed this announcement — reload it.'), { code: 'PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT' }));
    render(<PlatformAnnouncementsScreen />);
    fireEvent.click(await screen.findByText(ROW.message));
    const ed = await screen.findByTestId('announcement-editor');
    fireEvent.click(within(ed).getByRole('button', { name: 'Save changes' }));
    expect(await within(ed).findByRole('alert')).toHaveTextContent('Someone else changed this announcement');
    expect(m.update).toHaveBeenCalledWith('n1', expect.objectContaining({ expectedVersion: 3 }));
  });

  it('§18 / §20 / §130 an active announcement offers Pause, Archive and Duplicate with the current version; stats and history show', async () => {
    m.get.mockResolvedValue(DETAIL());
    m.pause.mockResolvedValue(DETAIL({ status: 'paused', version: 4 }));
    render(<PlatformAnnouncementsScreen />);
    fireEvent.click(await screen.findByText(ROW.message));
    const ed = await screen.findByTestId('announcement-editor');
    expect(within(ed).getByText(/Delivered to 12 employees in 4 salons · 2 dismissed · 0 acknowledged/)).toBeInTheDocument();
    expect(within(ed).getByText('Version history (2)')).toBeInTheDocument();
    expect(within(ed).queryByRole('button', { name: 'Publish now' })).toBeNull();
    fireEvent.click(within(ed).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(m.pause).toHaveBeenCalledWith('n1', 3));
    expect(await within(ed).findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(within(ed).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(within(ed).getByRole('button', { name: 'Duplicate to draft' })).toBeInTheDocument();
  });
});

// English + Vietnamese POS mandate WP-F (§56–§57): the Super Admin (English UI) writes an optional Vietnamese version,
// marks it reviewed or chooses English only, and previews what a Vietnamese POS will show.
describe('PlatformAnnouncementsScreen — Vietnamese version (WP-F)', () => {
  it('writes the Vietnamese title / message, previews it as a Vietnamese POS shows it, and sends the review tick', async () => {
    m.create.mockResolvedValue(DETAIL({ status: 'draft', version: 1 }));
    const ed = await newDraft();
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'Card terminal maintenance at 3 PM.' } });
    const viPreview = () => screen.getByTestId('preview-1920-vi');
    expect(within(viPreview()).getByText('Card terminal maintenance at 3 PM.')).toBeInTheDocument();   // no VI yet → English
    expect(screen.getByText(/no Vietnamese version — a Vietnamese POS shows the English/)).toBeInTheDocument();
    const vi = within(ed).getByTestId('announcement-vietnamese');
    fireEvent.change(within(vi).getByLabelText('Vietnamese title'), { target: { value: 'Bảo trì' } });
    fireEvent.change(within(vi).getByLabelText('Vietnamese message'), { target: { value: 'Máy quẹt thẻ bảo trì lúc 3 giờ chiều.' } });
    expect(within(viPreview()).getByText('Máy quẹt thẻ bảo trì lúc 3 giờ chiều.')).toBeInTheDocument();
    expect(viPreview()).toHaveAttribute('lang', 'vi');
    expect(within(screen.getByTestId('preview-1920')).getByText('Card terminal maintenance at 3 PM.')).toBeInTheDocument();   // the English preview is unchanged
    fireEvent.click(within(vi).getByLabelText(/Vietnamese reviewed/));
    fireEvent.click(within(ed).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ titleVi: 'Bảo trì', messageVi: 'Máy quẹt thẻ bảo trì lúc 3 giờ chiều.', englishOnly: false, viReviewed: true })));
  });
  it('editing any text clears the review tick; English only clears and hides the Vietnamese fields', async () => {
    const ed = await newDraft();
    const vi = within(ed).getByTestId('announcement-vietnamese');
    fireEvent.change(within(vi).getByLabelText('Vietnamese message'), { target: { value: 'Xin chào' } });
    const tick = within(vi).getByLabelText(/Vietnamese reviewed/) as HTMLInputElement;
    fireEvent.click(tick); expect(tick.checked).toBe(true);
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'Hello again' } });
    expect((within(vi).getByLabelText(/Vietnamese reviewed/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(vi).getByLabelText(/English only/));
    expect(within(vi).queryByLabelText('Vietnamese message')).toBeNull();
    m.create.mockResolvedValue(DETAIL({ status: 'draft', version: 1 }));
    fireEvent.click(within(ed).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ titleVi: null, messageVi: null, englishOnly: true })));
  });
  it('a critical notice says it needs a reviewed Vietnamese version or English only; the server refusal is shown as its message', async () => {
    m.create.mockResolvedValue(DETAIL({ status: 'draft', version: 1, type: 'maintenance' }));
    m.update.mockResolvedValue(DETAIL({ status: 'draft', version: 1, type: 'maintenance' }));
    m.publish.mockRejectedValue(Object.assign(new Error('A maintenance, warning, urgent or critical announcement needs a reviewed Vietnamese version — or mark it English only.'), { code: 'PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED' }));
    const ed = await newDraft();
    fireEvent.change(within(ed).getByLabelText('Message'), { target: { value: 'Maintenance at 3 PM.' } });
    fireEvent.change(within(ed).getByLabelText('Type'), { target: { value: 'maintenance' } });
    expect(within(ed).getByRole('note')).toHaveTextContent(/needs a reviewed Vietnamese version — or tick English only/);
    fireEvent.click(within(within(ed).getByTestId('announcement-vietnamese')).getByLabelText(/English only/));
    expect(within(ed).queryByRole('note')).toBeNull();
  });
  it('the history shows each announcement\'s language state', async () => {
    m.list.mockResolvedValue({ items: [{ ...ROW, vietnamese: 'reviewed' }, { ...ROW, id: 'n2', message: 'Other', vietnamese: 'english_only' }, { ...ROW, id: 'n3', message: 'Third', vietnamese: 'unreviewed' }], total: 3, page: 1, pageSize: 25 });
    render(<PlatformAnnouncementsScreen />);
    expect(await screen.findByText('EN + VI')).toBeInTheDocument();
    expect(screen.getByText('English only')).toBeInTheDocument();
    expect(screen.getByText('VI not reviewed')).toBeInTheDocument();
  });
});

// Oct 27 2026 — §60 Creator column, §34 no emoji in the preview, §84 System Status suggestions (never auto-published).
describe('PlatformAnnouncementsScreen — Oct 27 additions', () => {
  it('§60 the list shows who created each announcement', async () => {
    m.list.mockResolvedValue({ items: [{ ...ROW, createdBy: 'aaaaaaaa-1111-4111-8111-111111111111', createdByName: 'Kevin Dang' }, { ...ROW, id: 'n2', message: 'Other', createdBy: null, createdByName: null }], total: 2, page: 1, pageSize: 25 });
    render(<PlatformAnnouncementsScreen />);
    expect(await screen.findByRole('columnheader', { name: 'Created by' })).toBeInTheDocument();
    const cells = screen.getAllByTestId('created-by').map((c) => c.textContent);
    expect(cells).toEqual(['Kevin Dang', '—']);
  });
  it('§34 the header preview draws its bell / mail / close with the icon library — no emoji', () => {
    const d = { id: null, version: null, title: '', message: 'Hello', type: 'info', priority: 'normal', audience: 'all_tenants', tenants: [], branches: [], startsAt: '', endsAt: '', dismissible: true, requiresAck: false, titleVi: '', messageVi: '', englishOnly: false, viReviewed: false, viReviewedSaved: false } as never;
    const { container } = render(<HeaderPreview d={d} width={1920} />);
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2709\u2715]/u);
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
  });
  it('§84 suggestions map incidents / maintenance to drafts (severity → type and priority)', () => {
    const g = suggestionsFromStatus({
      activeIncidents: [{ incidentId: 'INC-1', service: 'Card payments', severity: 'critical', status: 'investigating', startedAt: '2026-10-27T10:00:00Z', affectedTenants: 4 }],
      scheduledMaintenance: [{ service: 'Booking', scope: 'all', windowStart: '2026-10-28T03:00:00Z', windowEnd: '2026-10-28T03:30:00Z', tenantImpact: 0, noticeStatus: 'draft', owner: 'ops' }],
    });
    expect(g).toHaveLength(2);
    expect(g[0].draft).toMatchObject({ type: 'urgent', priority: 'critical', audience: 'all_tenants', title: 'Card payments', dismissible: false });
    expect(g[1].draft).toMatchObject({ type: 'maintenance', priority: 'normal', title: 'Scheduled maintenance' });
    expect(suggestionsFromStatus(null)).toEqual([]);
  });
  it('§84 picking a suggestion only prefills the editor — nothing is created or published', async () => {
    vi.mocked(superAdminApi.systemStatusOverview).mockResolvedValue({ activeIncidents: [{ incidentId: 'INC-1', service: 'Card payments', severity: 'high', status: 'investigating', startedAt: 'x', affectedTenants: 1 }], scheduledMaintenance: [] } as never);
    render(<PlatformAnnouncementsScreen />);
    await screen.findByText(ROW.message);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest from System Status' }));
    const box = await screen.findByTestId('status-suggestions');
    expect(box).toHaveTextContent(/nothing is published until you review it/);
    fireEvent.click(within(box).getByRole('button', { name: /Incident · Card payments/ }));
    const ed = screen.getByTestId('announcement-editor');
    expect((within(ed).getByLabelText('Type') as HTMLSelectElement).value).toBe('warning');
    expect(ed.textContent).toContain('affecting Card payments');
    expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.publish).not.toHaveBeenCalled();
  });
});
