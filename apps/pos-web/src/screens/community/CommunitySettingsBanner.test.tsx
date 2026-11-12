// CommunitySettingsBanner.test.tsx — BUILD_PLAN Phase 8: /community/settings (salon settings CAS save, technician grant,
// read-only for non-managers, follows, analytics) and the shell-level emergency banner (dismiss per user, storage-safe).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { B, calls, err, installFetch, sent, settings, author, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
const who = { userId: 'u1' };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: who.userId } }) }));
import { CommunitySettingsScreen } from './CommunitySettingsScreen';
import { CommunityEmergencyBanner, dismissKey } from './CommunityEmergencyBanner';

let routes: Record<string, R>;
const alert = (o: any = {}) => ({ postId: 'p1', title: 'Fake processor calls asking for codes', severity: 'critical', category: 'account_takeover_attempt', publishedAt: '2026-10-08T12:00:00Z', author: author(), ...o });
beforeEach(() => {
  perms.deny = new Set(); who.userId = 'u1';
  try { localStorage.clear(); } catch { /* */ }
  routes = {
    [`GET ${B}/settings`]: { body: settings() },
    [`PUT ${B}/settings`]: (c) => ({ body: settings({ ...c.body, version: 5 }) }),
    [`GET ${B}/follows`]: { body: [{ id: 'f1', category: 'phone_scam', region: 'NJ', severityMin: 'high', channels: ['in_app', 'push'] }] },
    [`POST ${B}/follows`]: (c) => ({ body: { id: 'f2', ...c.body } }),
    [`DELETE ${B}/follows/f1`]: { body: { ok: true } },
    [`GET ${B}/analytics`]: { body: { from: '2026-09-08', to: '2026-10-08', posts: { published_unverified: 2 }, published: 2, comments: 5, similarReports: 1, followers: 7, avgHoursToPublish: 3.25, topCategories: [{ category: 'phone_scam', count: 2 }] } },
    [`GET ${B}/alerts/active`]: { body: [alert(), alert({ postId: 'p2', title: 'Gift card refund pressure', severity: 'high' })] },
  };
  installFetch(routes);
});
afterEach(() => vi.restoreAllMocks());

