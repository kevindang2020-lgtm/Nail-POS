// CommunityModerationPanels.test.tsx — BUILD_PLAN Phase 8: the moderation center's other panels — post / comment
// reports, disputes, appeals (another moderator should decide; deciding your own needs the explicit box), evidence (a
// file is opened under a case — a new one when none is given), cases + case detail (assign, update, the private incident
// under an incident_access case), salons (restrictions, lift, contact), audit trail, analytics, settings (versioned).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api: Record<string, any> = {};
for (const k of ['overview', 'posts', 'post', 'postAction', 'postComments', 'commentAction', 'cases', 'openCase', 'caseDetail', 'updateCase', 'reports', 'resolveReport', 'disputes', 'decideDispute', 'appeals', 'decideAppeal', 'evidence', 'evidenceAccess', 'reviewEvidence', 'incidentAccess', 'tenants', 'tenant', 'tenantAction', 'restrictions', 'actions', 'analytics', 'settings', 'saveSettings']) api[k] = vi.fn();
vi.mock('../api/superAdminCommunityModerationApi', async (orig) => ({ ...(await orig() as any), superAdminCommunityModerationApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
let permissions: string[] = ['super_admin.technicians.view', 'super_admin.technicians.manage'];
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', role: 'SUPER_ADMIN', permissions } }) }));
import { CommunityModerationScreen } from './CommunityModerationScreen';

const page = (items: any[], o: any = {}) => ({ items, page: 1, pageSize: 25, total: items.length, hasMore: false, ...o });
const report = (o: any = {}) => ({ id: 'rep-1', kind: 'post', postId: 'post-1', commentId: null, reporterTenantName: 'Glow Spa', reason: 'contains_personal_info', detail: 'has a phone', status: 'open', caseId: null, createdAt: '2026-10-08T11:00:00Z', ...o });
const caseRow = (o: any = {}) => ({ id: 'case-1234-x', kind: 'incident_access', status: 'open', priority: 'normal', reason: 'Law enforcement request', postId: null, postTitle: null, commentId: null, incidentId: 'inc-1', targetTenantId: 'tenant-a', targetTenantName: 'Pilot Nail Salon', openedByName: 'Pat', assignedToUserId: null, assignedToName: null, resolutionNote: null, createdAt: '2026-10-08T09:00:00Z', updatedAt: '2026-10-08T09:00:00Z', closedAt: null, ...o });
const restriction = (o: any = {}) => ({ id: 'res-1', tenantId: 'tenant-b', tenantName: 'Bad Actor Nails', userId: null, kind: 'commenting_restricted', reason: 'harassing comments', expiresAt: null, createdAt: '2026-10-01T00:00:00Z', liftedAt: null, ...o });
const err = (status: number, code: string, message = 'x') => Object.assign(new Error(message), { status, code });

beforeEach(() => {
  permissions = ['super_admin.technicians.view', 'super_admin.technicians.manage'];
  Object.values(api).forEach((f) => f.mockReset());
  api.overview.mockResolvedValue({ queues: {}, cases: { open: 0, investigating: 0, urgent: 0, assignedToMe: 0 }, published7d: 0, removed7d: 0, rejected7d: 0, restrictionsActive: 0, tenantsEnabled: 0, avgHoursToDecision: null, oldestWaitingHours: null, generatedAt: '2026-10-08T12:00:00Z' });
  for (const k of ['resolveReport', 'decideDispute', 'decideAppeal', 'reviewEvidence', 'tenantAction', 'commentAction']) api[k].mockResolvedValue({ ok: true, caseId: 'case-9' });
});
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const dialog = () => screen.getByRole('dialog');
const fill = (lbl: string, value: string) => fireEvent.change(within(dialog()).getByLabelText(lbl), { target: { value } });
const confirm = (name: string) => fireEvent.click(within(dialog()).getByRole('button', { name }));

describe('reports', () => {
  it('post reports: open ones by default; dismiss with a reason; actioned / dismissed have no buttons', async () => {
    api.reports.mockResolvedValue(page([report(), report({ id: 'rep-2', status: 'dismissed' })]));
    render(<CommunityModerationScreen />);
    tab('Post reports');
    const rows = await screen.findAllByTestId('mod-report-row');
    expect(api.reports).toHaveBeenCalledWith('post', { status: 'open', page: 1 });
    expect(rows[0].textContent).toContain('contains personal info');
    expect(within(rows[1]).queryByRole('button', { name: 'Dismiss…' })).toBeNull();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Dismiss…' }));
    fill('Reason', 'The number is the bank switchboard');
    confirm('Dismiss');
    await waitFor(() => expect(api.resolveReport).toHaveBeenCalledWith('rep-1', 'post', { resolution: 'dismissed', reason: 'The number is the bank switchboard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Report dismissed.');
    await waitFor(() => expect(api.reports).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    await waitFor(() => expect(api.reports).toHaveBeenLastCalledWith('post', { status: 'all', page: 1 }));
  });

  it('comment reports: remove the comment, then mark the report actioned', async () => {
    api.reports.mockResolvedValue(page([report({ id: 'rep-c', kind: 'comment', commentId: 'cm-9' })]));
    render(<CommunityModerationScreen />);
    tab('Comment reports');
    const rows = await screen.findAllByTestId('mod-report-row');
    expect(api.reports).toHaveBeenCalledWith('comment', { status: 'open', page: 1 });
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Remove comment…' }));
    fill('Reason', 'Customer phone number in it');
    confirm('Remove');
    await waitFor(() => expect(api.commentAction).toHaveBeenCalledWith('cm-9', { action: 'remove', reason: 'Customer phone number in it' }));
    fireEvent.click(within((await screen.findAllByTestId('mod-report-row'))[0]).getByRole('button', { name: 'Actioned…' }));
    fill('Reason', 'Comment removed for PII');
    confirm('Mark actioned');
    await waitFor(() => expect(api.resolveReport).toHaveBeenCalledWith('rep-c', 'comment', { resolution: 'actioned', reason: 'Comment removed for PII' }));
  });
});

describe('disputes + appeals', () => {
  it('a dispute is decided with a decision and a note', async () => {
    api.disputes.mockResolvedValue(page([{ id: 'd-1', postId: 'post-1', raisedByKind: 'tenant', raisedByTenantName: 'Glow Spa', reason: 'It was a real bank call', status: 'open', resolutionNote: null, caseId: 'case-d', createdAt: '2026-10-08T10:00:00Z' }]));
    render(<CommunityModerationScreen />);
    tab('Disputes');
    const rows = await screen.findAllByTestId('mod-dispute-row');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Decide…' }));
    fill('Decision', 'corrected');
    fill('Note', 'Wording corrected with the salon');
    confirm('Decide');
    await waitFor(() => expect(api.decideDispute).toHaveBeenCalledWith('d-1', { decision: 'corrected', note: 'Wording corrected with the salon' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dispute decided: corrected.');
  });

  it('appeals: your own original decision is flagged; deciding it needs the explicit box (sent as allowSameDecider)', async () => {
    api.appeals.mockResolvedValue(page([
      { id: 'a-1', postId: 'post-1', commentId: null, appellantTenantName: 'Pilot Nail Salon', subject: 'Removal', reason: 'We had a police report', status: 'submitted', originalDecision: 'remove', originalDeciderIsMe: true, decisionNote: null, caseId: null, createdAt: '2026-10-08T10:00:00Z' },
      { id: 'a-2', postId: null, commentId: 'cm-1', appellantTenantName: 'Glow Spa', subject: 'Comment', reason: 'Not personal', status: 'submitted', originalDecision: 'remove', originalDeciderIsMe: false, decisionNote: null, caseId: null, createdAt: '2026-10-08T10:00:00Z' },
    ]));
    render(<CommunityModerationScreen />);
    tab('Appeals');
    const rows = await screen.findAllByTestId('mod-appeal-row');
    expect(api.appeals).toHaveBeenCalledWith({ status: 'submitted', page: 1 });
    expect(within(rows[0]).getByTestId('mod-appeal-same-decider')).toBeTruthy();
    expect(within(rows[1]).queryByTestId('mod-appeal-same-decider')).toBeNull();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Decide…' }));
    expect(dialog().textContent).toContain('Another moderator should review this appeal');
    fireEvent.click(within(dialog()).getByLabelText('I made the original decision and still decide this appeal'));
    fill('Decision', 'overturn');
    fill('Note', 'Police report reference checked');
    confirm('Decide');
    await waitFor(() => expect(api.decideAppeal).toHaveBeenCalledWith('a-1', { decision: 'overturn', note: 'Police report reference checked', allowSameDecider: true }));
    fireEvent.click(within((await screen.findAllByTestId('mod-appeal-row'))[1]).getByRole('button', { name: 'Decide…' }));
    expect(within(dialog()).queryByLabelText('I made the original decision and still decide this appeal')).toBeNull();
    fill('Note', 'The comment named a customer');
    confirm('Decide');
    await waitFor(() => expect(api.decideAppeal).toHaveBeenLastCalledWith('a-2', { decision: 'uphold', note: 'The comment named a customer' }));
  });
});

describe('evidence', () => {
  it('viewing a file without a case opens an evidence case first, then shows the time-limited link; review saves a decision', async () => {
    api.evidence.mockResolvedValue(page([{ id: 'ev-1', postId: 'post-1', tenantName: 'Pilot Nail Salon', mimeType: 'application/pdf', sizeBytes: 3000, uploadStatus: 'complete', scanStatus: 'clean', redactionStatus: 'none', createdAt: '2026-10-08T10:00:00Z' }]));
    api.openCase.mockResolvedValue(caseRow({ id: 'case-ev', kind: 'evidence' }));
    api.evidenceAccess.mockResolvedValue({ url: 'https://files.example/ev-1?sig=1', expiresAt: '2026-10-08T12:10:00Z' });
    render(<CommunityModerationScreen />);
    tab('Evidence review');
    const rows = await screen.findAllByTestId('mod-evidence-row');
    expect(api.evidence).toHaveBeenCalledWith({ status: 'needs_review', page: 1 });
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'View file…' }));
    fill('Reason', 'Checking the screenshot is redacted');
    confirm('Get a link');
    await waitFor(() => expect(api.evidenceAccess).toHaveBeenCalledWith('ev-1', 'case-ev', 'Checking the screenshot is redacted'));
    expect(api.openCase).toHaveBeenCalledWith({ kind: 'evidence', reason: 'Checking the screenshot is redacted', postId: 'post-1' });
    expect((await screen.findByRole('link', { name: 'Open the file' })).getAttribute('href')).toBe('https://files.example/ev-1?sig=1');
    fireEvent.click(within(screen.getAllByTestId('mod-evidence-row')[0]).getByRole('button', { name: 'Review…' }));
    fill('Decision', 'redacted');
    fill('Reason', 'Faces blurred before sharing');
    confirm('Save review');
    await waitFor(() => expect(api.reviewEvidence).toHaveBeenCalledWith('ev-1', { decision: 'redacted', reason: 'Faces blurred before sharing' }));
  });

  it('a case id typed in is used as is (no new case)', async () => {
    api.evidence.mockResolvedValue(page([{ id: 'ev-1', postId: 'post-1', tenantName: 'Pilot', mimeType: 'image/png', sizeBytes: 10, uploadStatus: 'complete', scanStatus: 'clean', redactionStatus: 'none', createdAt: '2026-10-08T10:00:00Z' }]));
    api.evidenceAccess.mockResolvedValue({ url: 'https://files.example/x', expiresAt: '2026-10-08T12:10:00Z' });
    render(<CommunityModerationScreen />);
    tab('Evidence review');
    fireEvent.click(within((await screen.findAllByTestId('mod-evidence-row'))[0]).getByRole('button', { name: 'View file…' }));
    fill('Case id', 'case-given');
    fill('Reason', 'Dispute needs the original');
    confirm('Get a link');
    await waitFor(() => expect(api.evidenceAccess).toHaveBeenCalledWith('ev-1', 'case-given', 'Dispute needs the original'));
    expect(api.openCase).not.toHaveBeenCalled();
  });
});

describe('cases', () => {
  it('filters reach the API; opening a case goes to its detail', async () => {
    api.cases.mockResolvedValue(page([caseRow()]));
    api.openCase.mockResolvedValue(caseRow({ id: 'case-new-1', kind: 'tenant_conduct' }));
    api.caseDetail.mockResolvedValue({ case: caseRow({ id: 'case-new-1', kind: 'tenant_conduct', incidentId: null }), actions: [], post: null });
    render(<CommunityModerationScreen />);
    tab('Cases');
    await screen.findAllByTestId('mod-case-row');
    expect(api.cases).toHaveBeenCalledWith({ status: 'open', kind: '', mine: false, page: 1 });
    fireEvent.click(screen.getByLabelText('Assigned to me'));
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'dispute' } });
    await waitFor(() => expect(api.cases).toHaveBeenLastCalledWith({ status: 'open', kind: 'dispute', mine: true, page: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Open a case…' }));
    fill('Kind', 'tenant_conduct');
    fill('Salon id (optional)', 'tenant-b');
    fill('Reason', 'Pattern of abusive comments');
    confirm('Open case');
    await waitFor(() => expect(api.openCase).toHaveBeenCalledWith({ kind: 'tenant_conduct', priority: 'normal', reason: 'Pattern of abusive comments', postId: null, targetTenantId: 'tenant-b', incidentId: null }));
    expect(await screen.findByTestId('mod-case-detail')).toBeTruthy();
    expect(api.caseDetail).toHaveBeenCalledWith('case-new-1');
    expect(screen.getByRole('tab', { name: 'Case detail' })).toHaveAttribute('aria-selected', 'true');
  });

  it('case detail: actions trail, assign to me, update status, open the private incident (shown, marked audited)', async () => {
    api.cases.mockResolvedValue(page([caseRow()]));
    api.caseDetail.mockResolvedValue({ case: caseRow(), actions: [{ id: 'act-1', action: 'incident_access', actorName: 'Pat', reason: 'Law enforcement', postId: null, commentId: null, targetTenantName: 'Pilot Nail Salon', detail: {}, createdAt: '2026-10-08T09:05:00Z' }], post: null });
    api.updateCase.mockResolvedValue(caseRow({ assignedToName: 'Pat' }));
    api.incidentAccess.mockResolvedValue({ id: 'inc-1', branchId: null, category: 'theft_or_shoplifting', severity: 'moderate', occurredOn: '2026-10-01', rawDetail: 'Took two bottles of polish', advisoryPostId: null, createdAt: '2026-10-01T00:00:00Z' });
    render(<CommunityModerationScreen />);
    tab('Cases');
    fireEvent.click(within((await screen.findAllByTestId('mod-case-row'))[0]).getByRole('button', { name: 'Open case' }));
    expect((await screen.findByTestId('mod-action-row')).textContent).toContain('incident access');
    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }));
    await waitFor(() => expect(api.updateCase).toHaveBeenCalledWith('case-1234-x', { assignToMe: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update…' }));
    fill('Status', 'resolved');
    fill('Resolution note', 'Records handed over');
    confirm('Update case');
    await waitFor(() => expect(api.updateCase).toHaveBeenLastCalledWith('case-1234-x', { status: 'resolved', priority: 'normal', resolutionNote: 'Records handed over' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open the private incident…' }));
    fill('Reason', 'Subpoena 2026-118 for this incident');
    confirm('Open incident');
    await waitFor(() => expect(api.incidentAccess).toHaveBeenCalledWith('inc-1', { caseId: 'case-1234-x', reason: 'Subpoena 2026-118 for this incident' }));
    const inc = await screen.findByTestId('mod-incident');
    expect(inc.textContent).toContain('Private to the salon — this view is audited.');
    expect(inc.textContent).toContain('Took two bottles of polish');
  });

  it('no private-incident button on a case that is not an incident_access case', async () => {
    api.cases.mockResolvedValue(page([caseRow({ kind: 'report' })]));
    api.caseDetail.mockResolvedValue({ case: caseRow({ kind: 'report' }), actions: [], post: null });
    render(<CommunityModerationScreen />);
    tab('Cases');
    fireEvent.click(within((await screen.findAllByTestId('mod-case-row'))[0]).getByRole('button', { name: 'Open case' }));
    await screen.findByTestId('mod-case-detail');
    expect(screen.queryByRole('button', { name: 'Open the private incident…' })).toBeNull();
  });
});

describe('salons', () => {
  const salon = { tenantId: 'tenant-b', tenantName: 'Bad Actor Nails', enabled: true, posts: 4, removed: 2, upheldDisputes: 1, reportsAgainst: 7, restrictions: [restriction()] };
  it('conduct + active restrictions; lift one; suspend until a day; contact needs a message', async () => {
    api.tenants.mockResolvedValue(page([salon]));
    api.restrictions.mockResolvedValue([restriction(), restriction({ id: 'res-old', liftedAt: '2026-10-02T00:00:00Z' })]);
    render(<CommunityModerationScreen />);
    tab('Salons');
    const row = (await screen.findAllByTestId('mod-salon-row'))[0];
    expect(row.textContent).toContain('commenting restricted');
    expect(screen.getAllByTestId('mod-restriction')).toHaveLength(1);
    expect(api.restrictions).toHaveBeenCalledWith(true);
    fireEvent.click(within(screen.getByTestId('mod-restriction')).getByRole('button', { name: 'Lift…' }));
    fill('Reason', 'Thirty days served, apology sent');
    confirm('Lift restriction');
    await waitFor(() => expect(api.tenantAction).toHaveBeenCalledWith('tenant-b', { action: 'lift', reason: 'Thirty days served, apology sent', restrictionId: 'res-1' }));
    fireEvent.click(within((await screen.findAllByTestId('mod-salon-row'))[0]).getByRole('button', { name: 'Suspend…' }));
    fill('Until (optional, UTC day)', '2026-11-08');
    fill('Reason', 'Threats in comments again');
    confirm('Suspend');
    await waitFor(() => expect(api.tenantAction).toHaveBeenLastCalledWith('tenant-b', { action: 'suspend', reason: 'Threats in comments again', expiresAt: '2026-11-08T23:59:59Z', userId: null }));
    fireEvent.click(within((await screen.findAllByTestId('mod-salon-row'))[0]).getByRole('button', { name: 'Contact…' }));
    fill('Reason', 'Warning before a restriction');
    confirm('Send message');
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Message: this field is required.');
    fill('Message', 'Please keep comments about safety only.');
    confirm('Send message');
    await waitFor(() => expect(api.tenantAction).toHaveBeenLastCalledWith('tenant-b', { action: 'contact', reason: 'Warning before a restriction', message: 'Please keep comments about safety only.' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Message sent to Bad Actor Nails.');
  });
  it('salon detail lists the whole restriction history, lifted ones too', async () => {
    api.tenants.mockResolvedValue(page([salon]));
    api.restrictions.mockResolvedValue([]);
    api.tenant.mockResolvedValue({ ...salon, restrictions: [restriction(), restriction({ id: 'res-old', kind: 'posting_restricted', liftedAt: '2026-10-02T00:00:00Z' })] });
    render(<CommunityModerationScreen />);
    tab('Salons');
    fireEvent.click(within((await screen.findAllByTestId('mod-salon-row'))[0]).getByRole('button', { name: 'Details' }));
    const items = await screen.findAllByTestId('mod-salon-restriction');
    expect(api.tenant).toHaveBeenCalledWith('tenant-b');
    expect(items.map((i) => i.textContent)).toEqual([expect.stringContaining('active'), expect.stringContaining('lifted')]);
  });
  it('search reaches the API', async () => {
    api.tenants.mockResolvedValue(page([]));
    api.restrictions.mockResolvedValue([]);
    render(<CommunityModerationScreen />);
    tab('Salons');
    fireEvent.change(screen.getByLabelText('Search salons'), { target: { value: ' glow ' } });
    await waitFor(() => expect(api.tenants).toHaveBeenLastCalledWith({ q: 'glow', page: 1 }));
    expect(await screen.findByTestId('mod-empty')).toBeTruthy();
  });
});

describe('audit trail, analytics, settings', () => {
  it('audit trail filters by post / case', async () => {
    api.actions.mockResolvedValue(page([{ id: 'act-1', action: 'publish', actorName: 'Pat Eight', reason: 'checked', postId: 'post-1', commentId: null, targetTenantName: 'Pilot Nail Salon', detail: {}, createdAt: '2026-10-08T10:00:00Z' }]));
    render(<CommunityModerationScreen />);
    tab('Audit trail');
    expect((await screen.findByTestId('mod-action-row')).textContent).toContain('Pat Eight');
    fireEvent.change(screen.getByLabelText('Post id'), { target: { value: 'post-1' } });
    await waitFor(() => expect(api.actions).toHaveBeenLastCalledWith({ postId: 'post-1', caseId: undefined, page: 1 }));
  });
  it('analytics: totals, overturn rate, severities, categories; the range reaches the API', async () => {
    api.analytics.mockResolvedValue({ from: '2026-09-08', to: '2026-10-08', published: 20, rejected: 3, removed: 2, disputes: 4, appeals: 2, overturnRate: 0.25, byCategory: [{ category: 'phone_scam', count: 9 }], bySeverity: { informational: 1, low: 2, moderate: 5, high: 10, critical: 2 }, medianHoursToDecision: 3 });
    render(<CommunityModerationScreen />);
    tab('Analytics');
    expect((await screen.findByTestId('mod-analytics-totals')).textContent).toContain('overturn rate 25%');
    expect(screen.getByTestId('mod-analytics-severity').textContent).toContain('high 10');
    expect(screen.getByTestId('mod-analytics-category').textContent).toContain('phone scam9');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    await waitFor(() => expect(api.analytics).toHaveBeenLastCalledWith('2026-01-01', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)));
  });
  it('settings: saved with the version it was read at; a bad threshold is refused before sending; a 409 reloads', async () => {
    api.settings.mockResolvedValue({ riskMatchingEnabled: false, rulesVersion: '2026-10-08', autoHideReportThreshold: 5, version: 3 });
    api.saveSettings.mockRejectedValueOnce(err(409, 'version_conflict')).mockResolvedValue({ riskMatchingEnabled: true, rulesVersion: '2026-10-08', autoHideReportThreshold: 8, version: 4 });
    render(<CommunityModerationScreen />);
    tab('Settings');
    expect((await screen.findByTestId('mod-settings-threshold')).textContent).toContain('5');
    fireEvent.click(screen.getByRole('button', { name: 'Change settings…' }));
    fill('Reports before review', '0');
    fill('Reason', 'Fewer false alarms please');
    confirm('Save settings');
    expect(await screen.findByRole('status')).toHaveTextContent('whole number from 1 to 100');
    expect(api.saveSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change settings…' }));
    fireEvent.click(within(dialog()).getByLabelText('Risk matching on'));
    fill('Reports before review', '8');
    fill('Reason', 'Fewer false alarms please');
    confirm('Save settings');
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ expectedVersion: 3, riskMatchingEnabled: true, autoHideReportThreshold: 8, reason: 'Fewer false alarms please' }));
    expect(await screen.findByRole('status')).toHaveTextContent('someone else changed this first');
    await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2));
  });
  it('view only: no settings button, no salon actions', async () => {
    permissions = ['super_admin.technicians.view'];
    api.settings.mockResolvedValue({ riskMatchingEnabled: true, rulesVersion: '2026-10-08', autoHideReportThreshold: 5, version: 3 });
    api.tenants.mockResolvedValue(page([{ tenantId: 't', tenantName: 'X', enabled: true, posts: 0, removed: 0, upheldDisputes: 0, reportsAgainst: 0, restrictions: [] }]));
    api.restrictions.mockResolvedValue([restriction()]);
    render(<CommunityModerationScreen />);
    tab('Settings');
    expect((await screen.findByTestId('mod-settings-risk')).textContent).toContain('on');
    expect(screen.queryByRole('button', { name: 'Change settings…' })).toBeNull();
    tab('Salons');
    await screen.findAllByTestId('mod-salon-row');
    expect(screen.queryByRole('button', { name: 'Suspend…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lift…' })).toBeNull();
  });
});
