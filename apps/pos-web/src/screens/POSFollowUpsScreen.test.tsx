import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSFollowUpsScreen } from './POSFollowUpsScreen';

const task = {
  id: 't1', businessDate: '2026-06-10', status: 'pending', customerName: 'Olivia Brown', customerPhone: null,
  customerHasApp: true, serviceName: 'Gel Manicure', serviceId: 's1', ticketId: 'k1', ticketServiceLineId: 'l1',
  appointmentId: null, technicianId: 'te1', technicianName: 'Linh Tran', completedAt: '2026-06-10T20:30:00Z',
  templateKey: 'thank_you', suggestedMessage: 'Hi Olivia, thank you for coming in today.', sentMessage: null, sentAt: null, skipReason: null,
};
const result = { tasks: [task], stats: { pending: 1, sent: 0, skipped: 0, dismissed: 0, rebooked: 0, total: 1 } };

const mockFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => result, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSFollowUpsScreen', () => {
  it('renders the branch follow-up queue with a pending task, technician summary, and Send action', async () => {
    globalThis.fetch = mockFetch() as any;
    render(<POSFollowUpsScreen />);
    expect(await screen.findByText('Follow-Up Queue')).toBeInTheDocument();
    expect(await screen.findByText('Olivia Brown')).toBeInTheDocument();           // task row
    expect(screen.getByText(/Gel Manicure/)).toBeInTheDocument();                  // service line in row
    expect(screen.getAllByText('Linh Tran').length).toBeGreaterThan(0);            // appears in summary + table
    expect(screen.getByText('1 pending')).toBeInTheDocument();                     // technician summary chip
    expect(screen.getAllByText('Send').length).toBeGreaterThan(0);                 // pending → can send
    expect(screen.getByText('Generate Now')).toBeInTheDocument();                  // manual generation
  });
});
