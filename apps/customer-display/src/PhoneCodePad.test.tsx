// PhoneCodePad.test — BUILD_PLAN Phase 3: the customer types the phone-change code on the display facing them.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ submitPhoneCode: vi.fn() }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), submitPhoneCode: api.submitPhoneCode }));
import { PhoneCodePad } from './PhoneCodePad';

const creds = { mode: 'device', deviceToken: 'd1' } as const;
const type = (digits: string) => { for (const d of digits) fireEvent.click(screen.getByRole('button', { name: d })); };

beforeEach(() => api.submitPhoneCode.mockReset());

describe('PhoneCodePad', () => {
  it('shows only the masked number, and sends exactly the six digits typed', async () => {
    api.submitPhoneCode.mockResolvedValue({ ok: true, message: 'Your new number is confirmed.' });
    const onDone = vi.fn();
    render(<PhoneCodePad creds={creds} maskedPhone="••••0199" onDone={onDone} />);
    expect(screen.getByText('••••0199')).toBeTruthy();
    const confirm = screen.getByText('Confirm');
    type('12345'); expect(confirm).toBeDisabled();
    type('67');                                              // a seventh digit is ignored
    expect(screen.getByTestId('pad-code')).toHaveTextContent('123456');
    fireEvent.click(confirm);
    await waitFor(() => expect(api.submitPhoneCode).toHaveBeenCalledWith(creds, '123456'));
    expect(await screen.findByTestId('pad-message')).toHaveTextContent('Your new number is confirmed.');
  });
  it('a wrong code shows the server’s message and clears the entry for another try', async () => {
    api.submitPhoneCode.mockResolvedValue({ ok: false, message: 'That code is incorrect.' });
    render(<PhoneCodePad creds={creds} maskedPhone="••••0199" onDone={vi.fn()} />);
    type('111111'); fireEvent.click(screen.getByText('Confirm'));
    expect(await screen.findByTestId('pad-message')).toHaveTextContent('That code is incorrect.');
    expect(screen.getByTestId('pad-code')).toHaveTextContent('······');
  });
  it('Not now closes the pad', () => {
    const onDone = vi.fn();
    render(<PhoneCodePad creds={creds} maskedPhone="••••0199" onDone={onDone} />);
    fireEvent.click(screen.getByText('Not now'));
    expect(onDone).toHaveBeenCalled();
  });
});
