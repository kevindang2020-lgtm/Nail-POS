// messagingSetupCenter.test — extras TEXT MESSAGING SETUP 15 "Safe Configuration Export": the support report is built from
// the readiness parts + branch senders the page already shows, and never carries a token, a customer destination or an id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ overview: vi.fn(), branches: vi.fn(), activity: vi.fn(), detail: vi.fn() }));
vi.mock('../api/posMessagingSetupApi', () => ({ posMessagingSetupApi: api }));
import { SmsReadinessPanel, buildSupportReport, redactSupportText, BranchSenders as BranchSendersPanel } from './messagingSetupCenter';
import type { SetupOverview, BranchSenders } from '../api/posMessagingSetupApi';

const BR_ID = '3f2b8c1e-1111-4222-8333-944455556666';
const OV: SetupOverview = {
  generatedAt: '2026-11-12T15:00:00Z', scope: { branchId: null, branchName: null, source: 'tenant_default' }, overall: 'attention_required',
  parts: [
    { key: 'account', state: 'ready', summary: 'Twilio accepted these credentials at the last check.', evidence: "the salon's own Twilio AC…9f3a · auth token", source: 'provider check', checkedAt: '2026-11-12T14:00:00Z', nextAction: null, fixLink: '#' },
    { key: 'sender', state: 'ready', summary: 'The sending number is on this Twilio account.', evidence: '+12155550123 · toll-free · SMS-capable · salon default', source: 'provider check', checkedAt: '2026-11-12T14:00:00Z', nextAction: null, fixLink: '#' },
    { key: 'delivery', state: 'attention_required', summary: '2 text(s) failed in the last 24 hours.', evidence: `status callback URL set · last verified report 2026-11-12T13:00:00.000Z · tenant ${BR_ID} · owner ann@example.com`, source: 'delivery reports', checkedAt: null, nextAction: 'Open Customer Notifications → Failed for the provider error codes.', fixLink: '#' },
  ],
  delivery: { statusCallbackUrl: true, lastStatusEventAt: '2026-11-12T13:00:00Z', waitingOver2h: 1, failedTests24h: 0, failedSms24h: 2, awaitingReports: 1 },
  wizard: { steps: [], resumeAt: 'summary' }, schedule: { enabled: false, lastScheduledAt: null, lastCheckAt: '2026-11-12T14:00:00Z', runsAt: 'nightly', mode: 'read-only' }, note: '',
};
const BR: BranchSenders = { salonDefault: { accountSidMasked: 'AC…9f3a', sender: '+12155550123', senderType: 'toll_free', source: 'tenant_default' }, rule: '',
  branches: [{ branchId: BR_ID, name: 'Cherry Hill', source: 'tenant_default', inherits: true, accountSidMasked: 'AC…9f3a', sender: '+12155550123', senderType: 'toll_free', registration: 'ready', parts: [], lastCheckedAt: null }] };

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

