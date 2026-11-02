// principal.branch.test.tsx — mandate §120: after the More screen switches location, the APP-level principal moves to the
// new branch (so every screen's data re-keys to it and the phone re-registers there); the name the server gave at sign-in stays.
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useBranchSwitchedPrincipal } from './principal';

describe('useBranchSwitchedPrincipal', () => {
  it('merges the re-signed principal from aps:branch-switched into the signed-in one', () => {
    const { result } = renderHook(() => { const [p, setP] = useState<any>({ userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: [], fullName: 'Dana' }); useBranchSwitchedPrincipal(setP); return p; });
    act(() => { window.dispatchEvent(new CustomEvent('aps:branch-switched', { detail: { userId: 'u1', tenantId: 't1', branchId: 'b2', role: 'OWNER', permissions: ['x'] } })); });
    expect(result.current).toEqual({ userId: 'u1', tenantId: 't1', branchId: 'b2', role: 'OWNER', permissions: ['x'], fullName: 'Dana' });
  });
  it('ignores an event for another person or with no branch', () => {
    const start = { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: [] };
    const { result } = renderHook(() => { const [p, setP] = useState<any>(start); useBranchSwitchedPrincipal(setP); return p; });
    act(() => { window.dispatchEvent(new CustomEvent('aps:branch-switched', { detail: { userId: 'u2', branchId: 'b2' } })); });
    act(() => { window.dispatchEvent(new CustomEvent('aps:branch-switched', { detail: { userId: 'u1', branchId: null } })); });
    expect(result.current).toBe(start);
  });
});
