// POSAIOcrReceiptScreen — Receipt Document Recognition guide (Nov 1 2026). The six cards come from one tenant-scoped count of
// every queue (they used to be counted from the first 200 rows); each tab asks the server for ITS queue (the old list sent
// `status`, which the API ignored, so every tab showed every document — and "in review" documents had no tab at all); a failed
// read is an error, never an empty queue; Return / Reject ask for the reason; a receipt opened from the scanner page opens here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ detail: vi.fn(), previewUrl: vi.fn(), approve: vi.fn(), reject: vi.fn(), returnForCorrection: vi.fn(), startReview: vi.fn(), post: vi.fn(), correctField: vi.fn() }));
const rc = vi.hoisted(() => ({ summary: vi.fn(), documents: vi.fn(), document: vi.fn(), check: vi.fn() }));
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
});
