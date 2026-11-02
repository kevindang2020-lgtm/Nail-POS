// customerScheduleProposalsApi.test.ts — contract §3.1 customer routes, through the real client.
import { describe, it, expect, vi, beforeEach } from 'vitest';
// BUILD_PLAN Phase 13: no mobile-sdk mock — the real transport runs (web: no bearer), against the stubbed fetch below
import { customerScheduleProposalsApi as api, isPendingProposal } from './customerScheduleProposalsApi';

let calls: { url: string; method: string; body?: any }[];
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (u: any, init?: any) => { calls.push({ url: String(u), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined }); return { ok: true, status: 200, json: async () => ({ items: [{ id: 'p1' }], proposal: { id: 'p1' } }), headers: { get: () => null } } as any; }) as any;
});

describe('customerScheduleProposalsApi', () => {
  it('lists, approves and rejects with expectedVersion', async () => {
    expect((await api.list()).map((p) => p.id)).toEqual(['p1']);
    expect(calls[0]).toMatchObject({ url: '/api/v1/customer/schedule-proposals', method: 'GET' });
    await api.approve('p/1', 3);
    expect(calls[1]).toEqual({ url: '/api/v1/customer/schedule-proposals/p%2F1/approve', method: 'POST', body: { expectedVersion: 3 } });
    await api.reject('p1', 4);
    expect(calls[2]).toEqual({ url: '/api/v1/customer/schedule-proposals/p1/reject', method: 'POST', body: { expectedVersion: 4 } });
  });
  it('pending = proposed or customer_notified', () => {
    expect(isPendingProposal({ status: 'proposed' })).toBe(true);
    expect(isPendingProposal({ status: 'customer_notified' })).toBe(true);
    expect(isPendingProposal({ status: 'customer_approved' })).toBe(false);
    expect(isPendingProposal({ status: 'expired' })).toBe(false);
  });
});
