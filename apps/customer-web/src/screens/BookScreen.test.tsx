import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { salon: vi.fn().mockResolvedValue({ id: 'b1', name: 'Luxe Nails', address: '1 Main St', phone: null }), salonsNearby: vi.fn().mockResolvedValue({ results: [] }), salonServices: vi.fn().mockResolvedValue([]), salonTechnicians: vi.fn().mockResolvedValue({ technicians: [] }), sendBookingVerification: vi.fn(), checkBookingVerification: vi.fn(), bookingCaptcha: vi.fn(), bookingOptions: vi.fn(), availability: vi.fn(), createBooking: vi.fn(), bookingServiceTechnicians: vi.fn(async () => ({ serviceId: 's1', technicians: [] })), techFavorites: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'CUSTOMER' } }) }));
import { customerApi } from '../api/customerApi';
import { BookScreen } from './BookScreen';

const setup = () => {
  (customerApi.techFavorites as any).mockResolvedValue({ slugs: [], techs: [] });
  (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }, { id: 's2', name: 'Pedicure Spa', durationMinutes: 60, priceCents: 4000, category: 'Pedicure' }], technicians: [{ id: 't1', fullName: 'Lisa' }] });
  (customerApi.availability as any).mockResolvedValue({ date: '2026-08-27', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 },
    slots: [{ startTime: '10:00', available: true, technicianIds: ['t1'] }, { startTime: '11:00', available: false, technicianIds: [] }] });
  (customerApi.createBooking as any).mockResolvedValue({ appointmentId: 'a1', date: '2026-08-27', startTime: '10:00', endTime: '10:45', serviceName: 'Gel Manicure', technicianName: 'Lisa', status: 'booked' });
};

