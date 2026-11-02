import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { paymentMethods: vi.fn(), addPaymentMethod: vi.fn(), paymentTokenizer: vi.fn(), deletePaymentMethod: vi.fn(), setDefaultPaymentMethod: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { PaymentMethodsScreen } from './PaymentMethodsScreen';

describe('PaymentMethodsScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('lists saved cards (brand •••• last4)', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([{ id: 'pm1', brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true }]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText(/Expires 12\/30/)).toBeInTheDocument();
  });
  it('adds a card through the salon\'s hosted tokenizer: only a CardSecure TOKEN from the gateway origin is saved, never a card number', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([]);
    (customerApi.paymentTokenizer as any).mockResolvedValue({ available: true, origin: 'https://isv-uat.cardconnect.com', url: 'https://isv-uat.cardconnect.com/itoke/ajax-tokenizer.html?useexpiry=true' });
    (customerApi.addPaymentMethod as any).mockResolvedValue({ id: 'pm2', brand: 'Card', last4: '1111', expMonth: 12, expYear: 2029, isDefault: true });
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/add (a )?card/i));
    expect(await screen.findByTitle('Secure card entry')).toBeTruthy();
    expect(screen.queryByLabelText('Card number')).toBeNull();                 // no card-number field in this app
    // a message from ANOTHER origin, and a raw card number from the right one, are both ignored
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: JSON.stringify({ message: '9418594164541111', expiry: '202912' }) }));
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://isv-uat.cardconnect.com', data: JSON.stringify({ message: '4111111111111111', expiry: '202912' }) }));
    expect(screen.queryByText(/ready to save/i)).toBeNull();
    // the gateway's own page hands back a token
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://isv-uat.cardconnect.com', data: JSON.stringify({ message: '9418594164541111', expiry: '202912' }) }));
    expect(await screen.findByText(/ending 1111 ready to save/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Save card'));
    await waitFor(() => expect(customerApi.addPaymentMethod).toHaveBeenCalledWith(expect.objectContaining({ token: '9418594164541111', last4: '1111', expMonth: 12, expYear: 2029 })));
    expect(JSON.stringify((customerApi.addPaymentMethod as any).mock.calls)).not.toContain('4111111111111111');
  });
  it('says so plainly when the salon has no card gateway yet', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([]);
    (customerApi.paymentTokenizer as any).mockResolvedValue({ available: false, reason: 'gateway_not_configured' });
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/add (a )?card/i));
    expect(await screen.findByText(/isn't available at this salon yet/i)).toBeTruthy();
  });
});
