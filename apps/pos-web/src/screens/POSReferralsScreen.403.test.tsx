import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posReferralsApi', () => ({ posReferralsApi: { state: stateMock, record: vi.fn(), reward: vi.fn() } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: vi.fn() } }));
import { POSReferralsScreen } from './POSReferralsScreen';
describe('Referrals permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSReferralsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
