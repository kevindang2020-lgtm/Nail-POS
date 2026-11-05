import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MembershipPlanBuilder } from './MembershipPlanBuilder';

// Services fetch is mocked to an empty catalog so the builder mounts without network.
beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => [], headers: { get: () => null } } as any)) as any;
});

describe('MembershipPlanBuilder', () => {
  it('renders the five-step stepper and step 1 fields', () => {
    render(<MembershipPlanBuilder onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByText('Plan Builder')).toBeInTheDocument();
    ['Identity', 'Pricing', 'Term', 'Benefits', 'Commission'].forEach((s) => expect(screen.getAllByText(s).length).toBeGreaterThan(0));
    expect(screen.getByText('Plan name')).toBeInTheDocument();
    expect(screen.getByText('Recurring')).toBeInTheDocument();
  });

  it('gates Next until a plan name is entered', () => {
    render(<MembershipPlanBuilder onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('VIP Nail Club'), { target: { value: 'VIP Nail Club' } });
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });

  // ONE-PAY F9 (Oct 13 2026): the screen never computes a technician's money — the split % is shown, the amount is
  // payroll's (the membership redemption split, priced server-side at each redemption).
  it('the profitability preview shows the technician % and eligible value, never a computed technician amount', () => {
    render(<MembershipPlanBuilder onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('VIP Nail Club'), { target: { value: 'VIP' } });
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByText('+ Add benefit'));
    fireEvent.change(screen.getByLabelText('Cost basis (USD)'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Profitability preview')).toBeInTheDocument();
    expect(screen.getByText(/calculated by payroll/i)).toBeInTheDocument();
    expect(screen.queryByText('$24.00')).toBeNull();   // 60 % of $40.00 — the screen must not compute it
  });
});
