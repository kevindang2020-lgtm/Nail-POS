// POSCustomerPhoneEditor.test — the receptionist's side of the canonical phone flow (BUILD_PLAN Phase 3).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const can = { manager: true };
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => (p === 'customers.phone_manage' ? can.manager : true) }));
vi.mock('../api/posCustomersApi', () => ({
  posCustomersApi: {
    phoneStatus: vi.fn(), phoneStart: vi.fn(), phoneSend: vi.fn(), phoneVerify: vi.fn(), phoneCancel: vi.fn(async () => ({})),
    phoneResolve: vi.fn(), phoneApprove: vi.fn(), phoneManualConfirm: vi.fn(), phoneRetrySync: vi.fn(), phoneToDisplay: vi.fn(),
  },
}));
import { posCustomersApi as api } from '../api/posCustomersApi';
import { POSCustomerPhoneEditor, withCountry } from './POSCustomerPhoneEditor';

const status = (over: Record<string, unknown> = {}) => ({
  customerId: 'c1', recordVersion: 7, sync: 'ok', lastChange: null, openChange: null,
  phone: { display: '(856) 555-0101', masked: '••••0101', status: 'active_unverified', verified: false, label: 'Not verified', verifiedAt: null, since: null }, ...over,
});
const mount = (props: Partial<Parameters<typeof POSCustomerPhoneEditor>[0]> = {}) => {
  const onDone = vi.fn(); const onCancel = vi.fn();
  render(<MemoryRouter initialEntries={['/c']}><Routes>
    <Route path="/c" element={<POSCustomerPhoneEditor customerId="c1" customerName="Rita" currentMasked="••••0101" onDone={onDone} onCancel={onCancel} {...props} />} />
    <Route path="/tenant/communications/messaging-setup" element={<div>Messaging setup page</div>} />
  </Routes></MemoryRouter>);
  return { onDone, onCancel };
};
const enterAndSave = async (num = '856 555 0199') => {
  fireEvent.change(await screen.findByLabelText('New phone number'), { target: { value: num } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByText('Save and continue'));
};

beforeEach(() => {
  can.manager = true;
  for (const f of Object.values(api)) (f as any).mockReset?.();
  vi.mocked(api.phoneStatus).mockResolvedValue(status() as never);
  vi.mocked(api.phoneCancel).mockResolvedValue({} as never);
});

describe('the editor opens on the customer’s real phone state', () => {
  it('shows the number and its proof, and sends the server’s record version back', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
    vi.mocked(api.phoneSend).mockResolvedValue({ state: 'verification_sent', message: 'Code sent.' } as never);
    mount();
    expect(await screen.findByTestId('phone-current')).toHaveTextContent('(856) 555-0101');
    expect(screen.getByTestId('phone-current')).toHaveTextContent('Not verified');
    await enterAndSave();
    await waitFor(() => expect(api.phoneStart).toHaveBeenCalled());
    expect(vi.mocked(api.phoneStart).mock.calls[0][1]).toMatchObject({ phone: '+18565550199', expectedVersion: 7 });
  });
  it('a change already in flight is resumed at the code step', async () => {
    vi.mocked(api.phoneStatus).mockResolvedValue(status({ openChange: { sessionId: 's9', state: 'verification_sent', maskedPhone: '••••0177', expired: false, source: 'staff_pos' } }) as never);
    mount();
    expect(await screen.findByText(/••••0177/)).toBeTruthy();
    expect(screen.getByLabelText('Verification code')).toBeTruthy();
  });
});

