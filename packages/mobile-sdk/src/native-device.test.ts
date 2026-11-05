// native-device.test — Constitution 12 §144: the app names its device at login; the id is per-install and persists.
import { describe, it, expect, beforeEach } from 'vitest';
import { setSecureStore, InMemorySecureStore, deviceId, deviceIdentity, devicePlatform, deviceName, adoptDeviceId } from './native-auth';

describe('device identity', () => {
  beforeEach(() => setSecureStore(new InMemorySecureStore()));
  it('mints one random 32-hex id per install and returns the SAME one afterwards', async () => {
    const a = await deviceId(); const b = await deviceId();
    expect(a).toMatch(/^[0-9a-f]{32}$/); expect(b).toBe(a);
  });
  it('a fresh install (new store) gets a DIFFERENT id — the id is not derived from anything', async () => {
    const a = await deviceId(); setSecureStore(new InMemorySecureStore()); expect(await deviceId()).not.toBe(a);
  });
  it('the identity carries a readable name and a platform, capped in length', async () => {
    const d = await deviceIdentity('App');
    expect(d.name).toMatch(/App$/); expect(d.name.length).toBeLessThanOrEqual(80); expect(['ios', 'android', 'web']).toContain(d.platform);
    expect(deviceName('x'.repeat(200)).length).toBe(80);
  });
  it('a broken secure store yields a null id — login still proceeds, unnamed', async () => {
    setSecureStore({ get: async () => { throw new Error('keychain down'); }, set: async () => { throw new Error('keychain down'); }, remove: async () => undefined });
    expect(await deviceId()).toBeNull();
    expect((await deviceIdentity('App')).name).toMatch(/App/);
  });
  it('platform detection is from the user agent, defaulting to web', () => expect(['ios', 'android', 'web']).toContain(devicePlatform()));
  it('M6-4: an adopted id (the payment device id) is THE id — login body and X-Device-ID name it; null returns to the per-install id', async () => {
    const own = await deviceId();
    adoptDeviceId('3f0b7c1e-9a2d-4e5f-8a6b-1c2d3e4f5a6b');
    expect(await deviceId()).toBe('3f0b7c1e-9a2d-4e5f-8a6b-1c2d3e4f5a6b');
    expect((await deviceIdentity('Pay')).id).toBe('3f0b7c1e-9a2d-4e5f-8a6b-1c2d3e4f5a6b');
    adoptDeviceId('bad id!'); expect(await deviceId()).toBe(own);   // a malformed id is never adopted
    adoptDeviceId(null); expect(await deviceId()).toBe(own);
  });
});