// Sep 2026 redesign: the flow is Date -> (Salon) -> Services -> Time & Tech -> Summary. With the signed-in salon known,
// 'Continue to Services' goes straight to the service list.
async function toServices() {
  fireEvent.click(await screen.findByRole('button', { name: /Continue to Services/ }));
  await screen.findByText('Gel Manicure');
}

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
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: /Select a Service to Continue/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    expect((screen.getByRole('button', { name: /Choose Time & Tech/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the real availability grid and books the selected slot (auto-assigns a free technician)', async () => {
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    // real slots arrive from /customer/booking/availability
    const slot = await screen.findByText('10:00 AM');
    expect((customerApi.availability as any).mock.calls[0].slice(0, 2)).toEqual(['s1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);   // + optional technician (redesign)
    const unavailable = screen.getByText('11:00 AM').closest('button') as HTMLButtonElement;
    expect(unavailable.disabled).toBe(true);                       // conflicted slot not selectable
    fireEvent.click(slot);
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));   // Time & Tech → Summary
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    const body = (customerApi.createBooking as any).mock.calls[0][0];
    expect(body).toMatchObject({ serviceId: 's1', technicianId: 't1', startTime: '10:00' });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByText(/booked!/)).toBeInTheDocument();
  });

  it('carries a Book-This-Look inspiration into the booking request and shows the banner', async () => {
    const look = { photoId: 'ph1', caption: 'Chrome French', imageUrl: '/i1.jpg', techName: 'Jane Nguyen' };
    render(<MemoryRouter initialEntries={[{ pathname: '/book', state: { look } }]}><BookScreen /></MemoryRouter>);
    expect(await screen.findByText('Booking this look')).toBeInTheDocument();
    await toServices();
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    fireEvent.click(await screen.findByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    const body = (customerApi.createBooking as any).mock.calls[0][0];
    expect(body.inspirationPhotoId).toBe('ph1');
    expect(body.inspirationNote).toContain('Chrome French');
    expect(body.inspirationNote).toContain('Jane Nguyen');
  });

  it('lets the customer choose a specific technician in the Time & Tech step', async () => {
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }], technicians: [{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Mona' }] });
    (customerApi.availability as any).mockResolvedValue({ date: '2026-07-01', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 }, slots: [{ startTime: '10:00', available: true, technicianIds: ['t1', 't2'] }] });
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));   // → schedule
    fireEvent.click(await screen.findByRole('button', { name: /Mona/ }));   // the technician is chosen in the Time & Tech step now
    fireEvent.click(await screen.findByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    expect((customerApi.createBooking as any).mock.calls[0][0]).toMatchObject({ serviceId: 's1', technicianId: 't2', startTime: '10:00' });
  });

  it('filters services by the real category pills', async () => {
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
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
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    // the enriched chips are on the Time & Tech step itself
    expect(await screen.findByText('★ 4.9 (32)', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('View profile')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));

    // Future slots (12:00 PM, 1:00 PM) are present
    expect(await screen.findByText('12:00 PM')).toBeInTheDocument();
    expect(screen.getByText('1:00 PM')).toBeInTheDocument();

    // Past slots (9:00 AM, 10:00 AM, 11:00 AM) are filtered out and not shown
    expect(screen.queryByText('9:00 AM')).not.toBeInTheDocument();
    expect(screen.queryByText('10:00 AM')).not.toBeInTheDocument();
    expect(screen.queryByText('11:00 AM')).not.toBeInTheDocument();
  });

  it('Phase 4: a 428 holds the slot, the code is sent for that session, and the retry carries the session (no 428 loop)', async () => {
    (customerApi.createBooking as any)
      .mockRejectedValueOnce(Object.assign(new Error('Please verify your phone number to continue.'), { status: 428, code: 'phone_verification_required', details: { bookingSessionId: 'bs.tok', maskedPhone: '••••0101', holdExpiresAt: '2026-08-27T08:10:00.000Z' } }))
      .mockResolvedValueOnce({ appointmentId: 'a1', date: '2026-08-27', startTime: '10:00', endTime: '10:45', serviceName: 'Gel Manicure', technicianName: 'Lisa', status: 'booked' });
    (customerApi.sendBookingVerification as any).mockResolvedValue({ status: 'code_sent', bookingSessionId: 'bs.tok', maskedPhone: '••••0101' });
    (customerApi.checkBookingVerification as any).mockResolvedValue({ status: 'phone_verified' });
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    fireEvent.click(await screen.findByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.sendBookingVerification).toHaveBeenCalledWith({ bookingSessionId: 'bs.tok' }));
    expect(await screen.findByTestId('hold-note')).toBeTruthy();
    const boxes = screen.getAllByRole('textbox');
    '123456'.split('').forEach((d, i) => fireEvent.change(boxes[i], { target: { value: d } }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(2));
    expect((customerApi.createBooking as any).mock.calls[1][0]).toMatchObject({ bookingSessionId: 'bs.tok', startTime: '10:00' });
    expect(await screen.findByText(/You’re booked/)).toBeTruthy();
  });
  // Technician Profile mandate §56 / §144 (merge Oct 12): favourite technicians come first and are preferred for
  // "Any Available" — only among the slot's (server-eligible) technicians.
  it('lists a favourite technician first (♥) and prefers her for Any Available when she is free', async () => {
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }], technicians: [{ id: 't1', fullName: 'Lisa' }, { id: 't2', fullName: 'Mona' }] });
    (customerApi.availability as any).mockResolvedValue({ date: '2026-08-27', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 }, slots: [{ startTime: '10:00', available: true, technicianIds: ['t1', 't2'] }] });
    (customerApi.techFavorites as any).mockResolvedValue({ slugs: ['mona-k'], techs: [{ technicianId: 't2', publicSlug: 'mona-k' }] });
    render(<MemoryRouter><BookScreen /></MemoryRouter>);
    await toServices();
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    await screen.findByText('10:00 AM');
    const chips = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent || '').filter((t) => /Lisa|Mona/.test(t));
    expect(chips[0]).toMatch(/Mona/);                       // favourite first
    expect(screen.getByLabelText('Your favorite')).toBeInTheDocument();
    fireEvent.click(screen.getByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    expect((customerApi.createBooking as any).mock.calls[0][0]).toMatchObject({ technicianId: 't2' });   // Any Available → the favourite
  });

  it('Book This Look from Nail Showcase pre-fills service + technician and sends the style note (no portfolio photo id)', async () => {
    const look = { caption: 'Chrome French', imageUrl: '/s1.jpg', techName: 'Lisa', source: 'showcase' };
    render(<MemoryRouter initialEntries={[{ pathname: '/book', search: '?serviceId=s1&technicianId=t1', state: { look } }]}><BookScreen /></MemoryRouter>);
    expect(await screen.findByText('Booking this look')).toBeInTheDocument();
    // the service is pre-picked (this salon offers s1), so Continue goes straight to Time & Tech
    await waitFor(() => expect(customerApi.bookingOptions).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Continue/ }));
    fireEvent.click(await screen.findByText('10:00 AM'));
    expect((customerApi.availability as any).mock.calls[0][0]).toBe('s1');
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    const body = (customerApi.createBooking as any).mock.calls[0][0];
    expect(body).toMatchObject({ serviceId: 's1', technicianId: 't1' });
    expect(body.inspirationNote).toContain('Chrome French');
    expect(body.inspirationNote).toContain('Nail Showcase');
    expect(body).not.toHaveProperty('inspirationPhotoId');
  });

  it('a showcase service this salon does not offer is NOT pre-picked', async () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/book', search: '?serviceId=foreign-svc' }]}><BookScreen /></MemoryRouter>);
    await toServices();
    expect((screen.getByRole('button', { name: /Select a Service to Continue/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
