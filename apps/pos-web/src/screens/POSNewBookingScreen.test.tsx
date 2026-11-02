// POSNewBookingScreen.test.tsx — SCAN (Oct 12 2026). New Booking built every date with toISOString() (UTC), so after
// 8 PM on the US east coast "today" was booked as TOMORROW; a ?date= hand-off overrode the date the user then picked;
// and the header / summary showed a frozen mockup ("Schedule for Thu, May 7, 2026", "– 11:55 AM · 1 hr 55 min",
// "Lily Adams"). The clock here is FIXED (and the zone set) — nothing depends on the real date.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const create = vi.fn(async (_b: any) => ({ appointmentId: 'a1' }));
const draftsList = vi.fn(async () => ({ drafts: [] as any[] }));
const draftsSave = vi.fn(async (payload: any) => ({ draftId: 'd1', title: payload?.customerName ?? null, notes: payload?.notes ?? null, date: payload?.date ?? null, startTime: payload?.startTime ?? null, serviceIds: payload?.serviceIds ?? [], customerId: payload?.customerId ?? null, payload, createdAt: '2026-10-22T00:00:00Z', expiresAt: '2026-10-29T00:00:00Z', createdByUserId: null }));
const draftsDiscard = vi.fn(async (_id: string) => ({ ok: true }));
const draftsConverted = vi.fn(async (_id: string) => ({ ok: true }));
// GET /pos/booking/availability: the server's open slots (HH:MM) per technician
const availability = vi.fn(async (_q: any): Promise<any> => [{ technicianId: 't1', name: 'Mai Tran', slots: ['10:00', '10:30', '13:15'] }, { technicianId: 't2', name: 'Lan', slots: ['09:45', '10:00'] }]);
vi.mock('../api/posBookingApi', () => ({
  posBookingApi: {
    state: vi.fn(async () => ({ filters: {
      services: [{ serviceId: 's1', name: 'Gel Manicure', category: 'Manicure', priceCents: 4500, durationMinutes: 45 }, { serviceId: 's2', name: 'Pedicure Deluxe', category: 'Pedicure', priceCents: 6000, durationMinutes: 70 }],
      serviceCategories: ['Manicure', 'Pedicure'],
      technicians: [{ technicianId: 't1', name: 'Mai Tran' }],
    } })),
    create: (b: any) => create(b),
    availability: (q: any) => availability(q),
    technicians: vi.fn(async () => ({ date: '2026-06-10', technicians: [{ technicianId: 't1', name: 'Mai Tran', rosterNumber: 1, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 }], total: 1, totalAll: 1, workingCount: 1, page: 1, pageSize: 12, totalPages: 1 })),
    // B-22: drafts are their own API — Save Draft never calls create
    drafts: { list: () => draftsList(), save: (p: any) => draftsSave(p), discard: (id: string) => draftsDiscard(id), converted: (id: string) => draftsConverted(id) },
  },
}));
// CR-04 (Oct 30 2026): a ?customerId= hand-off is LOADED from the server (GET /pos/customers/:id) before it shows as chosen
const getDetail = vi.fn(async (_id: string): Promise<any> => { throw new Error('not found'); });
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { search: vi.fn(async () => ({ items: [] })), getDetail: (id: string) => getDetail(id) } }));
vi.mock('../api/posCheckInApi', () => ({ posCheckInApi: { createCustomer: vi.fn() } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));

import { posBookingApi } from '../api/posBookingApi';
import { POSNewBookingScreen, localYmd, ymdToLocalDate, clockPlusMinutes, openStartTimes, to12Hour } from './POSNewBookingScreen';

const TZ0 = process.env.TZ;
beforeEach(() => { process.env.TZ = 'America/New_York'; create.mockClear(); availability.mockClear(); });
afterEach(() => { vi.useRealTimers(); process.env.TZ = TZ0; });

describe('New Booking date helpers (local calendar, never UTC)', () => {
  it('localYmd is the LOCAL calendar day; ymdToLocalDate round-trips; clockPlusMinutes adds the service time', () => {
    expect(localYmd(new Date('2026-10-13T00:30:00Z'))).toBe('2026-10-12');   // 8:30 PM EDT on the 12th
    expect(localYmd(ymdToLocalDate('2026-03-08')!)).toBe('2026-03-08');      // the DST change day
    expect(ymdToLocalDate('2026-13-40')).toBeNull();
    expect(clockPlusMinutes('10:00 AM', 115)).toBe('11:55 AM');
    expect(clockPlusMinutes('11:30 AM', 45)).toBe('12:15 PM');
  });
});

describe('open start times (deep-scan: they were a fixed 9:00 AM – 4:00 PM list)', () => {
  it('openStartTimes: one technician\'s slots, or every technician\'s for first available — sorted, de-duplicated, 12-hour', () => {
    const rows = [{ technicianId: 't1', slots: ['10:00', '13:15'] }, { technicianId: 't2', slots: ['09:45', '10:00'] }];
    expect(openStartTimes(rows, 't1')).toEqual(['10:00 AM', '1:15 PM']);
    expect(openStartTimes(rows)).toEqual(['9:45 AM', '10:00 AM', '1:15 PM']);
    expect(to12Hour('00:30')).toBe('12:30 AM'); expect(to12Hour('12:00')).toBe('12:00 PM');
  });
});

describe('POSNewBookingScreen', () => {
  const mount = (q = '') => render(<MemoryRouter initialEntries={['/booking/new' + q]}><POSNewBookingScreen /></MemoryRouter>);
  const book = async () => {
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(screen.getByText('Continue as Guest'));
    fireEvent.change(screen.getByPlaceholderText('Enter guest name'), { target: { value: 'Ann' } });
    fireEvent.click(await within(await screen.findByTestId('open-start-times')).findByText('10:00 AM'));
    fireEvent.click(screen.getByText(/Confirm Booking/));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    return create.mock.calls[0][0];
  };

  it('at 8:30 PM local, "today" is booked as today (not the UTC tomorrow)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T00:30:00Z'));
    mount('?startTime=09:00%20PM');
    expect((await book()).date).toBe('2026-10-12');
  });

  it('a ?date= hand-off is the starting day, but the day the user picks is the one booked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T14:00:00Z'));
    mount('?date=2026-10-14');
    await screen.findByText('Gel Manicure');
    expect((screen.getByLabelText('Appointment date') as HTMLInputElement).value).toBe('2026-10-14');
    fireEvent.change(screen.getByLabelText('Appointment date'), { target: { value: '2026-10-16' } });
    expect((await book()).date).toBe('2026-10-16');
  });

  it('header and summary show the chosen day, the computed end time and the chosen technician — no mockup text', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T14:00:00Z'));
    mount('?date=2026-10-14&startTime=10:00%20AM&technicianId=t1');
    fireEvent.click(await screen.findByText('Gel Manicure'));
    expect(screen.getByText(/Schedule for Wed, Oct 14, 2026/)).toBeInTheDocument();
    expect(screen.getAllByText(/10:00 AM – 10:45 AM/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/May 7|11:55 AM|Lily Adams/)).toBeNull();
    expect(screen.getAllByText(/Mai Tran/).length).toBeGreaterThan(0);
  });

  // B-22 (Oct 22 2026): Save Draft is a REAL draft — never an appointment with "[DRAFT]" in the notes
  it('Save Draft saves the form as a draft (no appointment is created); a listed draft can be resumed and then books as converted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T14:00:00Z'));
    draftsList.mockResolvedValueOnce({ drafts: [{ draftId: 'd9', title: 'Ann Lee', notes: 'birthday', date: '2026-10-14', startTime: '10:00', serviceIds: ['s1'], customerId: null, createdAt: '', expiresAt: '', createdByUserId: null,
      payload: { serviceIds: ['s1'], serviceLines: [{ serviceId: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }], date: '2026-10-14', startTime: '10:00', technicianId: 't1', customerName: 'Ann Lee', notes: 'birthday', partySize: 1 } }] });
    mount('?date=2026-10-14&startTime=10:00%20AM&technicianId=t1');
    expect(await screen.findByTestId('booking-drafts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Resume'));
    expect(screen.getAllByText(/Gel Manicure/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Save Draft'));
    await vi.waitFor(() => expect(draftsSave).toHaveBeenCalledTimes(1));
    expect(create).not.toHaveBeenCalled();
    expect(String(draftsSave.mock.calls[0][0]?.notes ?? '')).not.toMatch(/\[DRAFT\]/);
    expect(draftsDiscard).toHaveBeenCalledWith('d9');   // the resumed copy is superseded by the new save
  });
});

