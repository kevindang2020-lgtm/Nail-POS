import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MembershipChip, useMemberStatusMap } from './MembershipChip';

const mockFetch = (data: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => data, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

function Harness({ ids }: { ids: string[] }) {
  const map = useMemberStatusMap(ids);
  return <div>{ids.map((id) => (map[id] ? <MembershipChip key={id} planName={map[id].planName} status={map[id].status} compact /> : <span key={id} data-testid={`none-${id}`} />))}</div>;
}

describe('MembershipChip + useMemberStatusMap', () => {
  it('renders a chip only for active members from one batch response', async () => {
    globalThis.fetch = mockFetch({ members: [{ customerId: 'c1', isMember: true, planName: 'VIP Nail Club', status: 'active' }] }) as any;
    render(<Harness ids={['c1', 'c2']} />);
    await waitFor(() => expect(screen.getByText(/VIP Nail Club/)).toBeInTheDocument());
    expect(screen.getByTestId('none-c2')).toBeInTheDocument(); // absent from response => non-member, no chip
  });

  it('is presentational from props (non-compact shows plan and status)', () => {
    render(<MembershipChip planName="Glow Plan" status="trial" />);
    expect(screen.getByText(/Glow Plan/)).toBeInTheDocument();
    expect(screen.getByText(/Trial/)).toBeInTheDocument();
  });
});
