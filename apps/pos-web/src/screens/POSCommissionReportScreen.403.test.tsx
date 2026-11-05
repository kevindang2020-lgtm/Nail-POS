import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posCommissionReportApi', () => ({ posCommissionReportApi: { state: stateMock } }));
import { POSCommissionReportScreen } from './POSCommissionReportScreen';
describe('Commission report permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSCommissionReportScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
