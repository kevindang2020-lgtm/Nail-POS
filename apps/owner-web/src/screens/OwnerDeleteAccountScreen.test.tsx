// OwnerDeleteAccountScreen: Apple-required account-deactivation request. Owners deactivate (not hard-delete) so business
// and financial records are retained. Verifies the request is submitted with the typed reason, the confirmation state
// renders the server message plus the remove/retain breakdown, and a failure surfaces an error instead of a false success.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerAccountApi: { requestDeactivation: vi.fn() } }));

import { ownerAccountApi } from '../api/ownerApi';
import { OwnerDeleteAccountScreen } from './OwnerDeleteAccountScreen';

const result = {
  requestId: 'req1', status: 'received', requestType: 'deactivate' as const, submittedAt: '2026-06-27T12:00:00Z',
  willRemove: ['Your contact details'], willRetain: ['Tickets and commissions'], contactEmail: 'kim@salon.com',
  message: 'Your deactivation request has been received.',
};

beforeEach(() => vi.clearAllMocks());

describe('OwnerDeleteAccountScreen', () => {
  it('submits the deactivation request with the typed reason and shows the confirmation', async () => {
    (ownerAccountApi.requestDeactivation as any).mockResolvedValue(result);
    render(<OwnerDeleteAccountScreen />);
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'Closing the salon' } });
    fireEvent.click(screen.getByRole('button', { name: /Request account deactivation/i }));
    await waitFor(() => expect(ownerAccountApi.requestDeactivation).toHaveBeenCalledWith('Closing the salon'));
    expect(await screen.findByText('Your deactivation request has been received.')).toBeInTheDocument();
    expect(screen.getByText('Your contact details')).toBeInTheDocument();
    expect(screen.getByText('Tickets and commissions')).toBeInTheDocument();
  });

  it('omits an empty reason', async () => {
    (ownerAccountApi.requestDeactivation as any).mockResolvedValue(result);
    render(<OwnerDeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Request account deactivation/i }));
    await waitFor(() => expect(ownerAccountApi.requestDeactivation).toHaveBeenCalledWith(undefined));
  });

  it('surfaces an error instead of a false success', async () => {
    (ownerAccountApi.requestDeactivation as any).mockRejectedValue(new Error('Server error'));
    render(<OwnerDeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Request account deactivation/i }));
    expect(await screen.findByText('Server error')).toBeInTheDocument();
    expect(screen.queryByText('Request received')).not.toBeInTheDocument();
  });
});
