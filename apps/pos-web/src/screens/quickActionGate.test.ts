import { describe, it, expect } from 'vitest';
import { quickActionGate } from './quickActionGate';
import { requiredPermissions, allNavItems } from '../shell/tenant-nav';

const only = (keys: string[]) => (p: string) => keys.includes(p);
describe('quickActionGate', () => {
  it('uses the permission keys of the sidebar item that owns the route (query ignored, nested route → its parent item)', () => {
    const checkout = allNavItems().find((i) => i.route === '/checkout')!;
    expect(quickActionGate('/checkout', () => true)).toMatchObject({ ok: true, owner: checkout.id, required: requiredPermissions(checkout), missing: [] });
    const queue = quickActionGate('/queue?assign=1', only([]));
    expect(queue.owner).toBe('queue'); expect(queue.ok).toBe(false); expect(queue.missing).toEqual(requiredPermissions({ id: 'queue' }));
    expect(quickActionGate('/booking/walk-in', only([])).owner).toBe('booking');
  });
  it('enabled exactly when every required key is held; names only the missing ones', () => {
    const req = requiredPermissions({ id: 'checkin' });
    expect(req.length).toBeGreaterThan(1);
    const g = quickActionGate('/check-in', only([req[0]]));
    expect(g.ok).toBe(false); expect(g.missing).toEqual(req.slice(1));
    expect(quickActionGate('/check-in', only(req)).ok).toBe(true);
  });
});
