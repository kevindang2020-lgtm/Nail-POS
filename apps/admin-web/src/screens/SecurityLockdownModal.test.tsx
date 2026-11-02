import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockList, mockPropose, mockConfirm, mockExecute, mockLift } = vi.hoisted(() => ({ mockList: vi.fn(), mockPropose: vi.fn(), mockConfirm: vi.fn(), mockExecute: vi.fn(), mockLift: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securityLockdowns: () => mockList(),
  securityLockdownPropose: (b: any) => mockPropose(b),
  securityLockdownConfirm: (id: string, b: any) => mockConfirm(id, b),
  securityLockdownExecute: (id: string) => mockExecute(id),
  securityLockdownLift: (id: string, b: any) => mockLift(id, b),
} }));
import { SecurityLockdownModal } from './SecurityLockdownModal';

beforeEach(() => {
  mockList.mockReset(); mockPropose.mockReset(); mockConfirm.mockReset(); mockExecute.mockReset(); mockLift.mockReset();
  mockList.mockResolvedValue([]);
  mockPropose.mockResolvedValue({ lockdown: { id: 'lkd1', lockdownRef: 'LKD-2026-001', scope: 'account', target: 'u1', status: 'proposed' }, confirmationPhrase: 'LOCKDOWN ACCOUNT' });
  mockConfirm.mockResolvedValue({ id: 'lkd1', status: 'confirmed' });
  mockExecute.mockResolvedValue({ id: 'lkd1', status: 'active', affectedSessions: 2 });
});

describe('SecurityLockdownModal — deliberate multi-step wizard', () => {
  it('step 1: Propose is disabled until scope target + reason are provided', async () => {
    render(<SecurityLockdownModal onClose={() => {}} />);
    await screen.findByText(/never one-click/);
    expect(screen.getByRole('button', { name: /Propose lockdown/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('target identifier'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByPlaceholderText(/why the lockdown/), { target: { value: 'compromised' } });
    expect(screen.getByRole('button', { name: /Propose lockdown/ })).not.toBeDisabled();
  });

  it('step 2: Confirm requires BOTH the exact phrase AND step-up (never one-click)', async () => {
    render(<SecurityLockdownModal onClose={() => {}} />);
    await screen.findByText(/never one-click/);
    fireEvent.change(screen.getByPlaceholderText('target identifier'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByPlaceholderText(/why the lockdown/), { target: { value: 'compromised' } });
    fireEvent.click(screen.getByRole('button', { name: /Propose lockdown/ }));
    await waitFor(() => expect(mockPropose).toHaveBeenCalled());
    const confirmBtn = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmBtn).toBeDisabled();
    // wrong phrase → still disabled
    fireEvent.change(screen.getByLabelText('confirmation phrase'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByLabelText('step-up re-authentication verified'));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    // exact phrase + step-up → enabled
    fireEvent.change(screen.getByLabelText('confirmation phrase'), { target: { value: 'LOCKDOWN ACCOUNT' } });
    expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('lkd1', { confirmationPhrase: 'LOCKDOWN ACCOUNT', stepUpVerified: true }));
  });

  it('step 3: Execute activates the lockdown and refetches', async () => {
    render(<SecurityLockdownModal onClose={() => {}} />);
    await screen.findByText(/never one-click/);
    fireEvent.change(screen.getByPlaceholderText('target identifier'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByPlaceholderText(/why the lockdown/), { target: { value: 'compromised' } });
    fireEvent.click(screen.getByRole('button', { name: /Propose lockdown/ }));
    await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.change(screen.getByLabelText('confirmation phrase'), { target: { value: 'LOCKDOWN ACCOUNT' } });
    fireEvent.click(screen.getByLabelText('step-up re-authentication verified'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    const exec = await screen.findByRole('button', { name: /Execute lockdown/ });
    fireEvent.click(exec);
    await waitFor(() => expect(mockExecute).toHaveBeenCalledWith('lkd1'));
    expect(await screen.findByText(/LKD-2026-001 is active/)).toBeInTheDocument();
  });

  it('lifts an active lockdown from the list (with a reason)', async () => {
    mockList.mockResolvedValue([{ id: 'lkd9', lockdownRef: 'LKD-2026-009', scope: 'platform', target: null, status: 'active' }]);
    mockLift.mockResolvedValue({ id: 'lkd9', status: 'lifted' });
    render(<SecurityLockdownModal onClose={() => {}} />);
    expect(await screen.findByText('LKD-2026-009')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lift' }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'threat contained' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockLift).toHaveBeenCalledWith('lkd9', { reason: 'threat contained' }));
  });
});
