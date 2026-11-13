import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { ovMock } = vi.hoisted(() => ({ ovMock: vi.fn() }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: { overview: ovMock } }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: { summary: ovMock, devices: ovMock, history: ovMock, check: ovMock } }));
vi.mock('react-router-dom', async (o) => ({ ...(await o<typeof import('react-router-dom')>()), useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(), () => {}] }));
import { POSDeviceFleetScreen } from './POSDeviceFleetScreen';
describe('Device fleet permissions', () => {
  it('shows a permission message on 403', async () => { ovMock.mockRejectedValue({ status: 403 }); render(<POSDeviceFleetScreen view="health" />); expect((await screen.findAllByText(/do not have permission/i)).length).toBeGreaterThan(0); });
});
