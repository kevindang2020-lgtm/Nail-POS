import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarDensity } from './aiCalendar/density';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const faqsOverride: { fn: null | ((q: any) => Promise<any>) } = { fn: null };
const historyCalls: any[] = [];
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
    faqs: (q: any) => (faqsOverride.fn ? faqsOverride.fn(q) : Promise.resolve({ items: [{ id: 'faq1', question: 'Do you take walk-ins?', answer: 'Yes when available.', category: 'General', status: 'approved', aiServable: true, hasPendingChange: false, createdAt: '2026-10-30T12:00:00Z', approvedAt: '2026-10-30T13:00:00Z' }],
      page: 1, pageSize: 20, totalItems: 1, totalPages: 1, categories: ['General'] })),
    search: () => Promise.resolve({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }),
    history: (q: any) => { historyCalls.push(q); return Promise.resolve(q?.basis === 'readiness'
      ? { basis: 'readiness', items: [{ id: 'r3:business_hours', kind: 'readiness', title: 'business_hours', detail: 'READY → FAILED', at: '2026-11-10T15:00:00Z',
          readiness: { key: 'business_hours', from: 'READY', to: 'FAILED', source: 'Settings → Store hours (this branch)', reason: 'monday is invalid', actor: 'Olivia Owner', runId: 'r3', previousRunId: 'r2' } }], page: 1, pageSize: 20, totalItems: 1, totalPages: 1 }
      : { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1 }); },
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
  pendingHolds: () => Promise.resolve({ asOf: '2026-07-04T15:00:00Z', timeZone: 'America/New_York', pendingCode: 1, expiringSoon: 1, items: [
    { id: 'h1', technicianId: 't1', technicianName: 'Bella', date: '2026-07-04', start: '12:00', end: '13:00', expiresAt: '2026-07-04T15:04:00Z', minutesLeft: 4, channel: 'online', pendingCode: true, expiringSoon: true },
    { id: 'h2', technicianId: 't1', technicianName: 'Bella', date: '2026-07-05', start: '09:00', end: '10:00', expiresAt: '2026-07-04T15:40:00Z', minutesLeft: 40, channel: null, pendingCode: false, expiringSoon: false }] }),
  provenance: () => Promise.resolve({ asOf: '2026-07-04T15:00:00Z', timeZone: 'America/New_York', windowDays: 30, readOnly: true,
    counts: { toolFailed: 1, verificationIncomplete: 1, sourceUnlinked: 1, sourceMismatch: 0, total: 3 },
    items: [
      { kind: 'verification_incomplete', at: '2026-07-04T14:00:00Z', appointmentId: null, refs: [{ table: 'booking_holds', id: 'aaaaaaaa-1111-4000-8000-000000000001' }, { table: 'booking_verification_sessions', id: 'bbbbbbbb-2222-4000-8000-000000000002' }],
        detail: { tool: 'hold_slot', result: null, call: '…9876', holdStatus: 'released', releaseReason: null, verification: 'expired', source: null, appointmentStatus: null } },
      { kind: 'tool_failed', at: '2026-07-04T13:00:00Z', appointmentId: null, refs: [{ table: 'voice_tool_executions', id: 'cccccccc-3333-4000-8000-000000000003' }],
        detail: { tool: 'book_appointment', result: 'slot_taken', call: '…1234', holdStatus: null, releaseReason: null, verification: null, source: null, appointmentStatus: null } },
      { kind: 'source_unlinked', at: '2026-07-04T12:00:00Z', appointmentId: 'bk1', refs: [{ table: 'pos_tech_appointments', id: 'dddddddd-4444-4000-8000-000000000004' }],
        detail: { tool: null, result: null, call: null, holdStatus: null, releaseReason: null, verification: null, source: 'ai', appointmentStatus: 'booked' } }] }),
} }));

