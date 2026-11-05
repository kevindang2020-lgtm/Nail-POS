// PhoneVerificationStep.test.tsx
//
// This component is the difference between a feature and a wall.
//
// The backend refuses an unverified remote booking with a 428 and hands back a `bookingSessionId` and a MASKED
// phone. Until this existed, nothing consumed that: BookScreen caught the error in its generic handler and showed
// **"This time is no longer available"** — a message that is both WRONG and IMPOSSIBLE for the customer to act on.
// The enforcement worked perfectly and no customer could ever satisfy it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const send = vi.fn();
const check = vi.fn();
vi.mock('../api/customerApi', () => ({
  customerApi: {
    sendBookingVerification: (b: any) => send(b),
    checkBookingVerification: (b: any) => check(b),
  },
}));

import { PhoneVerificationStep } from './PhoneVerificationStep';

const props = {
  bookingSessionId: 'bs-1',
  maskedPhone: '••••4567',
  phone: '',
  onVerified: vi.fn(),
  onCancel: vi.fn(),
};

beforeEach(() => { send.mockReset(); check.mockReset(); props.onVerified.mockReset(); });

const boxes = () => screen.getAllByRole('textbox') as HTMLInputElement[];

describe('the number is MASKED, always', () => {
  it('shows only the mask the server gave us', () => {
    render(<PhoneVerificationStep {...props} />);
    expect(screen.getByText(/••••4567/)).toBeTruthy();
  });

  it('cannot leak the full number — it never receives one', () => {
    // Once a code has been SENT, echoing the whole number back turns a shoulder-surfer into someone who knows
    // both the number and that a code is in flight to it. The server only ever hands us a mask, so this component
    // is structurally incapable of showing more.
    const { container } = render(<PhoneVerificationStep {...props} />);
    expect(container.textContent).not.toMatch(/\d{7,}/);
  });
});

describe('entering the code', () => {
  it('auto-submits on the sixth digit — no hunting for a Continue button', async () => {
    check.mockResolvedValue({ status: 'phone_verified' });
    render(<PhoneVerificationStep {...props} />);
    const b = boxes();
    for (let i = 0; i < 6; i++) fireEvent.change(b[i], { target: { value: String(i + 1) } });

    await waitFor(() => expect(check).toHaveBeenCalledWith({ bookingSessionId: 'bs-1', phone: '', code: '123456' }));
    await waitFor(() => expect(props.onVerified).toHaveBeenCalled());
  });

  it('supports PASTE — the code arrives by SMS, and copying it is the natural gesture', async () => {
    // Without this, six boxes are six chances to mistype a code the customer can already see.
    check.mockResolvedValue({ status: 'phone_verified' });
    render(<PhoneVerificationStep {...props} />);
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => '654321' } });
    await waitFor(() => expect(check).toHaveBeenCalledWith(expect.objectContaining({ code: '654321' })));
  });

  it('strips non-digits from a pasted code', async () => {
    check.mockResolvedValue({ status: 'phone_verified' });
    render(<PhoneVerificationStep {...props} />);
    fireEvent.paste(boxes()[0], { clipboardData: { getData: () => 'Your code is 112233' } });
    await waitFor(() => expect(check).toHaveBeenCalledWith(expect.objectContaining({ code: '112233' })));
  });

  it('offers a numeric keypad and SMS autofill', () => {
    // A customer should not have to leave the app to read their own code.
    render(<PhoneVerificationStep {...props} />);
    for (const el of boxes()) {
      expect(el.getAttribute('inputmode')).toBe('numeric');
      expect(el.getAttribute('autocomplete')).toBe('one-time-code');
    }
  });
});

describe('a wrong code', () => {
  it("shows the SERVER's message, not a generic one, and clears the boxes", async () => {
    // "That code is incorrect" and "This code has expired" need different actions from the customer. Replacing
    // them with one generic string throws away the only actionable half of the interaction.
    check.mockRejectedValue({ message: 'This code has expired. Request a new code.' });
    render(<PhoneVerificationStep {...props} />);
    const b = boxes();
    for (let i = 0; i < 6; i++) fireEvent.change(b[i], { target: { value: '9' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
    await waitFor(() => expect(boxes()[0].value).toBe(''));
    expect(props.onVerified).not.toHaveBeenCalled();
  });
});

describe('resend', () => {
  it('is disabled during the cooldown — the SERVER enforces it regardless', () => {
    render(<PhoneVerificationStep {...props} />);
    const btn = screen.getByText(/Resend code in/i).closest('button')!;
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('announces the countdown, so a screen-reader user is not left wondering why it is dead', () => {
    render(<PhoneVerificationStep {...props} />);
    expect(screen.getByText(/Resend code in \d+s/)).toHaveAttribute('aria-live', 'polite');
  });
});

describe('accessibility', () => {
  it('labels every box and announces errors assertively', async () => {
    check.mockRejectedValue({ message: 'That code is incorrect.' });
    render(<PhoneVerificationStep {...props} />);
    expect(screen.getByLabelText('Digit 1 of 6')).toBeTruthy();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeTruthy();

    const b = boxes();
    for (let i = 0; i < 6; i++) fireEvent.change(b[i], { target: { value: '1' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });
});