describe('SMS setup support report (masked)', () => {
  it('lists every part, the delivery line and each branch sender — with no id, email, full number or token', () => {
    const r = buildSupportReport(OV, BR);
    expect(r).toMatch(/SMS setup & readiness report/);
    expect(r).toMatch(/Account: Ready/);
    expect(r).toMatch(/Delivery: 2 failed in 24 h · 1 waiting over 2 h/);
    expect(r).toMatch(/Cherry Hill: Inherits salon default · AC…9f3a · …0123 \(toll_free\)/);
    expect(r).toMatch(/2026-11-12T13:00:00\.000Z/);   // a date is not a phone number
    expect(r).not.toContain(BR_ID);
    expect(r).not.toMatch(/2155550123|ann@example\.com/);
    expect(r).toMatch(/Excluded from this report/);
  });
  it('redaction: ids, SIDs, emails, long digit runs and token-like strings never survive', () => {
    const sid = 'AC' + 'a'.repeat(28) + '1234';
    const out = redactSupportText(`${BR_ID} ${sid} bo@salon.co (215) 555-0199 ${'x'.repeat(40)} count 12`);
    expect(out).toBe('[id] AC…1234 [email] …0199 [hidden] count 12');
  });
  it('without branch senders the report says so (and still builds)', () => {
    expect(buildSupportReport(OV, null)).toMatch(/Branch senders: could not be read/);
  });
  it('the Support report button opens the dialog with the masked text; nothing is sent', async () => {
    api.branches.mockResolvedValue(BR);
    render(<SmsReadinessPanel ov={OV} error={null} onOpen={() => undefined} />);
    fireEvent.click(screen.getByTestId('ms-report-open'));
    const box = await screen.findByTestId('ms-report-text') as HTMLTextAreaElement;
    expect(box.value).toMatch(/Cherry Hill/);
    expect(box.value).not.toContain(BR_ID);
    expect(box.readOnly).toBe(true);
    await waitFor(() => expect(api.branches).toHaveBeenCalledTimes(1));
    expect(api.overview).not.toHaveBeenCalled(); expect(api.activity).not.toHaveBeenCalled();
  });
});

// extras TEXT MESSAGING SETUP 07 / 09 (round 10): per-branch Ready / Pending / Blocked + next actions, and the read-only sender
// simulator (what reminders, a test text and booking codes would use, with the STOP rule)
describe('Branch senders — summary, next actions and simulator', () => {
  it('shows the server summary, the next actions and each route with its STOP rule', async () => {
    api.branches.mockResolvedValue({ ...BR, branches: [{ ...BR.branches[0], summary: { ready: 3, pending: 1, blocked: 2 },
      nextActions: [{ key: 'registration', state: 'attention_required', nextAction: 'Submit the toll-free verification', fixLink: '#registration' }, { key: 'delivery', state: 'failed', nextAction: 'Fix the status callback', fixLink: '#webhooks' }],
      routes: { reminders: { account: 'AC…9f3a', number: '+12155550123', messagingServiceSidLast4: '7c1d', via: 'messaging_service', sendable: true, stopRule: 'blocked_by_stop' },
        testSms: { account: 'AC…9f3a', number: '+12155550123', messagingServiceSidLast4: '7c1d', via: 'number', sendable: true, stopRule: 'not_applicable' },
        otp: { account: 'AC…9f3a', verifyServiceSidLast4: 'b2e0', via: 'verify_service', sendable: false, stopRule: 'sent_despite_stop' } } }] });
    render(<BranchSendersPanel onConfigure={() => {}} />);
    expect(await screen.findByTestId('ms-br-sum-' + BR_ID)).toHaveTextContent('3 ready · 1 pending · 2 blocked');
    expect(screen.getByTestId('ms-br-next-' + BR_ID).textContent).toMatch(/^Next: .+, .+$/);
    expect(screen.getByTestId(`ms-br-sim-${BR_ID}-reminders`)).toHaveTextContent('Reminders & follow-ups: Messaging Service MG…7c1d (number +12155550123) · can send · not sent to people who texted STOP');
    expect(screen.getByTestId(`ms-br-sim-${BR_ID}-testSms`)).toHaveTextContent('Test text: number +12155550123 · can send');
    expect(screen.getByTestId(`ms-br-sim-${BR_ID}-otp`)).toHaveTextContent('Booking codes: Verify service VA…b2e0 · cannot send yet · sent even after STOP (transactional)');
  });
  it('an older server without them shows the row as before', async () => {
    api.branches.mockResolvedValue(BR);
    render(<BranchSendersPanel onConfigure={() => {}} />);
    await screen.findByTestId('ms-br-' + BR_ID);
    expect(screen.queryByTestId('ms-br-sum-' + BR_ID)).toBeNull(); expect(screen.queryByTestId('ms-br-sim-' + BR_ID)).toBeNull();
  });
});
