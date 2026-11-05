import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { loyMock } = vi.hoisted(() => ({ loyMock: vi.fn() }));
vi.mock('../api/posLoyaltyApi', () => ({ posLoyaltyApi: { state: loyMock } }));
import { POSLoyaltyScreen } from './POSLoyaltyScreen';
describe('Loyalty permissions', () => {
  it('shows a permission message on 403', async () => { loyMock.mockRejectedValue({ status: 403 }); render(<POSLoyaltyScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
