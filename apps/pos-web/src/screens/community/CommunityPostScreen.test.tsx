// CommunityPostScreen.test.tsx — BUILD_PLAN Phase 8: the /community/posts/:id deep link (detail, updates, related,
// threaded comments, rules-before-first-comment, follow, similar, report / dispute / appeal, approver edit / update /
// resolve, own-salon evidence, 409 / 403 handling) through the REAL api client.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { actions, author, B, calls, comment, err, installFetch, post, sent, settings, type Route as R } from './communityTestKit';

const perms = { deny: new Set<string>() };
vi.mock('../../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: 'u1' } }) }));
import { CommunityPostScreen } from './CommunityPostScreen';

let routes: Record<string, R>;
const server: { post: any } = { post: null };
const thread = () => [comment({ replies: [comment({ id: 'c2', parentId: 'c1', depth: 2, body: 'Thanks for the heads up', author: author({ label: 'Bella Nails', isOwnSalon: true }), mine: true, version: 4 })] }),
  comment({ id: 'c3', body: '[removed by moderator]', removed: true })];
const defaults = (): Record<string, R> => ({
  [`GET ${B}/posts/p1`]: () => ({ body: server.post }),
  [`GET ${B}/posts/p1/comments`]: { body: thread() },
  [`GET ${B}/settings`]: { body: settings() },
  [`POST ${B}/rules/acknowledge`]: (c) => ({ body: { acknowledged: true, rulesVersion: c.body.rulesVersion } }),
  [`POST ${B}/posts/p1/comments`]: (c) => ({ body: comment({ id: 'c9', body: c.body.body, mine: true }) }),
  [`PUT ${B}/comments/c2`]: (c) => ({ body: comment({ id: 'c2', body: c.body.body, version: 5 }) }),
  [`DELETE ${B}/comments/c2`]: { body: { ok: true } },
  [`POST ${B}/comments/c1/report`]: { body: { ok: true } },
  [`POST ${B}/posts/p1/follow`]: () => { server.post = { ...server.post, following: true }; return { body: { following: true, followers: 4 } }; },
  [`DELETE ${B}/posts/p1/follow`]: () => { server.post = { ...server.post, following: false }; return { body: { following: false, followers: 3 } }; },
  [`POST ${B}/posts/p1/similar`]: () => { server.post = { ...server.post, similarReportedByMe: true }; return { body: { similarCount: 2, mine: true } }; },
  [`POST ${B}/posts/p1/report`]: { body: { ok: true } },
  [`POST ${B}/posts/p1/dispute`]: { body: { ok: true, status: 'disputed' } },
  [`POST ${B}/posts/p1/appeal`]: { body: { id: 'a1', postId: 'p1', subject: 'post_removed', reason: 'x', status: 'submitted', decisionNote: null, createdAt: '', decidedAt: null } },
  [`POST ${B}/posts/p1/updates`]: { body: {} },
  [`POST ${B}/posts/p1/resolve`]: { body: {} },
  [`GET ${B}/posts/p1/evidence`]: { body: [{ id: 'e1', mimeType: 'image/png', sizeBytes: 2048, uploadStatus: 'uploaded', scanStatus: 'clean', redactionStatus: 'not_required', createdAt: '2026-10-08T12:00:00Z' }] },
  [`GET ${B}/evidence/e1/access`]: { body: { url: 'https://s3.example/e1?sig', expiresAt: '' } },
});
const renderPost = (id = 'p1') => render(<MemoryRouter initialEntries={[`/community/posts/${id}`]}><Routes><Route path="/community/posts/:id" element={<CommunityPostScreen />} /><Route path="/community/drafts/:id" element={<div data-testid="editor-route" />} /></Routes></MemoryRouter>);
const own = () => post({ author: author({ label: 'Bella Nails', isOwnSalon: true, anonymous: false }), viewerActions: actions({ canEdit: true, canAddUpdate: true, canResolve: true, canUploadEvidence: true, canReport: false, canDispute: false, canMarkSimilar: false, canAppeal: true }) });
beforeEach(() => { perms.deny = new Set(); server.post = post({ updates: [{ id: 'u1', body: 'They called again today.', createdAt: '2026-10-08T15:00:00Z', author: author() }], related: [{ id: 'p7', title: 'Processor impersonation', relation: 'possible_duplicate', severity: 'high', publishedAt: null }] }); routes = defaults(); installFetch(routes); });

describe('post detail (the deep link)', () => {
  it('shows the sanitized post, its facts, updates, related posts and the comment thread', async () => {
    renderPost();
    expect(await screen.findByRole('heading', { name: 'Caller asked for the processor login code' })).toBeTruthy();
    expect(screen.getByTestId('community-post-body').textContent).toContain('[phone removed]');
    expect(screen.getByText('Account takeover attempt')).toBeTruthy();
    expect(screen.getByTestId('community-post').textContent).toContain('A salon in NJ · published');
    expect(screen.getByTestId('community-update')).toHaveTextContent('They called again today.');
    expect(screen.getByTestId('community-related')).toHaveTextContent('possible duplicate');
    const cs = await screen.findAllByTestId('community-comment');
    expect(cs.length).toBe(3);                                                // threaded: c1 → c2, plus c3
    expect(screen.getByRole('article', { name: 'Comment from Bella Nails' })).toHaveTextContent('Thanks for the heads up');
    expect(screen.getByText('[removed by moderator]')).toBeTruthy();
    expect(screen.queryByTestId('community-evidence')).toBeNull();            // another salon's post → no files
  });
  it('posting a comment: the rules first (when not accepted), then the comment', async () => {
    routes[`GET ${B}/settings`] = { body: settings({ rulesAcknowledgedByMe: false }) };
    renderPost();
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'Same here — we hung up.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    const dlg = await screen.findByRole('dialog', { name: 'Safety Community rules' });
    expect(sent('POST', `${B}/posts/p1/comments`).length).toBe(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'I agree to the community rules' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/comments`).length).toBe(1));
    expect(sent('POST', `${B}/rules/acknowledge`)[0].body.rulesVersion).toBeTruthy();
    expect(sent('POST', `${B}/posts/p1/comments`)[0].body).toEqual({ body: 'Same here — we hung up.' });
    expect(screen.queryByRole('dialog', { name: 'Safety Community rules' })).toBeNull();
  });
  it('a server 403 rules_not_acknowledged re-opens the rules; a commenting restriction is explained', async () => {
    routes[`POST ${B}/posts/p1/comments`] = err(403, 'rules_not_acknowledged');
    renderPost();
    fireEvent.change(await screen.findByLabelText('Add a comment'), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByRole('dialog', { name: 'Safety Community rules' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    routes[`POST ${B}/posts/p1/comments`] = err(403, 'community_commenting_restricted');
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(await screen.findByText(/paused commenting for your salon/)).toBeTruthy();
  });
  it('reply carries parentId; edit carries expectedVersion; delete asks first', async () => {
    renderPost();
    fireEvent.click(await screen.findByRole('button', { name: 'Reply to comment from Glow Spa' }));
    fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Which number?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/comments`)[0]?.body).toEqual({ body: 'Which number?', parentId: 'c1' }));
    const mine = screen.getByRole('article', { name: 'Comment from Bella Nails' });
    fireEvent.click(within(mine).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(mine).getByLabelText('Edit your comment'), { target: { value: 'Thanks!' } });
    fireEvent.click(within(mine).getByRole('button', { name: 'Save comment' }));
    await waitFor(() => expect(sent('PUT', `${B}/comments/c2`)[0]?.body).toEqual({ body: 'Thanks!', expectedVersion: 4 }));
    fireEvent.click(within(screen.getByRole('article', { name: 'Comment from Bella Nails' })).getByRole('button', { name: 'Delete' }));
    expect(sent('DELETE', `${B}/comments/c2`).length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(sent('DELETE', `${B}/comments/c2`).length).toBe(1));
  });
  it('no reply button at depth 3; report on others’ comments only', async () => {
    routes[`GET ${B}/posts/p1/comments`] = { body: [comment({ depth: 3 })] };
    renderPost();
    const c = (await screen.findAllByTestId('community-comment'))[0];
    expect(within(c).queryByRole('button', { name: /Reply/ })).toBeNull();
    fireEvent.click(within(c).getByRole('button', { name: 'Report' }));
    fireEvent.change(within(c).getByLabelText('Reason'), { target: { value: 'harassment' } });
    fireEvent.click(within(c).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(sent('POST', `${B}/comments/c1/report`)[0]?.body).toEqual({ reason: 'harassment', detail: null }));
  });
  it('locked comments: no composer, a plain message', async () => {
    server.post = post({ commentsLocked: true });
    renderPost();
    expect(await screen.findByTestId('community-comments-locked')).toBeTruthy();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
  });
  it('follow / unfollow and "we saw this too" reload the post', async () => {
    renderPost();
    fireEvent.click(await screen.findByRole('button', { name: 'Follow' }));
    expect(await screen.findByRole('button', { name: 'Unfollow' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
    await waitFor(() => expect(sent('DELETE', `${B}/posts/p1/follow`).length).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: 'We saw this too' }));
    fireEvent.change(screen.getByLabelText(/When did it happen/), { target: { value: '2026-10-06' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report similar experience' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/similar`)[0]?.body).toEqual({ note: null, occurredOn: '2026-10-06' }));
    expect(await screen.findByText('Your salon reported a similar experience.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'We saw this too' })).toBeNull();
  });
  it('report / dispute send the contract bodies', async () => {
    renderPost();
    fireEvent.click(await screen.findByRole('button', { name: 'Report post' }));
    const rd = screen.getByRole('dialog', { name: 'Report this post' });
    fireEvent.change(within(rd).getByLabelText('Reason'), { target: { value: 'inaccurate' } });
    fireEvent.click(within(rd).getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/report`)[0]?.body).toEqual({ reason: 'inaccurate', detail: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Dispute' }));
    const dd = screen.getByRole('dialog', { name: 'Dispute this post' });
    fireEvent.change(within(dd).getByLabelText('What is wrong with this post?'), { target: { value: 'This was our own staff testing.' } });
    fireEvent.click(within(dd).getByRole('button', { name: 'Send dispute' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/dispute`)[0]?.body).toEqual({ reason: 'This was our own staff testing.', raisedByKind: 'tenant' }));
    expect(await screen.findByRole('status')).toHaveTextContent('labelled disputed');
  });
  it('buttons follow viewerActions AND permissions', async () => {
    server.post = post({ viewerActions: actions({ canReport: false, canFollow: false }) });
    perms.deny = new Set(['community.dispute.create']);
    renderPost();
    await screen.findByRole('heading', { name: 'Caller asked for the processor login code' });
    expect(screen.queryByRole('button', { name: 'Report post' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dispute' })).toBeNull();      // viewerActions allow it, the role does not
    expect(screen.getByRole('button', { name: 'We saw this too' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit post' })).toBeNull();
  });
  it('own salon: edit, add update, resolve (expectedVersion; 409 reloads), appeal, private evidence', async () => {
    server.post = own();
    renderPost();
    fireEvent.click(await screen.findByRole('button', { name: 'Add update' }));
    fireEvent.change(screen.getByLabelText('Update'), { target: { value: 'Processor confirmed it was not them.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post update' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/updates`)[0]?.body).toEqual({ body: 'Processor confirmed it was not them.' }));
    routes[`POST ${B}/posts/p1/resolve`] = err(409, 'version_conflict');
    const before = sent('GET', `${B}/posts/p1`).length;
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    fireEvent.change(screen.getByLabelText('Resolution note'), { target: { value: 'No more calls.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolved' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this');
    expect(sent('POST', `${B}/posts/p1/resolve`)[0].body).toEqual({ expectedVersion: 3, note: 'No more calls.' });
    expect(sent('GET', `${B}/posts/p1`).length).toBeGreaterThan(before);
    expect(await screen.findByTestId('community-evidence-row')).toHaveTextContent('Scanned — clean');
    fireEvent.click(screen.getByRole('button', { name: 'Appeal' }));
    fireEvent.change(screen.getByLabelText('What are you appealing?'), { target: { value: 'post_removed' } });
    fireEvent.change(screen.getByLabelText('Why should moderators look again?'), { target: { value: 'It names nobody at all.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send appeal' }));
    await waitFor(() => expect(sent('POST', `${B}/posts/p1/appeal`)[0]?.body).toEqual({ subject: 'post_removed', reason: 'It names nobody at all.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit post' }));
    expect(await screen.findByTestId('editor-route')).toBeTruthy();
  });
  it('evidence opens only with a reason and through a short-lived link', async () => {
    server.post = own();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPost();
    fireEvent.click(await screen.findByRole('button', { name: 'Open…' }));
    const btn = screen.getByRole('button', { name: 'Open file' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason for opening this file'), { target: { value: 'checking the screenshot' } });
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://s3.example/e1?sig', '_blank', 'noopener'));
    expect(sent('GET', `${B}/evidence/e1/access`)[0].query.get('reason')).toBe('checking the screenshot');
    open.mockRestore();
  });
  it('a post another salon cannot see → plain message, no crash', async () => {
    routes[`GET ${B}/posts/p1`] = err(403, 'not_visible');
    renderPost();
    expect(await screen.findByRole('alert')).toHaveTextContent('not visible to your salon');
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });
});
