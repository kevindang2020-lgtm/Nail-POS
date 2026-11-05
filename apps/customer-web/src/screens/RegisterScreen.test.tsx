import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/authApi', () => ({ authApi: { register: vi.fn() } }));
// No salon list → the manual salon-code field is shown.
vi.mock('../api/customerApi', () => ({ customerApi: { salonsNearby: vi.fn(async () => ({ results: [] })) } }));
import { authApi } from '../api/authApi';
import { RegisterScreen } from './RegisterScreen';

describe('RegisterScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('registers via /customer/auth/register and signals success', async () => {
    (authApi.register as any).mockResolvedValue({ ok: true });
    const onRegistered = vi.fn();
    render(<RegisterScreen onBack={vi.fn()} onRegistered={onRegistered} />);
    fireEvent.change(await screen.findByLabelText('Salon code'), { target: { value: 'PILOT03' } });
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Customer' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@cust.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password (8+ characters)'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ salonCode: 'PILOT03', email: 'new@cust.com', password: 'secret123' })));
    expect(onRegistered).toHaveBeenCalledWith('new@cust.com');
  });
  it('surfaces a server error (e.g. duplicate email)', async () => {
    (authApi.register as any).mockResolvedValue({ ok: false, message: 'An account with that email already exists. Try signing in.' });
    render(<RegisterScreen onBack={vi.fn()} onRegistered={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Salon code'), { target: { value: 'PILOT03' } });
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'A' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'B' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'dupe@cust.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password (8+ characters)'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });
});
