import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerFollowUpApi', () => ({ customerFollowUpApi: { list: vi.fn(), get: vi.fn(), reply: vi.fn(), rebook: vi.fn() } }));
import { customerFollowUpApi } from '../api/customerFollowUpApi';
import { CustomerFollowUpsScreen } from './CustomerFollowUpsScreen';

const item = {
  id: 'f1', businessDate: '2026-06-10', status: 'sent', serviceName: 'Gel Manicure', serviceId: 'sv1', ticketId: 'tk1',
  technicianId: 'te1', technicianName: 'Linh Tran', completedAt: '2026-06-10T20:30:00Z',
  sentMessage: 'Hi Olivia, thank you for coming in today! Hope you love your nails.', suggestedMessage: '', sentAt: '2026-06-10T21:00:00Z',
};

describe('CustomerFollowUpsScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the customer\'s sent follow-ups with technician, service, and message preview', async () => {
    (customerFollowUpApi.list as any).mockResolvedValue([item]);
    render(<MemoryRouter><CustomerFollowUpsScreen /></MemoryRouter>);
    expect(await screen.findByText('Linh Tran sent you a follow-up')).toBeInTheDocument();
    expect(screen.getByText(/Gel Manicure/)).toBeInTheDocument();
    expect(screen.getByText(/thank you for coming in today/)).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no follow-ups', async () => {
    (customerFollowUpApi.list as any).mockResolvedValue([]);
    render(<MemoryRouter><CustomerFollowUpsScreen /></MemoryRouter>);
    expect(await screen.findByText('No follow-ups yet')).toBeInTheDocument();
  });
});
