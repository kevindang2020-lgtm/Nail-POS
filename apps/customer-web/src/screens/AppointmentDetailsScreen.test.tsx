import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { appointments: vi.fn(), serviceProgress: vi.fn(), salon: vi.fn(), cancelAppointment: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { AppointmentDetailsScreen } from './AppointmentDetailsScreen';

const renderAt = (appt: any) => render(
  <MemoryRouter initialEntries={[{ pathname: `/appointments/${appt.appointmentId}`, state: { appt } }]}>
    <Routes><Route path="/appointments/:appointmentId" element={<AppointmentDetailsScreen />} /></Routes>
  </MemoryRouter>);

describe('AppointmentDetailsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.salon as any).mockResolvedValue({ name: 'AIPowerSalon Nails & Spa', address: '123 Main St, Cherry Hill, NJ 08002', phone: '(856) 555-0100' }); });
  it('renders the live status timeline from the active service', async () => {
    (customerApi.serviceProgress as any).mockResolvedValue({ ticketId: 't1', serviceName: 'Acrylic Full Set', status: 'serving', startedAt: new Date().toISOString(), elapsedSeconds: 600, progressPercent: 50, estimatedFinishTime: null });
    renderAt({ appointmentId: 'a1', serviceName: 'Acrylic Full Set', startTime: new Date().toISOString(), status: 'serving', technicianName: 'Lisa' });
    expect(await screen.findByText('This is your live status')).toBeInTheDocument();
    expect(screen.getByText('Almost Done')).toBeInTheDocument(); // timeline step label present
    expect(screen.getByText('Lisa')).toBeInTheDocument();
    // real salon location + Call dials the real number (tel:)
    expect(await screen.findByText('AIPowerSalon Nails & Spa')).toBeInTheDocument();
    expect(screen.getByText('123 Main St, Cherry Hill, NJ 08002')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call the salon' })).toHaveAttribute('href', 'tel:(856)5550100'.replace(/[^0-9+a-z:]/gi, ''));
  });
  it('shows a pre-checkin state (no live hero) for a confirmed appointment', async () => {
    (customerApi.serviceProgress as any).mockResolvedValue(null);
    renderAt({ appointmentId: 'a2', serviceName: 'Gel Manicure', startTime: new Date().toISOString(), status: 'confirmed', technicianName: 'Anna' });
    expect(await screen.findByText(/Live status will appear here once you’re checked in\./)).toBeInTheDocument();
  });
  it('cancels an upcoming appointment after confirmation (real POST)', async () => {
    (customerApi.serviceProgress as any).mockResolvedValue(null);
    (customerApi.cancelAppointment as any).mockResolvedValue({ ok: true });
    renderAt({ appointmentId: 'a3', serviceName: 'Gel Manicure', startTime: new Date(Date.now() + 86400000).toISOString(), status: 'confirmed', technicianName: 'Anna' });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Appointment' }));
    const dialog = screen.getByRole('dialog');
    expect(customerApi.cancelAppointment).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel it' }));
    await waitFor(() => expect(customerApi.cancelAppointment).toHaveBeenCalledWith('a3'));
  });
});
