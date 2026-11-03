// POSMessagingSetupScreen.test — BUILD_PLAN Phase 4: the salon connects its Verify Service, tests it, disconnects, and
// gives a branch its own Twilio. Phone & Messaging guide (Oct 30 2026): the API key SID needs its secret, an unreachable
// Twilio is never silently saved, a number is bought only after a reviewed confirmation, and a test SMS needs a
// confirmation (with an idempotency key) and shows Accepted — never Delivered — until Twilio's callback.
// Round 2 (Oct 30 2026): the SIDs arrive masked and the full SID only through "Show full SID" (PM-02, plus a screen
// secret-safety scan); a branch test SMS shows and uses that branch's effective configuration, only for an authorized
// branch (PM-01); Registration shows what Twilio confirmed, Refresh Status, the outage state (PM-03) and toll-free (PM-04).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() } }));
// the Setup Center panels (overview / branch senders / activity) have their own API; this file tests the credential, Verify, number
// and test-SMS flows, so the center gets a quiet, honest fixture
vi.mock('../api/posMessagingSetupApi', () => ({ posMessagingSetupApi: {
  overview: vi.fn(async () => ({ generatedAt: '2026-10-30T12:00:00Z', scope: { branchId: null, branchName: null, source: 'tenant_default' }, overall: 'ready', parts: [],
    delivery: { statusCallbackUrl: true, lastStatusEventAt: null, waitingOver2h: 0, failedTests24h: 0, failedSms24h: 0, awaitingReports: 0 },
    wizard: { steps: [], resumeAt: 'account' }, schedule: { enabled: false, lastScheduledAt: null, lastCheckAt: null, runsAt: '03:00', mode: 'off' }, note: '' })),
  branches: vi.fn(async () => ({ salonDefault: { accountSidMasked: 'AC…1111', sender: '+18565550111', senderType: 'local', source: 'tenant_default' }, branches: [], rule: '' })),
  activity: vi.fn(async () => ({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1, basis: 'created', period: { preset: 'month', from: null, to: null, tz: 'America/New_York', today: '2026-10-30' } })),
  detail: vi.fn(),
} }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn(async () => ({ branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Uptown' }] })) } }));
import { api } from '../api/client';
import { readinessFixture, regItem } from './phoneMessagingTestKit';
import { POSMessagingSetupScreen } from './POSMessagingSetupScreen';

const VA = 'VA' + 'a'.repeat(32);
const view = (over: Record<string, unknown> = {}) => ({ tenantId: 't1', branchId: null, provider: 'twilio', status: 'configured', accountSid: 'AC…1111', accountSidLast4: '1111', fromNumber: '+18565550100', authTokenLast4: 'abcd',
  verifyServiceSid: VA, apiKeySid: null, hasApiKeySecret: false, lastValidatedAt: null, lastValidationError: null, branchOverride: false, ...over });
const renderIt = () => render(<MemoryRouter><POSMessagingSetupScreen /></MemoryRouter>);

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as any).mockReset();
  vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view(p.includes('/branches/b2') ? { branchId: 'b2' } : {})
    : p.startsWith('/tenant/messaging/readiness') ? readinessFixture() : { configured: true, available: [] }) as never);
});

