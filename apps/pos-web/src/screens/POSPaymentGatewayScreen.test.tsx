import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { statusMock } = vi.hoisted(() => ({ statusMock: vi.fn() }));
vi.mock('../api/posPaymentGatewayApi', () => ({ posPaymentGatewayApi: { status: statusMock } }));
import { POSPaymentGatewayScreen } from './POSPaymentGatewayScreen';
beforeEach(() => statusMock.mockReset());

describe('POSPaymentGatewayScreen', () => {
  it('shows connected processor details when configured', async () => {
    statusMock.mockResolvedValue({ processorType: 'fiserv', environment: 'production', merchantIdMasked: '••••4321', status: 'active', setupRequired: false, onboardingStatus: 'complete' });
    render(<POSPaymentGatewayScreen />);
    expect(await screen.findByText(/Connected · Fiserv/)).toBeInTheDocument();
    expect(screen.getByText('••••4321')).toBeInTheDocument();
    expect(screen.getByText('production')).toBeInTheDocument();
  });
  it('shows an honest not-connected state when setup is required', async () => {
    statusMock.mockResolvedValue({ processorType: 'none', environment: '', merchantIdMasked: '', status: 'not_configured', setupRequired: true, onboardingStatus: 'not_started' });
    render(<POSPaymentGatewayScreen />);
    expect(await screen.findByText('Not connected yet')).toBeInTheDocument();
    expect(screen.getByText(/isn't set up for this salon yet/)).toBeInTheDocument();
    expect(screen.queryByText('••••4321')).not.toBeInTheDocument();
  });
});
