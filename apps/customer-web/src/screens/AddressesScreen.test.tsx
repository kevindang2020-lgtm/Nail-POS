import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { addresses: vi.fn(), addAddress: vi.fn(), deleteAddress: vi.fn(), setDefaultAddress: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { AddressesScreen } from './AddressesScreen';

describe('AddressesScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists real addresses with a default badge', async () => {
    (customerApi.addresses as any).mockResolvedValue([{ id: 'a1', label: 'Home', line1: '12 Maple St', line2: null, city: 'Cherry Hill', state: 'NJ', zip: '08002', isDefault: true }]);
    render(<MemoryRouter><AddressesScreen /></MemoryRouter>);
    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(screen.getByText('12 Maple St')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });
  it('adds an address via a real POST', async () => {
    (customerApi.addresses as any).mockResolvedValue([]);
    (customerApi.addAddress as any).mockResolvedValue({ id: 'a2', label: '', line1: '9 Oak Ave', line2: null, city: null, state: null, zip: null, isDefault: false });
    render(<MemoryRouter><AddressesScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add address' }));
    fireEvent.change(screen.getByPlaceholderText('Street address'), { target: { value: '9 Oak Ave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(customerApi.addAddress).toHaveBeenCalledWith(expect.objectContaining({ line1: '9 Oak Ave' })));
  });
});
