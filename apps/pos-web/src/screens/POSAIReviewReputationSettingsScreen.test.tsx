// POSAIReviewReputationSettingsScreen — Review & Reputation Settings guide (Nov 1 2026). The title, Save Changes and the eight
// controls stay; values and sources come from /pos/reputation-settings/state; Save sends only the changed controls with the
// version after a confirmation; automatic replies + approval cannot be saved together; the screen says what does not run; a
// stale version reloads; a role without manage cannot change anything; history and the check render localized text.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { rs, perms } = vi.hoisted(() => ({ rs: { state: vi.fn(), save: vi.fn(), history: vi.fn(), event: vi.fn(), check: vi.fn() }, perms: { deny: [] as string[] } }));
vi.mock('../api/posReputationSettingsApi', () => ({ posReputationSettingsApi: rs }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER' } }) }));
import { POSAIReviewReputationSettingsScreen } from './POSAIReviewReputationSettingsScreen';

const setting = (key: string, value: unknown, source = 'default') => ({ key, value, default: value, source, ignoredAt: [] });
const STATE = (o: Record<string, unknown> = {}, version = 0) => ({
  assistant: { effectiveEnabled: true, disabledAtLevel: null, salon: 'inherited', branchOverride: 'none', operational: 'operational' },
  entitlement: { allowed: true, reason: 'ok', subscriptionStatus: 'active', enforcement: 'observe' },
  settings: [setting('enabled', true), setting('responseTone', 'professional'), setting('approvalRequired', true), setting('autoResponse', false), setting('requestsEnabled', o.requestsEnabled ?? false, o.requestsEnabled ? 'tenant' : 'default'),
    setting('channel', 'sms'), setting('delayMinutes', 120), setting('oneReminder', false)],
  safeguards: { quietHoursStart: 21, quietHoursEnd: 9, cooldownDays: 30, maxPerCustomerPerPeriod: 1, minVisitValueCents: 0 },
  runtime: { approval: 'always_enforced', autoResponse: 'off', reviewRequests: { scheduling: o.requestsEnabled ? 'on_checkout' : 'off', sender: 'not_running', scheduled: 4, overdueNotSent: 2, sent: 0 }, reminder: 'off', propagation: 'live' },
  sms: { configured: false, sender: 'none', lastValidatedAt: null, lastError: null }, providers: { connected: 0 },
  salonRow: { version, exists: version > 0, updatedAt: null }, lastChange: null, checkedAt: '2026-11-02T15:00:00Z' });
const mount = () => render(<POSAIReviewReputationSettingsScreen />);
beforeEach(() => {
  for (const f of Object.values(rs)) f.mockReset();
  perms.deny = [];
  rs.state.mockResolvedValue(STATE());
});

describe('POSAIReviewReputationSettingsScreen', () => {
  it('keeps the title and the eight controls with their photographed values and sources; Save is idle until something changes', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Review & Reputation Settings' })).toBeInTheDocument();
    expect(await screen.findByTestId('in-enabled')).toBeChecked();
    expect(screen.getByTestId('in-responseTone')).toHaveValue('professional');
    expect(screen.getByTestId('in-approvalRequired')).toBeChecked();
    expect(screen.getByTestId('in-autoResponse')).not.toBeChecked();
    expect(screen.getByTestId('in-requestsEnabled')).not.toBeChecked();
    expect(screen.getByTestId('in-channel')).toHaveValue('sms');
    expect(screen.getByTestId('in-delayMinutes')).toHaveValue(120);
    expect(screen.getByTestId('in-oneReminder')).not.toBeChecked();
    expect(screen.getByTestId('row-responseTone-src')).toHaveTextContent('Default');
    expect(screen.getByTestId('row-approvalRequired-note')).toHaveTextContent(/only from a draft a person approved/);
    expect(screen.getByTestId('rssx-save')).toBeDisabled();
  });

  it('Review Reputation 08: the review-site inventory shows each site\'s real connection, what the platform can do there and reviews on record; own feedback apart', async () => {
    rs.state.mockResolvedValue({ ...STATE(), providerInventory: {
      external: [
        { source: 'google', provider: 'google_business_profile', connector: 'connected', connections: 1, lastSuccessfulSyncAt: '2026-11-10T12:00:00Z', lastFailedSyncAt: null, autoImport: false, replyByApi: true, reviews: 2, lastReviewAt: null },
        { source: 'facebook', provider: 'facebook_pages', connector: 'disconnected', connections: 0, lastSuccessfulSyncAt: null, lastFailedSyncAt: '2026-10-02T08:00:00Z', autoImport: false, replyByApi: false, reviews: 0, lastReviewAt: null },
        { source: 'yelp', provider: null, connector: 'no_connector', connections: 0, lastSuccessfulSyncAt: null, lastFailedSyncAt: null, autoImport: false, replyByApi: false, reviews: 1, lastReviewAt: null }],
      internal: { sources: [{ source: 'internal', reviews: 1, lastReviewAt: null }], reviews: 1, requestsSent: 3 } } });
    mount();
    const g = await screen.findByTestId('rssx-inv-google');
    expect(g).toHaveTextContent('Google Business Profile'); expect(g).toHaveTextContent('Connected'); expect(g).toHaveTextContent('Approved replies can be posted from here'); expect(g).toHaveTextContent('Not imported automatically');
    expect(screen.getByTestId('rssx-inv-facebook')).toHaveTextContent(/Disconnected.*failed Oct 2, 2026.*Reply on the site itself/);
    expect(screen.getByTestId('rssx-inv-yelp')).toHaveTextContent('No connector available');
    expect(screen.getByTestId('rssx-inv-internal')).toHaveTextContent('1 on record · 3 review requests sent');
    expect(rs.save).not.toHaveBeenCalled();
  });
  it('Settings 05: provider freshness (last sync, a failing provider) and the publish / request queues are shown; nothing changes', async () => {
    rs.state.mockResolvedValue({ ...STATE(), providers: { connected: 2, lastSuccessfulSyncAt: '2026-11-11T13:00:00Z', lastFailedSyncAt: '2026-11-11T17:00:00Z', failing: 1 },
      publishQueue: { approvedNotPublished: 2, publishFailed: 1 } });
    mount();
    expect(await screen.findByTestId('rssx-provider-sync')).toHaveTextContent(/^Last successful sync: Nov 11, 2026/);
    expect(screen.getByTestId('rssx-provider-failing')).toHaveTextContent('1 provider(s) failed their latest sync');
    const r = screen.getByTestId('rssx-risks');
    expect(r).toHaveTextContent('2 approved public reply(ies) waiting to be published.');
    expect(r).toHaveTextContent('1 public reply(ies) failed to publish');
    expect(r).toHaveTextContent('2 review request(s) are past their send time and not sent.');
    expect(rs.save).not.toHaveBeenCalled();
  });
  it('a change is marked unsaved; Save confirms the change and sends ONLY it with the version and reason', async () => {
    rs.save.mockResolvedValue({ version: 1, state: STATE({ requestsEnabled: true }, 1) });
    mount();
    fireEvent.click(await screen.findByTestId('in-requestsEnabled'));
    expect(screen.getByTestId('rssx-dirty')).toHaveTextContent('1');
    expect(screen.getByTestId('row-requestsEnabled-note')).toHaveTextContent(/nothing is sent/);
    expect(screen.getByTestId('row-channel-note')).toHaveTextContent(/no SMS sender/);
    fireEvent.click(screen.getByTestId('rssx-save'));
    expect(screen.getByTestId('rssx-confirm-list')).toHaveTextContent('Off → On');
    fireEvent.change(screen.getByTestId('rssx-reason'), { target: { value: 'ask everyone' } });
    fireEvent.click(screen.getByTestId('rssx-confirm-go'));
    await waitFor(() => expect(rs.save).toHaveBeenCalledWith({ values: { requestsEnabled: true }, expectedVersion: 0, reason: 'ask everyone' }));
    expect(await screen.findByTestId('rssx-notice')).toHaveTextContent('version 1');
    expect(screen.queryByTestId('rssx-dirty')).toBeNull();
  });

  it('automatic replies with approval on cannot be saved; the note explains it', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('in-autoResponse'));
    expect(screen.getByTestId('row-autoResponse-note')).toHaveTextContent(/cannot be on while/);
    expect(screen.getByTestId('rssx-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('in-approvalRequired'));
    expect(screen.getByTestId('row-autoResponse-note')).toHaveTextContent(/nothing runs automatic replies/);
    expect(screen.getByTestId('rssx-save')).not.toBeDisabled();
  });

  it('an out-of-range delay blocks Save; a failed save keeps the changes and says nothing was saved', async () => {
    rs.save.mockRejectedValue({ status: 500 });
    mount();
    fireEvent.change(await screen.findByTestId('in-delayMinutes'), { target: { value: '20000' } });
    expect(screen.getByTestId('row-delayMinutes-note')).toBeInTheDocument();
    expect(screen.getByTestId('rssx-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('in-delayMinutes'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('rssx-save'));
    fireEvent.click(screen.getByTestId('rssx-confirm-go'));
    expect(await screen.findByTestId('rssx-confirm-err')).toHaveTextContent(/nothing was changed/);
    await waitFor(() => expect(rs.save).toHaveBeenCalledWith(expect.objectContaining({ values: { delayMinutes: 90 } })));
    expect(screen.getByTestId('in-delayMinutes')).toHaveValue(90);
  });

  it('a stale version reloads and tells the person their changes were not saved', async () => {
    rs.save.mockRejectedValue({ body: { code: 'RSS_STALE_VERSION' } });
    mount();
    fireEvent.click(await screen.findByTestId('in-oneReminder'));
    fireEvent.click(screen.getByTestId('rssx-save'));
    fireEvent.click(screen.getByTestId('rssx-confirm-go'));
    expect(await screen.findByTestId('rssx-notice')).toHaveTextContent(/were not saved/);
    await waitFor(() => expect(rs.state).toHaveBeenCalledTimes(2));
  });

  it('a role without manage sees the values but cannot change or save them', async () => {
    perms.deny = ['pos.ai_review_reputation.manage'];
    mount();
    expect(await screen.findByTestId('in-enabled')).toBeDisabled();
    expect(screen.queryByTestId('rssx-save')).toBeNull();
  });

  it('history lists changes newest first with filters; the check renders localized detail', async () => {
    rs.history.mockResolvedValue({ items: [{ id: 'e1', type: 'settings_changed', changes: [{ key: 'responseTone', before: 'professional', after: 'warm', beforeKnown: true }], legacy: false, actor: 'Owner', role: 'OWNER', version: 2, at: '2026-11-02T15:00:00Z' }],
      total: 1, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' } });
    rs.event.mockResolvedValue({ id: 'e1', level: 'tenant', type: 'settings_changed', changes: [{ key: 'responseTone', before: 'professional', after: 'warm', beforeKnown: true }], actor: 'Owner', role: 'OWNER', version: 2, reason: null,
      at: '2026-11-02T15:00:00Z', legacy: false, propagation: { mode: 'live', aiDraftsSince: 3, requestsScheduledSince: 0 } });
    rs.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [{ key: 'requests_sender', state: 'WARNING' }, { key: 'request_dry_run', state: 'WARNING', count: 3,
      detail: { days: 7, visits: 6, capped: false, wouldAsk: 3, skipped: 3, byReason: { opted_out: 1, no_contact_method: 1, frequency_cap: 1 }, quietHoursShifted: 1, channel: 'sms', channelReady: false, requestsEnabled: false,
        cost: { state: 'NOT_AVAILABLE', reason: 'no_per_message_price_for_review_requests' },
        recipients: [{ ticketId: 'k1', customerId: 'c1', name: 'Linh T.', phoneLast4: '0141', wouldAsk: true, reason: null, scheduledFor: '2026-11-02T20:00:00Z', channel: 'sms' },
          { ticketId: 'k2', customerId: 'c2', name: 'Mai N.', phoneLast4: null, wouldAsk: false, reason: 'no_contact_method', scheduledFor: null, channel: 'sms' }] } }] });
    mount();
    fireEvent.click(await screen.findByTestId('tab-history'));
    expect(await screen.findByTestId('rssx-hist-row')).toHaveTextContent('Response tone');
    fireEvent.change(screen.getByTestId('rssx-hist-type'), { target: { value: 'assistant_disabled' } });
    await waitFor(() => expect(rs.history).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'assistant_disabled', page: 1 })));
    fireEvent.click(screen.getByTestId('rssx-hist-row'));
    expect(await screen.findByTestId('rssx-event-changes')).toHaveTextContent('Professional');
    expect(screen.getByTestId('rssx-event-changes')).toHaveTextContent('Warm');
    fireEvent.click(screen.getByTestId('tab-health'));
    fireEvent.click(screen.getByTestId('rssx-check'));
    expect(await screen.findByTestId('chk-requests_sender')).toHaveTextContent(/nothing is sent/);
    // extras 03: the dry run of the current request policy, worded from the server's counts and reason codes
    expect(screen.getByTestId('chk-request_dry_run')).toHaveTextContent('Dry run of review requests (last 7 days) · 3');
    const dry = screen.getByTestId('rssx-dry-run');
    expect(dry).toHaveTextContent('Last 7 days: 6 paid visits — 3 would be asked, 3 would be skipped (opted out or suppressed 1 · no phone / email 1 · already asked this period 1)');
    expect(dry).toHaveTextContent('1 would be moved out of quiet hours. Channel: SMS. The salon’s SMS sender is not connected.');
    expect(dry).toHaveTextContent('Review requests are turned off');
    expect(dry.textContent).not.toMatch(/frequency_cap|no_contact_method|opted_out/);
    // extras Reviews 07 (round 10): the exact recipients (short name, last 4 only) and the cost stated as not available
    const rows = screen.getAllByTestId('rssx-dry-recipient'); expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Linh T.'); expect(rows[0]).toHaveTextContent('•••0141'); expect(rows[0]).toHaveTextContent('Would be asked by SMS');
    expect(rows[1]).toHaveTextContent('Mai N.'); expect(rows[1]).toHaveTextContent('no phone / email'); expect(rows[1].textContent).not.toMatch(/no_contact_method/);
    expect(screen.getByTestId('rssx-dry-cost')).toHaveTextContent('no per-message price');
    expect(rs.save).not.toHaveBeenCalled();
  });

  it('extras Reviews Reputation 07 (round 11): with a platform price per text set, the dry run shows the server\'s estimate (whole cents × recipients); an unusable price is said, never estimated here', async () => {
    const detail = (cost: Record<string, unknown>) => ({ overall: 'PASSED', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [{ key: 'request_dry_run', state: 'PASSED', count: 3,
      detail: { days: 7, visits: 6, capped: false, wouldAsk: 3, skipped: 3, byReason: {}, quietHoursShifted: 0, channel: 'sms', channelReady: true, requestsEnabled: true, cost, recipients: [] } }] });
    rs.check.mockResolvedValueOnce(detail({ state: 'ESTIMATE', unitPriceCents: 4, recipients: 3, estimatedCents: 12 }));
    const v = mount();
    fireEvent.click(await screen.findByTestId('tab-health'));
    fireEvent.click(screen.getByTestId('rssx-check'));
    expect(await screen.findByTestId('rssx-dry-cost')).toHaveTextContent('Estimated cost: $0.12 (3 texts × $0.04 each)');
    expect(screen.getByTestId('rssx-dry-cost')).toHaveTextContent('nothing is sent or billed');
    v.unmount();
    rs.check.mockResolvedValueOnce(detail({ state: 'NOT_AVAILABLE', reason: 'price_setting_invalid' }));
    mount();
    fireEvent.click(await screen.findByTestId('tab-health'));
    fireEvent.click(screen.getByTestId('rssx-check'));
    expect(await screen.findByTestId('rssx-dry-cost')).toHaveTextContent('not a whole number of cents');
    expect(rs.save).not.toHaveBeenCalled();
  });
  it('Settings 02 + 05 (round 10): each control shows the server\'s exact lock reason; role-based security failures, the running revision and an Open Integrations shortcut are shown; nothing changes', async () => {
    const base = STATE();
    rs.state.mockResolvedValue({ ...base,
      settings: base.settings.map((x: any) => (x.key === 'responseTone' ? { ...x, value: 'warm', source: 'branch', lockReason: 'branch_override' } : x.key === 'requestsEnabled' ? { ...x, lockReason: 'assistant_disabled' } : { ...x, lockReason: null })),
      securityFailures: { windowDays: 7, privilegeEscalation: 2, crossTenant: 1, lastAt: '2026-11-11T13:00:00Z' },
      appliedRevision: { version: 5, at: '2026-11-10T13:00:00Z', by: 'Owner', propagation: 'live' } });
    mount();
    expect(await screen.findByTestId('row-responseTone-lock')).toHaveTextContent('This branch has its own value');
    expect(screen.getByTestId('row-requestsEnabled-lock')).toHaveTextContent('The assistant is off');
    expect(screen.queryByTestId('row-enabled-lock')).toBeNull();
    expect(screen.getByTestId('rssx-security')).toHaveTextContent('2 privilege-escalation and 1 cross-salon access attempt(s) were refused');
    expect(screen.getByTestId('rssx-open-integrations').getAttribute('href')).toBe('/tenant/integrations/apps');
    expect(screen.getByTestId('rssx-applied')).toHaveTextContent('Running revision v5');
    expect(rs.save).not.toHaveBeenCalled();
  });
  it('an older server (no lock reasons, no security block) shows neither — never an invented reason', async () => {
    mount();
    await screen.findByTestId('row-enabled');
    expect(screen.queryByTestId('row-responseTone-lock')).toBeNull();
    expect(screen.queryByTestId('rssx-security')).toBeNull();
  });
});
