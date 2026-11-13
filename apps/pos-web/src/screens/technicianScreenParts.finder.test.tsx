// QualifiedFinder — extras "Live Technician Schedule" row 10 (Service Skill Explanation): the finder lists the qualified
// technicians with openings; "Why is a technician not listed?" runs the read-only conflict check for one technician with the
// picked services and shows the reasons — the missing service mapping by name (technician_services), shift, booked time.
// Nothing is saved or booked by the check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { cat, book, conf } = vi.hoisted(() => ({
  cat: { services: vi.fn() },
  book: { openings: vi.fn(), availability: vi.fn() },
  conf: { conflicts: vi.fn() },
}));
vi.mock('../api/posCatalogApi', () => ({ posCatalogApi: cat }));
vi.mock('../api/posBookingApi', () => ({ posBookingApi: book }));
vi.mock('../api/posTeamScreensApi', () => ({ posTechAppointmentsScreenApi: conf, posTechniciansScreenApi: { directory: vi.fn(), mapping: vi.fn() } }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { setServices: vi.fn() } }));
vi.mock('../api/posLiveTechnicianScheduleApi', () => ({ posLiveTechnicianScheduleApi: {} }));
vi.mock('../components/TechnicianPickerButton', () => ({
  TechnicianPickerButton: ({ onChange }: { onChange: (id: string) => void }) => <button type="button" onClick={() => onChange('t2')}>pick-t2</button>,
}));
import { QualifiedFinder, syncStarts } from './technicianScreenParts';

const TODAY = '2026-11-12';
beforeEach(() => {
  [cat.services, book.openings, book.availability, conf.conflicts].forEach((f) => f.mockReset());
  cat.services.mockResolvedValue({ items: [{ serviceId: 's-gel', name: 'Gel Manicure', durationMinutes: 45 }, { serviceId: 's-acr', name: 'Acrylic Full Set', durationMinutes: 75 }] });
  book.openings.mockResolvedValue({ date: TODAY, serviceIds: ['s-acr'], durationMinutes: 75, eligibleCount: 1, withOpenings: 1, openings: [{ technicianId: 't1', name: 'Linh', rosterNumber: 1, time: '13:30', openSlots: 3, rank: 1 }], hasMore: false, offset: 0, limit: 10 });
  conf.conflicts.mockResolvedValue({ technicianId: 't2', technician: 'Mai', date: TODAY, start: '13:30', end: '14:45', minutes: 75, ok: false,
    reasons: [{ kind: 'not_qualified', detail: 'Acrylic Full Set' }, { kind: 'overlap', from: '13:00', to: '14:00', appointmentId: 'a9', detail: null }] });
});