describe('POSNewBookingScreen — start times come from the server', () => {
  const mount = (q = '') => render(<MemoryRouter initialEntries={['/booking/new' + q]}><POSNewBookingScreen /></MemoryRouter>);
  it('shows the server\'s open times for the chosen services and technician, never the fixed list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    mount('?date=2026-10-14&technicianId=t1');
    fireEvent.click(await screen.findByText('Gel Manicure'));
    await waitFor(() => expect(availability).toHaveBeenLastCalledWith({ date: '2026-10-14', serviceIds: ['s1'], technicianId: 't1' }));
    const grid = await screen.findByTestId('open-start-times');
    await within(grid).findByText('1:15 PM');
    expect(within(grid).queryByText('9:00 AM')).toBeNull();            // from the old fixed list
    expect(within(grid).queryByText('9:45 AM')).toBeNull();            // another technician's slot
  });
  it('the board\'s Best Matches hand-off (?time=HH:MM) arrives selected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    mount('?date=2026-10-14&technicianId=t1&time=13:15');
    fireEvent.click(await screen.findByText('Gel Manicure'));
    expect(screen.getAllByText(/1:15 PM – 2:00 PM/).length).toBeGreaterThan(0);
  });
  it('the board\'s ?serviceId= hand-off arrives selected, and the open times are asked for that service', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    mount('?date=2026-10-14&serviceId=s2');
    await waitFor(() => expect(availability).toHaveBeenLastCalledWith({ date: '2026-10-14', serviceIds: ['s2'], technicianId: undefined }));
  });
  it('the open times are asked for the WHOLE visit — the main service and its add-on (45 + 15 minutes)', async () => {
    (posBookingApi.state as any).mockResolvedValueOnce({ filters: {
      services: [{ serviceId: 's1', name: 'Gel Manicure', category: 'Manicure', priceCents: 4500, durationMinutes: 45 }, { serviceId: 'a1', name: 'Nail Art', category: 'Add-ons', priceCents: 1500, durationMinutes: 15 }],
      serviceCategories: ['Manicure', 'Add-ons'], technicians: [{ technicianId: 't1', name: 'Mai Tran' }] } });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    mount('?date=2026-10-14&technicianId=t1');
    fireEvent.click((await screen.findAllByText('Gel Manicure'))[0]);
    const arts = await screen.findAllByText('Nail Art'); fireEvent.click(arts[arts.length - 1]);
    await waitFor(() => expect(availability).toHaveBeenLastCalledWith({ date: '2026-10-14', serviceIds: ['s1', 'a1'], technicianId: 't1' }));
  });
  it('nothing open → says so; the call failing → the standard times, labelled as not checked', async () => {
    availability.mockResolvedValue([{ technicianId: 't1', name: 'Mai Tran', slots: [] }]);
    mount('?date=2026-10-14&technicianId=t1');
    expect(await screen.findByText(/No open start time fits/)).toBeInTheDocument();
    availability.mockRejectedValue(new Error('offline'));
    fireEvent.click(await screen.findByText('Gel Manicure'));
    expect(await screen.findByText(/Open times could not be loaded/)).toBeInTheDocument();
    expect(within(screen.getByTestId('open-start-times')).getByText('9:00 AM')).toBeInTheDocument();
    availability.mockReset(); availability.mockImplementation(async () => [{ technicianId: 't1', name: 'Mai Tran', slots: ['10:00', '10:30', '13:15'] }]);
  });
});

