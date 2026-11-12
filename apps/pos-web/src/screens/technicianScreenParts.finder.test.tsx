// QualifiedFinder — extras "Live Technician Schedule" row 10 (Service Skill Explanation): the finder lists the qualified
// technicians with openings; "Why is a technician not listed?" runs the read-only conflict check for one technician with the
// picked services and shows the reasons — the missing service mapping by name (technician_services), shift, booked time.
// Nothing is saved or booked by the check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { cat, book, conf } = vi.hoisted(() => ({
  cat: { services: vi.fn() },
  book: { openings: vi.fn() },
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
import { QualifiedFinder } from './technicianScreenParts';

const TODAY = '2026-11-12';
beforeEach(() => {
  [cat.services, book.openings, conf.conflicts].forEach((f) => f.mockReset());
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
});
