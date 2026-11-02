import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkipLineDrawer } from './SkipLineDrawer';

const item = { intentId: 'i1', ticketId: 'tk1', ticketNumber: '#000124', customerName: 'Grace Kim', method: 'card', status: 'sent_to_customer', amountCents: 5150 };
const okFetch = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('SkipLineDrawer (POS Skip-the-Line)', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SkipLineDrawer open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists in-flight payments with a status chip and actions', async () => {
    globalThis.fetch = okFetch({ items: [item] }) as any;
    render(<SkipLineDrawer open onClose={() => {}} />);
    expect(await screen.findByText('Grace Kim')).toBeTruthy();
    expect(screen.getByText('Sent to customer')).toBeTruthy();
    expect(screen.getByText('Resend')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Front desk')).toBeTruthy();
  });

  it('cancel calls the cancel endpoint', async () => {
    const f = okFetch({ items: [item] });
    globalThis.fetch = f as any;
    render(<SkipLineDrawer open onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(f).toHaveBeenCalledWith(expect.stringContaining('/cancel-app-payment'), expect.objectContaining({ method: 'POST' })));
  });

  it('shows an empty state when nothing is in flight', async () => {
    globalThis.fetch = okFetch({ items: [] }) as any;
    render(<SkipLineDrawer open onClose={() => {}} />);
    expect(await screen.findByText(/No app or cash payments in flight/)).toBeTruthy();
  });

  it('B-80: an unsettled app charge (card sent, no answer) offers Verify, disables resend / cancel, and Verify calls the verify endpoint', async () => {
    const f = vi.fn(async (url: string) => ({ ok: true, status: 200, headers: { get: () => null },
      json: async () => (String(url).includes('/verify-app-payment') ? { ticketId: 'tk1', results: [{ intentId: 'i1', ticketId: 'tk1', status: 'succeeded', outcome: 'approved' }] } : { items: [{ ...item, status: 'processing', unsettled: true, chargeStartedAt: '2026-10-23T10:00:00Z' }] }) } as any));
    globalThis.fetch = f as any;
    render(<SkipLineDrawer open onClose={() => {}} />);
    expect(await screen.findByText(/Do not take another payment/)).toBeTruthy();
    expect((screen.getByText('Resend') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(f).toHaveBeenCalledWith(expect.stringContaining('/pos/tickets/tk1/verify-app-payment'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Verified with the processor.')).toBeTruthy();
  });
});
