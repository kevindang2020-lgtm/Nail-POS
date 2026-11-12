// POSAIOcrReceiptScreen — Receipt / Expense / OCR mandate close-out (Oct 27 2026). Verifies: §18 several photos ask "one receipt or
// several?" and COMBINE appends pages under ONE document (upload with deferExtraction, then pages, then extract); §26 a receipt the
// server found hard to read shows "may be difficult to read — Retake / Process anyway" and nothing fails; §38 a weak field says
// Verify and Confirm / Edit store the person's answer; §142 a suggested existing expense is linked from the review panel, never
// auto-linked; §115 a reading that gave up offers Retry reading; §155 offline, the photo is held on the device and the user is told.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

const m = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), previewUrl: vi.fn(), upload: vi.fn(), addPage: vi.fn(), extract: vi.fn(), retryExtract: vi.fn(), correctField: vi.fn(), startReview: vi.fn(), approve: vi.fn(), reject: vi.fn(), returnForCorrection: vi.fn(), post: vi.fn(), rescan: vi.fn(), retryPost: vi.fn(), settings: vi.fn(), saveSettings: vi.fn() }));
const fin = vi.hoisted(() => ({ attachReceipt: vi.fn(), suggestedExpense: vi.fn() }));
vi.mock('../api/posAiOcrReceiptApi', () => ({ posAiOcrReceiptApi: m }));
const rcm = vi.hoisted(() => ({ summary: vi.fn(), documents: vi.fn(), document: vi.fn(), check: vi.fn() }));
vi.mock('../api/posReceiptCenterApi', () => ({ posReceiptCenterApi: rcm }));
vi.mock('../api/posExpensesApi', () => ({ posExpensesApi: fin }));
import { MemoryRouter } from 'react-router-dom';
import { POSAIOcrReceiptScreen as Screen } from './POSAIOcrReceiptScreen';
const POSAIOcrReceiptScreen = () => <MemoryRouter><Screen /></MemoryRouter>;
/** a receipt-center row (the queue lists read /pos/receipt-center/documents) */
const row = (o: Record<string, unknown> = {}) => ({ id: 'd1', vendor: 'ABC Nail Supply', number: null, purchaseDate: '2026-10-11', uploadedAt: '2026-11-02T15:00:00Z', totalCents: 8899, currency: 'USD', pipeline: 'review_required', pages: 1,
  branch: null, uploader: null, expenseId: null, tracks: { reading: 'read', expense: 'awaiting_review', receiving: 'not_applicable', duplicate: 'none' }, documentType: 'receipt', qualityFlags: [], suggestedMatch: null, suggestedExpenseId: null, thumbnailKey: null, ...o });
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' } });

const doc = (o: Record<string, unknown> = {}) => ({ id: 'd1', tenantId: 't', branchId: null, pipelineState: 'review_required', documentType: 'receipt', vendor: 'ABC Nail Supply', totalCents: 8899, category: null, fileHash: 'h', perceptualHash: null, documentNumber: null, documentDate: '2026-10-11', postingVersion: 1, storageKey: null,
  pageCount: 1, qualityFlags: [], extractionAttempts: 1, nextExtractionAt: null, lastExtractionError: null, suggestedExpenseId: null, suggestedMatch: null, sourceChannel: 'pos_upload', thumbnailKey: null, duplicateStatus: 'none',
  fields: [{ key: 'vendor', text: 'ABC Nail Supply', cents: null, confidence: 0.98, state: 'high', page: 1, correctedValue: null }, { key: 'total', text: '$88.99', cents: 8899, confidence: 0.55, state: 'low', page: 1, correctedValue: null }], lineItems: [{ lineNumber: 1, description: 'Gel', quantity: 1, unitPriceCents: 8899, lineTotalCents: 8899, confidence: 0.9 }], ...o });
