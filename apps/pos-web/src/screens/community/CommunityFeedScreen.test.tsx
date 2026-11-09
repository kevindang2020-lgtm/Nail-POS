// CommunityFeedScreen.test.tsx — BUILD_PLAN Phase 8: /community feed through the REAL api client (routed fetch).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { REALTIME_EVENT } from '../../realtime/realtime-client';
import { B, calls, err, installFetch, page, post, sent, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: 'u1' } }) }));
import { CommunityFeedScreen } from './CommunityFeedScreen';

let routes: Record<string, R>;
const defaults = (): Record<string, R> => ({
  [`GET ${B}/feed`]: (c) => ({ body: page([post(), post({ id: 'p2', title: 'Fake gift card balance call', severity: 'critical', following: true })], { page: Number(c.query.get('page') || 1), total: 45, hasMore: true }) }),
  [`GET ${B}/search`]: (c) => (c.query.get('q') === '555-123-4567' ? err(400, 'search_identifier_rejected') : { body: page([post({ id: 'p3', title: 'Gift card trick' })]) }),
});
const renderFeed = () => render(<MemoryRouter initialEntries={['/community']}><Routes><Route path="/community" element={<CommunityFeedScreen />} /><Route path="/community/posts/:id" element={<div data-testid="detail-route" />} /><Route path="/community/new" element={<div data-testid="new-route" />} /></Routes></MemoryRouter>);
beforeEach(() => { perms.deny = new Set(); routes = defaults(); installFetch(routes); });

describe('Safety Community feed', () => {
  it('first load asks for the active feed, newest first, page 1 of 25 (SUNMI Nov 9 2026)', async () => {
    renderFeed();
    expect((await screen.findAllByTestId('community-post-row')).length).toBe(2);
    // the overview card's count read asks for pageSize 1; the feed itself is the 25-per-page read
    expect(Object.fromEntries(sent('GET', `${B}/feed`).find((c) => c.query.get('pageSize') !== '1')!.query)).toEqual({ status: 'active', sort: 'newest', page: '1', pageSize: '25' });
    expect(screen.getByText('Fake gift card balance call')).toBeTruthy();
    expect(screen.getAllByTestId('community-post-row')[1].textContent).toContain('you follow this');
  });
  it('filters, sort and following-only go to the server as query params and reset to page 1', async () => {
    renderFeed();
    await screen.findAllByTestId('community-post-row');
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
    await waitFor(() => expect(sent('GET', `${B}/feed`).some((c) => c.query.get('page') === '2')).toBe(true));
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'phone_scam' } });
    fireEvent.change(screen.getByLabelText('Filter by severity'), { target: { value: 'critical' } });
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'severity' } });
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'resolved' } });
    fireEvent.click(screen.getByLabelText('Following only'));
    await waitFor(() => {
      const l = sent('GET', `${B}/feed`).slice(-1)[0];
      expect(Object.fromEntries(l.query)).toEqual({ category: 'phone_scam', severity: 'critical', sort: 'severity', status: 'resolved', followingOnly: 'true', page: '1', pageSize: '25' });
    });
  });
  it('a text search uses /community/search; an identifier is refused in plain words', async () => {
    renderFeed();
    await screen.findAllByTestId('community-post-row');
    fireEvent.change(screen.getByLabelText('Search advisories'), { target: { value: 'gift card' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Gift card trick')).toBeTruthy();
    expect(sent('GET', `${B}/search`)[0].query.get('q')).toBe('gift card');
    fireEvent.change(screen.getByLabelText('Search advisories'), { target: { value: '555-123-4567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByTestId('community-feed-error')).toHaveTextContent('not by who');
    expect(screen.queryByText('Gift card trick')).toBeNull();
    fireEvent.click(screen.getByText('Clear search'));
    await screen.findByText('Fake gift card balance call');
  });
  it('a post title opens the deep link /community/posts/:id', async () => {
    renderFeed();
    fireEvent.click(await screen.findByRole('link', { name: 'Fake gift card balance call' }));
    expect(await screen.findByTestId('detail-route')).toBeTruthy();
  });
  it('New advisory is hidden without community.advisory.draft', async () => {
    perms.deny = new Set(['community.advisory.draft']);
    renderFeed();
    await screen.findAllByTestId('community-post-row');
    expect(screen.queryByRole('button', { name: 'New advisory' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'My advisories' })).toBeNull();
  });
  it('no community.feed.view → nothing asked of the API', async () => {
    perms.deny = new Set(['community.feed.view']);
    renderFeed();
    expect(screen.getByText(/do not have access/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.path.startsWith(B)).length).toBe(0);
  });
  it('a suspended / disabled community is explained, not blank', async () => {
    routes[`GET ${B}/feed`] = err(403, 'community_disabled');
    renderFeed();
    expect(await screen.findByTestId('community-feed-error')).toHaveTextContent('turned off for your salon');
  });
  it('a community_* realtime event reloads the feed', async () => {
    renderFeed();
    await screen.findAllByTestId('community-post-row');
    const n = sent('GET', `${B}/feed`).length;
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'community_post_updated', screens: ['community'] } })); await new Promise((r) => setTimeout(r, 400)); });
    expect(sent('GET', `${B}/feed`).length).toBeGreaterThan(n);
  });
});
