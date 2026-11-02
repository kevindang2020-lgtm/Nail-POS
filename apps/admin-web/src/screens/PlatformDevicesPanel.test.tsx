// S-A13: the platform devices panel — approval state per device, Approve calls the step-up-guarded route, the current
// device is never offered "Sign out", and the server's refusal reaches the screen.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/authApi', () => ({ authApi: { devices: vi.fn(), approvePlatformDevice: vi.fn(), revokeDevice: vi.fn() } }));
import { authApi } from '../api/authApi';
import { PlatformDevicesPanel } from './PlatformDevicesPanel';

const rows = [
  { id: 'd1', name: 'Chrome on Mac', platform: 'web', trustState: 'recognized', lastSeenAt: '2026-10-27T10:00:00Z', current: true, platformApprovedAt: '2026-10-01T00:00:00Z' },
  { id: 'd2', name: 'Safari on iPad', platform: 'web', trustState: 'new', lastSeenAt: '2026-10-27T11:00:00Z', current: false, platformApprovedAt: null },
];

describe('PlatformDevicesPanel (S-A13)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows approval per device and approves an unapproved one', async () => {
    (authApi.devices as any).mockResolvedValueOnce({ devices: rows, canTrust: true }).mockResolvedValueOnce({ devices: [rows[0], { ...rows[1], platformApprovedAt: '2026-10-27T12:00:00Z' }], canTrust: true });
    (authApi.approvePlatformDevice as any).mockResolvedValue({ ok: true });
    render(<PlatformDevicesPanel />);
    expect(await screen.findByText('Safari on iPad')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('Not approved')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);   // never the current device
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(authApi.approvePlatformDevice).toHaveBeenCalledWith('d2'));
    await waitFor(() => expect(screen.queryByText('Not approved')).toBeNull());
  });

  it('shows the server refusal', async () => {
    (authApi.devices as any).mockResolvedValue({ devices: rows, canTrust: true });
    (authApi.approvePlatformDevice as any).mockRejectedValue(new Error('Approve new devices from a device that is already approved for Super Admin.'));
    render(<PlatformDevicesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already approved');
  });
});
