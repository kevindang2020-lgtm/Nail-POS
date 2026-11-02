// owner-offline.test.tsx — BUILD_PLAN Phase 13 (Constitution 6 §14–19): the migrated Owner screens under the query layer.
// Cached Alerts / Approvals render offline with "last updated"; an approval decision sends ONE Idempotency-Key, reuses it
// after a LOST answer (so the server answers with the first result) and is refused offline — never queued, because a
// decision can execute a refund.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MobileQueryProvider, MemoryKvStore, createAppQueryClient, persistNow, scopedKey, resetNetworkState, type QueryScope } from '@aipowersalon/mobile-sdk';

const api = vi.hoisted(() => ({ pending: vi.fn(), decide: vi.fn(), policies: vi.fn() }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn(), openPayroll: vi.fn(), openAlerts: vi.fn() }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('../api/ownerApi', () => ({ ownerMoreApi: { alerts: vi.fn() }, ownerApprovalsApi: { get: vi.fn() } }));
vi.mock('../api/ownerApprovalRequestsApi', () => ({ ownerApprovalRequestsApi: api }));
vi.mock('./OwnerCommunityCard', () => ({ OwnerCommunityCard: () => null }));

import { ownerMoreApi, ownerApprovalsApi } from '../api/ownerApi';
import { AlertsScreen } from './AlertsScreen';
import { ApprovalCenterScreen } from './ApprovalCenterScreen';
import { OwnerApprovalRequestsCard } from './OwnerApprovalRequestsCard';

const S: QueryScope = { realm: 'tenant', tenantId: 't-1', branchId: null, userId: 'o-1' };
const offlineErr = () => Object.assign(new TypeError('Failed to fetch'), { status: 0, code: 'NETWORK_ERROR' });
function setOnline(v: boolean) { Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v }); window.dispatchEvent(new Event(v ? 'online' : 'offline')); }
let store: MemoryKvStore;
async function seed(key: unknown[], data: unknown) {
  const c = createAppQueryClient(); c.setQueryDefaults(scopedKey(S, ...key), { meta: { persist: true } }); c.setQueryData(scopedKey(S, ...key), data);
  await persistNow(c, { app: 'owner', store }, S);
}
const wrap = (el: JSX.Element) => <MobileQueryProvider app="owner" scope={S} send={async () => ({})} store={store}>{el}</MobileQueryProvider>;
const req = { id: 'a1', kind: 'refund', status: 'pending', title: 'Refund $80.00', amountCents: 8000, requestedByName: 'Fran', branchName: 'Main', reason: 'r', canDecide: true, whyNot: null, version: 1, payload: {} };

beforeEach(() => { vi.clearAllMocks(); store = new MemoryKvStore(); setOnline(true); resetNetworkState(); api.pending.mockResolvedValue([req]); api.policies.mockResolvedValue([]); });
afterEach(() => { cleanup(); setOnline(true); });

describe('Alerts + Approvals (migrated) offline', () => {
  it('Alerts: the cached list renders offline with "last updated"', async () => {
    await seed(['owner', 'alerts', 'all'], [{ id: 'x', title: 'Low stock: Gel top coat', status: 'new', severity: 'high', createdAt: '2026-10-08T12:00:00Z', message: 'm' }]);
    setOnline(false); (ownerMoreApi.alerts as any).mockRejectedValue(offlineErr());
    render(wrap(<AlertsScreen />));
    expect(await screen.findByText(/Low stock: Gel top coat/)).toBeInTheDocument();
    expect(screen.getByText(/You’re offline — showing saved data\. Last updated/)).toBeInTheDocument();
  });
  it('Approvals: the cached payroll queue renders offline', async () => {
    await seed(['owner', 'approvals'], { counts: { payrollToApprove: 1, payrollToLock: 0 }, items: [{ periodId: 'p4', label: 'Period p4', kind: 'approve', status: 'pending', technicianCount: 2, totalCents: 1000 }] });
    setOnline(false); (ownerApprovalsApi.get as any).mockRejectedValue(offlineErr()); api.pending.mockRejectedValue(offlineErr());
    render(wrap(<ApprovalCenterScreen />));
    expect(await screen.findByText(/1 pending/)).toBeInTheDocument();
    expect(screen.getAllByText(/You’re offline/).length).toBeGreaterThan(0);
  });
});

describe('approval decisions: Idempotency-Key, online-only', () => {
  it('a lost answer → the next tap reuses the SAME key; a definitive answer retires it', async () => {
    api.decide.mockRejectedValueOnce(Object.assign(new Error('timed out'), { status: 0, code: 'NETWORK_TIMEOUT' })).mockResolvedValueOnce({ ...req, status: 'executed', version: 2 });
    render(wrap(<OwnerApprovalRequestsCard />));
    fireEvent.click(await screen.findByRole('button', { name: /Approve: Refund/ }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve: Refund/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Approve: Refund/ }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledTimes(2));
    const [k1, k2] = api.decide.mock.calls.map((c: any[]) => c[2].idempotencyKey);
    expect(k1).toBe(k2);
  });
  it('a 409 answer retires the key (the next tap is a new attempt)', async () => {
    api.decide.mockRejectedValueOnce({ status: 409, code: 'version_conflict', message: 'x' }).mockResolvedValueOnce({ ...req, status: 'executed' });
    render(wrap(<OwnerApprovalRequestsCard />));
    fireEvent.click(await screen.findByRole('button', { name: /Approve: Refund/ }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve: Refund/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Approve: Refund/ }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledTimes(2));
    expect(api.decide.mock.calls[0][2].idempotencyKey).not.toBe(api.decide.mock.calls[1][2].idempotencyKey);
  });
  it('offline: refused up front, nothing sent, nothing queued', async () => {
    render(wrap(<OwnerApprovalRequestsCard />));
    const btn = await screen.findByRole('button', { name: /Approve: Refund/ });
    setOnline(false);
    fireEvent.click(btn);
    expect(await screen.findByText(/You’re offline\. Approvals need a live connection/)).toBeInTheDocument();
    expect(api.decide).not.toHaveBeenCalled();
    expect(await store.keys()).not.toContainEqual(expect.stringContaining('aps.journal'));
  });
});
