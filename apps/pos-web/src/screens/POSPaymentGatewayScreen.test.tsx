import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { posPaymentChannelsApi } from '../api/posPaymentChannelsApi';
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
  it('round 10 (Split Payments 02): the read-only check shows processor callback processing health with its count and reason', async () => {
    statusMock.mockResolvedValue({ processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '••••4321', status: 'active', setupRequired: false, onboardingStatus: 'complete' });
    vi.mocked(posPaymentChannelsApi.check).mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-13T10:00:00Z', checks: [
      { key: 'webhook_processing', area: 'shared', state: 'WARNING', reason: 'CALLBACKS_NOT_PROCESSED', count: 2 },
      { key: 'webhook_signatures', area: 'shared', state: 'PASSED', reason: null },
      { key: 'cash_method', area: 'shared', state: 'PASSED', reason: 'CASH_ALWAYS_ACCEPTED' },
      { key: 'gift_card_method', area: 'shared', state: 'PASSED', reason: 'GIFT_CARD_REDEEM_THIS_LOCATION', count: 4 },
      { key: 'gift_card_sales', area: 'shared', state: 'WARNING', reason: 'GIFT_CARD_SALES_DISABLED' },
    ] });
    render(<POSPaymentGatewayScreen />);
    fireEvent.click(await screen.findByTestId('pgx-check'));
    const row = await screen.findByTestId('pgx-chk-webhook_processing');
    expect(row).toHaveTextContent('Processor callbacks processed (last 24 h)');
    expect(row).toHaveTextContent('· 2');
    expect(row).toHaveTextContent('were not processed after 15 minutes');
    expect(screen.getByTestId('pgx-chk-webhook_signatures')).toHaveTextContent('Passed');
    // round 10 (Split Payments 15): cash and gift card readiness for this location, with the reason (never shown as "off" when Checkout accepts them)
    expect(screen.getByTestId('pgx-chk-cash_method')).toHaveTextContent('no on/off switch for cash');
    expect(screen.getByTestId('pgx-chk-gift_card_method')).toHaveTextContent('Gift card — paying with a card · 4');
    expect(screen.getByTestId('pgx-chk-gift_card_sales')).toHaveTextContent('Warning');
    expect(screen.getByTestId('pgx-chk-gift_card_sales')).toHaveTextContent('Paying with an existing card still works.');
  });
});
