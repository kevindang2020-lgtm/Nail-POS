// push-unregister.test.ts — signing out must stop the pushes.
//
// == THE BUG THIS PINS SHUT ================================================================================
//
// `techApi.unregisterPush(token)` and `POST /push/unregister` (which revokes the row) both existed for as long as
// push has. NOTHING CALLED EITHER, and lib/push.ts had no unregister function to call them from.
//
// So `logout()` cleared the session cookie, cleared the Keychain — with a comment reading *"A token left in the
// Keychain outlives the sign-out — exactly what someone with the device would look for"* — and then left the PUSH
// token registered.
//
// Same threat, one line apart. A technician signed out and her phone kept receiving New-Assignment pushes for that
// salon: customer names, appointment details, queue alerts, on the lock screen of a device she had signed out of.
// A device she may have handed back to the salon, sold, or lost.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const unregisterPush = vi.fn(async (_token: string) => ({ ok: true as const }));
vi.mock('../api/techApi', () => ({ techApi: { unregisterPush: (t: string) => unregisterPush(t), registerPush: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));

import { unregisterPushToken } from './push';

const KEY = 'aps.push.token';

describe('signing out hands the push token back', () => {
  beforeEach(() => { unregisterPush.mockClear(); localStorage.clear(); });

  it('revokes the token this device registered with', async () => {
    localStorage.setItem(KEY, 'device-token-abc');

    await unregisterPushToken();

    expect(unregisterPush).toHaveBeenCalledWith('device-token-abc');
    expect(localStorage.getItem(KEY)).toBeNull();   // and it is gone from the device
  });

  it('the token SURVIVES an app restart, or there is nothing left to revoke WITH', async () => {
    // The module reloads on every launch. A token registered yesterday must still be revocable when she signs out
    // today — which is why it is persisted rather than held in a variable.
    localStorage.setItem(KEY, 'token-from-a-previous-launch');
    await unregisterPushToken();
    expect(unregisterPush).toHaveBeenCalledWith('token-from-a-previous-launch');
  });

  it('a FAILED revoke keeps the token — a retry beats losing the only handle we have on it', async () => {
    localStorage.setItem(KEY, 'device-token-abc');
    unregisterPush.mockRejectedValueOnce(new Error('offline'));

    await expect(unregisterPushToken()).resolves.toBeUndefined();   // never throws — must not trap her in a session

    expect(localStorage.getItem(KEY)).toBe('device-token-abc');     // still there, so the next sign-out tries again
  });

  it('no token registered → nothing to revoke, and no call is made', async () => {
    await unregisterPushToken();
    expect(unregisterPush).not.toHaveBeenCalled();
  });
});