import { POSAIBusinessSetupScreen, setupListState } from './POSAIBusinessSetupScreen';
import { POSAICalendarScreen } from './POSAICalendarScreen';
import { posAiCalendarApi } from '../api/posAiCalendarApi';

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
  it('Pending verification lists live holds soonest to expire first, with waiting-for-code and minutes left', async () => {
    render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('aic-pending-btn'));
    const rows = await screen.findAllByTestId('aic-pq-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/12:00–13:00/); expect(rows[0].textContent).toMatch(/Expiring soon/);
    expect(screen.getAllByTestId('aic-pq-left').map((x) => x.textContent)).toEqual([expect.stringMatching(/^4 min/), expect.stringMatching(/^40 min/)]);
    expect(screen.getByTestId('aic-pending').textContent).toMatch(/1 waiting for a code/);
  });
  it('extras AI Calendar 10: AI booking exceptions — counts per kind, words for every code, the stored record ids, an appointment opens the overlay; read only', async () => {
    render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('aic-provenance-btn'));
    const rows = await screen.findAllByTestId('aic-pv-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId('aic-pv-count-tool_failed')).toHaveTextContent('AI booking call failed · 1');
    expect(screen.getByTestId('aic-pv-count-source_mismatch')).toHaveTextContent('AI booking not labelled AI · 0');
    const det = screen.getAllByTestId('aic-pv-detail').map((x) => x.textContent);
    expect(det[0]).toBe('Action: Hold a time · Call …9876 · Hold: released · Code: expired');
    expect(det[1]).toBe('Action: Book appointment · Result: time already taken · Call …1234');
    expect(det[2]).toMatch(/^Source: AI · Status: /);
    expect(screen.getAllByTestId('aic-pv-refs')[0]).toHaveTextContent('Hold aaaaaaaa · Code check bbbbbbbb');
    expect(rows[0].querySelector('button')).toBeNull();   // nothing to retry or release here
    fireEvent.click(screen.getByTestId('aic-pv-open'));
    expect(screen.queryByTestId('aic-provenance')).toBeNull();
  });
});

describe('AI Calendar extras #05 — Conflict Explanation drawer', () => {
  it('explains a booked time from the day view on screen, and an open time reads as open (nothing is booked)', async () => {
    render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('aic-why-btn'));
    fireEvent.change(screen.getByTestId('aic-why-start'), { target: { value: '10:15' } });
    const reasons = screen.getAllByTestId('aic-why-reason');
    expect(reasons.map((r) => r.getAttribute('data-code'))).toEqual(['APPOINTMENT']);
    expect(reasons[0].textContent).toMatch(/Already booked 10:00–10:30/);
    fireEvent.change(screen.getByTestId('aic-why-start'), { target: { value: '18:45' } });
    expect(screen.getAllByTestId('aic-why-reason').map((r) => r.getAttribute('data-code'))).toEqual(['OUTSIDE_HOURS', 'OUTSIDE_SHIFT']);
    expect(screen.getAllByTestId('aic-why-reason')[0].textContent).toMatch(/Outside salon hours \(09:00–19:00\)/);
    fireEvent.change(screen.getByTestId('aic-why-start'), { target: { value: '11:00' } });
    expect(screen.getByTestId('aic-why-free').textContent).toMatch(/11:00–11:45 is open/);
    expect(document.body.textContent).not.toMatch(/aical\.why\./);
  });
});

describe('AI Calendar extras #02 — Verified Appointment Timeline tab', () => {
  it('lists the stored steps in order with their row ids; a recorded status outside the known words still reads', async () => {
    const base = { overview: { id: 'bk1', date: '2026-07-04', start: '10:00', end: '10:30', status: 'completed', source: 'online', aiCreated: false, aiEvidence: 'x', verification: 'verified', timeZone: 'America/New_York', createdAt: null, updatedAt: null },
      customer: { name: 'Ann', phone: '•••0142', email: null, phoneVerified: true, contactMasked: true }, services: [], technician: null, bookingHistory: [], unreadable: [], aiActivity: { toolResults: [], copilotActions: [] },
      verificationAndHolds: [], communications: { reminders: [], messages: [] }, auditTrail: [], links: { openBooking: '/booking', customer: null, technicianSchedule: null } };
    const api = posAiCalendarApi as unknown as { detail: (id: string) => Promise<unknown> };
    const orig = api.detail;
    api.detail = () => Promise.resolve({ ...base, timeline: [
      { step: 'held', at: '2026-07-01T15:00:00Z', ref: { table: 'booking_holds', id: 'aaaaaaaa-1111-4000-8000-000000000001' }, detail: 'online' },
      { step: 'otp_sent', at: '2026-07-01T15:01:00Z', ref: { table: 'booking_verification_sessions', id: 'bbbbbbbb-1111-4000-8000-000000000002' }, detail: 'online' },
      { step: 'otp_verified', at: '2026-07-01T15:03:00Z', ref: { table: 'booking_verification_sessions', id: 'bbbbbbbb-1111-4000-8000-000000000002' }, detail: null },
      { step: 'booked', at: '2026-07-01T15:05:00Z', ref: { table: 'pos_tech_appointments', id: 'cccccccc-1111-4000-8000-000000000003' }, detail: 'online' },
      { step: 'status:checked_in', at: '2026-07-04T13:55:00Z', ref: { table: 'appointment_change_log', id: 'dddddddd-1111-4000-8000-000000000004' }, detail: 'from booked' },
      { step: 'status:started', at: '2026-07-04T14:00:00Z', ref: { table: 'appointment_change_log', id: 'eeeeeeee-1111-4000-8000-000000000005' }, detail: null }] });
    try {
      render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
      fireEvent.click(await screen.findByText('Ann'));
      fireEvent.click(await screen.findByTestId('aic-tab-timeline'));
      const items = (await screen.findByTestId('aic-timeline')).querySelectorAll('li');
      expect([...items].map((li) => li.getAttribute('data-step'))).toEqual(['held', 'otp_sent', 'otp_verified', 'booked', 'status:checked_in', 'status:started']);
      expect(items[0]!.textContent).toMatch(/Slot held/); expect(items[0]!.textContent).toMatch(/hold aaaaaaaa/);
      expect(items[2]!.textContent).toMatch(/Code verified/); expect(items[4]!.textContent).toMatch(/Status → Checked in/);
      expect(items[5]!.textContent).not.toMatch(/aical\.|undefined/);
      expect(items[3]!.querySelector('code')!.getAttribute('title')).toBe('cccccccc-1111-4000-8000-000000000003');
    } finally { api.detail = orig; }
  });
});

