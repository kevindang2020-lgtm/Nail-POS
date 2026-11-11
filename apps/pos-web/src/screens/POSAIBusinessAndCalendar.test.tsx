import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const addClosure = vi.fn((_b: any) => Promise.resolve({ id: 'c2' }));
const closureItems: any[] = [{ id: 'c1', date: '2026-11-26', scope: 'salon', closed: true, opensAt: null, closesAt: null, note: 'Thanksgiving', createdAt: null }];
const setTags = vi.fn((_id: string, tags: string[]) => Promise.resolve({ id: 'faq1', tags }));
vi.mock('../api/posAiBusinessSetupApi', () => ({
  posAiBusinessSetupApi: {
    readiness: () => Promise.resolve({ branchScope: 'branch', checkedAt: '2026-10-31T12:00:00Z',
      core: [
        { key: 'business_hours', status: 'READY', source: 'Settings → Store hours (this branch)', rawCount: 7, eligibleCount: 6, exclusions: [], warnings: [], detail: 'Open 6 day(s) a week.', action: { label: 'Edit', route: '/settings' }, checkedAt: '', traceId: 'bs_1' },
        { key: 'services', status: 'READY', source: 'Services & Products (services)', rawCount: 4, eligibleCount: 2, exclusions: [{ reason: 'other_branch', count: 1 }], warnings: [], detail: '2 of 4 service(s) can be booked by the AI.', action: { label: 'Open', route: '/services' }, checkedAt: '', traceId: 'bs_2' },
        { key: 'technicians', status: 'UNKNOWN', source: 'Team Management', rawCount: null, eligibleCount: null, exclusions: [], warnings: [], detail: '', action: null, checkedAt: '', traceId: 'bs_3' },
      ], supplemental: [] }),
    faqs: () => Promise.resolve({ items: [{ id: 'faq1', question: 'Do you take walk-ins?', answer: 'Yes when available.', category: 'General', status: 'approved', aiServable: true, hasPendingChange: false, createdAt: '2026-10-30T12:00:00Z', approvedAt: '2026-10-30T13:00:00Z' }],
      page: 1, pageSize: 20, totalItems: 1, totalPages: 1, categories: ['General'] }),
    search: () => Promise.resolve({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }),
    history: () => Promise.resolve({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }),
    createFaq: vi.fn(), act: vi.fn(), preview: vi.fn(), health: vi.fn(), assistant: vi.fn(),
    faq: () => Promise.resolve({ id: 'faq1', question: 'Do you take walk-ins?', answer: 'Yes when available.', category: 'General', tags: ['policy'], status: 'approved', aiServable: true, hasPendingChange: false, version: 3, createdAt: '2026-10-01T12:00:00Z', revisions: [], events: [], previewUses: 0 }),
    closures: () => Promise.resolve({ timezone: 'America/New_York', items: closureItems }), addClosure: (b: any) => addClosure(b), removeClosure: vi.fn(), setTags: (id: string, t: string[]) => setTags(id, t),
    healthRun: vi.fn(), healthLast: () => Promise.resolve(null),
  },
}));
// AI Calendar guide: the screen reads the calendar center (canonical Booking rows); realtime is mocked
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
vi.mock('../api/posAiCalendarApi', () => ({ posAiCalendarApi: {
  summary: () => Promise.resolve({ date: '2026-07-04', today: '2026-07-04', timeZone: 'America/New_York', branchScope: 'branch', appointments: 1, aiCreated: 1, aiLinkedToCall: 1, cancelled: 0, noShow: 0, pendingVerification: 0,
    openSlots: { value: 30, engineValue: 38, serviceMinutes: 45, reconciliation: ['POS Booking engine total: 38'], definition: 'Bookable start times' },
    technicians: { value: 1, activeRoster: 2, clockedIn: null, freeNow: null }, definitions: { appointments: 'a', aiCreated: 'b', openSlots: 'c', technicians: 'd' } }),
  day: () => Promise.resolve({ date: '2026-07-04', hours: { open: '09:00', close: '19:00' }, techPaging: { page: 1, pageSize: 12, total: 1, totalPages: 1, label: '1–1 of 1' },
    technicians: [{ id: 't1', name: 'Bella', workingToday: true, windows: [{ start: '09:00', end: '19:00' }] }],
    appointments: [{ id: 'bk1', technicianId: 't1', customerName: 'Ann', start: '10:00', end: '10:30', status: 'booked', source: 'ai', aiCreated: true, services: ['Gel Manicure'] }], holds: [] }),
  range: () => Promise.resolve({ days: [], totals: { appointments: 0, aiCreated: 0 } }), list: () => Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
  detail: () => Promise.resolve(null), health: () => Promise.resolve(null), assistant: () => Promise.resolve({ cards: [] }),
} }));

