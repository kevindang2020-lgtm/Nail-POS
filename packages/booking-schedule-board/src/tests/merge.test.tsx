// Merge additions (Nov 13 2026): stable technician identity accent (addendum §05), host words (EN/VI, P-14), server paging
// for 200+ technicians (addendum §13), host-controlled date / Fit day, jump-to-technician, visible-set reporting, no print.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FULL_PERMISSIONS, type BookingDataAdapter, type GetScheduleRangeInput } from '../adapters/BookingDataAdapter';
import { MockBookingDataAdapter } from '../adapters/MockBookingDataAdapter';
import { BookingScheduleBoard } from '../components/BookingScheduleBoard';
import type { ScheduleRange, Technician } from '../domain/scheduleTypes';
import { TECHNICIAN_ACCENTS, technicianAccent } from '../domain/technicianColor';
import { toISO } from '../domain/time';
import { buildFixture, FIXTURE_BRANCH, FIXTURE_DATE, FIXTURE_TENANT, FIXTURE_TZ } from '../fixtures/fixtures';
import { BOARD_TEXT_EN, type BoardTextKey } from '../i18n/boardText';

const at = (m: number) => toISO(FIXTURE_DATE, m, FIXTURE_TZ);
const NOW = () => new Date(at(9 * 60));
beforeAll(() => { (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} }; });
afterEach(cleanup);

/** WCAG relative luminance contrast of #rrggbb against white */
function contrastWithWhite(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return 1.05 / (L + 0.05);
}

describe('technician identity accent (addendum §05)', () => {
  it('is a pure function of (tenant, technician): same input → same colour; never the column index', () => {
    expect(technicianAccent('t1', 'tech-200')).toBe(technicianAccent('t1', 'tech-200'));
    expect(TECHNICIAN_ACCENTS).toContain(technicianAccent('t1', 'tech-200'));
    // tenant-scoped: the same technician id in two salons is hashed with its own tenant
    const ids = Array.from({ length: 40 }, (_, i) => `tech-${i}`);
    expect(ids.some((id) => technicianAccent('salon-a', id) !== technicianAccent('salon-b', id))).toBe(true);
    // 200 technicians spread over the whole palette (colours repeat — the number + name stay the identifiers)
    const used = new Set(Array.from({ length: 200 }, (_, i) => technicianAccent('t1', `tech-${i}`)));
    expect(used.size).toBe(TECHNICIAN_ACCENTS.length);
  });
  it('every accent carries white text legibly and is none of the status marks', () => {
    for (const c of TECHNICIAN_ACCENTS) expect(contrastWithWhite(c)).toBeGreaterThanOrEqual(4.5);
    const status = ['#168af5', '#8374ee', '#a747ef', '#f96b21', '#13be98'];
    for (const c of TECHNICIAN_ACCENTS) expect(status).not.toContain(c.toLowerCase());
  });
  it('header badge, every card rail and the detail panel show the SAME accent; page 2 keeps each technician’s own colour', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture({ technicianCount: 25 }), { now: NOW });
    render(<BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE} permissions={FULL_PERMISSIONS} adapter={adapter} now={NOW} onOpenBookingAssistant={() => {}} />);
    const header = await screen.findByTestId('bsb-tech-tech-002');
    const accent = technicianAccent(FIXTURE_TENANT, 'tech-002');
    expect(header.getAttribute('data-accent')).toBe(accent);
    const col = screen.getByTestId('bsb-col-tech-002');
    const cards = col.querySelectorAll('.bsb-card');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((c) => expect(c.getAttribute('data-accent')).toBe(accent));
    // status stays its own (fill by data-status), independent of identity
    expect(new Set([...cards].map((c) => c.getAttribute('data-status'))).size).toBeGreaterThanOrEqual(1);
    fireEvent.click(cards[0] as HTMLElement);
    expect(within(await screen.findByTestId('bsb-appointment')).getByTestId('bsb-panel-accent').getAttribute('data-accent')).toBe(accent);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // technician #13 on page 2 keeps the colour of its id, not of "column 1"
    fireEvent.click(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    const p2first = screen.getAllByRole('columnheader')[0];
    const id = p2first.getAttribute('data-testid')!.replace('bsb-tech-', '');
    expect(p2first.getAttribute('data-accent')).toBe(technicianAccent(FIXTURE_TENANT, id));
  });
});

