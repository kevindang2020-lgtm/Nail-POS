// Browser/interaction QA for the read-only POS payment-gateway status card.
// Renders in jsdom and exercises every branch: active gateway, not-configured gateway, request error, and an
// unexpected/odd response shape. The card must NEVER crash the Settings board, so the odd-shape + error paths matter.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PaymentGatewayStatusCard } from './PaymentGatewayStatusCard';
import { posSettingsApi } from '../api/posSettingsApi';

vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { gatewayStatus: vi.fn() } }));
const gatewayStatus = posSettingsApi.gatewayStatus as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); });

describe('PaymentGatewayStatusCard', () => {
  it('renders an active, configured gateway (masked) once loaded', async () => {
    gatewayStatus.mockResolvedValue({
      processorType: 'fiserv', environment: 'production', merchantIdMasked: '****9911',
      status: 'active', setupRequired: false,
    });
    const { container } = render(<PaymentGatewayStatusCard />);
    expect(await screen.findByText('Active')).toBeInTheDocument();   // the status label (ns/status), not the raw code
    expect(container).toHaveTextContent('Processor: fiserv');
    expect(container).toHaveTextContent('env: production');
    expect(container).toHaveTextContent('merchant: ****9911');
  });

  it('renders a not-configured gateway with the setup-required pill (no crash)', async () => {
    gatewayStatus.mockResolvedValue({
      processorType: 'none', environment: 'sandbox', merchantIdMasked: '',
      status: 'not_configured', setupRequired: true,
    });
    render(<PaymentGatewayStatusCard />);
    expect(await screen.findByText('Not Set Up')).toBeInTheDocument();   // never the raw code (§62)
    expect(screen.getByText('setup required')).toBeInTheDocument();
  });

  it('shows a muted unavailable note when the request errors (never throws)', async () => {
    gatewayStatus.mockRejectedValue(new Error('network down'));
    render(<PaymentGatewayStatusCard />);
    expect(await screen.findByText('Gateway status unavailable.')).toBeInTheDocument();
  });

  it('tolerates an unexpected response shape (renders the not-configured fallback)', async () => {
    gatewayStatus.mockResolvedValue('totally-not-a-gateway-object' as unknown);
    render(<PaymentGatewayStatusCard />);
    expect(await screen.findByText('Not configured — your provider sets this up.')).toBeInTheDocument();
  });
});
