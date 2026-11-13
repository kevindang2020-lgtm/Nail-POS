import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FULL_PERMISSIONS, READ_ONLY_PERMISSIONS, type BookingDataAdapter } from '../adapters/BookingDataAdapter';
import { MockBookingDataAdapter } from '../adapters/MockBookingDataAdapter';
import { BookingScheduleBoard, type BookingScheduleBoardProps } from '../components/BookingScheduleBoard';
import { BookingDomainError } from '../domain/bookingErrors';
import type { BookingContext } from '../domain/scheduleTypes';
import { minuteOfDay, toISO } from '../domain/time';
import { buildFixture, FIXTURE_BRANCH, FIXTURE_DATE, FIXTURE_TENANT, FIXTURE_TZ } from '../fixtures/fixtures';
import type { PersistedBoardState } from '../state/boardState';
import { applyEvent, storeFromRange } from '../state/scheduleStore';

const scope = { tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH };
const at = (m: number) => toISO(FIXTURE_DATE, m, FIXTURE_TZ);
const NOW = () => new Date(at(9 * 60)); // board opens at 9:00 AM on the fixture day

beforeAll(() => {
  // jsdom lacks these; the board degrades gracefully without them.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(cleanup);

function mount(adapter: BookingDataAdapter, extra: Partial<BookingScheduleBoardProps> = {}) {
  const onOpenBookingAssistant = vi.fn<(c: BookingContext) => void>();
  const utils = render(
    <BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE}
      permissions={FULL_PERMISSIONS} adapter={adapter} now={NOW} onOpenBookingAssistant={onOpenBookingAssistant} {...extra} />,
  );
  return { ...utils, onOpenBookingAssistant };
}
const ready = () => screen.findByTestId('bsb-tech-tech-001');

describe('BookingScheduleBoard (UI against the mock adapter)', () => {
  it('shows a skeleton, then 12 technician columns with page label synced top and bottom (spec §9)', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture({ technicianCount: 25 }), { now: NOW });
    mount(adapter);
    expect(screen.getByTestId('bsb-skeleton')).toBeInTheDocument();
    await ready();
    // 25 staff, 1 on time off → 24 working → 2 pages
    expect(screen.getAllByRole('columnheader')).toHaveLength(12);
    expect(screen.getByText('Technicians 1–12 of 24')).toBeInTheDocument();
    expect(screen.getByText('Working technicians (24)')).toBeInTheDocument();
    expect(within(screen.getByTestId('bsb-pager-bottom')).getByText('Page 1 of 2')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    expect(screen.getByText('Technicians 13–24 of 24')).toBeInTheDocument();
    expect(within(screen.getByTestId('bsb-pager-bottom')).getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.queryByTestId('bsb-tech-tech-001')).toBeNull();
    expect(screen.getByText('13')).toBeInTheDocument(); // global sequence numbers continue
    // Only one request for the whole branch/day — never one per column (spec §32)
    expect(adapter.stats.scheduleRangeCalls).toBe(1);
  });

  it('a 25-working-technician day pages 12 / 12 / 1', async () => {
    const data = buildFixture({ technicianCount: 26 }); // tech-008 off → 25 working
    mount(new MockBookingDataAdapter(data, { now: NOW }));
    await ready();
    const next = () => fireEvent.click(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /^Next/ }));
    expect(screen.getByText('Technicians 1–12 of 25')).toBeInTheDocument();
    next();
    expect(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /Next 1$/ })).toBeInTheDocument();
    next();
    expect(screen.getByText('Technicians 25–25 of 25')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(1);
    expect(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /^Next/ })).toBeDisabled();
  });

  it('daily availability strip is computed, not hard-coded (spec §11)', async () => {
    mount(new MockBookingDataAdapter(buildFixture(), { now: NOW }));
    await ready();
    // tech-002 first gap is 10:45–11:30 AM (45 min)
    const cell = screen.getByTestId('bsb-avail-tech-002');
    expect(cell).toHaveTextContent('10:45 – 11:30 AM');
    expect(cell).toHaveTextContent('45 min open');
  });

  it('clicking an open + Book cell emits the host booking context (spec §14)', async () => {
    const { onOpenBookingAssistant } = mount(new MockBookingDataAdapter(buildFixture(), { now: NOW }));
    await ready();
    fireEvent.click(screen.getByTestId('bsb-cell-tech-002-645'));
    expect(onOpenBookingAssistant).toHaveBeenCalledTimes(1);
    const ctx = onOpenBookingAssistant.mock.calls[0][0];
    expect(ctx).toMatchObject({ tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, date: FIXTURE_DATE, technicianId: 'tech-002', availableDurationMinutes: 45, serviceId: 'svc-gel-mani' });
    expect(minuteOfDay(ctx.startAt, FIXTURE_DATE, FIXTURE_TZ)).toBe(645);
    // A cell inside a gap reports what is left from that cell, not the whole gap
    fireEvent.click(screen.getByTestId('bsb-cell-tech-002-660'));
    expect(onOpenBookingAssistant.mock.calls[1][0].availableDurationMinutes).toBe(30);
  });

  it('View All lists every gap from the same availability; picking one emits context (spec §12)', async () => {
    const { onOpenBookingAssistant } = mount(new MockBookingDataAdapter(buildFixture(), { now: NOW }));
    await ready();
    fireEvent.click(within(screen.getByTestId('bsb-avail-tech-002')).getByRole('button', { name: /View all/ }));
    const pop = screen.getByTestId('bsb-view-all');
    const rows = within(pop).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['10:45 – 11:30 AM45 min', '12:30 – 2:00 PM90 min', '3:00 – 4:00 PM60 min', '4:45 – 8:00 PM195 min']);
    fireEvent.click(rows[2]);
    expect(onOpenBookingAssistant.mock.calls[0][0]).toMatchObject({ technicianId: 'tech-002', availableDurationMinutes: 60 });
  });

  it('#9 realtime: a booking made at "Station A" appears on this board without reload', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    mount(adapter);
    await ready();
    expect(screen.getByTestId('bsb-open-tech-002-645')).toBeInTheDocument();
    const before = adapter.stats.scheduleRangeCalls;
    let created!: { id: string };
    await act(async () => {
      created = await adapter.createAppointment({ ...scope, idempotencyKey: 'stationA-1', technicianId: 'tech-002', customerName: 'From Station A', serviceIds: ['svc-gel-mani'], startAt: at(645), requestedTechnician: false });
    });
    expect(await screen.findByTestId(`bsb-appt-${created.id}`)).toHaveTextContent('From Station A');
    expect(screen.queryByTestId('bsb-open-tech-002-645')).toBeNull();
    expect(screen.getByTestId('bsb-avail-tech-002')).toHaveTextContent('12:30 – 2:00 PM');
    expect(adapter.stats.scheduleRangeCalls).toBe(before); // incremental, no full reload
  });

  it('#7 Block Time: 60-min block removes the opening immediately', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    mount(adapter);
    await ready();
    expect(screen.getByTestId('bsb-open-tech-002-750')).toHaveAttribute('data-duration', '90');
    fireEvent.click(within(screen.getByTestId('bsb-legend')).getByRole('button', { name: /Block time/ }));
    const panel = screen.getByTestId('bsb-block-time');
    fireEvent.change(within(panel).getByLabelText('Technician'), { target: { value: 'tech-002' } });
    fireEvent.change(within(panel).getByLabelText('Start time'), { target: { value: String(750) } });
    fireEvent.change(within(panel).getByLabelText('Duration'), { target: { value: '60' } });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Block time' })); });
    await waitFor(() => expect(screen.queryByTestId('bsb-block-time')).toBeNull());
    expect(screen.queryByTestId('bsb-open-tech-002-750')).toBeNull();
    expect(screen.getByTestId('bsb-open-tech-002-810')).toHaveAttribute('data-duration', '30');
    expect(adapter.snapshot().segments.some((s) => s.type === 'blocked' && s.technicianId === 'tech-002' && s.reason === 'Training')).toBe(true);
  });

  it('#4/#10 move: refused move rolls back the card and shows the domain error', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    mount(adapter);
    await ready();
    const range = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    const src = range.appointments.find((a) => a.technicianId === 'tech-002' && minuteOfDay(a.startAt, FIXTURE_DATE, FIXTURE_TZ) === 16 * 60)!;
    fireEvent.click(screen.getByTestId(`bsb-appt-${src.id}`));
    const panel = screen.getByTestId('bsb-appointment');
    // Destination tech-005 at 14:30 runs into a protected 15:00 appointment
    fireEvent.change(within(panel).getByLabelText('Technician'), { target: { value: 'tech-005' } });
    fireEvent.change(within(panel).getByLabelText('Start'), { target: { value: String(14 * 60 + 30) } });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Move' })); });
    expect(await within(screen.getByTestId('bsb-appointment')).findByRole('alert')).toHaveTextContent('This service would run into a protected appointment.');
    expect(screen.getByTestId('bsb-toast')).toHaveTextContent('protected appointment');
    // Original booking preserved, in its original column
    expect(within(screen.getByTestId('bsb-col-tech-002')).getByTestId(`bsb-appt-${src.id}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('bsb-col-tech-005')).queryByTestId(`bsb-appt-${src.id}`)).toBeNull();
    // Valid destination commits and both columns update
    fireEvent.change(within(screen.getByTestId('bsb-appointment')).getByLabelText('Start'), { target: { value: String(13 * 60 + 30) } });
    await act(async () => { fireEvent.click(within(screen.getByTestId('bsb-appointment')).getByRole('button', { name: 'Move' })); });
    await waitFor(() => expect(within(screen.getByTestId('bsb-col-tech-005')).getByTestId(`bsb-appt-${src.id}`)).toBeInTheDocument());
    expect(within(screen.getByTestId('bsb-col-tech-002')).queryByTestId(`bsb-appt-${src.id}`)).toBeNull();
    expect(screen.getByTestId('bsb-open-tech-002-900')).toHaveAttribute('data-duration', '300'); // 3:00 PM gap now merges with the evening: 3:00–8:00 PM
  });

  it('#3 a concurrent conflict surfaces APPOINTMENT_CONFLICT and refreshes the board', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    const racing: BookingDataAdapter = Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
      moveAppointment: async () => { throw new BookingDomainError('APPOINTMENT_CONFLICT'); },
    });
    mount(racing);
    await ready();
    const before = adapter.stats.scheduleRangeCalls;
    const range = await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE });
    const src = range.appointments.find((a) => a.technicianId === 'tech-002' && minuteOfDay(a.startAt, FIXTURE_DATE, FIXTURE_TZ) === 16 * 60)!;
    fireEvent.click(screen.getByTestId(`bsb-appt-${src.id}`));
    fireEvent.change(within(screen.getByTestId('bsb-appointment')).getByLabelText('Start'), { target: { value: String(15 * 60) } });
    await act(async () => { fireEvent.click(within(screen.getByTestId('bsb-appointment')).getByRole('button', { name: 'Move' })); });
    expect(await screen.findAllByText('That time was just booked. The schedule has been updated.')).not.toHaveLength(0);
    await waitFor(() => expect(adapter.stats.scheduleRangeCalls).toBeGreaterThan(before + 1)); // silent reload after conflict
  });

  it('#6 Best Matches never ranks an ineligible technician', async () => {
    mount(new MockBookingDataAdapter(buildFixture(), { now: NOW }));
    await ready();
    fireEvent.change(screen.getByLabelText('Service to book'), { target: { value: 'svc-acrylic' } });
    fireEvent.click(screen.getByRole('button', { name: /Best matches/ }));
    const list = await screen.findByTestId('bsb-matches');
    const names = within(list).getAllByTestId('bsb-match').map((b) => b.textContent ?? '');
    expect(names.length).toBeGreaterThan(0);
    expect(names.some((n) => n.includes('Celeste'))).toBe(false); // tech-003: gel only, not acrylic
    expect(names.some((n) => n.includes('Hana'))).toBe(false); // tech-008: time off
  });

  it('Find an Opening goes through the adapter and a pick emits context to the host', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    const spy = vi.spyOn(adapter, 'findOpenings');
    const onOpenNewBooking = vi.fn();
    mount(adapter, { onOpenNewBooking });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Find an opening/ }));
    const panel = screen.getByTestId('bsb-find-opening');
    fireEvent.change(within(panel).getByLabelText('Technician'), { target: { value: 'tech-002' } });
    const results = await within(panel).findAllByTestId('bsb-opening');
    expect(spy).toHaveBeenCalled();
    expect(results[0]).toHaveTextContent('10:45 AM');
    fireEvent.click(results[0]);
    expect(onOpenNewBooking).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 'tech-002', serviceId: 'svc-gel-mani', availableDurationMinutes: 45 }));
  });

  it('#11 returning from a booking workflow restores date, filters and page (spec §26)', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture({ technicianCount: 25 }), { now: NOW });
    let saved: PersistedBoardState | null = null;
    const first = mount(adapter, { onStateChange: (s) => { saved = s; } });
    await ready();
    fireEvent.click(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    fireEvent.change(screen.getByLabelText('Filter by service'), { target: { value: 'svc-pedicure' } });
    await waitFor(() => expect(saved).toMatchObject({ pageIndex: 1, serviceId: 'svc-pedicure', date: FIXTURE_DATE }));
    first.unmount();
    mount(adapter, { initialState: saved! });
    await screen.findByTestId('bsb-tech-tech-014');
    expect(screen.getByText('Technicians 13–24 of 24')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by service')).toHaveValue('svc-pedicure');
  });

  it('read-only permissions hide Block time and disable booking cells', async () => {
    mount(new MockBookingDataAdapter(buildFixture(), { now: NOW }), { permissions: READ_ONLY_PERMISSIONS });
    await ready();
    expect(within(screen.getByTestId('bsb-legend')).queryByRole('button', { name: /Block time/ })).toBeNull();
    expect(screen.getByTestId('bsb-cell-tech-002-645')).toBeDisabled();
  });

  it('contains no print controls (AIPowerSalon no-print rule)', async () => {
    mount(new MockBookingDataAdapter(buildFixture(), { now: NOW }));
    await ready();
    expect(screen.queryByRole('button', { name: /print/i })).toBeNull();
  });
});

describe('schedule store reconciliation', () => {
  it('a version gap triggers a silent resync instead of applying a possibly-stale event', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    const store = storeFromRange(await adapter.getScheduleRange({ ...scope, fromDate: FIXTURE_DATE, toDate: FIXTURE_DATE }));
    const env = { ...scope, date: FIXTURE_DATE, at: 'x', event: { type: 'blocked_time.removed' as const, segmentId: 'nope', technicianId: 'tech-001' } };
    expect(applyEvent(store, { ...env, serverVersion: store.serverVersion + 1 }).needsReload).toBe(false);
    expect(applyEvent(store, { ...env, serverVersion: store.serverVersion + 3 }).needsReload).toBe(true);
    expect(applyEvent(store, { ...env, serverVersion: store.serverVersion }).state).toBe(store); // duplicate ignored
    // Only the affected technician slice changes revision
    const after = applyEvent(store, { ...env, serverVersion: store.serverVersion + 1 }).state;
    expect(after.slices['tech-001'].revision).toBe(2);
    expect(after.slices['tech-002']).toBe(store.slices['tech-002']);
  });
});
