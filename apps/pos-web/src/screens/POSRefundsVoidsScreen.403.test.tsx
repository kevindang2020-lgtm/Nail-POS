import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posRefundsVoidsApi', () => ({ posRefundsVoidsApi: { state: stateMock } }));
import { POSRefundsVoidsScreen } from './POSRefundsVoidsScreen';
describe('Refunds/voids permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSRefundsVoidsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
