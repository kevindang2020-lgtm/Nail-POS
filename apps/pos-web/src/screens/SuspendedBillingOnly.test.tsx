import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const logout = vi.fn(async () => {});
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout, principal: { role: 'OWNER', restriction: 'SUSPENDED_BILLING_ONLY' } }) }));
vi.mock('./POSAccountInvoicesScreen', () => ({ POSAccountInvoicesScreen: () => <div data-testid="invoices">invoices</div> }));
import { SuspendedBillingOnly } from './SuspendedBillingOnly';

describe('billing-only POS (Constitution 7 §19)', () => {
  it('shows why, the invoices, and a way out — nothing else', () => {
    render(<SuspendedBillingOnly />);
    expect(screen.getByTestId('suspended-billing-banner')).toHaveTextContent('Your salon is suspended.');
    expect(screen.getByTestId('invoices')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });
});
