// CommunityDraftsIncidents.test.tsx — BUILD_PLAN Phase 8: /community/drafts (my lists by kind + appeals) and
// /community/incidents (private incidents, notes on demand, "Create advisory from this").
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { B, installFetch, myPost, page, sent, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: 'u1' } }) }));
import { CommunityDraftsScreen } from './CommunityDraftsScreen';
import { CommunityIncidentsScreen } from './CommunityIncidentsScreen';

let routes: Record<string, R>;
const incident = (o: any = {}) => ({ id: 'i1', branchId: null, category: 'theft_or_shoplifting', severity: 'moderate', occurredOn: '2026-10-01', rawDetail: 'Took two bottles of polish.', advisoryPostId: null, createdAt: '2026-10-01T18:00:00Z', ...o });
beforeEach(() => {
  perms.deny = new Set();
  routes = {
    [`GET ${B}/mine`]: (c) => ({ body: page(c.query.get('kind') === 'published' ? [myPost({ id: 'm2', title: 'Published one', status: 'published_unverified' })] : [myPost({ id: 'm1', title: 'My draft', returnReason: null })], { hasMore: c.query.get('kind') === 'drafts', total: 30 }) }),
    [`GET ${B}/appeals`]: { body: [{ id: 'a1', postId: 'p1', subject: 'post_removed', reason: 'It names nobody.', status: 'under_review', decisionNote: null, createdAt: '2026-10-08T10:00:00Z', decidedAt: null }] },
    [`GET ${B}/incidents`]: { body: page([incident(), incident({ id: 'i2', category: 'phone_scam', advisoryPostId: 'p5' })]) },
    [`GET ${B}/incidents/i1`]: { body: incident() },
    [`POST ${B}/incidents`]: (c) => ({ body: incident({ id: 'i3', ...c.body }) }),
  };
  installFetch(routes);
});

describe('my advisories', () => {
  const renderIt = () => render(<MemoryRouter initialEntries={['/community/drafts']}><Routes><Route path="/community/drafts" element={<CommunityDraftsScreen />} /><Route path="/community/drafts/:id" element={<div data-testid="editor-route" />} /><Route path="/community/new" element={<div data-testid="new-route" />} /></Routes></MemoryRouter>);
  it('starts on drafts; tabs change the kind; paging sends page', async () => {
    renderIt();
    expect(await screen.findByText('My draft')).toBeTruthy();
    expect(sent('GET', `${B}/mine`)[0].query.get('kind')).toBe('drafts');
    fireEvent.click(screen.getByText('Next page'));
    await waitFor(() => expect(sent('GET', `${B}/mine`).slice(-1)[0].query.get('page')).toBe('2'));
    fireEvent.click(screen.getByRole('tab', { name: 'Published' }));
    expect(await screen.findByText('Published one')).toBeTruthy();
    expect(sent('GET', `${B}/mine`).slice(-1)[0].query.get('page')).toBe('1');
    expect(screen.getByRole('link', { name: 'View in the feed' })).toHaveAttribute('href', '/community/posts/m2');
  });
  it('Appeals tab lists the salon’s appeals', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('tab', { name: 'Appeals' }));
    expect(await screen.findByTestId('community-appeal-row')).toHaveTextContent(/under review/i);
  });
  it('Continue editing opens the editor', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue editing' }));
    expect(await screen.findByTestId('editor-route')).toBeTruthy();
  });
});

describe('private incidents', () => {
  const renderIt = () => render(<MemoryRouter initialEntries={['/community/incidents']}><Routes><Route path="/community/incidents" element={<CommunityIncidentsScreen />} /><Route path="/community/new" element={<div data-testid="new-route" />} /></Routes></MemoryRouter>);
  it('records an incident (category required) with the contract body', async () => {
    renderIt();
    await screen.findAllByTestId('community-incident-row');
    fireEvent.click(screen.getByRole('button', { name: 'Save incident' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a category.');
    fireEvent.change(screen.getByLabelText('Incident category'), { target: { value: 'refund_abuse' } });
    fireEvent.change(screen.getByLabelText('Incident severity'), { target: { value: 'low' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-07' } });
    fireEvent.change(screen.getByLabelText(/Private notes/), { target: { value: 'Asked for a refund twice.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save incident' }));
    await waitFor(() => expect(sent('POST', `${B}/incidents`)[0]?.body).toEqual({ category: 'refund_abuse', severity: 'low', occurredOn: '2026-10-07', rawDetail: 'Asked for a refund twice.' }));
    expect(await screen.findByRole('status')).toHaveTextContent('no other salon can see it');
  });
  it('notes load on demand; "Create advisory from this" starts the editor; a promoted one links to its advisory', async () => {
    renderIt();
    const rows = await screen.findAllByTestId('community-incident-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Show notes' }));
    expect(await screen.findByTestId('community-incident-detail')).toHaveTextContent('Took two bottles');
    expect(sent('GET', `${B}/incidents/i1`).length).toBe(1);
    expect(within(rows[1]).getByRole('link', { name: 'Open its advisory' })).toHaveAttribute('href', '/community/drafts/p5');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Create advisory from this' }));
    expect(await screen.findByTestId('new-route')).toBeTruthy();
  });
  it('no draft permission → no "Create advisory from this"', async () => {
    perms.deny = new Set(['community.advisory.draft']);
    renderIt();
    await screen.findAllByTestId('community-incident-row');
    expect(screen.queryByRole('button', { name: 'Create advisory from this' })).toBeNull();
  });
});
