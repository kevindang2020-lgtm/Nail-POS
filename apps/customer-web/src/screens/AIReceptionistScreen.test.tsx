import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/customerApi', () => ({ customerApi: {
  queue: vi.fn(), appointments: vi.fn(), salon: vi.fn(), deals: vi.fn(), loyalty: vi.fn(),
} }));
import { customerApi } from '../api/customerApi';
import { AIReceptionistScreen } from './AIReceptionistScreen';

describe('AIReceptionistScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (customerApi.queue as any).mockResolvedValue({ inQueue: true, position: 2, totalWaiting: 5, estimatedWaitMinMinutes: 10, estimatedWaitMaxMinutes: 20 });
    (customerApi.appointments as any).mockResolvedValue([{ appointmentId: 'a1', serviceName: 'Gel Manicure', startTime: new Date(Date.now() + 86400000).toISOString(), status: 'confirmed', technicianName: 'Lisa' }]);
    (customerApi.salon as any).mockResolvedValue({ name: 'AIPower Nails', address: '123 Main St', phone: '(856) 555-0100' });
    (customerApi.deals as any).mockResolvedValue([{ id: 'd1', title: '20% off gel', description: null, code: null, startsAt: null, endsAt: null }]);
    (customerApi.loyalty as any).mockResolvedValue({ points: 1250, tier: 'Gold', nextTier: 'Platinum', pointsToNextTier: 750, progressPercent: 60 });
  });

  it('greets the customer with capabilities', () => {
    render(<MemoryRouter><AIReceptionistScreen /></MemoryRouter>);
    expect(screen.getByText(/virtual receptionist/i)).toBeInTheDocument();
  });

  it('answers the queue question from real /customer/queue data', async () => {
    render(<MemoryRouter><AIReceptionistScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'My place in line' }));
    expect(await screen.findByText(/#2 of 5 in line/)).toBeInTheDocument();
    expect(customerApi.queue).toHaveBeenCalled();
  });

  it('answers the appointment question from real appointment data', async () => {
    render(<MemoryRouter><AIReceptionistScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'My next appointment' }));
    expect(await screen.findByText(/Your next appointment is Gel Manicure/)).toBeInTheDocument();
  });

  it('answers the rewards question with real loyalty points', async () => {
    render(<MemoryRouter><AIReceptionistScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'My rewards' }));
    expect(await screen.findByText(/1,250 points/)).toBeInTheDocument();
  });
});
