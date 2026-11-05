// Fiserv master build §4 / §8D — the Customer App never collects PAN/CVV; cards are added through the hosted iFrame.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { paymentMethods: vi.fn(), cardTokenizer: vi.fn(), addPaymentMethod: vi.fn(), deletePaymentMethod: vi.fn(), setDefaultPaymentMethod: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { PaymentMethodsScreen } from './PaymentMethodsScreen';

const ORIGIN = 'https://isv-uat.cardconnect.com';
const TOKENIZER = { available: true, url: `${ORIGIN}/itoke/ajax-tokenizer.html?useexpiry=true&usecvv=true`, origin: ORIGIN, consentVersion: 'cit-2026-11-04' };

async function openAdd() {
  render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));
  return (await screen.findByTitle('Secure card entry')) as HTMLIFrameElement;
}
function post(data: unknown, origin: string, source: unknown) {
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as any })); });
}

describe('PaymentMethodsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.paymentMethods as any).mockResolvedValue([]); (customerApi.cardTokenizer as any).mockResolvedValue(TOKENIZER); });

  it('lists saved cards (brand •••• last4)', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([{ id: 'pm1', brand: 'Visa', last4: '4242', expMonth: 12, expYear: 2030, isDefault: true }]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    expect(await screen.findByText('Visa •••• 4242')).toBeInTheDocument();
    expect(screen.getByText(/Expires 12\/30/)).toBeInTheDocument();
  });

  it('has NO card number, expiry or CVV inputs — the card fields live in the Fiserv iframe', async () => {
    const iframe = await openAdd();
    expect(screen.queryByLabelText('Card number')).toBeNull();
    expect(screen.queryByLabelText('CVV')).toBeNull();
    expect(screen.queryByLabelText('Expiry')).toBeNull();
    expect(iframe.getAttribute('src')).toBe(TOKENIZER.url);
    expect(document.querySelectorAll('input').length).toBeLessThanOrEqual(3);   // name, zip, consent checkbox only
  });

  it('saves only a token from our iframe at the exact origin, with consent', async () => {
    (customerApi.addPaymentMethod as any).mockResolvedValue({ id: 'pm2' });
    const iframe = await openAdd();
    fireEvent.change(screen.getByLabelText('Cardholder name'), { target: { value: 'Sarah Connor' } });
    fireEvent.change(screen.getByLabelText('Zip Code'), { target: { value: '19406' } });
    post(JSON.stringify({ message: '9418594164541111', expiry: '1230', errorCode: '0' }), ORIGIN, iframe.contentWindow);
    expect(await screen.findByText(/Card ready •••• 1111/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save card' });
    expect(save).toBeDisabled();                                   // consent not given yet
    fireEvent.click(screen.getByLabelText('Save this card for future payments'));
    fireEvent.click(save);
    await waitFor(() => expect(customerApi.addPaymentMethod).toHaveBeenCalledWith(expect.objectContaining({
      token: '9418594164541111', last4: '1111', expMonth: 12, expYear: 2030, cardholderName: 'Sarah Connor', zipCode: '19406', consent: true, consentVersion: 'cit-2026-11-04',
    })));
  });

  it('ignores a forged message from another origin', async () => {
    const iframe = await openAdd();
    post(JSON.stringify({ message: '9111111111111111', errorCode: '0' }), 'https://evil.example', iframe.contentWindow);
    expect(screen.queryByText(/Card ready/)).toBeNull();
  });

  it('ignores a message from the right origin but a different window', async () => {
    await openAdd();
    post(JSON.stringify({ message: '9111111111111111', errorCode: '0' }), ORIGIN, window);
    expect(screen.queryByText(/Card ready/)).toBeNull();
  });

  it('refuses a non-token payload (e.g. raw digits) even from the iframe', async () => {
    const iframe = await openAdd();
    post(JSON.stringify({ message: '4111111111111111', errorCode: '0' }), ORIGIN, iframe.contentWindow);
    expect(screen.queryByText(/Card ready/)).toBeNull();
    expect(await screen.findByText('Please check the card details.')).toBeInTheDocument();
  });

  it('shows "card saving unavailable" and collects nothing when the salon has no tokenizer', async () => {
    (customerApi.cardTokenizer as any).mockResolvedValue({ available: false, reason: 'gateway_not_configured' });
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));
    expect(await screen.findByText(/Card saving is not available at this salon yet/)).toBeInTheDocument();
    expect(screen.queryByTitle('Secure card entry')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save card' })).toBeDisabled();
  });

  it('refuses a tokenizer URL that is not a Fiserv CardSecure page', async () => {
    (customerApi.cardTokenizer as any).mockResolvedValue({ available: true, url: 'https://evil.example/itoke/x.html', origin: 'https://evil.example', consentVersion: 'v' });
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add card' }));
    expect(await screen.findByText(/Card saving is not available at this salon yet/)).toBeInTheDocument();
  });

  it('keeps the Debit / Credit label selector and card logos', async () => {
    await openAdd();
    fireEvent.click(screen.getByRole('button', { name: /Debit Card/ }));
    fireEvent.click(screen.getByRole('option', { name: /Credit Card/ }));
    expect(screen.getByRole('button', { name: /Credit Card/ })).toBeInTheDocument();
    for (const t of ['Visa', 'Mastercard', 'American Express', 'JCB']) expect(screen.getByTitle(t)).toBeInTheDocument();
  });

  it('saved cards show Default and Remove only', async () => {
    (customerApi.paymentMethods as any).mockResolvedValue([{ id: 'pm1', brand: 'Amex', last4: '3415', expMonth: 12, expYear: 2034, isDefault: false }]);
    render(<MemoryRouter><PaymentMethodsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Amex •••• 3415/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('the screen source never builds a token from typed digits', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/screens/PaymentMethodsScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/'9' \+ digits/);
    expect(src).not.toMatch(/setCvv|aria-label="CVV"|aria-label="Card number"/);
  });
});
