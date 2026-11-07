// Fiserv master build §8C P0: iOS native without the plugin → no capture call, no approved result.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { cap, nativeCapture } = vi.hoisted(() => ({ cap: { isNativePlatform: vi.fn(), getPlatform: vi.fn(), isPluginAvailable: vi.fn() }, nativeCapture: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: cap, registerPlugin: () => ({ capture: nativeCapture }) }));

import { isTapToPayAvailable, captureTapToPay, TapToPayNotProvisionedError } from './tapToPay';

beforeEach(() => { vi.clearAllMocks(); });

describe('tapToPay bridge', () => {
  it('native iOS WITHOUT the plugin is not available and capture rejects without calling native', async () => {
    cap.isNativePlatform.mockReturnValue(true); cap.getPlatform.mockReturnValue('ios'); cap.isPluginAvailable.mockReturnValue(false);
    expect(isTapToPayAvailable()).toBe(false);
    await expect(captureTapToPay({ amountCents: 100, idempotencyKey: 'k' })).rejects.toBeInstanceOf(TapToPayNotProvisionedError);
    expect(nativeCapture).not.toHaveBeenCalled();
  });

  it('web build is not available and never approves', async () => {
    cap.isNativePlatform.mockReturnValue(false); cap.getPlatform.mockReturnValue('web'); cap.isPluginAvailable.mockReturnValue(false);
    expect(isTapToPayAvailable()).toBe(false);
    await expect(captureTapToPay({ amountCents: 100, idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'TAP_NOT_PROVISIONED' });
  });

  it('Android with a plugin registered is still not available (iPhone only)', () => {
    cap.isNativePlatform.mockReturnValue(true); cap.getPlatform.mockReturnValue('android'); cap.isPluginAvailable.mockReturnValue(true);
    expect(isTapToPayAvailable()).toBe(false);
  });

  it('native iOS WITH the plugin passes the native result through unchanged', async () => {
    cap.isNativePlatform.mockReturnValue(true); cap.getPlatform.mockReturnValue('ios'); cap.isPluginAvailable.mockReturnValue(true);
    nativeCapture.mockResolvedValue({ outcome: 'declined' });
    expect(isTapToPayAvailable()).toBe(true);
    await expect(captureTapToPay({ amountCents: 100, idempotencyKey: 'k' })).resolves.toEqual({ outcome: 'declined' });
    expect(nativeCapture).toHaveBeenCalledWith({ amountCents: 100, idempotencyKey: 'k' });
  });
});