/** jsdom's File has no arrayBuffer(); the screen reads the bytes through it, so the test file answers its own bytes */
const file = (name: string, type = 'image/png') => { const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]); const f = new File([bytes], name, { type }); Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) }); return f; };
const pick = (files: File[]) => { const input = screen.getByLabelText('Choose file') as HTMLInputElement; Object.defineProperty(input, 'files', { value: files, configurable: true }); fireEvent.change(input); };
const online = (v: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset()); Object.values(fin).forEach((f) => f.mockReset()); Object.values(rcm).forEach((f) => f.mockReset());
  rcm.summary.mockResolvedValue({ states: { review_required: 1 }, cards: {}, pipeline: {} });
  rcm.documents.mockResolvedValue(page([row()]));
  online(true);
  if (!(globalThis as any).crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    m.detail.mockResolvedValue(doc());
  m.previewUrl.mockResolvedValue({ url: 'notconnected:x' });
  m.upload.mockResolvedValue({ documentId: 'new-1', pipelineState: 'extracting', quality: { flags: [], difficult: false }, thumbnailKey: null, pageCount: 1 });
  m.addPage.mockResolvedValue({ documentId: 'new-1', pageCount: 2, pipelineState: 'extracting', quality: { flags: [], difficult: false } });
  m.extract.mockResolvedValue({ pipelineState: 'review_required', providerKey: 'x', unavailable: false });
  m.correctField.mockResolvedValue({ fieldKey: 'total', state: 'manually_confirmed' });
  fin.attachReceipt.mockResolvedValue({ expenseId: 'e9', documentId: 'd1', role: 'receipt' });
});
const openUpload = async () => { render(<POSAIOcrReceiptScreen />); fireEvent.click(await screen.findByRole('tab', { name: 'Upload' })); await screen.findByText('Upload a receipt or document'); };

