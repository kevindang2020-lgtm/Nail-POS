import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../api/posInventoryAlertsApi', () => ({ posInventoryAlertsApi: { list: listMock, acknowledge: vi.fn() } }));
import { POSInventoryAlertsScreen } from './POSInventoryAlertsScreen';
describe('Inventory alerts permissions', () => {
  it('shows a permission message on 403', async () => { listMock.mockRejectedValue({ status: 403 }); render(<POSInventoryAlertsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
