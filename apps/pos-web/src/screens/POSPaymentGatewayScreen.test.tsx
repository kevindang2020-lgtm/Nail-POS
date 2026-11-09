import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock('../api/posPaymentGatewayApi', () => ({ posPaymentGatewayApi: { status: statusMock } }));
vi.mock('../api/posPaymentChannelsApi', () => ({ posPaymentChannelsApi: { channels: vi.fn().mockResolvedValue({ checkedAt: '2026-11-09T10:00:00Z', branch: { id: 'b', name: 'Main' }, liveMode: false, merchant: {}, ticket: null, channels: [] }), check: vi.fn() } }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: { history: vi.fn().mockResolvedValue({ class: 'terminal', items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 }) } }));
vi.mock('react-router-dom', async (o) => ({ ...(await o<typeof import('react-router-dom')>()), useNavigate: () => () => {} }));
import { POSPaymentGatewayScreen } from './POSPaymentGatewayScreen';
beforeEach(() => statusMock.mockReset());

describe('POSPaymentGatewayScreen', () => {
  it('shows connected processor details when configured', async () => {
    statusMock.mockResolvedValue({ processorType: 'fiserv', environment: 'production', merchantIdMasked: '••••4321', status: 'active', setupRequired: false, onboardingStatus: 'complete' });
    render(<POSPaymentGatewayScreen />);
    expect(await screen.findByText('Fiserv selected')).toBeInTheDocument();   // the guide: "Connected" was ambiguous
    expect(await screen.findByTestId('pgx-line-live')).toBeInTheDocument();
    expect(screen.getByText('••••4321')).toBeInTheDocument();
    expect(screen.getAllByText('production').length).toBeGreaterThan(0);
  });
  it('shows an honest not-connected state when setup is required', async () => {
    statusMock.mockResolvedValue({ processorType: 'none', environment: '', merchantIdMasked: '', status: 'not_configured', setupRequired: true, onboardingStatus: 'not_started' });
    render(<POSPaymentGatewayScreen />);
    expect(await screen.findByText('Not connected yet')).toBeInTheDocument();
    expect(screen.getByText(/isn't set up for this salon yet/)).toBeInTheDocument();
    expect(screen.queryByText('••••4321')).not.toBeInTheDocument();
  });
});
