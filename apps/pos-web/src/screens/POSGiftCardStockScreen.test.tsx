import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { stateMock, registerMock, voidMock } = vi.hoisted(() => ({ stateMock: vi.fn(), registerMock: vi.fn(), voidMock: vi.fn() }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardStockApi: { state: stateMock, register: registerMock, voidCard: voidMock } }));
vi.mock('../lib/barcode-core', () => ({ scannerSupported: () => true, extractCardNumber: (x: string) => x }));
vi.mock('../components/CardScanner', () => ({ CardScanner: ({ onScan }: { onScan: (v: string) => void }) => (
  <button onClick={() => onScan('4827193655028411')}>MockScan</button>
) }));
import { POSGiftCardStockScreen } from './POSGiftCardStockScreen';

beforeEach(() => { stateMock.mockReset(); registerMock.mockReset(); voidMock.mockReset(); });

describe('POSGiftCardStockScreen', () => {
  it('scanning appends a number to the register box', async () => {
    stateMock.mockResolvedValue({ counts: { available: 0, activated: 0, void: 0, total: 0 }, items: [], lowStock: true, lowStockThreshold: 10 });
    render(<POSGiftCardStockScreen />);
    await screen.findByText('Register cards');
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'MockScan' }));
    await waitFor(() => expect((screen.getByLabelText('Card numbers') as HTMLTextAreaElement).value).toBe('4827193655028411'));
  });

  it('shows stock counts, recent cards, and a low-stock warning', async () => {
    stateMock.mockResolvedValue({ counts: { available: 3, activated: 5, void: 1, total: 9 }, items: [{ id: 's1', last4: '8411', status: 'available', batchLabel: 'Box A', notes: null, createdAt: '2026-07-01T00:00:00Z', activatedAt: null }], lowStock: true, lowStockThreshold: 10 });
    render(<POSGiftCardStockScreen />);
    expect(await screen.findByText(/Low stock/)).toBeInTheDocument();
    expect(screen.getByText('•••• 8411')).toBeInTheDocument();
    expect(screen.getByText('Box A')).toBeInTheDocument();
  });

  it('registers a batch and reports how many were added', async () => {
    stateMock.mockResolvedValue({ counts: { available: 0, activated: 0, void: 0, total: 0 }, items: [], lowStock: true, lowStockThreshold: 10 });
    registerMock.mockResolvedValue({ added: 2, duplicates: 1, invalid: 0 });
    render(<POSGiftCardStockScreen />);
    await screen.findByText('Register cards');
    fireEvent.change(screen.getByLabelText('Card numbers'), { target: { value: '1111222233334444\n5555666677778888' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to stock' }));
    await waitFor(() => expect(registerMock).toHaveBeenCalledWith('1111222233334444\n5555666677778888', undefined));
    expect(await screen.findByText(/Added 2 cards/)).toBeInTheDocument();
  });

  it('voids an available card after confirm', async () => {
    stateMock.mockResolvedValue({ counts: { available: 1, activated: 0, void: 0, total: 1 }, items: [{ id: 's1', last4: '8411', status: 'available', batchLabel: null, notes: null, createdAt: '2026-07-01T00:00:00Z', activatedAt: null }], lowStock: true, lowStockThreshold: 10 });
    voidMock.mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<POSGiftCardStockScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    // Inline confirm dialog (no native window.confirm): the action only fires from the confirm tap.
    fireEvent.click(await screen.findByRole('button', { name: 'Remove card' }));
    await waitFor(() => expect(voidMock).toHaveBeenCalledWith('s1'));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
