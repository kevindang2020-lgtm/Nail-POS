// AuditScreen (owner Activity Log): renders the append-only owner audit trail with friendly labels, inline metadata
// (payout amount, expense amount), and a distinct treatment for security events (rejected PINs, blocked access).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerMoreApi: { audit: vi.fn() } }));

import { ownerMoreApi } from '../api/ownerApi';
import { AuditScreen } from './AuditScreen';

const rows = (over: any[] = []) => over.length ? over : [
  { id: 'a1', userId: 'u1', role: 'OWNER', action: 'payroll_approved', entityType: 'payroll_period', entityId: 'p2', metadata: { totalPayableCents: 2468000, fromStatus: 'draft' }, createdAt: '2026-06-27T14:00:00.000Z' },
  { id: 'a2', userId: 'u1', role: 'OWNER', action: 'payroll_pin_rejected', entityType: 'payroll_period', entityId: 'p2', metadata: { kind: 'lock' }, createdAt: '2026-06-27T13:50:00.000Z' },
  { id: 'a3', userId: 'u1', role: 'OWNER', action: 'expense_create', entityType: 'expense', entityId: 'e1', metadata: { amountCents: 5000, category: 'supplies' }, createdAt: '2026-06-27T13:00:00.000Z' },
  { id: 'a4', userId: 'u1', role: 'OWNER', action: 'owner_branch_selected', entityType: 'branch', entityId: 'b1', metadata: {}, createdAt: '2026-06-27T12:00:00.000Z' },
];

beforeEach(() => { vi.clearAllMocks(); (ownerMoreApi.audit as any).mockResolvedValue(rows()); });

describe('AuditScreen', () => {
  it('renders a payroll approval with a friendly label and the payout amount', async () => {
    render(<AuditScreen />);
    await waitFor(() => expect(screen.getByText(/Payroll approved/)).toBeInTheDocument());
    const row = screen.getByText(/Payroll approved/).closest('.owner-menurow') as HTMLElement;
    expect(row).toHaveTextContent('$24,680');
    expect(row).toHaveTextContent(/from draft/);
  });

  it('renders a rejected PIN as a security event', async () => {
    render(<AuditScreen />);
    await waitFor(() => expect(screen.getByText(/Payroll PIN rejected/)).toBeInTheDocument());
    expect(screen.getByText(/Payroll PIN rejected/).textContent).toContain('⚠️');
  });

  it('renders an expense with its amount and category', async () => {
    render(<AuditScreen />);
    await waitFor(() => expect(screen.getByText(/Expense added/)).toBeInTheDocument());
    const row = screen.getByText(/Expense added/).closest('.owner-menurow') as HTMLElement;
    expect(row).toHaveTextContent('$50');
    expect(row).toHaveTextContent(/supplies/);
  });

  it('shows an empty state when there is no activity', async () => {
    (ownerMoreApi.audit as any).mockResolvedValue([]);
    render(<AuditScreen />);
    await waitFor(() => expect(screen.getByText('No activity yet')).toBeInTheDocument());
  });
});
