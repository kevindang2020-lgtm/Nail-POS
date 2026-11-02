import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MembershipManageModal, type ManageMember } from './MembershipManageModal';

const member = (status: string): ManageMember => ({ membershipId: 'm1', customerName: 'Jordan Lee', planName: 'VIP Nail Club', status, nextBillingAt: '2026-07-27T00:00:00.000Z' });

beforeEach(() => { vi.restoreAllMocks(); });

describe('MembershipManageModal', () => {
  it('offers pause + cancel-at-period-end for an active member (no immediate cancel, no resume)', () => {
    render(<MembershipManageModal member={member('active')} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pause membership' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel at end of period' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel immediately' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Resume|Reactivate/ })).toBeNull();
  });

  it('offers resume + cancel options for a paused member (no pause)', () => {
    render(<MembershipManageModal member={member('paused')} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Resume membership' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel immediately' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause membership' })).toBeNull();
  });

  it('confirming pause calls the pause endpoint and reports done', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ membershipId: 'm1', status: 'paused' }), headers: { get: () => null } } as any; }) as any;
    const onDone = vi.fn();
    render(<MembershipManageModal member={member('active')} onClose={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause membership' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.some((u) => u.includes('/pos/memberships/pause'))).toBe(true);
  });

  it('surfaces a backend error and stays open', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Cannot cancel a membership in status "past_due".' }), headers: { get: () => null } }) as any) as any;
    render(<MembershipManageModal member={member('past_due')} onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel immediately' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText(/Cannot cancel|Could not update/)).toBeInTheDocument());
  });
});
