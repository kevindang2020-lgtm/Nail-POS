import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockList, mockPreview, mockBlock, mockUnblock } = vi.hoisted(() => ({ mockList: vi.fn(), mockPreview: vi.fn(), mockBlock: vi.fn(), mockUnblock: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securityIpBlocks: () => mockList(),
  securityIpBlockPreview: (b: any) => mockPreview(b),
  securityIpBlock: (b: any) => mockBlock(b),
  securityIpUnblock: (id: string) => mockUnblock(id),
} }));
import { SecurityIpBlockModal } from './SecurityIpBlockModal';

beforeEach(() => {
  mockList.mockReset(); mockPreview.mockReset(); mockBlock.mockReset(); mockUnblock.mockReset();
  mockList.mockResolvedValue([{ id: 'ip1', target: '203.0.113.45', threatType: 'brute_force', status: 'blocked', blockedAt: '2026-05-06T00:00:00Z' }]);
  mockPreview.mockResolvedValue({ valid: true, protected: false, wouldBlock: true });
  mockBlock.mockResolvedValue({ id: 'ip2', target: '198.51.100.7', status: 'blocked' });
  mockUnblock.mockResolvedValue({ id: 'ip1', status: 'allowed' });
});

describe('SecurityIpBlockModal', () => {
  it('loads and lists current blocks', async () => {
    render(<SecurityIpBlockModal onClose={() => {}} />);
    expect(await screen.findByText('203.0.113.45')).toBeInTheDocument();
  });

  it('Block stays disabled until a preview confirms the target is valid and not protected', async () => {
    render(<SecurityIpBlockModal onClose={() => {}} />);
    await screen.findByText('203.0.113.45');
    const blockBtn = screen.getByRole('button', { name: /Block this source/ });
    expect(blockBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/203.0.113.45 or/), { target: { value: '198.51.100.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/safe to block/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Block this source/ })).not.toBeDisabled();
  });

  it('warns and keeps Block disabled for a protected source (never lock out trusted access)', async () => {
    mockPreview.mockResolvedValue({ valid: true, protected: true, protectedReason: 'loopback/reserved address', wouldBlock: false });
    render(<SecurityIpBlockModal onClose={() => {}} />);
    await screen.findByText('203.0.113.45');
    fireEvent.change(screen.getByPlaceholderText(/203.0.113.45 or/), { target: { value: '127.0.0.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Protected source — cannot be blocked/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Block this source/ })).toBeDisabled();
  });

  it('blocks a valid source and refetches', async () => {
    render(<SecurityIpBlockModal onClose={() => {}} />);
    await screen.findByText('203.0.113.45');
    fireEvent.change(screen.getByPlaceholderText(/203.0.113.45 or/), { target: { value: '198.51.100.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText(/safe to block/);
    fireEvent.click(screen.getByRole('button', { name: /Block this source/ }));
    await waitFor(() => expect(mockBlock).toHaveBeenCalledWith(expect.objectContaining({ target: '198.51.100.7' })));
    expect(mockList).toHaveBeenCalledTimes(2); // initial + after block
  });

  it('unblocks an active block', async () => {
    render(<SecurityIpBlockModal onClose={() => {}} />);
    await screen.findByText('203.0.113.45');
    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('ip1'));
  });
});
