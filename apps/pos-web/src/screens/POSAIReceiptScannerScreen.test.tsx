// POSAIReceiptScannerScreen — AI OCR Receipt Scanner guide (Nov 1 2026). The add-on header stays (honest state); below it the
// four cards come from /pos/receipt-center/summary, the history is a server query (search, groups, which date, presets,
// pages), each row shows four separate tracks, a receipt opens read-only with a link to Receipt Review, a failed read is an
// error not "no receipts", and Check OCR System renders localized text. Nothing here posts or changes stock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { rc, pkg } = vi.hoisted(() => ({ rc: { summary: vi.fn(), documents: vi.fn(), document: vi.fn(), check: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posReceiptCenterApi', () => ({ posReceiptCenterApi: rc }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
import { POSAIReceiptScannerScreen } from './POSAIReceiptScannerScreen';

const CARD = { package: { code: 'ai_ocr_receipt_scanner', name: 'AI OCR Receipt Scanner', description: 'Scans receipt images.', category: 'finance', posArea: 'Inventory / Expenses / Receipts', state: 'trial_expired', storedStatus: 'trialing',
  disabledReason: null, price: { cents: 2900, period: 'monthly', source: 'catalog_list' }, usage: { used: null, limit: 500, unit: 'scans', percent: null, level: 'not_metered', periodStart: null, periodEnd: null, remaining: null },
  trial: { days: 14, endsAt: '2026-10-20T00:00:00Z', daysLeft: null, eligible: false }, actions: ['view_details'] } };
const SUM = { period: { preset: 'month', today: '2026-11-02' }, cards: { scanned: 4, needsReview: 1, duplicates: 1, approvedExpenses: 1, approvedExpenseCents: 8800 },
  pipeline: { processing: 0, failed: 1, quarantined: 0, approvedNotPosted: 0, oldestProcessingAt: null }, definitions: {} };
const ROW = { id: 'd1', vendor: 'Sally Beauty', number: 'INV-7', purchaseDate: '2026-10-30', uploadedAt: '2026-11-02T15:00:00Z', totalCents: 4599, currency: 'USD', pipeline: 'review_required', pages: 1, branch: 'Main', uploader: 'Owner',
  expenseId: null, tracks: { reading: 'read', expense: 'awaiting_review', receiving: 'not_applicable', duplicate: 'possible' } };
const LIST = { items: [ROW], total: 1, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' } };
const mount = () => render(<MemoryRouter><POSAIReceiptScannerScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(rc), ...Object.values(pkg)]) f.mockReset();
  pkg.detail.mockResolvedValue(CARD); rc.summary.mockResolvedValue(SUM); rc.documents.mockResolvedValue(LIST);
});

