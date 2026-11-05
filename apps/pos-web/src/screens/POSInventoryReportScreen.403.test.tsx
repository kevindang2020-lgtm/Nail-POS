import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { sumMock, alertMock } = vi.hoisted(() => ({ sumMock: vi.fn(), alertMock: vi.fn() }));
vi.mock('../api/posInventoryReportApi', () => ({ posInventoryReportApi: { summary: sumMock, alerts: alertMock } }));
import { POSInventoryReportScreen } from './POSInventoryReportScreen';
describe('Inventory report permissions', () => {
  it('shows a permission message on 403', async () => { sumMock.mockRejectedValue({ status: 403 }); alertMock.mockRejectedValue({ status: 403 }); render(<POSInventoryReportScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
