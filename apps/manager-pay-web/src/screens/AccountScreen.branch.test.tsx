// AccountScreen.branch.test.tsx — mandate §119–§121 on the More screen: an owner with several locations switches branch
// here through the platform's ONE branch switch (GET /auth/branches lists only the branches this person may enter — §121 —
// and POST /auth/select-branch re-scopes the session); while a payment on this phone is active the switch is refused —
// "finish or cancel first" (§120) — locally (the in-flight intent this install remembers) AND by the server (409).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountScreen } from './AccountScreen';
import { DEVICE_ID } from '../util/session';
import { rememberActiveAttempt, clearActiveAttempt } from '../util/activeAttempt';

vi.mock('../api/authApi', () => ({ authApi: { me: vi.fn(), logout: vi.fn(), branches: vi.fn(), selectBranch: vi.fn() } }));
vi.mock('../api/mobileCheckoutApi', () => ({ mobileCheckoutApi: { readiness: vi.fn(), capability: vi.fn(), disableDevice: vi.fn(), myDevices: vi.fn(), approveDevice: vi.fn(), revokeDevice: vi.fn() } }));
import { authApi } from '../api/authApi';
import { mobileCheckoutApi } from '../api/mobileCheckoutApi';

const owner = { userId: 'u_owner', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: [], fullName: 'Dana Owner' };
const TWO = [{ id: 'b1', isActive: true, name: 'Cherry Hill', city: 'Cherry Hill' }, { id: 'b2', isActive: true, name: 'Merchantville', city: 'Merchantville' }];

describe('More → Branch (§120–§121)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearActiveAttempt();
    (authApi.me as any).mockResolvedValue(owner);
    (mobileCheckoutApi.readiness as any).mockResolvedValue({ overall: 'ready', canTakePayment: true, checks: [] });
    (mobileCheckoutApi.capability as any).mockResolvedValue(null);
    (mobileCheckoutApi.myDevices as any).mockResolvedValue([]);
  });

  it('shows the current location by name and offers the owner’s other location; switching re-scopes the app', async () => {
    (authApi.branches as any).mockResolvedValue(TWO);
    (authApi.selectBranch as any).mockResolvedValue({ ok: true, principal: { ...owner, branchId: 'b2' } });
    const seen: any[] = [];
    const onSwitched = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('aps:branch-switched', onSwitched);
    try {
      render(<AccountScreen />);
      expect(await screen.findByText('Cherry Hill')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Switch to Merchantville' }));
      expect(authApi.selectBranch).not.toHaveBeenCalled();                 // an inline confirm first — never a stray tap
      fireEvent.click(await screen.findByRole('button', { name: 'Switch location' }));
      await waitFor(() => expect(authApi.selectBranch).toHaveBeenCalledWith('b2', DEVICE_ID));
      await waitFor(() => expect(seen).toEqual([{ ...owner, branchId: 'b2' }]));
      expect(await screen.findByText('Now taking payments at Merchantville.')).toBeInTheDocument();
    } finally { window.removeEventListener('aps:branch-switched', onSwitched); }
  });

  it('a payment still in flight on this phone: refused locally with "finish or cancel first" — the server is not asked', async () => {
    (authApi.branches as any).mockResolvedValue(TWO);
    rememberActiveAttempt({ ticketId: 'tk1', idempotencyKey: 'k1', amountCents: 4500 });
    render(<AccountScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Merchantville' }));
    expect(await screen.findByText('Finish or cancel the active payment before switching location.')).toBeInTheDocument();
    expect(authApi.selectBranch).not.toHaveBeenCalled();
  });

  it('the server refuses (a claimed checkout this phone holds) → its message is shown and nothing switches', async () => {
    (authApi.branches as any).mockResolvedValue(TWO);
    (authApi.selectBranch as any).mockRejectedValue(Object.assign(new Error('Finish or cancel the active payment on this phone before switching location.'), { status: 409, code: 'PAYMENT_IN_PROGRESS' }));
    const seen: any[] = [];
    const onSwitched = (e: Event) => seen.push(e);
    window.addEventListener('aps:branch-switched', onSwitched);
    try {
      render(<AccountScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Switch to Merchantville' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Switch location' }));
      expect(await screen.findByText('Finish or cancel the active payment on this phone before switching location.')).toBeInTheDocument();
      expect(seen).toHaveLength(0);
    } finally { window.removeEventListener('aps:branch-switched', onSwitched); }
  });

  it('§121 a manager authorised for one location sees only it — no switch offered', async () => {
    (authApi.me as any).mockResolvedValue({ ...owner, role: 'MANAGER' });
    (authApi.branches as any).mockResolvedValue([TWO[0]]);
    render(<AccountScreen />);
    expect(await screen.findByText('Cherry Hill')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to/ })).toBeNull();
  });

  it('an inactive location is listed honestly but cannot be chosen', async () => {
    (authApi.branches as any).mockResolvedValue([TWO[0], { id: 'b3', isActive: false, name: 'Haddonfield' }]);
    render(<AccountScreen />);
    expect(await screen.findByText('Haddonfield · Inactive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to Haddonfield' })).toBeNull();
  });
});