describe('AI Business Setup — Readiness Change History (extras #11)', () => {
  it('History → Readiness changes asks the server for status changes and shows part, from → to, reason, who ran the check and the source; a change row opens no FAQ', async () => {
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('ais-scope-history'));
    await screen.findByDisplayValue('FAQ changes');
    const basis = screen.getAllByRole('combobox').find((x) => (x as HTMLSelectElement).value === 'faq_change') as HTMLSelectElement;
    fireEvent.change(basis, { target: { value: 'readiness' } });
    await waitFor(() => expect(historyCalls[historyCalls.length - 1]).toMatchObject({ basis: 'readiness' }));
    const row = await screen.findByTestId('ais-readiness-change');
    expect(row).toHaveTextContent('Business hours');
    expect(row).toHaveTextContent('Ready');
    expect(row).toHaveTextContent('Failed');
    expect(row).toHaveTextContent('monday is invalid');
    expect(row).toHaveTextContent('check run by Olivia Owner');
    expect(row).toHaveTextContent('source: Settings → Store hours (this branch)');
    fireEvent.click(row);
    expect(screen.queryByTestId('ais-overlay')).toBeNull();
  });
});

describe('AI Business Setup — empty / error separation (extras #10)', () => {
  const emptyPage = { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 1, categories: [] };
  it('true empty and filtered no-match read differently', async () => {
    faqsOverride.fn = () => Promise.resolve(emptyPage);
    render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    expect(await screen.findByTestId('ais-list-state')).toHaveAttribute('data-kind', 'empty');
    expect(screen.getByTestId('ais-list-state')).toHaveTextContent('No FAQs yet');
    fireEvent.change(screen.getByTestId('ais-search'), { target: { value: 'parking' } });
    await waitFor(() => expect(screen.getByTestId('ais-list-state')).toHaveAttribute('data-kind', 'noMatch'), { timeout: 2000 });
    faqsOverride.fn = null;
  });
  it('unauthorized and API failure are their own states; a failed refresh of the same query keeps the rows marked stale', async () => {
    faqsOverride.fn = () => Promise.reject({ status: 403 });
    const a = render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    expect(await screen.findByTestId('ais-list-state')).toHaveAttribute('data-kind', 'forbidden');
    a.unmount();
    faqsOverride.fn = () => Promise.reject(new Error('Failed to fetch'));
    const b = render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
    expect(await screen.findByTestId('ais-list-state')).toHaveAttribute('data-kind', 'error');
    expect(screen.queryByTestId('ais-faq-row')).toBeNull();
    b.unmount();
    faqsOverride.fn = null;
  });
  it('the state function: a failed refresh of the query already shown is stale (rows kept), of another query is an error', () => {
    const list = { items: [{ id: 'x' }] };
    expect(setupListState({ err: 'down', forbidden: false, list, sameQuery: true, filtered: false })).toBe('stale');
    expect(setupListState({ err: 'down', forbidden: false, list, sameQuery: false, filtered: false })).toBe('error');
    expect(setupListState({ err: 'no', forbidden: true, list, sameQuery: true, filtered: false })).toBe('forbidden');
    expect(setupListState({ err: null, forbidden: false, list: { items: [] }, sameQuery: true, filtered: true })).toBe('noMatch');
    expect(setupListState({ err: null, forbidden: false, list: null, sameQuery: false, filtered: false })).toBe('loading');
  });
});

