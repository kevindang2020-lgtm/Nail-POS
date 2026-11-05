import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { updateProfile: vi.fn(), getProfile: vi.fn().mockResolvedValue(null), requestPhoneCode: vi.fn(), confirmPhoneCode: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { EditProfileScreen } from './EditProfileScreen';

describe('EditProfileScreen (My Information)', () => {
  beforeEach(() => vi.clearAllMocks());
  it('saves the other fields via PATCH /customer/profile — and does NOT send the phone', async () => {
    // This test used to assert `body.phone === '8565551234'` — it was PINNING A SECURITY HOLE.
    //
    // `PATCH /customer/profile` wrote that string straight to the number every booking code and appointment
    // reminder is delivered to: no E.164 (its "normalization" stripped the leading "+", so Twilio could not even
    // send to it), no verification, no duplicate check. A signed-in customer could point their codes at ANY number
    // — including somebody else's, who would then start receiving that salon's messages.
    //
    // Correcting a test that pinned a hole is not weakening it.
    (customerApi.updateProfile as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><EditProfileScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(customerApi.updateProfile).toHaveBeenCalledTimes(1));
    const body = (customerApi.updateProfile as any).mock.calls[0][0];
    expect(body).not.toHaveProperty('phone');
    expect(body).toHaveProperty('smsOptIn');
  });

  it('offers Change instead of a free-text phone field, and opens the verify-first flow', async () => {
    // Verify FIRST. You are alone with your phone: mistype a digit, swap the number immediately, and you have cut
    // yourself off from your account AND from the code that would let you fix it.
    render(<MemoryRouter><EditProfileScreen /></MemoryRouter>);
    expect(screen.queryByPlaceholderText('(555) 555-5555')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByText(/Change phone number/i)).toBeTruthy();
    expect(screen.getByText(/current number keeps working/i)).toBeTruthy();
  });

  it('saves name and birthday', async () => {
    (customerApi.updateProfile as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><EditProfileScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('First'), { target: { value: 'Casey' } });
    fireEvent.change(screen.getByPlaceholderText('Last'), { target: { value: 'Lee' } });
    fireEvent.change(screen.getByLabelText('Birthday'), { target: { value: '1992-03-15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(customerApi.updateProfile).toHaveBeenCalledTimes(1));
    const body = (customerApi.updateProfile as any).mock.calls[0][0];
    expect(body).toMatchObject({ firstName: 'Casey', lastName: 'Lee', birthday: '1992-03-15' });
  });

  it('verifies the phone number via code', async () => {
    (customerApi.getProfile as any).mockResolvedValue({ fullName: 'Casey Lee', firstName: 'Casey', lastName: 'Lee', email: null, phone: '(609) 555-1212', birthday: null, smsOptIn: false, emailOptIn: false, phoneVerified: false });
    (customerApi.requestPhoneCode as any).mockResolvedValue({ ok: true });
    (customerApi.confirmPhoneCode as any).mockResolvedValue({ ok: true, verified: true });
    render(<MemoryRouter><EditProfileScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify number' }));
    await waitFor(() => expect(customerApi.requestPhoneCode).toHaveBeenCalledTimes(1));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '421774' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(customerApi.confirmPhoneCode).toHaveBeenCalledWith('421774'));
    expect(await screen.findByText('Phone verified')).toBeInTheDocument();
  });
});