describe('POSAIOcrReceiptScreen — close-out', () => {
  it('§18: three photos ask "one receipt or several?"; Combine uploads page 1 with deferExtraction, appends pages 2–3 under the SAME document, then reads it once', async () => {
    await openUpload();
    pick([file('p1.png'), file('p2.png'), file('p3.png')]);
    expect(await screen.findByText('3 photos — one receipt or several?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Combine into one receipt (3 pages)' }));
    await waitFor(() => expect(m.extract).toHaveBeenCalledWith('new-1'));
    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(m.upload.mock.calls[0][0]).toMatchObject({ filename: 'p1.png', source: 'pos_upload', deferExtraction: true });
    expect(m.addPage).toHaveBeenCalledTimes(2);
    expect(m.addPage.mock.calls.map((c) => [c[0], c[1].filename])).toEqual([['new-1', 'p2.png'], ['new-1', 'p3.png']]);
  });
  it('§18: "separate" uploads each photo as its own document (no pages, no deferral)', async () => {
    await openUpload();
    pick([file('a.png'), file('b.png')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload as 2 separate receipts' }));
    await waitFor(() => expect(m.upload).toHaveBeenCalledTimes(2));
    expect(m.upload.mock.calls.every((c) => !c[0].deferExtraction && c[0].source === 'pos_upload')).toBe(true);
    expect(m.addPage).not.toHaveBeenCalled();
  });
  it('§26: a hard-to-read receipt is announced with Retake / Process anyway; it was still accepted (never a failure)', async () => {
    m.upload.mockResolvedValueOnce({ documentId: 'dark-1', pipelineState: 'extracting', quality: { flags: ['too_dark', 'low_resolution'], difficult: true }, thumbnailKey: null, pageCount: 1 });
    await openUpload();
    pick([file('dark.png')]);
    expect(await screen.findByText('This receipt may be difficult to read.')).toBeInTheDocument();
    expect(screen.getByText('too dark · low resolution')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Process anyway' }));
    await waitFor(() => expect(screen.queryByText('This receipt may be difficult to read.')).toBeNull());
    expect(m.upload).toHaveBeenCalledTimes(1);
  });
  it('§155: offline, the photo is held on this device (encrypted) and the user is told nothing is recorded yet; the queue shows "waiting to upload"', async () => {
    await openUpload();
    online(false);
    pick([file('offline.png')]);
    expect(await screen.findByText(/No connection — 1 receipt\(s\) saved on this device, encrypted/)).toBeInTheDocument();
    expect(m.upload).not.toHaveBeenCalled();
    expect(await screen.findByText('1 receipt(s) waiting to upload from this device.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload now' })).toBeDisabled();   // nothing to do while still offline
    online(true);
    window.dispatchEvent(new Event('online'));                                    // the reconnect uploads it by itself
    await waitFor(() => expect(m.upload).toHaveBeenCalledTimes(1));
    expect(m.upload.mock.calls[0][0]).toMatchObject({ filename: 'offline.png', source: 'pos_upload' });
    await waitFor(() => expect(screen.queryByText('1 receipt(s) waiting to upload from this device.')).toBeNull());
  });
  it('§38: the weak field says Verify with its confidence; Confirm stores a confirmation, Edit stores a correction in whole cents', async () => {
    render(<POSAIOcrReceiptScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: /Review Required/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(await screen.findByText('What was read (confirm or correct)')).toBeInTheDocument();
    expect(screen.getByText('Verify · 55%')).toBeInTheDocument();
    expect(screen.queryByText('Verify · 98%')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);   // confidence-first: the weak Total is listed first
    await waitFor(() => expect(m.correctField).toHaveBeenCalledWith('d1', 'total', { confirmOnly: true }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const box = screen.getByLabelText('Edit Total') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '$89.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.correctField).toHaveBeenCalledWith('d1', 'total', { value: '$89.99', valueCents: 8999 }));
    expect(screen.getByText('1 line items read')).toBeInTheDocument();
  });
  it('extras row 03 confidence-first: fields to check come first (weakest first), confident and confirmed ones stay listed below; the count is shown; nothing is saved by ordering', async () => {
    m.detail.mockResolvedValue(doc({ fields: [
      { key: 'vendor', text: 'ABC Nail Supply', cents: null, confidence: 0.98, state: 'high', page: 1, correctedValue: null },
      { key: 'date', text: '2026-10-11', cents: null, confidence: 0.7, state: 'medium', page: 1, correctedValue: null },
      { key: 'tax', text: '$5.00', cents: 500, confidence: 0.4, state: 'low', page: 1, correctedValue: null },
      { key: 'subtotal', text: '$83.99', cents: 8399, confidence: 0.5, state: 'manually_confirmed', page: 1, correctedValue: null },
      { key: 'total', text: '$88.99', cents: 8899, confidence: 0.55, state: 'low', page: 1, correctedValue: null },
    ] }));
    render(<POSAIOcrReceiptScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: /Review Required/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(await screen.findByText('3 field(s) to check — shown first')).toBeInTheDocument();
    // the field rows live under the heading's container (the vendor / date also appear in the document summary above it)
    const box = screen.getByText('What was read (confirm or correct)').parentElement as HTMLElement;
    const values = Array.from(box.querySelectorAll('span')).map((e) => e.textContent).filter((t) => ['$5.00', '$88.99', '2026-10-11', 'ABC Nail Supply', '$83.99'].includes(String(t)));
    // weakest first (tax 40%, total 55%, date 70%), then the rest in the server's order (vendor, confirmed subtotal)
    expect(values).toEqual(['$5.00', '$88.99', '2026-10-11', 'ABC Nail Supply', '$83.99']);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(m.correctField).not.toHaveBeenCalled();
  });
  it('§142: a matched existing expense is offered with "Link to that expense" (attach as the receipt) — and nothing is linked until the person taps; §115 a reading that gave up offers Retry reading', async () => {
    m.detail.mockResolvedValue(doc({ suggestedMatch: 'matched', suggestedExpenseId: 'e9', pageCount: 2, qualityFlags: ['likely_blurry'] }));
    rcm.documents.mockResolvedValue(page([row({ suggestedMatch: 'matched', suggestedExpenseId: 'e9', pages: 2 })]));
    render(<POSAIOcrReceiptScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: /Review Required/ }));
    expect(await screen.findByText('2 pages')).toBeInTheDocument();
    expect(screen.getByText('May match an expense')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByText(/matches an expense already recorded/)).toBeInTheDocument();
    expect(screen.getByText('Image check: looks blurry')).toBeInTheDocument();
    expect(fin.attachReceipt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Link to that expense' }));
    await waitFor(() => expect(fin.attachReceipt).toHaveBeenCalledWith('e9', 'd1'));
    // the dead letter
    m.detail.mockResolvedValue(doc({ id: 'd2', pipelineState: 'extraction_failed', nextExtractionAt: null, fields: [] }));
    rcm.documents.mockResolvedValue(page([row({ id: 'd2', pipeline: 'extraction_failed', tracks: { reading: 'failed', expense: 'not_linked', receiving: 'not_applicable', duplicate: 'none' } })]));
    fireEvent.click(screen.getByRole('tab', { name: /Reading failed/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    expect(await screen.findByText(/Reading gave up after three tries/)).toBeInTheDocument();
    m.retryExtract.mockResolvedValue({ pipelineState: 'review_required', providerKey: 'x', unavailable: false });
    fireEvent.click(screen.getByRole('button', { name: 'Retry reading' }));
    await waitFor(() => expect(m.retryExtract).toHaveBeenCalledWith('d2'));
    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();   // or enter by hand
  });
});