describe('AI Calendar extras #08 — automatic responsive density (spacing only, never smaller fonts)', () => {
  it('the rule: compact below 1280px of container, back to spacious only past the hysteresis band; an unmeasured box keeps its density', () => {
    expect(calendarDensity(1920)).toBe('spacious');
    expect(calendarDensity(1100)).toBe('compact');
    expect(calendarDensity(1290, 'compact')).toBe('compact');          // inside the 24px band: no flapping
    expect(calendarDensity(1310, 'compact')).toBe('spacious');
    expect(calendarDensity(0, 'compact')).toBe('compact');
  });
  it('the screen switches data-density from its own container width and keeps every control; compact CSS never touches font sizes', async () => {
    let fire: ((w: number) => void) | null = null;
    const Orig = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    class RO { constructor(cb: (e: { contentRect: { width: number } }[]) => void) { fire = (w) => cb([{ contentRect: { width: w } }]); } observe() {} disconnect() {} }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
    try {
      render(<MemoryRouter><POSAICalendarScreen /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText('Ann')).toBeInTheDocument());
      const root = screen.getByTestId('aic');
      const controls = () => ['aic-open-booking', 'aic-health-btn', 'aic-pending-btn', 'aic-refresh', 'aic-prev', 'aic-today', 'aic-next', 'aic-date', 'aic-view-day', 'aic-view-week', 'aic-view-month', 'aic-view-list', 'aic-assist-btn', 'aic-kpi-appointments', 'aic-kpi-ai', 'aic-kpi-slots', 'aic-kpi-techs'].filter((id) => screen.queryByTestId(id)).length;
      expect(controls()).toBe(17);
      act(() => fire!(1000));
      expect(root).toHaveAttribute('data-density', 'compact');
      expect(controls()).toBe(17);
      act(() => fire!(1290));
      expect(root).toHaveAttribute('data-density', 'compact');
      act(() => fire!(1600));
      expect(root).toHaveAttribute('data-density', 'spacious');
    } finally { (globalThis as { ResizeObserver?: unknown }).ResizeObserver = Orig; }
    const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
    const compact = css.split('\n').filter((l) => l.includes('[data-density="compact"]'));
    expect(compact.length).toBeGreaterThanOrEqual(8);
    expect(compact.filter((l) => /font(-size)?\s*:/.test(l))).toEqual([]);
    expect(compact.filter((l) => /min-height:\s*(\d+)px/.test(l) && Number(/min-height:\s*(\d+)px/.exec(l)![1]) < 44)).toEqual([]);
  });
});

describe('AI Business Setup — long lists (extras #09)', () => {
  it('the pager states the range and page of the total, pages and page size refetch from the server, and the tabs + pager stay on screen', async () => {
    const calls: any[] = [];
    const row = (n: number) => ({ id: `f${n}`, question: `Question ${n}`, answer: 'A', category: 'General', status: 'approved', aiServable: true, hasPendingChange: false, createdAt: '2026-10-30T12:00:00Z', approvedAt: null });
    faqsOverride.fn = (q: any) => { calls.push(q); const size = q.pageSize ?? 20, page = q.page ?? 1;
      const items = Array.from({ length: Math.max(0, Math.min(size, 45 - (page - 1) * size)) }, (_, i) => row((page - 1) * size + i + 1));
      return Promise.resolve({ items, page, pageSize: size, totalItems: 45, totalPages: Math.ceil(45 / size), categories: ['General'] }); };
    try {
      render(<MemoryRouter><POSAIBusinessSetupScreen /></MemoryRouter>);
      const list = await screen.findByTestId('ais-list');
      expect(list).toHaveClass('ais-list');
      await waitFor(() => expect(list.querySelector('.fk-pager-range')).toHaveTextContent('Showing 1–20 of 45 · Page 1 of 3'));
      expect(screen.getAllByTestId('ais-faq-row')).toHaveLength(20);
      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      await waitFor(() => expect(list.querySelector('.fk-pager-range')).toHaveTextContent('Showing 21–40 of 45 · Page 2 of 3'));
      expect(calls.at(-1)).toMatchObject({ page: 2, pageSize: 20 });
      expect(screen.getByText('Question 21')).toBeInTheDocument();
      fireEvent.change(screen.getByTestId('ais-size'), { target: { value: '50' } });
      await waitFor(() => expect(list.querySelector('.fk-pager-range')).toHaveTextContent('Showing 1–45 of 45 · Page 1 of 1'));
      expect(calls.at(-1)).toMatchObject({ page: 1, pageSize: 50 });
      // the scope tabs and the pager are the list's own sticky header / footer (direct children the CSS pins)
      expect(list.querySelector(':scope > .ais-tabs')).not.toBeNull();
      expect(list.querySelector(':scope > .ais-pager')).not.toBeNull();
      const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
      expect(css).toMatch(/\.ais-list > \.ais-tabs \{[^}]*position: sticky; top: 0/);
      expect(css).toMatch(/\.ais-list > \.ais-pager \{[^}]*position: sticky; bottom: 0/);
    } finally { faqsOverride.fn = null; }
  });
});
