import { describe, it, expect } from 'vitest';
import { hardwareReadiness, type HwEnv } from './hardwareReadiness';

// extras Device Assignments 08 — the checklist states only what this browser measures; nothing is fabricated.
const sunmi = { innerW: 1920, innerH: 952, screenW: 1920, screenH: 1080, dpr: 1, touch: true, displayMode: 'browser' as const };
const chromeAndroid: HwEnv = { userAgent: 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', brands: ['Chromium', 'Google Chrome', 'Not?A_Brand'], platform: 'Android', online: true, realtime: 'CONNECTED' };
const byId = (cs: ReturnType<typeof hardwareReadiness>) => Object.fromEntries(cs.map((c) => [c.id, c]));

describe('hardwareReadiness (pure)', () => {
  it('the SUNMI FLEX 3 in Chrome, online and connected: every measurable check is OK; agent and peripherals are never claimed', () => {
    const c = byId(hardwareReadiness(sunmi, chromeAndroid));
    expect(c.screen).toMatchObject({ state: 'ok', value: '1920×1080 @1x' });
    expect(c.viewport).toMatchObject({ state: 'ok', value: '1920×952', code: 'density.compact' });
    expect(c.touch.state).toBe('ok');
    expect(c.browser).toMatchObject({ state: 'ok', value: 'Google Chrome' });
    expect(c.os).toMatchObject({ state: 'info', value: 'Android' });
    expect(c.network.state).toBe('ok');
    expect(c.reconnect).toMatchObject({ state: 'ok', code: 'rt.CONNECTED' });
    expect(c.agent).toMatchObject({ state: 'not_reported', value: '' });
    expect(c.peripherals).toMatchObject({ state: 'not_reported', value: '' });
  });
  it('a small laptop in Safari without touch, offline and reconnecting: each is a Check, not OK', () => {
    const c = byId(hardwareReadiness({ innerW: 1366, innerH: 700, screenW: 1366, screenH: 768, dpr: 2, touch: false, displayMode: 'browser' },
      { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', brands: null, platform: null, online: false, realtime: 'RECONNECTING' }));
    expect(c.screen.state).toBe('warn');
    expect(c.viewport).toMatchObject({ state: 'warn', code: 'density.tight' });
    expect(c.touch.state).toBe('warn');
    expect(c.browser).toMatchObject({ state: 'warn', value: 'Safari' });
    expect(c.os).toMatchObject({ state: 'info', value: '', code: 'os.macos' });
    expect(c.network.state).toBe('warn');
    expect(c.reconnect).toMatchObject({ state: 'warn', code: 'rt.RECONNECTING' });
  });
  it('a browser that reports nothing says so — never a guessed name', () => {
    const c = byId(hardwareReadiness(sunmi, { userAgent: '', brands: null, platform: null, online: true, realtime: 'CONNECTED' }));
    expect(c.browser).toMatchObject({ state: 'not_reported', value: '' });
    expect(c.os).toMatchObject({ state: 'not_reported', value: '' });
  });
});
