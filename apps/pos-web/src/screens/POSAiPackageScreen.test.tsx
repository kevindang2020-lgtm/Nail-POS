// POSAiPackageScreen — the shared AI add-on page reads the ONE honest package state (AI OCR Receipt Scanner guide, Nov 2 2026):
// a lapsed trial is "Trial expired" (never "On trial" next to "Limited"), price + current-period usage + reset date, the trial
// end date, the next step; Start trial and Cancel confirm first and use the idempotent, audited actions; a failed read is an
// error, never "not subscribed".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn(), history: vi.fn() } }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: api }));
import { POSAiPackageScreen } from './POSAiPackageScreen';
beforeEach(() => { Object.values(api).forEach((m) => m.mockReset()); });

const card = (o: any = {}) => ({ package: { code: 'ai_ocr_receipt_scanner', name: 'AI OCR Receipt Scanner', description: 'Scans receipt images.', category: 'finance', posArea: 'Inventory / Expenses / Receipts',
  state: 'trial_available', storedStatus: null, disabledReason: null, price: { cents: 2900, period: 'monthly', source: 'catalog_list' },
  usage: { used: null, limit: 500, unit: 'scans', percent: null, level: 'not_metered', periodStart: null, periodEnd: null, remaining: null },
  trial: { days: 14, endsAt: null, daysLeft: null, eligible: true }, actions: ['view_details', 'start_trial'], ...o } });

describe('POSAiPackageScreen', () => {
  it('a lapsed trial reads "Trial expired" with its end date and next step — not "On trial" + "Limited"', async () => {
    api.detail.mockResolvedValue(card({ state: 'trial_expired', storedStatus: 'trialing', trial: { days: 14, endsAt: '2026-10-20T00:00:00Z', daysLeft: null, eligible: false }, actions: ['view_details'] }));
    render(<POSAiPackageScreen code="ai_ocr_receipt_scanner" title="AI Receipt Scanner" />);
    expect(await screen.findByTestId('pkg-state')).toHaveTextContent('Trial expired');
    expect(screen.queryByText('On trial')).toBeNull();
    expect(screen.getByTestId('pkg-trial')).toHaveTextContent(/Ended Oct 1\d, 2026/);
    expect(screen.getByTestId('pkg-next')).toHaveTextContent(/Upgrade through Billing/);
    expect(screen.getByTestId('pkg-price')).toHaveTextContent('$29.00/mo');
    expect(screen.queryByTestId('pkg-cancel')).toBeNull();
  });
  it('starts a trial only after confirmation, with an idempotency key', async () => {
    api.detail.mockResolvedValue(card()); api.startTrial.mockResolvedValue({});
    render(<POSAiPackageScreen code="ai_ocr_receipt_scanner" title="AI Receipt Scanner" />);
    fireEvent.click(await screen.findByTestId('pkg-trial-start'));
    expect(api.startTrial).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('pkg-confirm-go'));
    await waitFor(() => expect(api.startTrial).toHaveBeenCalledWith('ai_ocr_receipt_scanner', expect.objectContaining({ confirm: true, idempotencyKey: expect.any(String) })));
  });
  it('an active package shows current-period usage + reset date and cancels after confirmation with the stored status', async () => {
    api.detail.mockResolvedValue(card({ state: 'active', storedStatus: 'active', price: { cents: 2500, period: 'monthly', source: 'subscription' },
      usage: { used: 120, limit: 500, unit: 'scans', percent: 24, level: 'ok', periodStart: '2026-10-15T00:00:00Z', periodEnd: '2026-11-15T00:00:00Z', remaining: 380 }, actions: ['view_details', 'cancel', 'open_module'] }));
    api.cancel.mockResolvedValue({});
    render(<POSAiPackageScreen code="ai_ocr_receipt_scanner" title="AI Receipt Scanner" />);
    expect(await screen.findByTestId('pkg-usage')).toHaveTextContent('120 / 500 scans');
    expect(screen.getByTestId('pkg-price')).toHaveTextContent('$25.00/mo');
    expect(screen.getByText(/Resets Nov 1\d, 2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pkg-cancel'));
    fireEvent.click(screen.getByTestId('pkg-confirm-go'));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('ai_ocr_receipt_scanner', expect.objectContaining({ confirm: true, expectedStatus: 'active' })));
  });
  it('an unknown package says so; a failed read is an error, not "not subscribed"', async () => {
    api.detail.mockRejectedValueOnce({ status: 404, body: { code: 'AI_PACKAGE_NOT_FOUND' } });
    const { unmount } = render(<POSAiPackageScreen code="ai_x" title="AI X" />);
    expect(await screen.findByText(/isn't available on your account/)).toBeInTheDocument();
    unmount();
    api.detail.mockRejectedValueOnce({ status: 500 });
    render(<POSAiPackageScreen code="ai_ocr_receipt_scanner" title="AI Receipt Scanner" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-trial-start')).toBeNull();
  });
  it('AI Booking Assistant guide: a cancelled package keeps its past usage, labelled; Usage & history opens the activity log', async () => {
    api.detail.mockResolvedValue(card({ state: 'cancelled', storedStatus: 'cancelled', usage: { used: 142, limit: 500, unit: 'scans', percent: 28, level: 'ok', periodStart: null, periodEnd: null, remaining: null }, actions: ['view_details'] }));
    api.history.mockReturnValue(new Promise(() => {}));
    render(<POSAiPackageScreen code="ai_ocr_receipt_scanner" title="AI Receipt Scanner" />);
    expect(await screen.findByTestId('pkg-usage')).toHaveTextContent('142');
    expect(screen.getByText(/not counting now/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pkg-history'));
    await waitFor(() => expect(api.history).toHaveBeenCalled());
  });
});
