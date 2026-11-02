import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { ovMock } = vi.hoisted(() => ({ ovMock: vi.fn() }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: { overview: ovMock } }));
import { POSDeviceFleetScreen } from './POSDeviceFleetScreen';
describe('Device fleet permissions', () => {
  it('shows a permission message on 403', async () => { ovMock.mockRejectedValue({ status: 403 }); render(<POSDeviceFleetScreen view="health" />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
