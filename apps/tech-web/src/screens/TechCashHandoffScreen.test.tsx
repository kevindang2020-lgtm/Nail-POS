import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';
vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../api/techApi', async (orig) => ({ ...(await orig<typeof import('../api/techApi')>()), techApi: { cashHandoff: vi.fn(), submitCashHandoff: vi.fn() } }));
import { techApi } from '../api/techApi';
import { TechCashHandoffScreen } from './TechCashHandoffScreen';

const handoff = (over: Record<string, unknown> = {}) => ({
  technicianId: 't1', technicianName: 'Ava Nguyen', businessDate: '2026-06-16',
  expectedCents: 13300, paymentCount: 3, countedCents: null, varianceCents: null,
  status: 'open', submittedAt: null, reconciledAt: null, notes: null,
  lines: [{ ticketId: 'tk1', ticketNumber: '#000124', customerName: 'Grace Kim', amountCents: 5150, confirmedAt: null }],
  ...over,
});
const renderScreen = () => render(<TechNavProvider><TechCashHandoffScreen /></TechNavProvider>);

describe('TechCashHandoffScreen (end-of-day cash)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows collected cash, count and the hand-off button when open', async () => {
    (techApi.cashHandoff as any).mockResolvedValue(handoff());
    renderScreen();
    expect(await screen.findByText('$133.00')).toBeTruthy();
    expect(screen.getByText('3 cash payments')).toBeTruthy();
    expect(screen.getByText('Hand off to front desk')).toBeTruthy();
    expect(screen.getByText('Grace Kim')).toBeTruthy();
  });

  it('hands off and shows a confirmation', async () => {
    (techApi.cashHandoff as any).mockResolvedValue(handoff());
    (techApi.submitCashHandoff as any).mockResolvedValue(handoff({ status: 'submitted', submittedAt: '2026-06-16T20:00:00Z' }));
    renderScreen();
    fireEvent.click(await screen.findByText('Hand off to front desk'));
    expect(await screen.findByText(/Handed off to the front desk/)).toBeTruthy();
    expect(techApi.submitCashHandoff).toHaveBeenCalled();
  });

  it('reflects a reconciled match', async () => {
    (techApi.cashHandoff as any).mockResolvedValue(handoff({ status: 'reconciled', countedCents: 13300, varianceCents: 0 }));
    renderScreen();
    expect(await screen.findByText('Reconciled ✓')).toBeTruthy();
  });

  it('reflects a short discrepancy', async () => {
    (techApi.cashHandoff as any).mockResolvedValue(handoff({ status: 'discrepancy', countedCents: 12800, varianceCents: -500 }));
    renderScreen();
    expect(await screen.findByText(/Short by \$5.00/)).toBeTruthy();
  });
});