describe('QualifiedFinder — why a technician is not listed (read-only)', () => {
  it('checks one technician with the picked services, the full duration and the earliest opening; shows the missing mapping by service name', async () => {
    render(<MemoryRouter><QualifiedFinder today={TODAY} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('finder-pick'))[1]);   // Acrylic Full Set
    await screen.findByTestId('finder-table');
    expect(screen.queryByTestId('finder-why')).toBeNull();
    fireEvent.click(screen.getByTestId('finder-why-toggle'));
    expect(screen.getByTestId('finder-why')).toBeInTheDocument();
    expect(conf.conflicts).not.toHaveBeenCalled();                        // nothing runs until a technician is chosen and checked
    fireEvent.click(screen.getByText('pick-t2'));
    fireEvent.click(screen.getByTestId('cf-check'));
    await waitFor(() => expect(conf.conflicts).toHaveBeenCalledTimes(1));
    expect(conf.conflicts).toHaveBeenCalledWith(expect.objectContaining({ technicianId: 't2', date: TODAY, start: '13:30', minutes: 75, serviceIds: 's-acr' }));
    expect(await screen.findByTestId('cf-reason-not_qualified')).toHaveTextContent('Not mapped for: Acrylic Full Set');
    expect(screen.getByTestId('cf-reason-overlap')).toBeInTheDocument();
    // the finder's own list is untouched
    expect(screen.getAllByTestId('finder-row')).toHaveLength(1);
  });
  it('extras TEAM MANAGEMENT 05 (round 10): a Bookable-at column from the server\'s branch per opening (salon-wide in words); an older server shows no column', async () => {
    book.openings.mockResolvedValue({ date: TODAY, serviceIds: ['s-acr'], durationMinutes: 75, eligibleCount: 2, withOpenings: 2, hasMore: false, offset: 0, limit: 10, openings: [
      { technicianId: 't1', name: 'Linh', rosterNumber: 1, time: '13:30', openSlots: 3, rank: 1, branch: { branchId: 'b1', name: 'Cherry Hill' } },
      { technicianId: 't3', name: 'Vy', rosterNumber: 2, time: '14:00', openSlots: 1, rank: 2, branch: { branchId: null, name: null } }] });
    const v = render(<MemoryRouter><QualifiedFinder today={TODAY} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('finder-pick'))[1]);
    const cells = await screen.findAllByTestId('finder-branch');
    expect(cells.map((c) => c.textContent)).toEqual(['Cherry Hill', 'Any location (salon-wide)']);
    v.unmount();
    book.openings.mockResolvedValue({ date: TODAY, serviceIds: ['s-acr'], durationMinutes: 75, eligibleCount: 1, withOpenings: 1, openings: [{ technicianId: 't1', name: 'Linh', rosterNumber: 1, time: '13:30', openSlots: 3, rank: 1 }], hasMore: false, offset: 0, limit: 10 });
    render(<MemoryRouter><QualifiedFinder today={TODAY} onClose={() => {}} /></MemoryRouter>);
    fireEvent.click((await screen.findAllByTestId('finder-pick'))[1]);
    await screen.findByTestId('finder-table');
    expect(screen.queryByTestId('finder-branch')).toBeNull();
  });
});

describe('round 10 (LIVE TECHNICIAN SCHEDULE 05) — several specialists at once', () => {
  it('syncStarts: a shared start needs a DIFFERENT free technician for every service (no double use of one person)', () => {
    const gel = [{ technicianId: 't1', name: 'Linh', slots: ['10:00', '11:00'] }, { technicianId: 't2', name: 'Mai', slots: ['11:00'] }];
    const ped = [{ technicianId: 't1', name: 'Linh', slots: ['10:00', '11:00'] }];
    expect(syncStarts([gel, ped])).toEqual([{ time: '11:00', techs: [{ technicianId: 't2', name: 'Mai' }, { technicianId: 't1', name: 'Linh' }] }]);   // 10:00 only Linh is free for both → not a shared start
    expect(syncStarts([gel, []])).toEqual([]);
  });
  it('with two services picked, asks the engine for each service and lists the shared start times with a technician per service', async () => {
    book.availability.mockImplementation(async (q: { serviceIds: string[] }) => q.serviceIds[0] === 's-gel'
      ? [{ technicianId: 't1', name: 'Linh', slots: ['13:00', '14:00'] }, { technicianId: 't2', name: 'Mai', slots: ['14:00'] }]
      : [{ technicianId: 't1', name: 'Linh', slots: ['14:00'] }]);
    render(<MemoryRouter><QualifiedFinder today={TODAY} onClose={() => {}} /></MemoryRouter>);
    const picks = await screen.findAllByTestId('finder-pick');
    fireEvent.click(picks[0]); fireEvent.click(picks[1]);
    const rows = await screen.findAllByTestId('finder-sync-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('2:00 PM'); expect(rows[0]).toHaveTextContent('Mai'); expect(rows[0]).toHaveTextContent('Linh');
    expect(book.availability).toHaveBeenCalledWith({ date: TODAY, serviceIds: ['s-gel'] });
    expect(book.availability).toHaveBeenCalledWith({ date: TODAY, serviceIds: ['s-acr'] });
  });
});

