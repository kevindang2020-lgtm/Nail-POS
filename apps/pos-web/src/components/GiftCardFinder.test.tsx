// GiftCardFinder — extras GIFT CARDS 04 (round 10): a scoped, masked card picker over the active sale; never a redeemable code.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const gc = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: gc }));
import { GiftCardFinder } from './GiftCardFinder';

beforeEach(() => gc.list.mockReset());
describe('GiftCardFinder', () => {
  it('searches the server with the customer prefilled, lists masked cards with purchaser / recipient labels, and closes without touching the sale', async () => {
    gc.list.mockResolvedValue({ items: [{ id: 'g1', card: '•••• 4821', status: 'partially_redeemed', balanceCents: 3500, spendable: true, purchaser: { name: 'Anna Lee' }, recipient: { name: 'Mai Tran' } },
      { id: 'g2', card: '•••• 9999', status: 'void', balanceCents: 0, spendable: false, purchaser: null, recipient: null }] });
    const onClose = vi.fn();
    render(<GiftCardFinder initialQuery="Anna Lee" onClose={onClose} />);
    await waitFor(() => expect(gc.list).toHaveBeenCalledWith({ search: 'Anna Lee', preset: 'all', page: 1, pageSize: 10 }));
    const rows = await screen.findAllByTestId('gc-finder-row');
    expect(rows[0]).toHaveTextContent('•••• 4821'); expect(rows[0]).toHaveTextContent('$35.00'); expect(rows[0]).toHaveTextContent('Bought by Anna Lee'); expect(rows[0]).toHaveTextContent('for Mai Tran');
    expect(rows[1]).toHaveTextContent('cannot pay now'); expect(rows[1]).toHaveTextContent('No purchaser on file');
    expect(screen.getByTestId('gc-finder').textContent).not.toMatch(/partially_redeemed|\bvoid\b/);
    fireEvent.change(screen.getByTestId('gc-finder-q'), { target: { value: '4821' } }); fireEvent.click(screen.getByTestId('gc-finder-go'));
    await waitFor(() => expect(gc.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: '4821' })));
    fireEvent.click(screen.getAllByText('Close').slice(-1)[0]);
    expect(onClose).toHaveBeenCalled();
  });
  it('one character does not search', async () => {
    render(<GiftCardFinder initialQuery="A" onClose={() => {}} />);
    expect(await screen.findByText('Type at least 2 characters.')).toBeInTheDocument();
    expect(gc.list).not.toHaveBeenCalled();
  });
});