describe('the flow', () => {
  it('audit E9: with SMS not required the change is DONE — no send call, no false error', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: '', state: 'phone_activated', maskedPhone: '••••0199', duplicates: {} } as never);
    const { onDone } = mount();
    await enterAndSave();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.phoneSend).not.toHaveBeenCalled();
  });
  it('the country selector builds the international number', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••6789', duplicates: {} } as never);
    vi.mocked(api.phoneSend).mockResolvedValue({ state: 'verification_sent', message: '' } as never);
    mount();
    fireEvent.change(await screen.findByLabelText('Country'), { target: { value: '44' } });
    await enterAndSave('7700 900 6789');
    await waitFor(() => expect(vi.mocked(api.phoneStart).mock.calls[0][1].phone).toBe('+4477009006789'));
  });
  it('a change waiting for approval: a manager approves it here, then the code is sent', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'manager_review_required', maskedPhone: '••••0199', duplicates: {} } as never);
    vi.mocked(api.phoneApprove).mockResolvedValue({ state: 'pending_phone_saved', activated: false } as never);
    mount();
    await enterAndSave();
    expect(await screen.findByTestId('phone-approval')).toHaveTextContent('waiting for a manager');
    expect(api.phoneSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Approve change'));
    await waitFor(() => expect(api.phoneApprove).toHaveBeenCalledWith('c1', 's1'));
  });
  it('reception sees the wait, not an Approve button', async () => {
    can.manager = false;
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'manager_review_required', maskedPhone: '••••0199', duplicates: {} } as never);
    mount();
    await enterAndSave();
    await screen.findByTestId('phone-approval');
    expect(screen.queryByText('Approve change')).toBeNull();
  });
  it('a duplicate only a manager may resolve: the manager resolves it with a reason', async () => {
    vi.mocked(api.phoneStart).mockRejectedValue(Object.assign(new Error('dup'), { code: 'duplicate_conflict', duplicates: { outcome: 'multiple_matches', requiresResolution: true, requiresManager: true, matches: [{ customerId: 'x', maskedName: 'Ann L.', status: 'active_verified' }], message: 'Several customers already use this number.' } }));
    vi.mocked(api.phoneResolve).mockResolvedValue({ sessionId: 's2', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
    vi.mocked(api.phoneSend).mockResolvedValue({ state: 'verification_sent', message: '' } as never);
    mount();
    await enterAndSave();
    expect(await screen.findByTestId('manager-resolve')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Manager reason'), { target: { value: 'Mother and two daughters, confirmed in person' } });
    fireEvent.click(screen.getByText('Resolve and continue'));
    await waitFor(() => expect(api.phoneResolve).toHaveBeenCalled());
    expect(vi.mocked(api.phoneResolve).mock.calls[0][1]).toMatchObject({ resolution: 'different_people', reason: 'Mother and two daughters, confirmed in person' });
  });
  it('Twilio not connected: the number is kept and the screen offers Open Twilio Settings', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
    vi.mocked(api.phoneSend).mockRejectedValue(Object.assign(new Error('x'), { code: 'no_provider' }));
    mount();
    await enterAndSave();
    fireEvent.click(await screen.findByText('Open Twilio Settings'));
    expect(await screen.findByText('Messaging setup page')).toBeTruthy();
  });
  it('resend waits out a countdown', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
    vi.mocked(api.phoneSend).mockResolvedValue({ state: 'verification_sent', message: 'Code sent.' } as never);
    mount();
    await enterAndSave();
    const resend = await screen.findByTestId('resend');
    expect(resend).toHaveTextContent(/Resend code in \d+s/);
    expect(resend).toBeDisabled();
  });
  it('a manager can confirm without a code — labelled OTP not completed, reason required', async () => {
    vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
    vi.mocked(api.phoneSend).mockResolvedValue({ state: 'verification_sent', message: '' } as never);
    vi.mocked(api.phoneManualConfirm).mockResolvedValue({ state: 'customer_records_synchronized', label: 'Manually confirmed — OTP not completed' } as never);
    const { onDone } = mount();
    await enterAndSave();
    fireEvent.click(await screen.findByText('Confirm without a code…'));
    expect(screen.getByTestId('manual-confirm')).toHaveTextContent('OTP not completed');
    const confirmBtn = screen.getByText('Confirm without a code', { selector: 'button' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Manual confirmation reason'), { target: { value: 'Her phone is broken, ID checked at desk' } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.phoneManualConfirm).toHaveBeenCalledWith('c1', 's1', '+18565550199', 'Her phone is broken, ID checked at desk');
  });
  it('a synchronisation still running is shown, and a manager can retry it', async () => {
    vi.mocked(api.phoneStatus).mockResolvedValue(status({ sync: 'retrying', lastChange: { sessionId: 's7', state: 'synchronization_failed', completedAt: null } }) as never);
    vi.mocked(api.phoneRetrySync).mockResolvedValue({ state: 'customer_records_synchronized' } as never);
    mount();
    expect(await screen.findByTestId('phone-sync')).toHaveTextContent('still updating');
    fireEvent.click(screen.getByText('Retry now'));
    await waitFor(() => expect(api.phoneRetrySync).toHaveBeenCalledWith('c1', 's7'));
  });
});

describe('withCountry', () => {
  it('composes E.164 from the selector and the digits; a typed "+" wins; a US number typed with its 1 stays one number', () => {
    expect(withCountry('1', '(856) 555-0199')).toBe('+18565550199');
    expect(withCountry('1', '1 856 555 0199')).toBe('+18565550199');
    expect(withCountry('44', '+1 856 555 0199')).toBe('+1 856 555 0199');
    expect(withCountry('84', '090 123 4567')).toBe('+84901234567');          // the trunk 0 is national only
    expect(withCountry('44', '07700 900 678')).toBe('+447700900678');
    expect(withCountry('1', '')).toBe('');
  });
});

describe('the code on the customer display', () => {
  it('puts the pad on the display, waits, and finishes when the change lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.mocked(api.phoneStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
      vi.mocked(api.phoneSend).mockResolvedValue({ state: 'verification_sent', message: 'Code sent.' } as never);
      vi.mocked(api.phoneToDisplay).mockResolvedValue({ ok: true } as never);
      const { onDone } = mount();
      await enterAndSave();
      fireEvent.click(await screen.findByTestId('to-display'));
      await waitFor(() => expect(api.phoneToDisplay).toHaveBeenCalledWith('c1', 's1'));
      expect(await screen.findByText('Waiting for the display…')).toBeTruthy();
      vi.mocked(api.phoneStatus).mockResolvedValue(status({ lastChange: { sessionId: 's1', state: 'customer_records_synchronized', completedAt: '2026-10-07T00:00:00Z' } }) as never);
      await vi.advanceTimersByTimeAsync(3100);
      await waitFor(() => expect(onDone).toHaveBeenCalled());
    } finally { vi.useRealTimers(); }
  });
});
