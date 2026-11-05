import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock, atRiskMock } = vi.hoisted(() => ({ stateMock: vi.fn(), atRiskMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { state: stateMock, atRisk: atRiskMock } }));
import { POSRetentionScreen } from './POSRetentionScreen';
describe('Retention permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); atRiskMock.mockRejectedValue({ status: 403 }); render(<POSRetentionScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
