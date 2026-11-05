import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, appointments: vi.fn() } }));
import { POSAppointmentHistoryScreen } from './POSAppointmentHistoryScreen';
describe('Appointment history permissions', () => {
  it('shows a permission message on 403 from search', async () => {
    searchMock.mockRejectedValue({ status: 403 });
    render(<POSAppointmentHistoryScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