describe('Twilio Verify on the setup screen', () => {
  it('shows that Verify is untested, and "Test Verify" reports and reloads', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, friendlyName: 'My Salon' } as never);
    renderIt();
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Verify not tested yet');
    fireEvent.click(screen.getByText('Test Verify'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/credentials/test-verify', {}));
    expect(await screen.findByTestId('verify-msg')).toHaveTextContent('Verify works — "My Salon"');
  });
  it('saves the Verify Service SID and an API key (secret write-only)', async () => {
    vi.mocked(api.put).mockResolvedValue(view({ apiKeySid: 'SK' + 'c'.repeat(32), hasApiKeySecret: true }) as never);
    renderIt();
    fireEvent.change(await screen.findByLabelText('API key SID'), { target: { value: 'SK' + 'c'.repeat(32) } });
    fireEvent.change(screen.getByLabelText('API key secret'), { target: { value: 'shh' } });
    fireEvent.click(screen.getByText('Save credentials'));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0]).toEqual(['/tenant/messaging/credentials', expect.objectContaining({ verifyServiceSid: VA, apiKeySid: 'SK' + 'c'.repeat(32), apiKeySecret: 'shh' })]);
    expect(await screen.findByText(/run "Test Verify"/)).toBeTruthy();
  });
  it('an API key SID without its secret cannot be saved (a SID is not a secret)', async () => {
    renderIt();
    fireEvent.change(await screen.findByLabelText('API key SID'), { target: { value: 'SK' + 'c'.repeat(32) } });
    expect(await screen.findByTestId('pm-key-needs-secret')).toBeInTheDocument();
    expect(screen.getByText('Save credentials').closest('button')).toBeDisabled();
  });
  it('Twilio unreachable: nothing is saved until the owner chooses "Save without checking"', async () => {
    vi.mocked(api.put).mockRejectedValueOnce(Object.assign(new Error('Twilio could not be reached'), { code: 'MESSAGING_PROVIDER_UNREACHABLE', status: 503 }) as never).mockResolvedValueOnce(view() as never);
    renderIt();
    fireEvent.change(await screen.findByLabelText('Auth Token'), { target: { value: 'new-token' } });
    fireEvent.click(screen.getByText('Save credentials'));
    expect(await screen.findByTestId('pm-ask-unverified')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save without checking'));
    await waitFor(() => expect(vi.mocked(api.put).mock.calls[1][1]).toEqual(expect.objectContaining({ confirmUnverified: true })));
  });
  it('a failed test is shown with its reason', async () => {
    vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view({ lastValidationError: 'Twilio refused these credentials for this Verify Service.' }) : p.startsWith('/tenant/messaging/readiness') ? readinessFixture() : {}) as never);
    renderIt();
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Verify test failed: Twilio refused');
  });
  it('disconnect shows the impact and needs the typed confirmation', async () => {
    vi.mocked(api.del).mockResolvedValue({ ok: true } as never);
    renderIt();
    fireEvent.click(await screen.findByText('Disconnect'));
    const dlg = await screen.findByTestId('pm-disconnect');
    expect(within(dlg).getByTestId('pm-impact')).toHaveTextContent('2 branch(es) inherit this setup');
    const btn = within(dlg).getAllByText('Disconnect').map((n) => n.closest('button')!).find((b) => b.closest('.fk-dialog-foot'))!;
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.change(within(dlg).getByLabelText('Confirmation word'), { target: { value: 'disconnect' } });
    fireEvent.click(btn);
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/tenant/messaging/credentials'));
  });
  it('a branch that inherits says so; saving there creates its own', async () => {
    vi.mocked(api.put).mockResolvedValue(view({ branchId: 'b2', branchOverride: true }) as never);
    renderIt();
    fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'b2' } });
    expect(await screen.findByText(/uses the salon’s Twilio/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Account SID'), { target: { value: 'AC' + '2'.repeat(32) } });
    fireEvent.change(screen.getByLabelText('Verify Service SID'), { target: { value: VA } });
    fireEvent.click(screen.getByText('Save credentials'));
    await waitFor(() => expect(vi.mocked(api.put).mock.calls[0][0]).toBe('/tenant/messaging/credentials/branches/b2'));
  });
});

describe('number search and the deliberate purchase', () => {
  it('search never buys; Review shows the provider price (or says none was returned); Buy sends the confirmation', async () => {
    vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view() : p.startsWith('/tenant/messaging/readiness') ? readinessFixture()
      : { configured: true, available: [{ phoneNumber: '+18565550199', friendlyName: '(856) 555-0199', locality: 'Camden', region: 'NJ', capabilities: { sms: true, voice: true, mms: false } }] }) as never);
    vi.mocked(api.post).mockImplementation(async (p: string) => (p === '/tenant/messaging/number/quote'
      ? { ok: true, confirmationToken: 'tok-1', phoneNumber: '+18565550199', capabilities: { sms: true, voice: true, mms: false }, price: null, priceNote: 'price_not_returned_by_provider', expiresAt: '2026-10-30T15:10:00.000Z', billedTo: 'salon_account', replacesNumber: '+18565550100' }
      : { ok: true, number: '+18565550199' }) as never);
    renderIt();
    fireEvent.click(await screen.findByText('Search'));
    fireEvent.click(await screen.findByText('Review & buy'));
    expect(api.post).toHaveBeenCalledWith('/tenant/messaging/number/quote', { phoneNumber: '+18565550199' });
    expect(api.post).not.toHaveBeenCalledWith('/tenant/messaging/number/buy', expect.anything());
    expect(await screen.findByTestId('pm-buy-price')).toHaveTextContent('Price not returned by provider');
    fireEvent.click(screen.getByText('Buy this number'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/number/buy', { phoneNumber: '+18565550199', confirmationToken: 'tok-1' }));
  });
});

