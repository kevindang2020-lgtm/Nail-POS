import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
    createFaq: vi.fn(), act: vi.fn(), faq: vi.fn(), preview: vi.fn(), health: vi.fn(), assistant: vi.fn(),
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
  it('shows readiness from the canonical read model (raw vs eligible, exclusions), Unknown instead of a false zero, and the FAQ list', async () => {
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Do you take walk-ins?')).toBeInTheDocument());
    expect(screen.getByText('2 of 4 service(s) can be booked by the AI.')).toBeInTheDocument();
    expect(screen.getByTestId('ais-ready-technicians')).toHaveTextContent(/bs_3/);
    expect(screen.queryByText(/0 technicians/)).not.toBeInTheDocument();
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
