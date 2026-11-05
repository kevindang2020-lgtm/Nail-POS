import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { gcMock } = vi.hoisted(() => ({ gcMock: vi.fn() }));
vi.mock('../api/posGiftCardsApi', () => ({ posGiftCardsApi: { state: gcMock, liability: () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })) } }));   // branch liability panel hidden (no reports permission) — covered in POSGiftCardsScreen.liability.test.tsx
import { POSGiftCardsScreen } from './POSGiftCardsScreen';
describe('Gift cards permissions', () => {
  it('shows a permission message on 403', async () => { gcMock.mockRejectedValue({ status: 403 }); render(<POSGiftCardsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
