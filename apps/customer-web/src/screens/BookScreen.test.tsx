import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { salon: vi.fn(async () => ({ id: 'salon1', name: 'Lotus Nails', address: '1 Main St' })), salonsNearby: vi.fn(async () => ({ results: [] })), salonServices: vi.fn(async () => []), salonTechnicians: vi.fn(async () => ({ technicians: [] })), sendBookingVerification: vi.fn(async () => ({ ok: true })), bookingOptions: vi.fn(), availability: vi.fn(), createBooking: vi.fn(), bookingServiceTechnicians: vi.fn(async () => ({ serviceId: 's1', technicians: [] })) } }));
import { customerApi } from '../api/customerApi';
import { BookScreen } from './BookScreen';

// The booking flow now opens on the date + salon step; "Continue to Services →" moves to the service list.
const toServices = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Continue to Services/ }));
};

const setup = () => {
  (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }, { id: 's2', name: 'Pedicure Spa', durationMinutes: 60, priceCents: 4000, category: 'Pedicure' }], technicians: [{ id: 't1', fullName: 'Lisa' }] });
  (customerApi.availability as any).mockResolvedValue({ date: '2026-08-27', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 },
    slots: [{ startTime: '10:00', available: true, technicianIds: ['t1'] }, { startTime: '11:00', available: false, technicianIds: [] }] });
  (customerApi.createBooking as any).mockResolvedValue({ appointmentId: 'a1', date: '2026-08-27', startTime: '10:00', endTime: '10:45', serviceName: 'Gel Manicure', technicianName: 'Lisa', status: 'booked' });
};

describe('BookScreen (Book Services + Choose Date & Time)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-27T08:00:00'));
    setup();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('lists real services and enables the booking CTA only after a selection', async () => {
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    expect(await screen.findByText('Gel Manicure')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: 'Select a Service to Continue' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select Gel Manicure' }));
    expect((screen.getByRole('button', { name: /Choose Time & Tech/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the real availability grid and books the selected slot (auto-assigns a free technician)', async () => {
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByRole('button', { name: 'Select Gel Manicure' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    // real slots arrive from /customer/booking/availability
    const slot = await screen.findByText('10:00 AM');
    expect(customerApi.availability).toHaveBeenCalledWith('s1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), undefined, 'salon1');
    const unavailable = screen.getByText('11:00 AM').closest('button') as HTMLButtonElement;
    expect(unavailable.disabled).toBe(true);                       // conflicted slot not selectable
    fireEvent.click(slot);
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));   // tech + time → review
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Book Now' }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    const body = (customerApi.createBooking as any).mock.calls[0][0];
    expect(body).toMatchObject({ serviceId: 's1', technicianId: 't1', startTime: '10:00' });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText('You’re booked! 🎉')).toBeInTheDocument();
  });

  it('carries a Book-This-Look inspiration into the booking request and shows the banner', async () => {
    const look = { photoId: 'ph1', caption: 'Chrome French', imageUrl: '/i1.jpg', techName: 'Jane Nguyen' };
    render(<MemoryRouter initialEntries={[{ pathname: '/book', state: { look } }]}><BookScreen /></MemoryRouter>);
    await toServices();
    expect(await screen.findByText('Booking this look')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select Gel Manicure' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    fireEvent.click(await screen.findByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Book Now' }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    const body = (customerApi.createBooking as any).mock.calls[0][0];
    expect(body.inspirationPhotoId).toBe('ph1');
    expect(body.inspirationNote).toContain('Chrome French');
    expect(body.inspirationNote).toContain('Jane Nguyen');
  });

  it('lets the customer choose a specific technician on the technician + time step', async () => {
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }], technicians: [{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Mona' }] });
    (customerApi.availability as any).mockResolvedValue({ date: '2026-07-01', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 }, slots: [{ startTime: '10:00', available: true, technicianIds: ['t1', 't2'] }] });
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByRole('button', { name: 'Select Gel Manicure' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));   // → technician + time
    fireEvent.click(await screen.findByRole('button', { name: /Mona/ })); // pick a specific tech first
    fireEvent.click(await screen.findByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));   // → review
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Book Now' }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    expect((customerApi.createBooking as any).mock.calls[0][0]).toMatchObject({ serviceId: 's1', technicianId: 't2', startTime: '10:00' });
  });

  it('filters services by the real category pills', async () => {
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    await screen.findByText('Gel Manicure');
    expect(screen.getByText('Pedicure Spa')).toBeInTheDocument();        // both shown under "All"
    fireEvent.click(screen.getByRole('button', { name: 'Nails' }));       // pick a real category
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.queryByText('Pedicure Spa')).not.toBeInTheDocument();   // other category hidden
  });
  it('enriches technician chips with rating + View profile when the matcher returns cards (P5)', async () => {
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }], technicians: [{ id: 't1', fullName: 'Mia Tran' }] });
    (customerApi.availability as any).mockResolvedValue({ date: '2026-07-01', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 }, slots: [{ startTime: '10:00', available: true, technicianIds: ['t1'] }] });
    (customerApi.bookingServiceTechnicians as any).mockResolvedValue({ serviceId: 's1', technicians: [{ technicianId: 't1', displayName: 'Mia Tran', avatarUrl: '/media/a.png', averageRating: 4.9, reviewCount: 32, publicSlug: 'mia-tran', isPrimary: true, isBookable: true }] });
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByRole('button', { name: 'Select Gel Manicure' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    // Technician chips on the technician + time step carry the matcher's rating.
    expect(await screen.findByText('★ 4.9', { exact: false })).toBeInTheDocument();
  });

  it('filters out past time slots when viewing today', async () => {
    // Current time is 11:30 AM on 2026-08-27
    vi.setSystemTime(new Date('2026-08-27T11:30:00'));
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }], technicians: [{ id: 't1', fullName: 'Lisa' }] });
    (customerApi.availability as any).mockResolvedValue({
      date: '2026-08-27', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 },
      slots: [
        { startTime: '09:00', available: true, technicianIds: ['t1'] }, // past (< 11:30)
        { startTime: '10:00', available: true, technicianIds: ['t1'] }, // past (< 11:30)
        { startTime: '11:00', available: true, technicianIds: ['t1'] }, // past (< 11:30)
        { startTime: '12:00', available: true, technicianIds: ['t1'] }, // future (> 11:30)
        { startTime: '13:00', available: true, technicianIds: ['t1'] }, // future (> 11:30)
      ],
    });

    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByRole('button', { name: 'Select Gel Manicure' }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));

    // Future slots (12:00 PM, 1:00 PM) are present
    expect(await screen.findByText('12:00 PM')).toBeInTheDocument();
    expect(screen.getByText('1:00 PM')).toBeInTheDocument();

    // Past slots (9:00 AM, 10:00 AM, 11:00 AM) are filtered out and not shown
    expect(screen.queryByText('9:00 AM')).not.toBeInTheDocument();
    expect(screen.queryByText('10:00 AM')).not.toBeInTheDocument();
    expect(screen.queryByText('11:00 AM')).not.toBeInTheDocument();
  });
});

