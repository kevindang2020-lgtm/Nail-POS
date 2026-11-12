import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { lookupMock, replaceMock } = vi.hoisted(() => ({ lookupMock: vi.fn(), replaceMock: vi.fn() }));
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { giftCardLookup: lookupMock, replaceGiftCard: replaceMock } }));
vi.mock('../lib/barcode-core', () => ({ scannerSupported: () => true, extractCardNumber: (x: string) => x }));
vi.mock('../components/CardScanner', () => ({ CardScanner: ({ onScan }: { onScan: (v: string) => void }) => (
  <button onClick={() => onScan('4827193655028411')}>MockScan</button>
) }));
import { POSGiftCardLookupScreen } from './POSGiftCardLookupScreen';

beforeEach(() => { lookupMock.mockReset(); replaceMock.mockReset(); });

describe('POSGiftCardLookupScreen', () => {
  it('scanning a card fills the number and looks it up', async () => {
    lookupMock.mockResolvedValue({ found: true, reference: 'GC-****-8411', cardNumberMasked: '•••• •••• •••• 8411', balanceCents: 5000, status: 'active', redeemableHere: true });
    render(<POSGiftCardLookupScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));      // opens the (mocked) scanner
    fireEvent.click(screen.getByRole('button', { name: 'MockScan' }));  // scanner reports a decoded number
    await waitFor(() => expect(lookupMock).toHaveBeenCalledWith('4827193655028411'));
    expect(await screen.findByText('$50.00')).toBeInTheDocument();
  });

  it('previews balance, status, and redeemability for a found card', async () => {
    lookupMock.mockResolvedValue({ found: true, reference: 'GC-****-8411', cardNumberMasked: '•••• •••• •••• 8411', balanceCents: 5000, status: 'active', redeemableHere: true });
    render(<POSGiftCardLookupScreen />);
    fireEvent.change(screen.getByLabelText('Gift card number or code'), { target: { value: '4827 1936 5502 8411' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await waitFor(() => expect(lookupMock).toHaveBeenCalledWith('4827 1936 5502 8411'));
    expect(await screen.findByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('•••• •••• •••• 8411')).toBeInTheDocument();
    expect(screen.getByText('Redeemable at this salon')).toBeInTheDocument();
  });

  it('shows a safe not-found message that does not confirm guesses', async () => {
    lookupMock.mockResolvedValue({ found: false });
    render(<POSGiftCardLookupScreen />);
    fireEvent.change(screen.getByLabelText('Gift card number or code'), { target: { value: '9999888877776666' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/could not be found or is not available/)).toBeInTheDocument();
  });

  it('replaces a lost/frozen card and shows the new number once', async () => {
    lookupMock.mockResolvedValue({ found: true, reference: 'GC-****-8411', cardNumberMasked: '•••• •••• •••• 8411', balanceCents: 5000, status: 'frozen', redeemableHere: false });
    replaceMock.mockResolvedValue({ ok: true, newReference: 'GC-****-9999', newCardNumber: '1234567890129999', newCardNumberMasked: '•••• •••• •••• 9999', balanceCents: 5000 });
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<POSGiftCardLookupScreen />);
    fireEvent.change(screen.getByLabelText('Gift card number or code'), { target: { value: '4827 1936 5502 8411' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    // Gift Cards · 05: the replacement preview names the balance that moves and that the old card is retired — before any write
    expect(await screen.findByTestId('replace-preview')).toHaveTextContent(/Balance that moves: \$50\.00, from •••• •••• •••• 8411/);
    expect(screen.getByTestId('replace-preview')).toHaveTextContent(/retired permanently/);
    expect(replaceMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Replace this card/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Issue replacement' }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('4827 1936 5502 8411'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Replacement issued')).toBeInTheDocument();
    expect(screen.getByText('1234 5678 9012 9999')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('does not offer replace for an active, redeemable card', async () => {
    lookupMock.mockResolvedValue({ found: true, reference: 'GC-****-8411', balanceCents: 5000, status: 'active', redeemableHere: true });
    render(<POSGiftCardLookupScreen />);
    fireEvent.change(screen.getByLabelText('Gift card number or code'), { target: { value: '4827 1936 5502 8411' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Redeemable at this salon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Replace this card/ })).toBeNull();
  });

  it('shows a network card issued at another salon as redeemable here', async () => {
    lookupMock.mockResolvedValue({ found: true, reference: 'GC-****-7004', cardNumberMasked: '•••• •••• •••• 7004', balanceCents: 6000, status: 'active', redeemableHere: true, viaNetwork: true });
    render(<POSGiftCardLookupScreen />);
    fireEvent.change(screen.getByLabelText('Gift card number or code'), { target: { value: '7001 7002 7003 7004' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Redeemable here - network card')).toBeInTheDocument();
    expect(screen.getByText(/Issued at another salon in your network/)).toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
  });
});
