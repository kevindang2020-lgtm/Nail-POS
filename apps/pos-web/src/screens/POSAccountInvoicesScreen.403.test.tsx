import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posAccountInvoicesApi', () => ({ posAccountInvoicesApi: { state: stateMock } }));
import { POSAccountInvoicesScreen } from './POSAccountInvoicesScreen';
describe('Account invoices permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSAccountInvoicesScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
