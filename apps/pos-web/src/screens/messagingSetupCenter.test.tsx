// messagingSetupCenter.test — extras TEXT MESSAGING SETUP 15 "Safe Configuration Export": the support report is built from
// the readiness parts + branch senders the page already shows, and never carries a token, a customer destination or an id.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ overview: vi.fn(), branches: vi.fn(), activity: vi.fn(), detail: vi.fn() }));
vi.mock('../api/posMessagingSetupApi', () => ({ posMessagingSetupApi: api }));
import { SmsReadinessPanel, buildSupportReport, redactSupportText } from './messagingSetupCenter';
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