describe('community settings', () => {
  const renderIt = () => render(<MemoryRouter><CommunitySettingsScreen /></MemoryRouter>);
  it('saves with expectedVersion and the changed fields; the technician toggle becomes a view_community grant', async () => {
    renderIt();
    const box = await screen.findByTestId('community-salon-settings');
    fireEvent.click(within(box).getByLabelText("Managers' advisories need a second approval"));
    fireEvent.click(within(box).getByLabelText('Technicians can read the Safety Community'));
    fireEvent.change(within(box).getByLabelText('Community display name'), { target: { value: 'A Cherry Hill salon' } });
    fireEvent.click(within(box).getByLabelText('SMS for critical alerts'));
    fireEvent.click(within(box).getByLabelText('Phone scam'));
    fireEvent.click(screen.getByRole('button', { name: 'Save community settings' }));
    await waitFor(() => expect(sent('PUT', `${B}/settings`).length).toBe(1));
    expect(sent('PUT', `${B}/settings`)[0].body).toMatchObject({
      expectedVersion: 4, managerApprovalRequired: true, displayName: 'A Cherry Hill salon',
      roleGrants: { technician: ['view_community'] }, notify: { categories: ['phone_scam'], push: true, email: false, criticalSms: true },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('saved');
  });
  it('a 409 reloads the settings and says so', async () => {
    routes[`PUT ${B}/settings`] = err(409, 'version_conflict');
    renderIt();
    await screen.findByTestId('community-salon-settings');
    const n = sent('GET', `${B}/settings`).length;
    fireEvent.click(screen.getByRole('button', { name: 'Save community settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this');
    expect(sent('GET', `${B}/settings`).length).toBeGreaterThan(n);
  });
  it('without settings.manage: read only, no save, no analytics', async () => {
    perms.deny = new Set(['community.settings.manage']);
    renderIt();
    const box = await screen.findByTestId('community-salon-settings');
    expect(within(box).getByLabelText('Take part in the Safety Community')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save community settings' })).toBeNull();
    expect(screen.queryByTestId('community-analytics')).toBeNull();
    expect(calls.some((c) => c.path === `${B}/analytics`)).toBe(false);
  });
  it('follows: list, add (category / region / severity / channels), stop following', async () => {
    renderIt();
    expect(await screen.findByTestId('community-follow-row')).toHaveTextContent('Phone scam · NJ · High and above');
    fireEvent.change(screen.getByLabelText('Follow category'), { target: { value: 'gift_card_scam' } });
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'moderate' } });
    fireEvent.click(within(screen.getByTestId('community-follows')).getByLabelText('Email'));
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(sent('POST', `${B}/follows`)[0]?.body).toEqual({ category: 'gift_card_scam', region: null, severityMin: 'moderate', channels: ['in_app', 'email'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop following' }));
    await waitFor(() => expect(sent('DELETE', `${B}/follows/f1`).length).toBe(1));
  });
  it('analytics for the last 30 days', async () => {
    renderIt();
    const a = await screen.findByTestId('community-analytics');
    await waitFor(() => expect(a).toHaveTextContent('3.3'));
    expect(a).toHaveTextContent('Phone scam (2)');
    const q = sent('GET', `${B}/analytics`)[0].query;
    expect(q.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.queryByTestId('community-alert-preview')).toBeNull();   // an older server sends no preview: nothing invented
  });
  it('extras Safety Community 07 — the alert preview shows the server\'s counts by reason, channel, severity and category; off says so', async () => {
    const preview = { communityEnabled: true, considered: 5, wouldReceive: 3, truncated: false, byReason: { critical: 1, follow: 1, category: 1, default: 0 },
      channels: { inApp: 3, push: 3, email: 2, sms: 1 }, bySeverity: [{ severity: 'critical', count: 1 }, { severity: 'high', count: 1 }], byCategory: [{ category: 'phone_scam', count: 2 }] };
    routes[`GET ${B}/analytics`] = { body: { from: '2026-09-08', to: '2026-10-08', posts: {}, published: 0, comments: 0, similarReports: 0, followers: 0, avgHoursToPublish: null, topCategories: [], alertPreview: preview } };
    const { unmount } = renderIt();
    const p = await screen.findByTestId('community-alert-preview');
    expect(p).toHaveTextContent('3 of the 5 advisories other salons published would have reached us.');
    expect(p).toHaveTextContent('Critical (always sent): 1 · Matched a follow: 1 · A category we chose: 1 · No preferences set (we hear everything): 0');
    expect(p).toHaveTextContent('In-app: 3 · Push: 3 · Email: 2 · Text (critical only): 1');
    expect(p).toHaveTextContent('Critical 1 · High 1');
    expect(p).toHaveTextContent('Phone scam (2)');
    expect(p).toHaveTextContent('nothing is sent');
    unmount();
    routes[`GET ${B}/analytics`] = { body: { from: '2026-09-08', to: '2026-10-08', posts: {}, published: 0, comments: 0, similarReports: 0, followers: 0, avgHoursToPublish: null, topCategories: [],
      alertPreview: { ...preview, communityEnabled: false, wouldReceive: 0 } } };
    renderIt();
    const off = await screen.findByTestId('community-alert-preview');
    expect(off).toHaveTextContent('Safety Community is off for this salon, so no alerts would arrive.');
    expect(off).not.toHaveTextContent('would have reached us');
  });
});

describe('emergency banner', () => {
  const renderIt = () => render(<MemoryRouter><CommunityEmergencyBanner /></MemoryRouter>);
  it('shows the most severe active alert with a link to the post and "+1 more"', async () => {
    renderIt();
    const b = await screen.findByTestId('community-emergency-banner');
    expect(b).toHaveTextContent('Critical safety alert:');
    expect(b).toHaveTextContent('+1 more');
    expect(within(b).getByRole('link', { name: 'View advisory' })).toHaveAttribute('href', '/community/posts/p1');
  });
  it('dismiss is remembered per user', async () => {
    const { unmount } = renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss alert: Fake processor calls asking for codes' }));
    expect(await screen.findByText(/Gift card refund pressure/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(dismissKey('u1'))!)).toEqual(['p1']);
    unmount();
    renderIt();
    expect(await screen.findByText(/Gift card refund pressure/)).toBeTruthy();       // still dismissed for u1
    expect(screen.queryByText(/Fake processor calls/)).toBeNull();
  });
  it('another user on the same POS still sees the dismissed alert', async () => {
    localStorage.setItem(dismissKey('u1'), JSON.stringify(['p1']));
    who.userId = 'u2';
    renderIt();
    expect(await screen.findByText(/Fake processor calls asking for codes/)).toBeTruthy();
  });
  it('blocked storage never breaks it (dismiss still hides it for now)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss alert: Fake processor calls asking for codes' }));
    expect(await screen.findByText(/Gift card refund pressure/)).toBeTruthy();
  });
  it('hidden without permission (no call), on a 403, and when everything is dismissed', async () => {
    perms.deny = new Set(['community.feed.view']);
    const r1 = renderIt();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(0);
    expect(screen.queryByTestId('community-emergency-banner')).toBeNull();
    r1.unmount();
    perms.deny = new Set();
    routes[`GET ${B}/alerts/active`] = err(403, 'permission_denied');
    const r2 = renderIt();
    await waitFor(() => expect(sent('GET', `${B}/alerts/active`).length).toBe(1));
    expect(screen.queryByTestId('community-emergency-banner')).toBeNull();
    r2.unmount();
    routes[`GET ${B}/alerts/active`] = { body: [alert()] };
    localStorage.setItem(dismissKey('u1'), JSON.stringify(['p1']));
    renderIt();
    await waitFor(() => expect(sent('GET', `${B}/alerts/active`).length).toBe(2));
    expect(screen.queryByTestId('community-emergency-banner')).toBeNull();
  });
});
