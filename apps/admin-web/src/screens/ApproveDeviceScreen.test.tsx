// S-A13: the emailed approval page — opening it approves nothing; pressing Approve POSTs the token once; errors shown.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/authApi', () => ({ authApi: { approveDeviceByToken: vi.fn() } }));
import { authApi } from '../api/authApi';
import { ApproveDeviceScreen } from './ApproveDeviceScreen';

describe('ApproveDeviceScreen (S-A13)', () => {
  beforeEach(() => { vi.clearAllMocks(); window.history.pushState({}, '', '/approve-device?token=pda_abc'); });

  it('does nothing on open; Approve posts the token and confirms', async () => {
    (authApi.approveDeviceByToken as any).mockResolvedValue({ ok: true });
    render(<ApproveDeviceScreen />);
    expect(authApi.approveDeviceByToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve this device' }));
    await waitFor(() => expect(authApi.approveDeviceByToken).toHaveBeenCalledWith('pda_abc'));
    expect(await screen.findByRole('status')).toHaveTextContent('Device approved');
  });

  it('shows an expired-link refusal', async () => {
    (authApi.approveDeviceByToken as any).mockRejectedValue(new Error('This link has expired. Sign in again from the device to get a new one.'));
    render(<ApproveDeviceScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve this device' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  });

  it('a link without a token says so', () => {
    window.history.pushState({}, '', '/approve-device');
    render(<ApproveDeviceScreen />);
    expect(screen.getByText(/incomplete/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
