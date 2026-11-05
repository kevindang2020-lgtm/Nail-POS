import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { gwMock, numMock, a2pMock, notifMock } = vi.hoisted(() => ({ gwMock: vi.fn(), numMock: vi.fn(), a2pMock: vi.fn(), notifMock: vi.fn() }));
vi.mock('../api/posPaymentGatewayApi', () => ({ posPaymentGatewayApi: { status: gwMock } }));
vi.mock('../api/posPhoneApi', () => ({ posPhoneApi: { number: numMock, a2p: a2pMock } }));
vi.mock('../api/posSettingsApi', () => ({ posSettingsApi: { getCategory: notifMock } }));
import { POSIntegrationsScreen } from './POSIntegrationsScreen';
beforeEach(() => {
  gwMock.mockReset(); numMock.mockReset(); a2pMock.mockReset(); notifMock.mockReset();
  gwMock.mockResolvedValue({ processorType: 'fiserv', setupRequired: false, environment: 'production', merchantIdMasked: '••1234', status: 'active', onboardingStatus: 'complete' });
  numMock.mockResolvedValue({ configured: false, usingOwnAccount: false, registeredNumber: null });
  a2pMock.mockResolvedValue({ senderBrand: 'AIPowerSalon', a2pStatus: 'registered' });
  notifMock.mockResolvedValue({ senderBrand: 'Glow Bar', emailConfirmation: true, receiptDelivery: ['Email'] });
});

describe('POSIntegrationsScreen', () => {
  it('aggregates real integration statuses honestly', async () => {
    render(<MemoryRouter><POSIntegrationsScreen /></MemoryRouter>);
    expect(await screen.findByText('Fiserv')).toBeInTheDocument();
    expect(screen.getByText('Text Messaging')).toBeInTheDocument();
    // payment connected, messaging not connected -> both status labels present
    expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Not connected')).toBeInTheDocument();  // no messaging number
    expect(screen.getByText('A2P 10DLC Registration')).toBeInTheDocument();
    expect(screen.getByText(/Sender: Glow Bar/)).toBeInTheDocument();
  });
  it('renders a Manage action per row', async () => {
    render(<MemoryRouter><POSIntegrationsScreen /></MemoryRouter>);
    await screen.findByText('Fiserv');
    expect(screen.getAllByRole('button', { name: 'Manage' }).length).toBeGreaterThanOrEqual(4);
  });
});
