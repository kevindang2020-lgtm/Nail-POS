// TechServiceHistoryScreen.test.tsx — the dedicated Service History screen (Tech pass, Jul 29 2026).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const serviceHistory = vi.fn();
vi.mock('../api/techApi', () => ({ techApi: { serviceHistory: (...a: any[]) => serviceHistory(...a) } }));
const back = vi.fn();
vi.mock('../shell/nav', () => ({ useTechNav: () => ({ back }) }));

import { TechServiceHistoryScreen } from './TechServiceHistoryScreen';

const DATA = {
  items: [
    { ticketId: 't1', serviceName: 'Gel Manicure', customerName: 'Maria J.', completedAt: '2026-07-28T15:00:00Z', rating: 5, lineTotalCents: 4500 },
    { ticketId: 't2', serviceName: 'Builder Gel Refill', customerName: 'Lily', completedAt: '2026-07-27T15:00:00Z', rating: null, lineTotalCents: 6000 },
  ],
  services: ['Builder Gel Refill', 'Gel Manicure'],
};

beforeEach(() => { serviceHistory.mockReset(); serviceHistory.mockResolvedValue(DATA); });

describe('TechServiceHistoryScreen', () => {
  it('lists completed services with the guest, date, and an HONEST rating — "Not rated" when null', async () => {
    render(<TechServiceHistoryScreen />);
    expect(await screen.findByText('Maria J.')).toBeInTheDocument();
    expect(screen.getByText('★ 5.0')).toBeInTheDocument();
    expect(screen.getByText('Lily')).toBeInTheDocument();
    expect(screen.getByText('Not rated')).toBeInTheDocument();
  });

  it('the All-Services filter refetches with the chosen service', async () => {
    render(<TechServiceHistoryScreen />);
    await screen.findByText('Maria J.');
    fireEvent.change(screen.getByLabelText('Filter by service'), { target: { value: 'Gel Manicure' } });
    expect(await screen.findByText('Maria J.')).toBeInTheDocument();
    expect(serviceHistory).toHaveBeenLastCalledWith('Gel Manicure');
  });

  it('shows an honest empty state and an honest failure state', async () => {
    serviceHistory.mockResolvedValueOnce({ items: [], services: [] });
    const { unmount } = render(<TechServiceHistoryScreen />);
    expect(await screen.findByText(/No completed services yet/)).toBeInTheDocument();
    unmount();
    serviceHistory.mockRejectedValueOnce(new Error('nope'));
    render(<TechServiceHistoryScreen />);
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });
});
