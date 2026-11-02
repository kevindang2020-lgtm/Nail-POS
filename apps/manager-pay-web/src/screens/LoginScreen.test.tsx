// Manager Tap to Pay login — matches the reference design and drives the REAL /auth/login on the tenant portal.
// Verifies the layout, the submit gate, that the salon code + identifier + password + rememberMe reach the backend,
// that a remembered salon hides the field, the mandatory-code (MFA) step, and that success hands the principal up.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const onAuthed = vi.hoisted(() => vi.fn());
const login = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any> => ({ ok: true, outcome: 'SUCCESS', principal: { userId: 'u1', role: 'MANAGER', permissions: ['pos.checkout'] } })));
const branchesMock = vi.hoisted(() => vi.fn(async (): Promise<any[]> => []));
const selectBranchMock = vi.hoisted(() => vi.fn(async (_id: string, _device: string): Promise<any> => ({ ok: true, principal: { userId: 'u1', role: 'MANAGER', permissions: ['pos.checkout'], branchId: 'b1' } })));
vi.mock('../api/authApi', () => ({ authApi: { login: (...a: unknown[]) => login(...a), me: async () => null, branches: () => branchesMock(), selectBranch: (id: string, dev: string) => selectBranchMock(id, dev), requestPasswordReset: vi.fn(async () => ({ ok: true })) } }));
vi.mock('../native/tapToPay', () => ({ isTapToPayAvailable: () => false }));

import { LoginScreen } from './LoginScreen';

const fillCreds = () => {
  fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: '  mgr@salon.com  ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw123456' } });
};

beforeEach(() => { onAuthed.mockClear(); login.mockClear(); login.mockResolvedValue({ ok: true, outcome: 'SUCCESS', principal: { userId: 'u1', role: 'MANAGER', permissions: ['pos.checkout'] } }); try { globalThis.localStorage?.clear(); } catch { /* ignore */ } });

describe('Manager Tap to Pay LoginScreen', () => {
  it('renders the reference layout', () => {
    render(<LoginScreen onAuthed={onAuthed} />);
    expect(screen.getByAltText('AI PowerSalon')).toBeInTheDocument();
    expect(screen.getByText('SMARTER SALON. STRONGER BUSINESS.')).toBeInTheDocument();
    expect(screen.getByText('TAP TO PAY ON IPHONE')).toBeInTheDocument();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByText('Tap to Pay Experience')).toBeInTheDocument();
    expect(screen.getByText('Tap to Pay Ready')).toBeInTheDocument();
    expect(screen.getByText('Fast Checkout')).toBeInTheDocument();
    expect(screen.getByText('Secure Transactions')).toBeInTheDocument();
    expect(screen.getByText('Secure payment access only')).toBeInTheDocument();
  });

  it('asks for the salon code on a fresh device and gates Sign In until all required fields are filled', () => {
    render(<LoginScreen onAuthed={onAuthed} />);
    expect(screen.getByLabelText('Salon code')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Sign In' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'MERCH01' } });
    fillCreds();
    expect(btn).not.toBeDisabled();
  });

  it('signs in on the tenant portal with the salon code, trimmed identifier, and rememberMe, then hands up the principal', async () => {
    render(<LoginScreen onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'MERCH01' } });
    fillCreds();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]).toMatchObject({ portal: 'tenant', salonCode: 'MERCH01', identifier: 'mgr@salon.com', password: 'pw123456', rememberMe: true });
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith({ userId: 'u1', role: 'MANAGER', permissions: ['pos.checkout'] }));
  });

  it('hides the salon-code field once the device remembers it', () => {
    try { globalThis.localStorage?.setItem('aps_pay_salon_code', 'MERCH01'); } catch { /* ignore */ }
    render(<LoginScreen onAuthed={onAuthed} />);
    expect(screen.queryByLabelText('Salon code')).toBeNull();
  });

  it('prompts for the 6-digit code when the backend requires MFA', async () => {
    login.mockResolvedValueOnce({ ok: false, outcome: 'MFA_REQUIRED' });
    render(<LoginScreen onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'MERCH01' } });
    fillCreds();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByLabelText('Verification code')).toBeInTheDocument();
    expect(onAuthed).not.toHaveBeenCalled();
  });

  it('surfaces the server message on a failed sign-in', async () => {
    login.mockResolvedValueOnce({ ok: false, outcome: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    render(<LoginScreen onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'MERCH01' } });
    fillCreds();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('BRANCH_SELECTION_REQUIRED with several locations: asks which branch, then re-signs the session for it (naming this phone)', async () => {
    login.mockResolvedValueOnce({ ok: false, outcome: 'BRANCH_SELECTION_REQUIRED', message: 'Select the branch you want to work in.' });
    branchesMock.mockResolvedValueOnce([
      { id: 'b1', name: 'Ashia Nail Salon', city: 'Solan', isActive: true },
      { id: 'b2', name: 'Main', city: null, isActive: true },
      { id: 'b3', name: 'Closed', city: null, isActive: false },
    ]);
    render(<LoginScreen onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'PILOT01' } });
    fillCreds();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Ashia Nail Salon')).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.queryByText('Closed')).toBeNull();                       // inactive locations are not offered
    expect(onAuthed).not.toHaveBeenCalled();                               // branchless is not signed in
    fireEvent.click(screen.getByText('Ashia Nail Salon'));
    await waitFor(() => expect(selectBranchMock).toHaveBeenCalledWith('b1', expect.any(String)));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'b1' })));
  });

  it('BRANCH_SELECTION_REQUIRED with one location: enters it without asking', async () => {
    login.mockResolvedValueOnce({ ok: false, outcome: 'BRANCH_SELECTION_REQUIRED', message: 'Select the branch you want to work in.' });
    branchesMock.mockResolvedValueOnce([{ id: 'b1', name: 'Only', city: null, isActive: true }]);
    selectBranchMock.mockClear();
    render(<LoginScreen onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'PILOT01' } });
    fillCreds();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(selectBranchMock).toHaveBeenCalledWith('b1', expect.any(String)));
    await waitFor(() => expect(onAuthed).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'b1' })));
    expect(screen.queryByText('Select Branch')).toBeNull();
  });
});
