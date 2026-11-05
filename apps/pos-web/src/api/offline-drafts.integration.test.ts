// offline-drafts.integration.test.ts — the real chain: with the device offline, the offline layer refuses the notes save
// (503, code OFFLINE) and the screen's isOfflineFailure recognises THAT error — so the note becomes a draft instead of a
// generic "could not save".
import { describe, it, expect, afterEach } from 'vitest';
import { installOfflineReadCache } from './offline-read-cache';
import { posCustomersApi } from './posCustomersApi';
import { isOfflineFailure } from './offline-drafts';

let off: () => void = () => {};
afterEach(() => { off(); Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true }); });

describe('offline notes save → recognised as offline', () => {
  it('the real posCustomersApi.setNotes error while offline is an offline failure', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    off = installOfflineReadCache(window as any);
    let err: any = null;
    try { await posCustomersApi.setNotes('c1', { salonNotes: 'x' } as any); } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(isOfflineFailure(err)).toBe(true);
  });
  it('a permission refusal while ONLINE is not mistaken for offline', () => {
    expect(isOfflineFailure({ status: 403, message: 'Missing permission' })).toBe(false);
  });
});