describe('test SMS', () => {
  it('needs a confirmation, sends once with an idempotency key, and reports Accepted — not Delivered', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, sid: 'SM00000000000000000000000000abc123', status: 'accepted', warnings: [] } as never);
    renderIt();
    fireEvent.change(await screen.findByLabelText('Send to (E.164)'), { target: { value: '+15551230000' } });
    fireEvent.click(screen.getByText('Send test SMS'));
    expect(api.post).not.toHaveBeenCalledWith('/tenant/messaging/credentials/test', expect.anything());
    fireEvent.click(await screen.findByText('Send once'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/credentials/test', expect.objectContaining({ to: '+15551230000', confirm: true, idempotencyKey: expect.any(String) })));
    expect(await screen.findByTestId('pm-test-msg')).toHaveTextContent('Twilio accepted the message');
    expect(screen.getByTestId('pm-test-msg')).not.toHaveTextContent(/^Delivered/);
  });
  it('PM-01: for a branch it shows the EFFECTIVE configuration and sends through that branch’s route', async () => {
    const branchRd = readinessFixture({ source: 'branch_override', scope: { ...readinessFixture().scope, branchId: 'b2', branchName: 'Uptown' },
      account: { ...readinessFixture().account, accountSidLast4: '2222', accountSidMasked: 'AC…2222' }, sender: { ...readinessFixture().sender, number: '+18565550222' } });
    vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view(p.includes('/branches/b2') ? { branchId: 'b2', branchOverride: true, accountSid: 'AC…2222', fromNumber: '+18565550222' } : {})
      : p === '/tenant/messaging/readiness/branches/b2' ? branchRd : p.startsWith('/tenant/messaging/readiness') ? readinessFixture() : {}) as never);
    vi.mocked(api.post).mockResolvedValue({ ok: true, sid: 'SM' + '0'.repeat(26) + 'abc123', status: 'accepted', displayState: 'accepted', branchId: 'b2', configSource: 'branch_override', warnings: [] } as never);
    renderIt();
    fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'b2' } });
    await waitFor(() => expect(screen.getByTestId('pm-test-account')).toHaveTextContent('AC…2222'));
    expect(screen.getByTestId('pm-test-scope')).toHaveTextContent('Uptown');
    expect(screen.getByTestId('pm-test-sender')).toHaveTextContent('+18565550222');
    fireEvent.change(screen.getByLabelText('Send to (E.164)'), { target: { value: '+15551230000' } });
    fireEvent.click(screen.getByText('Send test SMS'));
    fireEvent.click(await screen.findByText('Send once'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/credentials/branches/b2/test', expect.objectContaining({ to: '+15551230000', confirm: true })));
    expect(api.post).not.toHaveBeenCalledWith('/tenant/messaging/credentials/test', expect.anything());
  });
  it('PM-01: a branch this user may not act for offers no test send', async () => {
    const limited = readinessFixture({ scope: { ...readinessFixture().scope, authorizedBranches: [{ branchId: 'b1', name: 'Main', source: 'tenant_default' }] } });
    vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view() : p.startsWith('/tenant/messaging/readiness') ? limited : {}) as never);
    renderIt();
    // the scope selector now offers only the branches the server says this user may act for: with only Main allowed there is
    // no selector at all, so Uptown cannot even be chosen (the old "pick b2 → not allowed" path no longer exists)
    await screen.findByLabelText('Send to (E.164)');
    const sel = screen.queryByLabelText('Branch') as HTMLSelectElement | null;
    if (sel) expect([...sel.options].map((o) => o.value)).not.toContain('b2');
  });
  it('an invalid destination cannot be sent', async () => {
    renderIt();
    fireEvent.change(await screen.findByLabelText('Send to (E.164)'), { target: { value: '5551230000' } });
    expect(screen.getByText('Send test SMS').closest('button')).toBeDisabled();
  });
});

