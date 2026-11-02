import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembershipBadge } from './MembershipBadge';

const mockFetch = (data: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('MembershipBadge', () => {
  it('shows the active plan and status for a member', async () => {
    globalThis.fetch = mockFetch({ memberships: [{ membershipId: 'm1', planName: 'VIP Nail Club', status: 'active' }] }) as any;
    render(<MembershipBadge customerId="c1" />);
    await waitFor(() => expect(screen.getByText(/VIP Nail Club/)).toBeInTheDocument());
    expect(screen.getByText(/Active/)).toBeInTheDocument();
  });

  it('renders nothing without a customer (no member)', () => {
    globalThis.fetch = mockFetch({ memberships: [] }) as any;
    const { container } = render(<MembershipBadge customerId={null} />);
    expect(container.textContent).toBe('');
  });
});
