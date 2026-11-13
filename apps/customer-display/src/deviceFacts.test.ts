// round 10 (Tablets 02): the display reports only what its browser exposes — OS from the user agent, battery from the Battery
// Status API — and nothing when it cannot read them (never a guessed value).
import { describe, it, expect } from 'vitest';
import { osFromUserAgent, readDeviceFacts } from './useHeartbeat';

describe('device health facts', () => {
  it('names the OS from the user agent', () => {
    expect(osFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-T220) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('Android 13');
    expect(osFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15')).toBe('iPadOS 17.4');
    expect(osFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows 10/11');
    expect(osFromUserAgent('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')).toBe('ChromeOS');
    expect(osFromUserAgent('', 'Android')).toBe('Android');
    expect(osFromUserAgent('', undefined)).toBeUndefined();
  });
  it('reads the battery when the API exists; omits it when it does not or fails', async () => {
    expect(await readDeviceFacts({ userAgent: 'Linux; Android 14;', getBattery: async () => ({ level: 0.42, charging: false }) })).toEqual({ os: 'Android 14', battery: { percent: 42, charging: false } });
    expect(await readDeviceFacts({ userAgent: 'Linux; Android 14;' })).toEqual({ os: 'Android 14' });
    expect(await readDeviceFacts({ userAgent: '', getBattery: async () => { throw new Error('denied'); } })).toEqual({});
    expect(await readDeviceFacts({ userAgent: '', getBattery: async () => ({ level: Number.NaN, charging: true }) })).toEqual({});
    expect(await readDeviceFacts(undefined)).toEqual({});
  });
});
