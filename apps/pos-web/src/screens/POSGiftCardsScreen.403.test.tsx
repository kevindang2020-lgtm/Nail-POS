import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const gc = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), liability: () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })) }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: gc }));   // branch liability panel hidden (no reports permission) — covered in POSGiftCardsScreen.liability.test.tsx
import { POSGiftCardsScreen } from './POSGiftCardsScreen';
describe('Gift cards permissions', () => {
  it('shows a permission message on 403', async () => {
    gc.list.mockRejectedValue({ status: 403 }); gc.summary.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSGiftCardsScreen /></MemoryRouter>);
    expect(await screen.findByText(/Your role cannot see this information/i)).toBeInTheDocument();
    expect(screen.queryByTestId('issue')).toBeNull();
  });
});
