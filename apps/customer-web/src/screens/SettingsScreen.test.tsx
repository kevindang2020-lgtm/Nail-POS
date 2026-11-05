import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { getProfile: vi.fn(), updateProfile: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { SettingsScreen } from './SettingsScreen';

describe('SettingsScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('loads current preferences and persists service + marketing toggles via PATCH', async () => {
    (customerApi.getProfile as any).mockResolvedValue({ fullName: 'J', email: 'j@e.com', phone: '5551234', smsOptIn: true, emailOptIn: false, marketingOptIn: false });
    (customerApi.updateProfile as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><SettingsScreen /></MemoryRouter>);

    // service (transactional) notifications
    const sms = await screen.findByRole('checkbox', { name: 'Appointment & service texts' });
    expect(sms).toBeChecked();                                   // loaded from real record
    const email = screen.getByRole('checkbox', { name: 'Email updates' });
    expect(email).not.toBeChecked();
    fireEvent.click(email);
    await waitFor(() => expect(customerApi.updateProfile).toHaveBeenCalledWith({ emailOptIn: true }));

    // marketing opt-in is SEPARATE and persists to its own field
    const marketing = screen.getByRole('checkbox', { name: 'Marketing messages' });
    expect(marketing).not.toBeChecked();
    fireEvent.click(marketing);
    await waitFor(() => expect(customerApi.updateProfile).toHaveBeenCalledWith({ marketingOptIn: true }));
  });
});