describe('PM-02 Account SID masking', () => {
  it('the SID arrives masked; saving with it unchanged sends the masked value (the server keeps the stored SID)', async () => {
    vi.mocked(api.put).mockResolvedValue(view() as never);
    renderIt();
    expect(await screen.findByTestId('pm-account-sid')).toHaveValue('AC…1111');
    fireEvent.change(screen.getByLabelText('Auth Token'), { target: { value: 'new-token' } });
    fireEvent.click(screen.getByText('Save credentials'));
    await waitFor(() => expect(vi.mocked(api.put).mock.calls[0][1]).toEqual(expect.objectContaining({ accountSid: 'AC…1111' })));
  });
  it('"Show full SID" is the explicit reveal call', async () => {
    vi.mocked(api.post).mockResolvedValue({ accountSid: 'AC' + '1'.repeat(32), branchId: null } as never);
    renderIt();
    fireEvent.click(await screen.findByTestId('pm-reveal-sid'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/credentials/reveal-sid', {}));
    await waitFor(() => expect(screen.getByTestId('pm-account-sid')).toHaveValue('AC' + '1'.repeat(32)));
  });
  it('secret safety: without a reveal, the rendered page never holds a full SID or a secret', async () => {
    renderIt();
    await screen.findByTestId('pm-test-account');
    const html = document.body.innerHTML + Array.from(document.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value).join(' ');
    expect(html).not.toMatch(/(AC|SK)[0-9a-fA-F]{32}/);
    expect(html).not.toContain('abcd-token');
    for (const pw of Array.from(document.querySelectorAll('input[type=password]'))) expect((pw as HTMLInputElement).value).toBe('');
  });
});

describe('PM-03 / PM-04 registration from the provider', () => {
  it('Refresh Status reads Twilio; an outage shows "Unknown — not verified" with the last successful check', async () => {
    const outage = readinessFixture({ a2p: { ...readinessFixture().a2p, state: 'unable_to_verify', reasonCode: 'PROVIDER_READ_PROVIDER_UNAVAILABLE',
      brand: regItem('unable_to_verify', { errorClass: 'provider_unavailable', lastSuccessAt: '2026-10-29T10:00:00.000Z', checkedAt: '2026-10-30T15:00:00.000Z', retryCount: 1, reasonCode: 'PROVIDER_READ_PROVIDER_UNAVAILABLE' }),
      lastProviderSuccessAt: '2026-10-29T10:00:00.000Z', lastRun: { at: '2026-10-30T15:00:00.000Z', outcome: 'provider_unreachable', trigger: 'manual' } } });
    vi.mocked(api.post).mockResolvedValue({ run: { outcome: 'provider_unreachable', errorClass: 'provider_unavailable', finishedAt: null }, replayed: false, readiness: outage } as never);
    renderIt();
    fireEvent.click(await screen.findByTestId('pm-reg-refresh'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/registration/refresh', { idempotencyKey: expect.any(String) }));
    expect(await screen.findByTestId('pm-reg-brand')).toHaveTextContent('Unknown — not verified');
    expect(screen.getByTestId('pm-reg-brand-verified')).toHaveTextContent('Not verified with Twilio');
    expect(screen.getByTestId('pm-reg-brand')).toHaveTextContent('last successful check');
    expect(screen.getByTestId('pm-reg-msg')).toHaveTextContent('Twilio could not be reached');
  });
  it('a toll-free sender shows its own verification and next step — not 10DLC, and nothing to submit here', async () => {
    const tf = readinessFixture({ sender: { ...readinessFixture().sender, number: '+18885550100', senderType: 'toll_free' },
      a2p: { ...readinessFixture().a2p, state: 'not_applicable', applicable: false, reasonCode: 'TOLL_FREE_VERIFICATION_SEPARATE' },
      tollFree: { ...regItem('rejected', { verified: true, providerStatus: 'TWILIO_REJECTED' }), applicable: true, numberType: 'toll_free', numberTypeSource: 'nanp_prefix', verificationSidLast4: '9d9d',
        submittedAt: '2026-10-03T12:00:00.000Z', rejectionCode: '30445', rejectionReason: 'Opt-in proof missing', nextAction: 'EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE' } });
    vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view() : p.startsWith('/tenant/messaging/readiness') ? tf : {}) as never);
    renderIt();
    expect(await screen.findByTestId('pm-tf')).toHaveTextContent('Rejected');
    expect(screen.getByTestId('pm-tf-rejection')).toHaveTextContent('Opt-in proof missing');
    expect(screen.getByTestId('pm-tf-next')).toHaveTextContent('resubmit in the Twilio console');
    expect(screen.queryByTestId('pm-reg-brand')).toBeNull();
    expect(screen.getByText('Not needed for a toll-free number')).toBeInTheDocument();
  });
  it('OPS-01: the webhook section shows the two URL settings and each number’s own inbound webhook', async () => {
    renderIt();
    expect(await screen.findByTestId('pm-config-TWILIO_STATUS_CALLBACK_URL')).toHaveTextContent('Valid');
    expect(screen.getByTestId('pm-wh-numbers')).toHaveTextContent('Points to this app');
  });
});
