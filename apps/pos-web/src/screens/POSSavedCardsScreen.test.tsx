import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { searchMock, cardsMock } = vi.hoisted(() => ({ searchMock: vi.fn(), cardsMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock } }));
vi.mock('../api/posSavedCardsApi', () => ({ posSavedCardsApi: { forCustomer: cardsMock } }));
import { POSSavedCardsScreen } from './POSSavedCardsScreen';
beforeEach(() => { searchMock.mockReset(); cardsMock.mockReset(); });

const cust = { customerId: 'c1', fullName: 'Ana Rivera', phone: '555-1', visitsCount: 3 };

describe('POSSavedCardsScreen', () => {
  it('searches, picks, and shows the customer cards on file', async () => {
    searchMock.mockResolvedValue({ items: [cust] });
    cardsMock.mockResolvedValue({ cards: [
      { id: 'p1', brand: 'Visa', last4: '4242', expMonth: 8, expYear: 2028, isDefault: true },
      { id: 'p2', brand: 'Mastercard', last4: '5100', expMonth: 3, expYear: 2027, isDefault: false },
    ] });
    render(<POSSavedCardsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    await waitFor(() => expect(cardsMock).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/4242/)).toBeInTheDocument();
    expect(screen.getByText('DEFAULT')).toBeInTheDocument();
    expect(screen.getByText(/Expires 08\/28/)).toBeInTheDocument();
  });
  it('shows an empty state when the customer has no cards', async () => {
    searchMock.mockResolvedValue({ items: [cust] });
    cardsMock.mockResolvedValue({ cards: [] });
    render(<POSSavedCardsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    expect(await screen.findByText(/No cards on file/)).toBeInTheDocument();
  });
});
