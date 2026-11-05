// LoyaltyBonusRequest.test.tsx — Customer Profile & Global Loyalty Protection guide (Nov 4 2026): the POS can only ASK for
// positive bonus points; the preview is the server's; nothing claims points were added before the owner approves.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoyaltyBonusRequest } from './LoyaltyBonusRequest';

const C = '11111111-2222-4333-8444-555555555555';
type Call = { url: string; method: string; body: any };
let calls: Call[]; let history: any[]; let preview: any;
beforeEach(() => {
  calls = []; history = [];
  preview = { customerId: C, customerName: 'Ava Kim', target: 'global', currentPoints: 0, points: 10, pointsAfter: 10, tokenCostCents: 100, walletAvailableCents: 50 };
  globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
    const u = String(url); const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.includes('/bonus-requests/preview')) return ok({ ...preview, points: Number(new URL(u, 'http://x').searchParams.get('points')), pointsAfter: Number(new URL(u, 'http://x').searchParams.get('points')) });
    if (method === 'POST' && /\/bonus-requests$/.test(u)) { history = [{ id: 'r1', status: 'pending', points: 10, reason: 'Service recovery', createdAt: '2026-11-05T15:00:00Z', target: 'global' }]; return ok({ created: true, request: { id: 'r1' } }); }
    if (u.includes('/bonus-requests')) return ok({ items: history, total: history.length, page: 1, pageSize: 10 });
    return ok({});
  }) as any;
});

describe('Request Bonus Points', () => {
  it('current points are read-only; only a positive whole number can be typed; no "new balance" field exists', async () => {
    render(<LoyaltyBonusRequest customerId={C} currentPoints={0} canRequest />);
    expect(await screen.findByTestId('lb-hist-empty')).toBeInTheDocument();
    expect(screen.queryByText(/new balance/i)).toBeNull();
    const input = screen.getByTestId('lb-points') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-25' } });
    expect(input.value).toBe('25');   // the minus sign cannot be entered
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(input.value).toBe('15');
  });
  it('shows the server preview (after 10, 1.00 token, wallet short) and sends customer + points + reason only', async () => {
    render(<LoyaltyBonusRequest customerId={C} currentPoints={0} canRequest />);
    fireEvent.change(await screen.findByTestId('lb-points'), { target: { value: '10' } });
    const pv = await screen.findByTestId('lb-preview');
    expect(pv).toHaveTextContent('10 pts'); expect(pv).toHaveTextContent('1.00 tokens');
    expect(screen.getByTestId('lb-short')).toHaveTextContent('0.50');
    fireEvent.click(screen.getByTestId('lb-send'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toMatch(/\/pos\/loyalty\/bonus-requests$/);
    expect(post.body).toEqual({ customerId: C, points: 10, reason: 'Service recovery' });
    expect(await screen.findByTestId('lb-done')).toHaveTextContent(/waiting for the owner/);
    expect(await screen.findByTestId('lb-waiting')).toBeInTheDocument();       // one waiting request at a time
    expect(screen.getByTestId('lb-send')).toBeDisabled();
    expect(screen.getByTestId('lb-hist-status')).toHaveTextContent('Waiting for owner');
  });
  it('a failed approval for lack of tokens says so in the history; a failed history load is not shown as "none"', async () => {
    history = [{ id: 'r2', status: 'execution_failed', failureCode: 'LOYALTY_BONUS_NEEDS_FUNDING', points: 30, reason: 'Apology', createdAt: '2026-11-05T15:00:00Z', target: 'global' }];
    const { unmount } = render(<LoyaltyBonusRequest customerId={C} currentPoints={0} canRequest />);
    expect(await screen.findByText(/not enough salon tokens/)).toBeInTheDocument();
    expect(screen.getByTestId('lb-hist-status')).toHaveTextContent('Not completed');
    unmount();
    (globalThis.fetch as any).mockImplementation(async (url: any) => (String(url).includes('/bonus-requests') && !String(url).includes('preview')
      ? { ok: false, status: 503, json: async () => ({ message: 'down' }), headers: { get: () => null } } : { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }) as any);
    render(<LoyaltyBonusRequest customerId={C} currentPoints={0} canRequest />);
    expect(await screen.findByTestId('lb-hist-error')).toBeInTheDocument();
    expect(screen.queryByTestId('lb-hist-empty')).toBeNull();
  });
  it('without the request permission the form is read-only', async () => {
    render(<LoyaltyBonusRequest customerId={C} currentPoints={4} canRequest={false} />);
    expect(screen.getByTestId('lb-points')).toBeDisabled();
    expect(screen.getByTestId('lb-send')).toBeDisabled();
  });
});
