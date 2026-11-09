import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, appointments: vi.fn() } }));
vi.mock('../api/posAppointmentHistoryApi', () => ({ posAppointmentHistoryApi: { summary: vi.fn().mockResolvedValue({ cards: { appointments: 0, upcoming: 0, completed: 0, canceled: 0, noShows: 0, rescheduled: 0 } }), list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0, applied: { q: null, status: 'all', dateField: 'scheduled', sort: 'newest', preset: 'all', from: null, to: null }, period: { today: '2026-11-09', timeZone: 'UTC' } }), options: vi.fn().mockResolvedValue({ technicians: [] }), check: vi.fn() } }));
import { POSAppointmentHistoryScreen } from './POSAppointmentHistoryScreen';
describe('Appointment history permissions', () => {
  it('shows a permission message on 403 from search', async () => {
    searchMock.mockRejectedValue({ status: 403 });
    render(<POSAppointmentHistoryScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
