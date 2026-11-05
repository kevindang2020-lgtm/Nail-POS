import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock } }));
vi.mock('../api/posSavedCardsApi', () => ({ posSavedCardsApi: { forCustomer: vi.fn() } }));
import { POSSavedCardsScreen } from './POSSavedCardsScreen';
describe('Saved cards permissions', () => {
  it('shows a permission message on 403 from search', async () => {
    searchMock.mockRejectedValue({ status: 403 });
    render(<POSSavedCardsScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
