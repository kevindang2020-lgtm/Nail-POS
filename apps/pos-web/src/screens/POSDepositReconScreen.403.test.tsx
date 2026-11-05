import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posDepositReconApi', () => ({ posDepositReconApi: { state: stateMock, listBankAccounts: vi.fn().mockResolvedValue([]), createBankAccount: vi.fn(), listDeposits: vi.fn(), createDeposit: vi.fn(), linkDeposit: vi.fn() } }));
import { POSDepositReconScreen } from './POSDepositReconScreen';
describe('Deposit recon permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSDepositReconScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
