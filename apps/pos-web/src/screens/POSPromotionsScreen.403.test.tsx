import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posSalonPromotionsApi', () => ({ posSalonPromotionsApi: { state: stateMock, create: vi.fn(), setStatus: vi.fn(), redeem: vi.fn() } }));
import { POSPromotionsScreen } from './POSPromotionsScreen';
describe('Promotions permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSPromotionsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
