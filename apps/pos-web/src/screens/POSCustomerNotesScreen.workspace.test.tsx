// POSCustomerNotesScreen — the Customer Notes SUNMI workspace (Nov 9 2026): four cards, the notes table with filters and pages,
// a customer's notes with Review & Accuracy for safety notes (the hash the reviewer read is sent; a changed note is refused and
// re-read), the health check, and the original editor reachable from a row.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const { cust, cn } = vi.hoisted(() => ({
  cust: { quickSearch: vi.fn(), getNotes: vi.fn(), setNotes: vi.fn() },
  cn: { summary: vi.fn(), list: vi.fn(), detail: vi.fn(), review: vi.fn(), check: vi.fn() },
}));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: cust }));
vi.mock('../api/posCustomerNotesApi', () => ({ posCustomerNotesApi: cn }));
import { POSCustomerNotesScreen } from './POSCustomerNotesScreen';

const H = 'a'.repeat(64);
const row = (o: any = {}) => ({ customerId: 'c1', customer: 'Lan Pham', phone: '(•••) •••-0101', category: 'allergy', preview: { text: 'Acrylic adhesive', truncated: false }, at: '2026-11-08T15:00:00Z', ticketId: null, review: 'needs_review', reviewedAt: null, safety: true, ...o });
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, applied: {}, period: { today: '2026-11-09', timeZone: 'America/New_York' }, ...o });
const detail = (review = 'needs_review') => ({ customer: { id: 'c1', name: 'Lan Pham', phone: '(•••) •••-0101', customerVisible: false, updatedAt: '2026-11-08T15:00:00Z' },
  entries: [{ category: 'allergy', text: 'Acrylic adhesive', hash: H, at: '2026-11-08T15:00:00Z', ticketId: null, review, reviewedAt: null, safety: true },
    { category: 'general', text: 'Likes quiet chairs', hash: 'b'.repeat(64), at: '2026-11-08T15:00:00Z', ticketId: null, review: 'not_required', reviewedAt: null, safety: false }],
  history: review === 'reviewed' ? [{ category: 'allergy', decision: 'confirmed', reason: null, at: '2026-11-09T10:00:00Z', reviewer: 'Owner Kim', current: true }] : [] });
beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* jsdom */ }
  vi.clearAllMocks();
  cust.quickSearch.mockResolvedValue({ items: [] });
  cn.summary.mockResolvedValue({ asOf: '', cards: { customersWithNotes: 5, safetyWarnings: 2, preferencesRecorded: 3, needsReview: 4 }, needsCorrection: 1, entries: 9, lastUpdatedAt: null, definitions: {}, scope: { label: 'tenant_wide', confined: false } });
  cn.list.mockResolvedValue(page([row(), row({ category: 'visit', ticketId: 't1', review: 'not_required', safety: false, preview: { text: 'Used soak-off', truncated: false } })]));
});