describe('CR-04: Customer Retention → Book appointment (customer preselected by id)', () => {
  const mount = (q: string) => render(<MemoryRouter initialEntries={['/booking/new' + q]}><POSNewBookingScreen /></MemoryRouter>);
  it('loads THAT customer from the server by id (no name / phone in the URL) and saves nothing by opening the form', async () => {
    getDetail.mockReset(); getDetail.mockResolvedValueOnce({ customerId: 'c-ana', displayName: 'Ana Rivera', firstName: 'Ana', lastName: 'Rivera', phone: '(215) 555-0101', status: 'active' });
    mount('?customerId=c-ana&from=retention');
    const sel = await screen.findByTestId('booking-selected-customer');
    expect(sel).toHaveTextContent('Ana Rivera'); expect(sel.getAttribute('data-customer-id')).toBe('c-ana');
    expect(getDetail).toHaveBeenCalledWith('c-ana');
    expect(screen.getByTestId('booking-prefill-note')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled(); expect(draftsSave).not.toHaveBeenCalled();
  });
  it('a deleted / other-salon id → an actionable message and the manual search; nothing is preselected', async () => {
    getDetail.mockReset(); getDetail.mockRejectedValueOnce(Object.assign(new Error('Customer not found'), { status: 404 }));
    mount('?customerId=gone-1&from=retention');
    expect(await screen.findByTestId('booking-prefill-failed')).toHaveTextContent(/Search for the customer below/);
    expect(screen.queryByTestId('booking-selected-customer')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