describe('host words (EN / VI front desk)', () => {
  it('every visible board string goes through the host translate; English is only the fallback', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture({ technicianCount: 25 }), { now: NOW });
    const seen = new Set<BoardTextKey>();
    const translate = (k: BoardTextKey) => { seen.add(k); return `«${k}»`; };
    const { container } = render(<BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE} permissions={FULL_PERMISSIONS} adapter={adapter} now={NOW} onOpenBookingAssistant={() => {}} translate={translate} formatMoney={(c) => `₫${c}`} />);
    await screen.findByTestId('bsb-tech-tech-001');
    expect(screen.getByText('«opening.find»')).toBeInTheDocument();
    expect(screen.getByText('«legend.blockTime»')).toBeInTheDocument();
    // no English UI sentence from the dictionary leaks while a host language is active
    const text = container.textContent ?? '';
    for (const k of ['opening.find', 'legend.blockTime', 'avail.caption', 'bottom.hint', 'pager.previous'] as BoardTextKey[]) expect(text).not.toContain(BOARD_TEXT_EN[k]);
    expect(seen.has('status.confirmed')).toBe(true);
  });
});

/** A server-paged adapter over the mock: honours page / pageSize / workingOnly and returns `paging`, like the real one. */
function serverPaged(base: MockBookingDataAdapter, calls: GetScheduleRangeInput[]): BookingDataAdapter {
  const adapter: BookingDataAdapter = Object.create(base);
  Object.defineProperty(adapter, 'pagesOnServer', { value: true });
  adapter.getScheduleRange = async (i: GetScheduleRangeInput): Promise<ScheduleRange> => {
    calls.push(i);
    const full = await base.getScheduleRange({ ...i });
    const all = [...full.technicians].sort((a, b) => a.sortOrder - b.sortOrder);
    const working = (t: Technician) => t.workingState !== 'time_off' && t.workingState !== 'off';
    const list = i.workingOnly ? all.filter(working) : all;
    const size = i.pageSize ?? 12;
    const totalPages = Math.max(1, Math.ceil(list.length / size));
    const pg = Math.min(Math.max(1, i.page ?? 1), totalPages);
    const pageTechs = list.slice((pg - 1) * size, pg * size);
    const ids = new Set(pageTechs.map((t) => t.id));
    const rosterNumbers = Object.fromEntries(pageTechs.map((t) => [t.id, all.indexOf(t) + 1]));
    return { ...full, technicians: pageTechs, appointments: full.appointments.filter((a) => ids.has(a.technicianId)), segments: full.segments.filter((s) => ids.has(s.technicianId)),
      paging: { total: list.length, totalAll: all.length, workingCount: all.filter(working).length, page: pg, pageSize: size, totalPages, rosterNumbers } };
  };
  adapter.locateTechnician = async (i) => {
    const full = await base.getScheduleRange({ ...i, fromDate: i.date, toDate: i.date });
    const list = [...full.technicians].sort((a, b) => a.sortOrder - b.sortOrder).filter((t) => !i.workingOnly || (t.workingState !== 'time_off' && t.workingState !== 'off'));
    const idx = list.findIndex((t) => t.id === i.technicianId);
    return idx < 0 ? null : { pageIndex: Math.floor(idx / i.pageSize) };
  };
  return adapter;
}

