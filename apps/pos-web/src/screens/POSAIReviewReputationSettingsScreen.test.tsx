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
      detail: { days: 7, visits: 6, capped: false, wouldAsk: 3, skipped: 3, byReason: { opted_out: 1, no_contact_method: 1, frequency_cap: 1 }, quietHoursShifted: 1, channel: 'sms', channelReady: false, requestsEnabled: false } }] });
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
    expect(rs.save).not.toHaveBeenCalled();
  });
});