describe('POSAIReceiptScannerScreen', () => {
  it('keeps the add-on header (honest state) and shows the four cards with their definitions', async () => {
    mount();
    expect(await screen.findByTestId('pkg-state')).toHaveTextContent('Trial expired');
    // the KPI card renders (loading) before its value arrives — wait for the value, not just the card (flaky under load)
    await waitFor(() => expect(screen.getByTestId('kpi-scanned')).toHaveTextContent('4'));
    expect(screen.getByTestId('kpi-review')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-dupes')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-approved')).toHaveTextContent('1');
    expect(screen.getByTestId('rcsx-defs')).toHaveTextContent('$88.00');
    expect(screen.getByTestId('rcsx-safety')).toHaveTextContent(/evidence, not an expense/);
    expect(screen.getByTestId('rcsx-pipeline')).toHaveTextContent('1 could not be read');
  });

  it('each row shows four separate tracks; search, groups, date field and presets are server queries that reset to page 1', async () => {
    mount();
    const row = await screen.findByTestId('rcsx-row');
    expect(row).toHaveTextContent('Sally Beauty');
    expect(screen.getByTestId('trk-expense')).toHaveTextContent('Awaiting review');
    expect(screen.getByTestId('trk-duplicate')).toHaveTextContent('Possible');
    fireEvent.change(screen.getByTestId('rcsx-search'), { target: { value: 'ACE-16' } });
    fireEvent.submit(screen.getByTestId('rcsx-search').closest('form')!);
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ACE-16', page: 1 })));
    fireEvent.click(screen.getByTestId('kpi-dupes'));
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'duplicates' })));
    fireEvent.change(screen.getByTestId('rcsx-datefield'), { target: { value: 'purchase' } });
    fireEvent.click(screen.getByTestId('preset-last_30'));
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ dateField: 'purchase', preset: 'last_30', page: 1 })));
    await waitFor(() => expect(rc.summary).toHaveBeenLastCalledWith({ preset: 'last_30' }));
  });

  it('a receipt opens read-only with lines, links and a way to Receipt Review', async () => {
    rc.document.mockResolvedValue({ id: 'd1', vendor: 'Sally Beauty', number: 'INV-7', purchaseDate: '2026-10-30', dateAmbiguous: false, currency: 'USD', amounts: { subtotalCents: 4200, taxCents: 399, feesCents: null, discountCents: null, totalCents: 4599, creditOrRefund: false },
      pages: 1, branch: 'Main', uploader: 'Owner', uploadedAt: '2026-11-02T15:00:00Z', pipeline: 'review_required', tracks: ROW.tracks, checks: { status: 'needs_review', blocksPosting: false, flags: [], missing: [] },
      fields: [{ key: 'vendor', value: 'Sally Beauty', cents: null, state: 'high', confidence: 0.98, corrected: false }], lines: [{ n: 1, description: 'Acetone 16oz', sku: 'ACE-16', quantity: 2, unit: null, unitCents: null, totalCents: 4599, reconciles: false }],
      duplicates: [], category: null, expense: null, postings: [], trail: [], jobs: [] });
    mount();
    fireEvent.click(await screen.findByTestId('rcsx-row'));
    expect(await screen.findByTestId('rcsx-amounts')).toHaveTextContent('$45.99');
    expect(screen.getByTestId('rcsx-lines')).toHaveTextContent("Line doesn't add up");
    expect(screen.getByTestId('rcsx-links')).toHaveTextContent('No expense recorded');
    expect(screen.getByTestId('rcsx-review-link')).toHaveAttribute('href', '/tenant/ai/ocr-receipt?doc=d1');
  });

  it('OCR Receipt Scanner 05: a line shows this vendor\'s last approved price and the change (from the server); a line never bought before shows nothing invented', async () => {
    rc.document.mockResolvedValue({ id: 'd1', vendor: 'Sally Beauty', number: 'INV-7', purchaseDate: '2026-10-30', dateAmbiguous: false, currency: 'USD', amounts: { subtotalCents: 1480, taxCents: 0, feesCents: null, discountCents: null, totalCents: 1480, creditOrRefund: false },
      pages: 1, branch: 'Main', uploader: 'Owner', uploadedAt: '2026-11-02T15:00:00Z', pipeline: 'review_required', tracks: ROW.tracks, checks: null, fields: [],
      lines: [{ n: 1, description: 'Acetone 16oz', sku: 'ACE-16', quantity: 1, unit: null, unitCents: 1150, totalCents: 1150, reconciles: true,
          previous: { unitCents: 1000, documentId: 'd0', date: '2026-10-20', uploadedAt: '2026-10-20T15:00:00Z', changeCents: 150, changePercent: 15 } },
        { n: 2, description: 'Brand new item', sku: 'NEW-1', quantity: 1, unit: null, unitCents: 330, totalCents: 330, reconciles: true, previous: null }],
      priceChanges: { compared: 1, up: 1, down: 0, basis: 'last_posted_receipt_same_vendor' }, duplicates: [], category: null, expense: null, postings: [], trail: [], jobs: [] });
    mount();
    fireEvent.click(await screen.findByTestId('rcsx-row'));
    const prev = await screen.findAllByTestId('rcsx-line-prev');
    expect(prev).toHaveLength(1);
    expect(prev[0]).toHaveTextContent('Last approved price $10.00 (2026-10-20) · change +$1.50 (+15%)');
    expect(screen.getByTestId('rcsx-price-note')).toHaveTextContent("1 line(s) compared with this vendor's last approved, posted receipt: 1 cost more, 0 cost less.");
  });

  it('a failed history read is an error with retry, not "no receipts"', async () => {
    rc.documents.mockRejectedValue({ status: 500 });
    mount();
    expect(await screen.findByText(/this is not "no receipts"/)).toBeInTheDocument();
    expect(screen.queryByText(/No receipts yet/)).toBeNull();
  });

  it('Check OCR System renders localized detail', async () => {
    rc.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [{ key: 'ocr_provider', state: 'WARNING', count: 0 }] });
    mount();
    fireEvent.click(await screen.findByTestId('rcsx-check'));
    expect(await screen.findByTestId('chk-ocr_provider')).toHaveTextContent(/go to manual entry/);
  });
});
