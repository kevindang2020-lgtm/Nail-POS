import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { numMock, a2pMock } = vi.hoisted(() => ({ numMock: vi.fn(), a2pMock: vi.fn() }));
vi.mock('../api/posPhoneApi', () => ({ posPhoneApi: { number: numMock, a2p: a2pMock } }));
import { POSPhoneScreen } from './POSPhoneScreen';
beforeEach(() => { numMock.mockReset(); a2pMock.mockReset(); });

describe('POSPhoneScreen', () => {
  it('shows the connected number and A2P status', async () => {
    numMock.mockResolvedValue({ configured: true, usingOwnAccount: true, registeredNumber: '+1 856 555 0100' });
    a2pMock.mockResolvedValue({ senderBrand: 'AIPowerSalon', a2pStatus: 'registered' });
    render(<MemoryRouter><POSPhoneScreen /></MemoryRouter>);
    expect((await screen.findAllByText('+1 856 555 0100')).length).toBeGreaterThan(0);
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('AIPowerSalon')).toBeInTheDocument();
  });
  it('shows an honest not-connected state', async () => {
    numMock.mockResolvedValue({ configured: false, usingOwnAccount: false, registeredNumber: null });
    a2pMock.mockResolvedValue({ senderBrand: '', a2pStatus: 'not_registered' });
    render(<MemoryRouter><POSPhoneScreen /></MemoryRouter>);
    expect(await screen.findByText('No number connected yet')).toBeInTheDocument();
    expect(screen.getByText('Not registered')).toBeInTheDocument();
  });
});
