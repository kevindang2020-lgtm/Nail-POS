// CommunityModerationScreen.test.tsx — BUILD_PLAN Phase 8 (tenant_safety_community): the Super Admin Safety Community
// Moderation center against agent B's shapes (@aipowersalon/api-contracts/platform Mod*): overview, the post queues,
// post detail and every post action — each asks for a reason (≥ 8), carries the post's version and the case being worked,
// a cancelled step-up is said plainly, a 409 reloads; without the manage key the center is view only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = {};
for (const k of ['overview', 'posts', 'post', 'postAction', 'postComments', 'commentAction', 'cases', 'openCase', 'caseDetail', 'updateCase', 'reports', 'resolveReport', 'disputes', 'decideDispute', 'appeals', 'decideAppeal', 'evidence', 'evidenceAccess', 'reviewEvidence', 'incidentAccess', 'tenants', 'tenant', 'tenantAction', 'restrictions', 'actions', 'analytics', 'settings', 'saveSettings']) api[k] = vi.fn();
vi.mock('../api/superAdminCommunityModerationApi', async (orig) => ({ ...(await orig() as any), superAdminCommunityModerationApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
let permissions: string[] = ['super_admin.technicians.view', 'super_admin.technicians.manage'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'SUPER_ADMIN', permissions } }) }));
import { CommunityModerationScreen } from './CommunityModerationScreen';
import { postActionsFor, failMessage, utcDay } from './CommunityModerationShared';

export const page = (items: any[], o: any = {}) => ({ items, page: 1, pageSize: 25, total: items.length, hasMore: false, ...o });
export const post = (o: any = {}) => ({
  id: 'post-1111', title: 'Fake bank call asking for the salon login', body: 'Caller said he was from the bank. Number [redacted].', category: 'account_takeover_attempt', severity: 'high',
  status: 'moderation_review', verificationLabel: 'unverified', visibility: 'draft', region: 'NJ', incidentDate: '2026-10-07', scamMethod: null, channels: ['phone'],
  recommendation: 'Never read a code to a caller.', tags: ['bank'], paymentProcessor: null, amountRange: null, officialReference: null,
  authorDisplay: 'display_name', authorLabel: 'Pilot Nail Salon', originTenantId: 'tenant-a', originTenantName: 'Pilot Nail Salon', originBranchName: 'Main', createdByName: 'Rae Eight',
  privacyScanFlags: ['phone'], moderationRequired: true, commentsLocked: false, removedReason: null,
  counts: { comments: 1, reports: 2, openReports: 1, similar: 3, disputes: 0, evidence: 1 }, signals: { flags: ['urgent_language'], score: 0.42, notes: ['mentions a login code'] },
  version: 4, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T11:00:00Z', publishedAt: null, ...o,
});
const overview = () => ({
  queues: { review: 3, sensitive: 1, reports: 2, comment_reports: 0, disputes: 1, appeals: 1, evidence: 4, returned: 2, published: 40, removed: 5 },
  cases: { open: 6, investigating: 2, urgent: 1, assignedToMe: 2 }, published7d: 9, removed7d: 1, rejected7d: 2, restrictionsActive: 1, tenantsEnabled: 12,
  avgHoursToDecision: 5.5, oldestWaitingHours: 30.25, generatedAt: '2026-10-08T12:00:00Z',
});
const detail = (o: any = {}) => ({
  post: post(o), versions: [{ version: 3, title: 'Fake bank call', body: 'x', status: 'manager_approval', editedBy: 'Mia Manager', changeNote: 'approved', createdAt: '2026-10-08T10:30:00Z' }],
  reports: [{ id: 'rep-1', kind: 'post', postId: 'post-1111', commentId: null, reporterTenantName: 'Glow Spa', reason: 'inaccurate', detail: 'not a bank', status: 'open', caseId: null, createdAt: '2026-10-08T11:00:00Z' }],
  disputes: [], evidence: [{ id: 'ev-1', postId: 'post-1111', tenantName: 'Pilot Nail Salon', mimeType: 'image/png', sizeBytes: 20480, uploadStatus: 'complete', scanStatus: 'clean', redactionStatus: 'none', createdAt: '2026-10-08T10:10:00Z' }],
  cases: [], related: [{ id: 'post-2222', title: 'Same caller in Camden', relation: 'possible_duplicate', score: 0.83 }],
  redactions: [{ field: 'body', reason: 'phone number', by: null, createdAt: '2026-10-08T10:00:00Z' }],
});
const comments = () => [
  { id: 'cm-1', postId: 'post-1111', parentId: null, body: 'Same call here yesterday', tenantName: 'Glow Spa', authorLabel: 'A salon in NJ', removed: false, removedReason: null, reportCount: 0, createdAt: '2026-10-08T11:30:00Z' },
  { id: 'cm-2', postId: 'post-1111', parentId: 'cm-1', body: '', tenantName: 'Bad Actor Nails', authorLabel: 'Bad Actor', removed: true, removedReason: 'personal data', reportCount: 2, createdAt: '2026-10-08T11:40:00Z' },
];
const err = (status: number, code: string, message = 'x') => Object.assign(new Error(message), { status, code });

