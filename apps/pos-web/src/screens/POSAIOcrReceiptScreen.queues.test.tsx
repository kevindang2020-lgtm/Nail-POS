// POSAIOcrReceiptScreen — Receipt Document Recognition guide (Nov 1 2026). The six cards come from one tenant-scoped count of
// every queue (they used to be counted from the first 200 rows); each tab asks the server for ITS queue (the old list sent
// `status`, which the API ignored, so every tab showed every document — and "in review" documents had no tab at all); a failed
// read is an error, never an empty queue; Return / Reject ask for the reason; a receipt opened from the scanner page opens here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ retryExtract: vi.fn(), detail: vi.fn(), previewUrl: vi.fn(), approve: vi.fn(), reject: vi.fn(), returnForCorrection: vi.fn(), startReview: vi.fn(), post: vi.fn(), correctField: vi.fn() }));
const rc = vi.hoisted(() => ({ summary: vi.fn(), documents: vi.fn(), document: vi.fn(), check: vi.fn(), processing: vi.fn() }));
vi.mock('../api/posAiOcrReceiptApi', () => ({ posAiOcrReceiptApi: m }));
vi.mock('../api/posReceiptCenterApi', () => ({ posReceiptCenterApi: rc }));
vi.mock('../api/posExpensesApi', () => ({ posExpensesApi: { attachReceipt: vi.fn() } }));
import { POSAIOcrReceiptScreen } from './POSAIOcrReceiptScreen';

const row = (o: Record<string, unknown> = {}) => ({ id: 'd1', vendor: 'ABC Nail Supply', number: 'INV-1', purchaseDate: '2026-10-11', uploadedAt: '2026-11-02T15:00:00Z', totalCents: 8899, currency: 'USD', pipeline: 'in_review', pages: 1,
  tracks: { reading: 'read', expense: 'awaiting_review', receiving: 'not_applicable', duplicate: 'none' }, documentType: 'receipt', qualityFlags: [], suggestedMatch: null, thumbnailKey: null, ...o });
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' } });
const doc = { id: 'd1', pipelineState: 'in_review', documentType: 'receipt', vendor: 'ABC Nail Supply', totalCents: 8899, fields: [], lineItems: [], storageKey: null, duplicateStatus: 'none' };
const mount = (path = '/tenant/ai/ocr-receipt') => render(<MemoryRouter initialEntries={[path]}><POSAIOcrReceiptScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(m), ...Object.values(rc)]) f.mockReset();
  rc.summary.mockResolvedValue({ states: { review_required: 3, in_review: 1, duplicate_hold: 2, approved: 1, failed: 1, posted: 7, quarantined: 0 }, cards: {}, pipeline: {} });
  rc.documents.mockResolvedValue(page([row()]));
  m.detail.mockResolvedValue(doc); m.previewUrl.mockResolvedValue({ url: 'notconnected:x' });
});