describe('server paging (200+ technicians — addendum §13)', () => {
  it('asks the server for ONE page at a time; counts and labels are the server’s; Next asks for page 2', async () => {
    const calls: GetScheduleRangeInput[] = [];
    const adapter = serverPaged(new MockBookingDataAdapter(buildFixture({ technicianCount: 26 }), { now: NOW }), calls);
    const onVisible = vi.fn();
    render(<BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE} permissions={FULL_PERMISSIONS} adapter={adapter} now={NOW} onOpenBookingAssistant={() => {}} onVisibleChange={onVisible} />);
    await screen.findByTestId('bsb-tech-tech-001');
    expect(calls[0]).toMatchObject({ page: 1, pageSize: 12, workingOnly: true });
    expect(screen.getAllByRole('columnheader')).toHaveLength(12);
    expect(screen.getByText('Technicians 1–12 of 25')).toBeInTheDocument();
    expect(screen.getByTestId('bsb-tech-filter')).toHaveTextContent('Working technicians (25)');
    await waitFor(() => expect(onVisible).toHaveBeenLastCalledWith(expect.objectContaining({ date: FIXTURE_DATE, technicianIds: expect.arrayContaining(['tech-001']) })));
    fireEvent.click(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ page: 2 }));
    await screen.findByText('Technicians 13–24 of 25');
    // the badge is the technician's ROSTER number (tech-008 is off → working-only page 2 starts at roster #14)
    expect(screen.getAllByRole('columnheader')[0].querySelector('.bsb-tech-num')!.textContent).toBe('14');
    // every technician (off ones too) — the server filter, not a client checklist
    fireEvent.click(screen.getByTestId('bsb-tech-filter'));
    fireEvent.click(screen.getByRole('button', { name: 'All technicians (26)' }));
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ page: 1, workingOnly: false }));
    await screen.findByText('Technicians 1–12 of 26');
  });
  it('jump-to-technician pages to them (locate on the server) and selects the column', async () => {
    const calls: GetScheduleRangeInput[] = [];
    const adapter = serverPaged(new MockBookingDataAdapter(buildFixture({ technicianCount: 26 }), { now: NOW }), calls);
    const props = { tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, userId: 'u1', timezone: FIXTURE_TZ, selectedDate: FIXTURE_DATE, permissions: FULL_PERMISSIONS, adapter, now: NOW, onOpenBookingAssistant: () => {} };
    const { rerender } = render(<BookingScheduleBoard {...props} />);
    await screen.findByTestId('bsb-tech-tech-001');
    rerender(<BookingScheduleBoard {...props} focusTechnician={{ technicianId: 'tech-026', nonce: 1 }} />);
    const col = await screen.findByTestId('bsb-tech-tech-026');
    expect(calls.at(-1)).toMatchObject({ page: 3 });
    await waitFor(() => expect(col).toHaveAttribute('aria-selected', 'true'));
  });
});

describe('host-controlled toolbar (the POS keeps its own Day / date / Fit day)', () => {
  it('follows the host date without resetting the technician page, and the host Fit day', async () => {
    const adapter = new MockBookingDataAdapter(buildFixture({ technicianCount: 25 }), { now: NOW });
    const props = { tenantId: FIXTURE_TENANT, branchId: FIXTURE_BRANCH, userId: 'u1', timezone: FIXTURE_TZ, permissions: FULL_PERMISSIONS, adapter, now: NOW, onOpenBookingAssistant: () => {}, showPrimaryToolbar: false };
    const onState = vi.fn();
    const { rerender } = render(<BookingScheduleBoard {...props} selectedDate={FIXTURE_DATE} fitDay={false} onStateChange={onState} />);
    await screen.findByTestId('bsb-tech-tech-001');
    expect(screen.queryByTestId('bsb-toolbar')).toBeNull();
    fireEvent.click(within(screen.getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    rerender(<BookingScheduleBoard {...props} selectedDate="2026-05-07" fitDay={false} onStateChange={onState} />);
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({ date: '2026-05-07', pageIndex: 1 })));
  });
});

describe('no schedule printing (owner rule; addendum §10, B-20)', () => {
  it('the board has Block time and no print control, menu item or print call anywhere', async () => {
    const print = vi.fn();
    const orig = window.print;
    window.print = print;
    const adapter = new MockBookingDataAdapter(buildFixture(), { now: NOW });
    const { container } = render(<BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE} permissions={FULL_PERMISSIONS} adapter={adapter} now={NOW} onOpenBookingAssistant={() => {}} />);
    await screen.findByTestId('bsb-tech-tech-001');
    expect(screen.getByTestId('bsb-block-time-action')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /More actions/ })[0]);
    expect(container.textContent ?? '').not.toMatch(/print/i);
    expect(screen.queryByRole('button', { name: /print/i })).toBeNull();
    expect(Object.values(BOARD_TEXT_EN).some((v) => /print/i.test(v))).toBe(false);
    expect(print).not.toHaveBeenCalled();
    window.print = orig;
  });
});