import { POSAIBusinessSetupScreen } from './POSAIBusinessSetupScreen';
import { POSAICalendarScreen } from './POSAICalendarScreen';

describe('POSAIBusinessSetupScreen', () => {
  it('FAQ Duplicate Warning: a new question that asks the same thing shows the existing one; Add stays enabled', async () => {
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Do you take walk-ins?')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('ais-q'), { target: { value: 'Do you accept walk-ins?' } });
    expect(await screen.findByTestId('ais-faq-dup', {}, { timeout: 2000 })).toHaveTextContent('Do you take walk-ins?');
    expect(screen.getByTestId('ais-add')).not.toBeDisabled();
  });
  it('shows readiness from the canonical read model (raw vs eligible, exclusions), Unknown instead of a false zero, and the FAQ list', async () => {
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Do you take walk-ins?')).toBeInTheDocument());
    expect(screen.getByText('2 of 4 service(s) can be booked by the AI.')).toBeInTheDocument();
    expect(screen.getByTestId('ais-ready-technicians')).toHaveTextContent(/bs_3/);
    expect(screen.queryByText(/0 technicians/)).not.toBeInTheDocument();
  });
  it('A12 Nov 6: holiday closures are listed and a special-hours day is added; FAQ tags are edited from the overlay', async () => {
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    expect(await screen.findByTestId('ais-closure-row')).toHaveTextContent('Thanksgiving');
    fireEvent.change(screen.getByTestId('ais-closure-date'), { target: { value: '2026-12-24' } });
    fireEvent.change(screen.getByTestId('ais-closure-kind'), { target: { value: 'special' } });
    fireEvent.click(screen.getByTestId('ais-closure-add'));
    await waitFor(() => expect(addClosure).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-12-24', closed: false, opensAt: '10:00', closesAt: '15:00', scope: 'salon' })));
    fireEvent.click(screen.getByText('Do you take walk-ins?'));
    fireEvent.click(await screen.findByTestId('ais-tags-edit'));
    fireEvent.change(screen.getByTestId('ais-tags-input'), { target: { value: 'policy, walk-in' } });
    fireEvent.click(screen.getByTestId('ais-tags-save'));
    await waitFor(() => expect(setTags).toHaveBeenCalledWith('faq1', ['policy', 'walk-in']));
  });
});

describe('POSAICalendarScreen', () => {
  it('reads canonical Booking through the calendar center, marks AI-created appointments and shows real characters (no \\u escapes)', async () => {
    render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Ann')).toBeInTheDocument());
    expect(screen.getByText(/Gel Manicure/)).toBeInTheDocument();
    expect(screen.getByText('10:00–10:30')).toBeInTheDocument();            // a real en dash, not the literal text "\u2013"
    expect(screen.getAllByText('AI').length).toBeGreaterThan(0);            // canonical source "ai" badge
    expect(screen.getByTestId('aic-kpi-slots')).toHaveTextContent('30');    // hold- and past-aware, with the engine total in the hint
    expect(screen.getByText('Open in POS Booking')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\\u20[0-9a-f]{2}/);
  });
});
