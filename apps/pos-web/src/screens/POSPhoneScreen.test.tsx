// POSPhoneScreen.test — the Phone & Messaging Center dashboard (owner guide, Oct 30 2026): four INDEPENDENT statuses from
// the shared readiness (connected ≠ registered ≠ delivered), a health check, a guided checklist that deep-links into the
// setup page, Booking Verify and AI voice shown separately, and no green for a stale check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { readinessFixture } from './phoneMessagingTestKit';
const { readinessMock, checkMock, overviewMock } = vi.hoisted(() => ({ readinessMock: vi.fn(), checkMock: vi.fn(), overviewMock: vi.fn() }));
vi.mock('../api/posPhoneApi', () => ({ posPhoneApi: { readiness: readinessMock, healthCheck: checkMock } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: { receptionistOverview: overviewMock } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn(async () => ({ branches: [{ id: 'b1', name: 'Main' }] })) } }));
import { POSPhoneScreen } from './POSPhoneScreen';

function Setup() { const l = useLocation(); return <div>Setup page {l.hash}</div>; }
const renderIt = () => render(<MemoryRouter initialEntries={['/tenant/communications/phone']}><Routes>
  <Route path="/tenant/communications/phone" element={<POSPhoneScreen />} />
  <Route path="/tenant/communications/messaging-setup" element={<Setup />} />
</Routes></MemoryRouter>);

beforeEach(() => {
  readinessMock.mockReset(); checkMock.mockReset(); overviewMock.mockReset();
  overviewMock.mockResolvedValue({ frontDeskStatus: 'live', setupProgressPct: 100 });
});

describe('POSPhoneScreen — Phone & Messaging Center', () => {
  it('shows the four independent statuses: connected to Twilio but carrier registration not started', async () => {
    readinessMock.mockResolvedValue(readinessFixture());
    renderIt();
    expect(await screen.findByTestId('pm-card-twilio')).toHaveTextContent('Connected');
    expect(screen.getByTestId('pm-card-number')).toHaveTextContent('+18565550100');
    expect(screen.getByTestId('pm-card-registration')).toHaveTextContent('Not started');
    expect(screen.getByTestId('pm-card-readiness')).toHaveTextContent('Blocked');
    expect(screen.getByText('Phone & Messaging Center')).toBeInTheDocument();
  });
  it('a stale check is never green', async () => {
    const r = readinessFixture();
    readinessMock.mockResolvedValue({ ...r, account: { ...r.account, state: 'stale', reasonCode: 'CHECK_STALE' } });
    renderIt();
    expect(await screen.findByTestId('pm-card-twilio')).toHaveTextContent('Stale');
    expect(screen.getByTestId('pm-card-twilio').className).not.toContain(' ok');
  });
  it('Run health check calls the server and shows its fresh answer', async () => {
    readinessMock.mockResolvedValue(readinessFixture({ account: { ...readinessFixture().account, state: 'unknown', reasonCode: 'NEVER_CHECKED' } }));
    checkMock.mockResolvedValue(readinessFixture());
    renderIt();
    expect(await screen.findByTestId('pm-card-twilio')).toHaveTextContent('Unknown');
    fireEvent.click(screen.getByTestId('pm-run-check'));
    await waitFor(() => expect(checkMock).toHaveBeenCalledWith(''));
    expect(await screen.findByTestId('pm-card-twilio')).toHaveTextContent('Connected');
  });
  it('the checklist deep-links into the setup section that fixes it', async () => {
    readinessMock.mockResolvedValue(readinessFixture());
    renderIt();
    const step = await screen.findByTestId('pm-step-registration');
    fireEvent.click(step.querySelector('button')!);
    expect(await screen.findByText(/Setup page #registration/)).toBeInTheDocument();
  });
  it('Booking Verify and the AI Receptionist are separate panels', async () => {
    readinessMock.mockResolvedValue(readinessFixture());
    renderIt();
    expect(await screen.findByTestId('pm-verify-state')).toHaveTextContent('Disabled');
    expect(await screen.findByTestId('pm-voice-state')).toHaveTextContent('Ready');
  });
  it('PM-02/PM-03/PM-04: the account is masked; a toll-free sender’s card is its toll-free verification, as Twilio confirmed it', async () => {
    const f = readinessFixture();
    readinessMock.mockResolvedValue(readinessFixture({ sender: { ...f.sender, number: '+18885550100', senderType: 'toll_free' }, a2p: { ...f.a2p, state: 'not_applicable', applicable: false },
      tollFree: { ...f.tollFree!, applicable: true, numberType: 'toll_free', state: 'pending', verified: true, nextAction: 'WAIT_FOR_REVIEW' } }));
    renderIt();
    const card = await screen.findByTestId('pm-card-registration');
    expect(card).toHaveTextContent('Toll-free Verification');
    expect(card).toHaveTextContent('Pending');
    expect(card).toHaveTextContent('Confirmed by Twilio');
    expect(screen.getByTestId('pm-account-masked')).toHaveTextContent('AC…1111');
    expect(document.body.innerHTML).not.toMatch(/AC[0-9a-fA-F]{32}/);
  });
  it('a load failure is shown, not a fabricated status', async () => {
    readinessMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    renderIt();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).toBeNull();
  });
});