describe('Customer Notes workspace', () => {
  it('four cards with real numbers; a card filters the table; the table is newest first with category and review', async () => {
    render(<POSCustomerNotesScreen />);
    await waitFor(() => expect(screen.getByTestId('cnx-kpi-review')).toHaveTextContent('4'));
    expect(screen.getByTestId('cnx-kpis').children).toHaveLength(4);
    expect(screen.getByTestId('cnx-kpi-review')).toHaveTextContent(/1 marked for correction/);
    const rows = await screen.findAllByTestId('cnx-row');
    expect(rows[0]).toHaveTextContent('Allergies / sensitivities'); expect(rows[0]).toHaveTextContent('Needs review');
    expect(rows[1]).toHaveTextContent('Visit note'); expect(rows[1]).toHaveTextContent('From a Service Done visit');
    fireEvent.click(screen.getByTestId('cnx-kpi-warnings'));
    await waitFor(() => expect(cn.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'warning', page: 1 })));
    fireEvent.change(screen.getByTestId('cnx-review'), { target: { value: 'needs_correction' } });
    await waitFor(() => expect(cn.list).toHaveBeenLastCalledWith(expect.objectContaining({ review: 'needs_correction' })));
    fireEvent.change(screen.getByTestId('cnx-search'), { target: { value: 'adhesive' } }); fireEvent.click(screen.getByTestId('cnx-search-btn'));
    await waitFor(() => expect(cn.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'adhesive' })));
    fireEvent.click(screen.getByTestId('cnx-preset-today'));
    await waitFor(() => expect(cn.list).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'today' })));
  });
  it('View → the notes with Review & Accuracy: confirming sends the hash that was read; a changed note is refused and re-read', async () => {
    cn.detail.mockResolvedValueOnce(detail()).mockResolvedValue(detail());
    cn.review.mockRejectedValueOnce(Object.assign(new Error('changed'), { status: 409, code: 'CUSTOMER_NOTES_CHANGED' })).mockResolvedValueOnce(detail('reviewed'));
    render(<POSCustomerNotesScreen />);
    fireEvent.click((await screen.findAllByTestId('cnx-view'))[0]);
    const dlg = await screen.findByTestId('cnx-detail');
    expect(within(dlg).getByTestId('cnx-entry-general').querySelector('[data-testid^=cnx-confirm]')).toBeNull();   // only safety notes are reviewed
    fireEvent.click(within(dlg).getByTestId('cnx-confirm-allergy'));
    expect(await within(dlg).findByTestId('cnx-act-err')).toHaveTextContent(/changed after you opened it/);
    await waitFor(() => expect(cn.detail).toHaveBeenCalledTimes(2));
    fireEvent.click(within(dlg).getByTestId('cnx-confirm-allergy'));
    await waitFor(() => expect(within(dlg).getByTestId('cnx-history')).toHaveTextContent(/Confirmed/));
    expect(cn.review).toHaveBeenLastCalledWith({ customerId: 'c1', category: 'allergy', contentHash: H, decision: 'confirmed', reason: null });
  });
  it('Extras Customer Notes 04: each safety note shows its review receipt — who, when, decision and which text version; an older review never covers the current text', async () => {
    const d0 = detail();
    cn.detail.mockResolvedValueOnce(d0)
      .mockResolvedValueOnce({ ...d0, history: [{ category: 'allergy', decision: 'confirmed', reason: null, at: '2026-11-07T10:00:00Z', reviewer: 'Owner Kim', current: false }] })
      .mockResolvedValueOnce(detail('reviewed'));
    render(<POSCustomerNotesScreen />);
    const open = async () => { fireEvent.click((await screen.findAllByTestId('cnx-view'))[0]); return screen.findByTestId('cnx-detail'); };
    let dlg = await open();
    expect(within(dlg).getByTestId('cnx-receipt-allergy')).toHaveTextContent('No review yet for this text (version aaaaaaaa)');
    expect(within(dlg).queryByTestId('cnx-receipt-general')).toBeNull();   // only safety notes carry a receipt
    fireEvent.click(within(dlg).getByTestId('cnx-detail-close'));
    dlg = await open();
    const older = within(dlg).getByTestId('cnx-receipt-allergy');
    expect(older).toHaveTextContent(/Last review \(Confirmed by Owner Kim · .*\) was for an earlier text — this version \(aaaaaaaa\) has not been reviewed/);
    fireEvent.click(within(dlg).getByTestId('cnx-detail-close'));
    dlg = await open();
    expect(within(dlg).getByTestId('cnx-receipt-allergy')).toHaveTextContent(/Review receipt: Confirmed by Owner Kim · Nov 9, 2026.* · for this exact text \(version aaaaaaaa\)/);
  });
  it('a correction needs a reason before it can be sent', async () => {
    cn.detail.mockResolvedValue(detail()); cn.review.mockResolvedValue(detail());
    render(<POSCustomerNotesScreen />);
    fireEvent.click((await screen.findAllByTestId('cnx-view'))[0]);
    const dlg = await screen.findByTestId('cnx-detail');
    fireEvent.click(within(dlg).getByTestId('cnx-needs-allergy'));
    expect(within(dlg).getByTestId('cnx-correct-go')).toBeDisabled();
    fireEvent.change(within(dlg).getByTestId('cnx-reason'), { target: { value: 'Ask again' } });
    fireEvent.click(within(dlg).getByTestId('cnx-correct-go'));
    await waitFor(() => expect(cn.review).toHaveBeenCalledWith(expect.objectContaining({ decision: 'needs_correction', reason: 'Ask again' })));
  });
  it('Edit on a row opens the original notes editor; Check runs the read-only health check', async () => {
    cust.getNotes.mockResolvedValue({ salonNotes: '', allergyNotes: 'Acrylic adhesive', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false });
    cn.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-09T10:00:00Z', checks: [{ key: 'corrections_open', state: 'WARNING', count: 1 }, { key: 'no_side_effects', state: 'READY' }] });
    render(<POSCustomerNotesScreen />);
    fireEvent.click((await screen.findAllByTestId('cnx-edit'))[0]);
    expect(await screen.findByDisplayValue('Acrylic adhesive')).toBeInTheDocument();
    expect(cust.getNotes).toHaveBeenCalledWith('c1');
    fireEvent.click(within(screen.getByTestId('cnx-editor')).getAllByRole('button', { name: 'Close' }).slice(-1)[0]);
    fireEvent.click(screen.getByTestId('cnx-check'));
    expect(await screen.findByTestId('cnx-chk-corrections_open')).toHaveTextContent(/Notes marked for correction/);
  });
  it('Persistent search state: search and filters come back after leaving and reopening the screen', async () => {
    const v = render(<POSCustomerNotesScreen />);
    await screen.findAllByTestId('cnx-row');
    fireEvent.change(screen.getByTestId('cnx-search'), { target: { value: 'Lan' } });
    fireEvent.click(screen.getByTestId('cnx-search-btn'));
    fireEvent.change(screen.getByTestId('cnx-review'), { target: { value: 'needs_correction' } });
    await waitFor(() => expect(cn.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Lan', review: 'needs_correction' })));
    v.unmount(); cn.list.mockClear();
    render(<POSCustomerNotesScreen />);
    await waitFor(() => expect(cn.list).toHaveBeenCalledWith(expect.objectContaining({ q: 'Lan', review: 'needs_correction' })));
    expect((screen.getByTestId('cnx-search') as HTMLInputElement).value).toBe('Lan');
  });
  it('Customer Notes 01: the server\'s relevance order is kept and each note says why it is ranked there; nothing is hidden', async () => {
    const d = detail();
    cn.detail.mockResolvedValue({ ...d, context: { ticketId: null, branch: true, technicians: 1, services: 0 },
      entries: [{ ...d.entries[0], relevance: { score: 100, reasons: ['safety'] } },
        { category: 'visit', text: 'Used soak-off', hash: 'c'.repeat(64), at: '2026-11-07T15:00:00Z', ticketId: 't9', review: 'not_required', reviewedAt: null, safety: false, relevance: { score: 30, reasons: ['same_technician', 'same_branch'] } },
        { ...d.entries[1], relevance: { score: 0, reasons: [] } }] });
    render(<POSCustomerNotesScreen />);
    fireEvent.click((await screen.findAllByTestId('cnx-view'))[0]);
    const dlg = await screen.findByTestId('cnx-detail');
    const entries = await within(dlg).findAllByTestId(/^cnx-entry-/);
    expect(entries.map((e) => e.getAttribute('data-testid'))).toEqual(['cnx-entry-allergy', 'cnx-entry-visit', 'cnx-entry-general']);
    expect(within(entries[1]).getByTestId('cnx-rel')).toHaveTextContent('From a visit with the same technician · From a visit at this branch');
    expect(within(entries[2]).queryByTestId('cnx-rel')).toBeNull();
    expect(within(dlg).getByTestId('cnx-rel-note')).toHaveTextContent(/every note is still shown/);
    expect(cn.detail).toHaveBeenLastCalledWith('c1');
  });
});