describe('POSAIOcrReceiptScreen — queues', () => {
  it('the six cards come from the per-queue counts (in review counts as review required; posting failures are their own card)', async () => {
    mount();
    const k = await screen.findByTestId('rrx-kpis');
    await waitFor(() => expect(k).toHaveTextContent('Review required4'));
    expect(k).toHaveTextContent('Duplicate holds2');
    expect(k).toHaveTextContent('Posted7');
    expect(k).toHaveTextContent('Posting failures1');
  });

  it('each tab asks the server for its own queue; search and presets are server queries', async () => {
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /Review Required/ }));
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'review', page: 1 })));
    fireEvent.click(screen.getByRole('tab', { name: /Duplicate Review/ }));
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ group: 'duplicate_hold' })));
    fireEvent.change(screen.getByTestId('rrx-search'), { target: { value: 'INV-1' } });
    fireEvent.submit(screen.getByTestId('rrx-search').closest('form')!);
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'INV-1', group: 'duplicate_hold' })));
    fireEvent.click(screen.getByTestId('preset-last_30'));
    await waitFor(() => expect(rc.documents).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last_30' })));
  });

  it('a failed queue read is an error with Try again — never "Nothing here"', async () => {
    rc.documents.mockRejectedValue({ status: 500 });
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /Review Required/ }));
    expect(await screen.findByText(/this is not "no documents"/)).toBeInTheDocument();
    expect(screen.queryByText('Nothing here right now.')).toBeNull();
  });

  it('Reject asks for the reason and sends it; a receipt opened from the scanner page (?doc=) opens directly', async () => {
    m.reject.mockResolvedValue({ outcome: 'rejected' });
    mount('/tenant/ai/ocr-receipt?doc=d1');
    await waitFor(() => expect(m.detail).toHaveBeenCalledWith('d1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(screen.getByTestId('rrx-reason-go')).toBeDisabled();
    fireEvent.change(screen.getByTestId('rrx-reason'), { target: { value: 'Personal purchase' } });
    fireEvent.click(screen.getByTestId('rrx-reason-go'));
    await waitFor(() => expect(m.reject).toHaveBeenCalledWith('d1', 'Personal purchase'));
  });
  it('extras OCR #02 / RDR #05: beside the original, every read line, the amounts as they stand and the SERVER\'s arithmetic checks (mismatch with expected / read / difference)', async () => {
    m.detail.mockResolvedValue({ ...doc, lineItems: [{ lineNumber: 1, description: 'Gel polish', quantity: 2, unitPriceCents: 1250, lineTotalCents: 2500, confidence: 0.9 }, { lineNumber: 2, description: 'Acetone', quantity: 1, unitPriceCents: 899, lineTotalCents: 899, confidence: 0.4 }],
      amounts: { subtotalCents: 3399, taxCents: 238, feesCents: null, discountCents: null, totalCents: 3737 },
      arithmetic: [{ name: 'line_items_vs_subtotal', passed: true, expectedCents: 3399, actualCents: 3399, deltaCents: 0 }, { name: 'components_vs_total', passed: false, expectedCents: 3637, actualCents: 3737, deltaCents: 100 }] });
    mount('/tenant/ai/ocr-receipt?doc=d1');
    const lines = await screen.findAllByTestId('rrx-line');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveTextContent('Gel polish');
    expect(lines[0]).toHaveTextContent('$12.50');
    expect(lines[0]).toHaveTextContent('$25.00');
    expect(screen.getByTestId('rrx-amounts')).toHaveTextContent('Subtotal $33.99');
    expect(screen.getByTestId('rrx-amounts')).toHaveTextContent('Fees —');
    expect(screen.getByTestId('rrx-check-line_items_vs_subtotal')).toHaveAttribute('data-passed', 'yes');
    const bad = screen.getByTestId('rrx-check-components_vs_total');
    expect(bad).toHaveAttribute('data-passed', 'no');
    expect(bad).toHaveTextContent('expected $36.37, read $37.37 (+$1.00)');
    expect(m.approve).not.toHaveBeenCalled();
    expect(m.correctField).not.toHaveBeenCalled();
  });
  it('extras OCR #02: amounts without enough parts say the arithmetic could not be checked — never a pass', async () => {
    m.detail.mockResolvedValue({ ...doc, amounts: { subtotalCents: null, taxCents: null, feesCents: null, discountCents: null, totalCents: 3737 }, arithmetic: [] });
    mount('/tenant/ai/ocr-receipt?doc=d1');
    expect(await screen.findByTestId('rrx-check-none')).toHaveTextContent('Not enough amounts');
    expect(screen.queryByTestId('rrx-lines')).toBeNull();
  });
  it('extras RDR #02: a quarantined receipt never asks for a preview link — the panel says the preview is blocked until the scan clears it', async () => {
    m.detail.mockResolvedValue({ ...doc, pipelineState: 'quarantined', storageKey: 'tenants/t/documents/d1/original.png' });
    mount('/tenant/ai/ocr-receipt?doc=d1');
    expect(await screen.findByTestId('rrx-preview-blocked')).toHaveTextContent('security scan');
    expect(m.previewUrl).not.toHaveBeenCalled();
  });
  it('extras RDR #02: a cleared receipt asks for its preview as before', async () => {
    m.detail.mockResolvedValue({ ...doc, pipelineState: 'review_required', storageKey: 'tenants/t/documents/d1/original.png' });
    mount('/tenant/ai/ocr-receipt?doc=d1');
    await waitFor(() => expect(m.previewUrl).toHaveBeenCalledWith('d1', 'tenants/t/documents/d1/original.png'));
    expect(screen.queryByTestId('rrx-preview-blocked')).toBeNull();
  });
  it('Receipt Document Recognition 03: the Extracting tab shows phase cards, waiting receipts with attempts and the latest job, stale ones, and Retry only where the server allows it', async () => {
    rc.processing.mockResolvedValue({ phases: [{ phase: 'queue', count: 1, oldestAt: '2026-11-02T14:58:00Z', attempts: 0 }, { phase: 'ocr', count: 2, oldestAt: '2026-11-02T14:00:00Z', attempts: 2 },
      { phase: 'validation', count: 0, oldestAt: null, attempts: 0 }, { phase: 'failed', count: 1, oldestAt: '2026-11-02T13:00:00Z', attempts: 3 }],
      items: [
        { documentId: 'f1', vendor: 'Failed thrice', branch: 'Main', state: 'extraction_failed', phase: 'failed', attempts: 3, nextAttemptAt: null, waitingMinutes: 120, stale: false,
          job: { provider: 'textract', status: 'failed', attempt: 3, error: 'PROVIDER_TIMEOUT', requestedAt: '2026-11-02T13:00:00Z', completedAt: '2026-11-02T13:00:00Z' }, retryEligible: true },
        { documentId: 's1', vendor: 'Stuck OCR', branch: 'Main', state: 'extracting', phase: 'ocr', attempts: 1, nextAttemptAt: null, waitingMinutes: 60, stale: true,
          job: { provider: 'textract', status: 'running', attempt: 1, error: null, requestedAt: '2026-11-02T14:00:00Z', completedAt: null }, retryEligible: false }],
      total: 4, shown: 2, sort: 'oldest', freshness: { lastJobAt: '2026-11-02T14:57:00Z', staleAfterMinutes: 15, stale: 1 }, generatedAt: '2026-11-02T15:00:00Z' });
    m.retryExtract.mockResolvedValue({ pipelineState: 'extracting', providerKey: 'textract', unavailable: false });
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: /Extracting/ }));
    const box = await screen.findByTestId('rrx-proc');
    expect(within(box).getByTestId('rrx-proc-ocr')).toHaveTextContent('Being read (OCR)2');
    expect(within(box).getByTestId('rrx-proc-failed')).toHaveTextContent('Reading failed1');
    expect(within(box).getByTestId('rrx-proc-fresh')).toHaveTextContent('1 quiet for over 15 minutes');
    const rows = within(box).getAllByTestId('rrx-proc-row');
    expect(rows[0]).toHaveTextContent('Failed thrice'); expect(rows[0]).toHaveTextContent('2 h'); expect(rows[0]).toHaveTextContent(/Provider timeout/i);
    expect(rows[1]).toHaveTextContent('No progress'); expect(rows[1]).toHaveTextContent('60 min');
    expect(within(rows[1]).queryByTestId('rrx-proc-retry')).toBeNull();          // the pipeline does not allow retry while reading
    expect(within(box).getByText('2 more receipts are waiting (oldest are shown first).')).toBeInTheDocument();
    fireEvent.click(within(rows[0]).getByTestId('rrx-proc-retry'));
    await waitFor(() => expect(m.retryExtract).toHaveBeenCalledWith('f1'));
    fireEvent.change(within(box).getByTestId('rrx-proc-sort'), { target: { value: 'attempts' } });
    await waitFor(() => expect(rc.processing).toHaveBeenLastCalledWith('attempts'));
  });
});
