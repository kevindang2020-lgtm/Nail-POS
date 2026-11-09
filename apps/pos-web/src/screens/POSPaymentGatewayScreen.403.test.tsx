import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock('../api/posPaymentGatewayApi', () => ({ posPaymentGatewayApi: { status: statusMock } }));
vi.mock('../api/posPaymentChannelsApi', () => ({ posPaymentChannelsApi: { channels: vi.fn().mockResolvedValue({ checkedAt: '2026-11-09T10:00:00Z', branch: { id: 'b', name: 'Main' }, liveMode: false, merchant: {}, ticket: null, channels: [] }), check: vi.fn() } }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: { history: vi.fn().mockResolvedValue({ class: 'terminal', items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 }) } }));
vi.mock('react-router-dom', async (o) => ({ ...(await o<typeof import('react-router-dom')>()), useNavigate: () => () => {} }));
import { POSPaymentGatewayScreen } from './POSPaymentGatewayScreen';
describe('Payment gateway permissions', () => {
  it('shows a permission message on 403', async () => { statusMock.mockRejectedValue({ status: 403 }); render(<POSPaymentGatewayScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
