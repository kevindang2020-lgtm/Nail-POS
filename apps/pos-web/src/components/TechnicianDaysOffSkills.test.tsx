// TechnicianDaysOffSkills.test.tsx — Technician Profile & Team Management guide (Nov 5 2026, G3): the manager sets
// Monday + Tuesday off every week (preview first; a booking on a new off day must be acknowledged, never cancelled), and
// assigns several catalog skills at once; removing a skill shows what it takes away.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WeeklyDaysOffPanel, TechnicianSkillsPanel } from './TechnicianDaysOffSkills';

const TID = '11111111-2222-4333-8444-555555555555';
type Call = { url: string; method: string; body: any };
let calls: Call[]; let rule: any; let skills: any[];
const list = () => ({ technicianId: TID, today: '2026-11-05', month: '2026-11', current: rule, upcoming: [], rules: rule ? [rule] : [], history: [], version: rule?.version ?? 0, canEdit: true,
  calendar: [{ date: '2026-11-09', state: rule ? 'off_weekly_rule' : 'working', ruleId: null }] });
beforeEach(() => {
  calls = []; rule = null; skills = [];
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url); const method = String(init.method || 'GET').toUpperCase(); const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/weekly-days-off/preview')) return ok({ weekdays: body.weekdays, conflicts: [{ appointmentId: 'a1', date: '2026-11-16', startTime: '10:00', customer: 'Guest' }], keptWorkingDates: [],
      before: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, off: false, hours: '09:00–19:00' })), after: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, off: body.weekdays.includes(w), hours: '09:00–19:00' })) });
    if (u.includes('/weekly-days-off') && method === 'PUT') { rule = { id: 'r1', weekdays: body.weekdays, effectiveFrom: body.effectiveFrom, effectiveTo: null, version: 1, status: 'ACTIVE' }; return ok(list()); }
    if (u.includes('/weekly-days-off')) return ok(list());
    if (u.includes('/skills-catalog/assign')) { skills = body.skillIds.map((id: string) => ({ id: 'as-' + id, skillId: id, name: id === 'k1' ? 'Gel Extensions' : 'Nail Art', status: 'APPROVED', services: [{ id: 's1', name: 'Gel Fill' }], version: 1 }));
      return ok({ technicianId: TID, items: skills, eligibleServices: 1, canEdit: true, assigned: ['Gel Extensions', 'Nail Art'], already: [], servicesGranted: 1 }); }
    if (u.includes('/removal-impact/')) return ok({ servicesRemoved: [{ id: 's1', name: 'Gel Fill' }], futureBookings: [{ appointmentId: 'b1', date: '2026-11-16' }] });
    if (u.includes('/skills-catalog/technician/')) return ok({ technicianId: TID, items: skills, eligibleServices: skills.length, canEdit: true });
    if (u.includes('/skills-catalog')) return ok({ items: [{ id: 'k1', name: 'Gel Extensions', services: [{ id: 's1', name: 'Gel Fill' }] }, { id: 'k2', name: 'Nail Art', services: [] }], page: 1, totalPages: 1, totalItems: 2, canEdit: true });
    return ok({});
  }) as any;
});

describe('Weekly days off', () => {
  it('Monday + Tuesday every week: preview first, a booking must be acknowledged, then Save sends the weekdays once', async () => {
    render(<MemoryRouter><WeeklyDaysOffPanel technicianId={TID} canEdit /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('wo-open'));
    fireEvent.click(screen.getByTestId('wo-day-1')); fireEvent.click(screen.getByTestId('wo-day-2'));
    expect((screen.getByTestId('wo-save') as HTMLButtonElement).disabled).toBe(true);   // no save before the preview
    fireEvent.click(screen.getByTestId('wo-preview-btn'));
    expect(await screen.findByTestId('wo-conflicts')).toHaveTextContent('1');
    expect((screen.getByTestId('wo-save') as HTMLButtonElement).disabled).toBe(true);   // the booking must be acknowledged
    fireEvent.click(screen.getByTestId('wo-ack'));
    fireEvent.click(screen.getByTestId('wo-save'));
    await screen.findByTestId('wo-current');
    const put = calls.filter((c) => c.method === 'PUT');
    expect(put).toHaveLength(1); expect(put[0].body).toMatchObject({ technicianId: TID, weekdays: [1, 2], effectiveFrom: '2026-11-05', acknowledgeConflicts: true, expectedVersion: 0 });
  });
  it('without schedule permission there is no edit button', async () => {
    render(<MemoryRouter><WeeklyDaysOffPanel technicianId={TID} canEdit={false} /></MemoryRouter>);
    await screen.findByTestId('wo-calendar');
    expect(screen.queryByTestId('wo-open')).toBeNull();
  });
});

describe('Skills', () => {
  it('assign several catalog skills at once; removing one shows the services and bookings it affects and needs a reason', async () => {
    render(<TechnicianSkillsPanel technicianId={TID} canEdit />);
    fireEvent.click(await screen.findByTestId('sk-assign-open'));
    fireEvent.click(await screen.findByTestId('sk-pick-k1')); fireEvent.click(screen.getByTestId('sk-pick-k2'));
    fireEvent.click(screen.getByTestId('sk-assign-save'));
    expect(await screen.findByTestId('sk-note')).toHaveTextContent('Gel Extensions');
    expect(calls.find((c) => c.url.includes('/assign'))!.body).toMatchObject({ technicianId: TID, skillIds: ['k1', 'k2'] });
    fireEvent.click(screen.getByTestId('sk-remove-as-k1'));
    await screen.findByTestId('sk-remove');
    const confirm = screen.getByTestId('sk-remove-confirm') as HTMLButtonElement;
    fireEvent.change(screen.getByTestId('sk-reason'), { target: { value: 'Retraining' } });
    expect(confirm.disabled).toBe(true);   // the future booking must be acknowledged
    fireEvent.click(screen.getByTestId('sk-ack'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.url.includes('/revoke') && c.method === 'POST')!.body).toMatchObject({ assignmentId: 'as-k1', reason: 'Retraining', acknowledgeBookings: true }));
  });
});