beforeEach(() => {
  permissions = ['super_admin.technicians.view', 'super_admin.technicians.manage'];
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue(overview());
  api.posts.mockImplementation(async (q: any) => page(q.queue === 'removed' ? [post({ status: 'removed', removedReason: 'duplicate' })] : q.queue === 'published' ? [post({ status: 'published_unverified', visibility: 'community_published' })] : [post()], { hasMore: q.queue === 'review' && (q.page ?? 1) === 1 }));
  api.post.mockImplementation(async () => detail());
  api.postComments.mockResolvedValue(comments());
  api.postAction.mockResolvedValue({ ok: true, caseId: 'case-9' });
  api.commentAction.mockResolvedValue({ ok: true, caseId: 'case-9' });
});
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const dialog = () => screen.getByRole('dialog');
const fill = (lbl: string, value: string) => fireEvent.change(within(dialog()).getByLabelText(lbl), { target: { value } });
const confirm = (name: string) => fireEvent.click(within(dialog()).getByRole('button', { name }));
async function openReview() { render(<CommunityModerationScreen />); tab('Review queue'); return screen.findAllByTestId('mod-post-row'); }

describe('CommunityModerationScreen — overview + queues', () => {
  it('overview: every queue counted, a queue card opens its panel; cases, 7-day decisions, waiting time', async () => {
    render(<CommunityModerationScreen />);
    const cards = await screen.findAllByTestId('mod-queue-card');
    expect(cards.map((c) => c.textContent)).toContain('review3');
    expect(cards.map((c) => c.textContent)).toContain('comment reports0');
    expect(screen.getByTestId('mod-overview-cases').textContent).toContain('2 assigned to me');
    expect(screen.getByTestId('mod-overview-7d').textContent).toContain('9 published · 2 rejected · 1 removed');
    expect(screen.getByText(/oldest waiting: 30.3 h/)).toBeTruthy();
    fireEvent.click(cards.find((c) => c.textContent === 'sensitive1')!);
    await waitFor(() => expect(api.posts).toHaveBeenCalledWith(expect.objectContaining({ queue: 'sensitive', page: 1 })));
    expect(screen.getByRole('tab', { name: 'Sensitive data' })).toHaveAttribute('aria-selected', 'true');
  });

  it('18 panels in the tab list', async () => {
    render(<CommunityModerationScreen />);
    expect(screen.getAllByRole('tab')).toHaveLength(18);
    await screen.findAllByTestId('mod-queue-card');
  });

  it('review queue: rows show salon, privacy flags, open/total reports; filters and paging reach the API', async () => {
    const rows = await openReview();
    expect(rows[0].textContent).toContain('Pilot Nail Salon · Main');
    expect(rows[0].textContent).toContain('Privacy scan: phone');
    expect(rows[0].textContent).toContain('1/2');
    fireEvent.change(screen.getByLabelText('Search posts'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    await waitFor(() => expect(api.posts).toHaveBeenLastCalledWith({ queue: 'review', q: 'bank', category: undefined, severity: 'high', page: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.posts).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'review', page: 2 })));
  });

  it('publish from the review queue: label + reason (≥ 8), the post version is sent, notice, everything reloads', async () => {
    const rows = await openReview();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Publish…' }));
    expect(screen.getByRole('dialog', { name: /Publish: Fake bank call/ })).toBeTruthy();
    fill('Verification label', 'evidence_reviewed');
    fill('Reason', 'short');
    confirm('Publish');
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Reason: enter at least 8 characters.');
    expect(api.postAction).not.toHaveBeenCalled();
    fill('Reason', 'Checked: no personal data left');
    confirm('Publish');
    await waitFor(() => expect(api.postAction).toHaveBeenCalledWith('post-1111', { action: 'publish', reason: 'Checked: no personal data left', expectedVersion: 4, label: 'evidence_reviewed' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Publish — done for “Fake bank call asking for the salon login”.');
    await waitFor(() => expect(api.posts).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('request changes needs a message to the salon; reject does not', async () => {
    const rows = await openReview();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Request changes…' }));
    fill('Reason', 'Too much detail about the caller');
    confirm('Return for changes');
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Message to the posting salon: this field is required.');
    fill('Message to the posting salon', 'Please remove the caller description.');
    confirm('Return for changes');
    await waitFor(() => expect(api.postAction).toHaveBeenCalledWith('post-1111', expect.objectContaining({ action: 'request_changes', messageToTenant: 'Please remove the caller description.' })));
    fireEvent.click(within(screen.getAllByTestId('mod-post-row')[0]).getByRole('button', { name: 'Reject…' }));
    fill('Reason', 'Not a safety advisory at all');
    confirm('Reject');
    await waitFor(() => expect(api.postAction).toHaveBeenLastCalledWith('post-1111', { action: 'reject', reason: 'Not a safety advisory at all', expectedVersion: 4 }));
  });

  it('a 409 says someone acted first and reloads; a cancelled step-up is said plainly; Cancel sends nothing', async () => {
    api.postAction.mockRejectedValueOnce(err(409, 'version_conflict'));
    const rows = await openReview();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Publish…' }));
    fill('Reason', 'Looks fine to publish');
    confirm('Publish');
    expect(await screen.findByRole('status')).toHaveTextContent('someone else changed this first');
    await waitFor(() => expect(api.posts).toHaveBeenCalledTimes(2));
    api.postAction.mockRejectedValueOnce(err(403, 'STEP_UP_REQUIRED'));
    fireEvent.click(within(screen.getAllByTestId('mod-post-row')[0]).getByRole('button', { name: 'Publish…' }));
    fill('Reason', 'Looks fine to publish');
    confirm('Publish');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('step-up'));
    expect(api.posts).toHaveBeenCalledTimes(2);
    fireEvent.click(within(screen.getAllByTestId('mod-post-row')[0]).getByRole('button', { name: 'Reject…' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.postAction).toHaveBeenCalledTimes(2);
  });

  it('published queue offers Remove; removed queue offers Restore only', async () => {
    render(<CommunityModerationScreen />);
    tab('Published');
    const pub = await screen.findAllByTestId('mod-post-row');
    expect(within(pub[0]).getByRole('button', { name: 'Remove…' })).toBeTruthy();
    expect(within(pub[0]).queryByRole('button', { name: 'Publish…' })).toBeNull();
    tab('Removed');
    await waitFor(() => expect(api.posts).toHaveBeenCalledWith(expect.objectContaining({ queue: 'removed' })));
    const rem = await screen.findAllByTestId('mod-post-row');
    await waitFor(() => expect(within(rem[0]).getByRole('button', { name: 'Restore…' })).toBeTruthy());
    expect(within(rem[0]).queryByRole('button', { name: 'Remove…' })).toBeNull();
  });

  it('without the manage key: view only — no action buttons anywhere', async () => {
    permissions = ['super_admin.technicians.view'];
    const rows = await openReview();
    expect(screen.getByTestId('mod-view-only')).toBeTruthy();
    expect(within(rows[0]).queryByRole('button', { name: 'Publish…' })).toBeNull();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    await screen.findByTestId('mod-post-detail');
    expect(screen.queryByTestId('mod-post-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove comment…' })).toBeNull();
  });

  it('a failed queue load says so', async () => {
    api.posts.mockRejectedValue(err(500, 'ERROR', 'Server down'));
    render(<CommunityModerationScreen />);
    tab('Review queue');
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down');
  });
});

describe('CommunityModerationScreen — post detail', () => {
  it('shows salon, flags, body, counts, AI signals labelled advisory, versions, reports, evidence, related, redactions, threaded comments', async () => {
    const rows = await openReview();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    const d = await screen.findByTestId('mod-post-detail');
    expect(api.post).toHaveBeenCalledWith('post-1111');
    expect(screen.getByTestId('mod-post-meta').textContent).toContain('moderation review · unverified · account takeover attempt · high · v4');
    expect(d.textContent).toContain('Posted by Pilot Nail Salon (Main) — Rae Eight');
    expect(screen.getByTestId('mod-post-flags').textContent).toContain('phone');
    expect(screen.getByTestId('mod-post-signals').textContent).toMatch(/AI signals — advisory only, never a decision.*Score 0.42.*urgent language/);
    expect(screen.getByTestId('mod-version-row').textContent).toContain('Mia Manager');
    expect(screen.getByTestId('mod-post-report').textContent).toContain('Glow Spa');
    expect(screen.getByTestId('mod-evidence-row').textContent).toContain('image/png · 20 KB');
    expect(screen.getByTestId('mod-related').textContent).toContain('possible duplicate (83%)');
    expect(screen.getByTestId('mod-redaction').textContent).toContain('phone number');
    const cms = await screen.findAllByTestId('mod-comment');
    expect(cms[1].textContent).toContain('[removed by moderator: personal data]');
    expect(within(cms[1]).getByRole('button', { name: 'Restore comment…' })).toBeTruthy();
    const acts = within(screen.getByTestId('mod-post-actions')).getAllByRole('button').map((b) => b.textContent);
    expect(acts).toEqual(['Publish…', 'Request changes…', 'Request evidence…', 'Reject…', 'Redact…', 'Change severity…', 'Merge into…', 'Link related…']);
  });

  it('redact sends the field, the text and its replacement; merge needs a target', async () => {
    const rows = await openReview();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    await screen.findByTestId('mod-post-actions');
    fireEvent.click(screen.getByRole('button', { name: 'Redact…' }));
    fill('Text to replace', 'Caller said he');
    fill('Replace with', 'A caller');
    fill('Reason', 'Gendered detail identifies him');
    confirm('Redact');
    await waitFor(() => expect(api.postAction).toHaveBeenCalledWith('post-1111', { action: 'redact', reason: 'Gendered detail identifies him', expectedVersion: 4, redactions: [{ field: 'body', find: 'Caller said he', replaceWith: 'A caller' }] }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Merge into…' }));
    fill('Reason', 'Same caller, same week');
    confirm('Merge');
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Merge into post (id): this field is required.');
    fill('Merge into post (id)', 'post-2222');
    confirm('Merge');
    await waitFor(() => expect(api.postAction).toHaveBeenLastCalledWith('post-1111', expect.objectContaining({ action: 'merge_into', targetPostId: 'post-2222' })));
  });

  it('comment actions: remove with a reason; redact with find / replace', async () => {
    const rows = await openReview();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Open' }));
    const cms = await screen.findAllByTestId('mod-comment');
    fireEvent.click(within(cms[0]).getByRole('button', { name: 'Remove comment…' }));
    fill('Reason', 'Names a customer by name');
    confirm('Remove');
    await waitFor(() => expect(api.commentAction).toHaveBeenCalledWith('cm-1', { action: 'remove', reason: 'Names a customer by name' }));
    fireEvent.click(within((await screen.findAllByTestId('mod-comment'))[0]).getByRole('button', { name: 'Redact comment…' }));
    fill('Text to replace', 'yesterday');
    fill('Reason', 'Date narrows it to a person');
    confirm('Redact');
    await waitFor(() => expect(api.commentAction).toHaveBeenLastCalledWith('cm-1', { action: 'redact', reason: 'Date narrows it to a person', find: 'yesterday', replaceWith: '[redacted]' }));
  });

  it('a post opened from a case runs its actions under that case', async () => {
    api.caseDetail.mockResolvedValue({ case: { id: 'case-7777', kind: 'report', status: 'open', priority: 'high', reason: 'two reports', postId: 'post-1111', postTitle: 'Fake bank call', commentId: null, incidentId: null, targetTenantId: null, targetTenantName: null, openedByName: 'Pat', assignedToUserId: null, assignedToName: null, resolutionNote: null, createdAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', closedAt: null }, actions: [], post: post() });
    api.cases.mockResolvedValue(page([{ id: 'case-7777', kind: 'report', status: 'open', priority: 'high', reason: 'two reports', postId: 'post-1111', postTitle: 'Fake bank call', commentId: null, incidentId: null, targetTenantId: null, targetTenantName: null, openedByName: 'Pat', assignedToUserId: null, assignedToName: null, resolutionNote: null, createdAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', closedAt: null }]));
    render(<CommunityModerationScreen />);
    tab('Cases');
    fireEvent.click(within((await screen.findAllByTestId('mod-case-row'))[0]).getByRole('button', { name: 'Open case' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open post' }));
    expect(screen.getByTestId('mod-active-case').textContent).toContain('case-777');
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    fill('Reason', 'Reports were right about it');
    confirm('Reject');
    await waitFor(() => expect(api.postAction).toHaveBeenCalledWith('post-1111', expect.objectContaining({ action: 'reject', caseId: 'case-7777' })));
  });
});

describe('CommunityModerationShared', () => {
  it('postActionsFor: status decides the actions (remove only for visible posts; restore only when removed)', () => {
    expect(postActionsFor({ status: 'sensitive_data_detected', commentsLocked: false })).toEqual(['redact', 'publish', 'request_changes', 'reject']);
    expect(postActionsFor({ status: 'published_official_report', commentsLocked: true })).toContain('unlock_comments');
    expect(postActionsFor({ status: 'published_unverified', commentsLocked: false })).toContain('lock_comments');
    expect(postActionsFor({ status: 'removed', commentsLocked: false })).toEqual(['restore']);
    expect(postActionsFor({ status: 'disputed', commentsLocked: false })).toContain('remove');
    expect(postActionsFor({ status: 'incident_draft', commentsLocked: false })).toEqual([]);
    expect(postActionsFor({ status: 'manager_approval', commentsLocked: false })).toEqual([]);
    expect(postActionsFor({ status: 'evidence_requested', commentsLocked: false })).not.toContain('publish');
  });
  it('failMessage + utcDay', () => {
    expect(failMessage(err(409, 'version_conflict'))).toMatch(/someone else changed this first/);
    expect(failMessage(err(403, 'community_suspended', 'Suspended'))).toBe('Suspended');
    expect(utcDay(0, new Date('2026-10-08T23:30:00-05:00'))).toBe('2026-10-09');
    expect(utcDay(30, new Date('2026-10-08T12:00:00Z'))).toBe('2026-09-08');
  });
});
