import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const logout = vi.fn(async () => {});
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout, principal: { role: 'OWNER', restriction: 'SUSPENDED_BILLING_ONLY' } }) }));
vi.mock('./HardwarePaymentScreen', () => ({ HardwarePaymentScreen: () => <div data-testid="hw">hardware payment</div> }));
import { SuspendedBillingOnly } from './SuspendedBillingOnly';

describe('Owner App billing-only (Constitution 7 §19)', () => {
  it('shows why, the billing screen, and Sign out', () => {
    render(<SuspendedBillingOnly />);
    expect(screen.getByTestId('suspended-billing-banner')).toHaveTextContent('Your salon is suspended.');
    expect(screen.getByTestId('hw')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });
});
