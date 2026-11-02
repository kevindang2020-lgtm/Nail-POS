// idle-lock.test.tsx — Functional Decision 35 + Kevin's Oct 12 2026 rule ("POS auto-lock is on by default at 60 minutes, also
// locked on the server, with a full sign-in after 8 hours locked"): auto-lock after the idle minutes (on by default, 60 — the
// device may choose shorter, never longer than the salon), quick PIN unlock, full sign-in once a lock is older than 8 hours.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { readIdleLockSettings, writeIdleLockSettings, lockState, markLocked, DEFAULT_IDLE_LOCK_MINUTES, LONG_INACTIVITY_HOURS, writeSalonLock, readSalonLock, effectiveIdleLock } from './idle-lock';
import { useIdleLock } from './useIdleLock';
import { POSSecuritySettingsModal } from './POSSecuritySettingsModal';
import { SESSION_LOCKED_EVENT, installSessionLockWatch } from '../api/session-lock-watch';
const post = vi.fn(async (..._a: any[]) => ({ success: true }));
const status = (over: Record<string, unknown> = {}) => ({ posSession: true, salon: { enabled: true, minutes: 60 }, locked: false, lockedAt: null, fullSignInAt: null, idleLockAt: null, fullSignInAfterHours: 8, ...over });
const get = vi.fn(async (..._a: any[]): Promise<any> => status());
vi.mock('../api/client', () => ({ api: { post: (...a: any[]) => post(...a), get: (...a: any[]) => get(...a) } }));

beforeEach(() => { localStorage.clear(); post.mockClear(); get.mockReset(); get.mockImplementation(async () => status()); });
afterEach(() => { vi.useRealTimers(); });

describe('idle-lock settings', () => {
  it('a device that never chose is ON at 60 minutes (Kevin, Oct 12); "off" is remembered; only listed minutes are accepted', () => {
    expect(DEFAULT_IDLE_LOCK_MINUTES).toBe(60);
    expect(readIdleLockSettings(localStorage)).toEqual({ enabled: true, minutes: 60 });
    writeIdleLockSettings(localStorage, { enabled: false });
    expect(readIdleLockSettings(localStorage).enabled).toBe(false);
    writeIdleLockSettings(localStorage, { minutes: 15 });
    expect(readIdleLockSettings(localStorage)).toEqual({ enabled: false, minutes: 15 });
    writeIdleLockSettings(localStorage, { minutes: 7 });                 // not a choice → unchanged
    expect(readIdleLockSettings(localStorage).minutes).toBe(15);
    localStorage.setItem('auto_lock_minutes', '9999');
    expect(readIdleLockSettings(localStorage).minutes).toBe(DEFAULT_IDLE_LOCK_MINUTES);
  });
  it('a lock is quick-PIN until it is older than the long-inactivity threshold; a lock with no time needs full sign-in', () => {
    const t0 = Date.parse('2026-10-02T22:00:00Z');
    expect(lockState(localStorage, t0)).toBe('unlocked');
    markLocked(localStorage, t0);
    expect(lockState(localStorage, t0 + LONG_INACTIVITY_HOURS * 3_600_000)).toBe('quick_pin');
    expect(lockState(localStorage, t0 + LONG_INACTIVITY_HOURS * 3_600_000 + 1)).toBe('full_sign_in');
    localStorage.removeItem('pos_locked_at');                              // a lock written before this change
    expect(lockState(localStorage, t0)).toBe('full_sign_in');
  });
});

describe('useIdleLock', () => {
  it('locks after 60 idle minutes by default — not after 5 — and activity restarts the clock', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIdleLock(() => {}));
    act(() => { vi.advanceTimersByTime(59 * 60_000); });
    expect(result.current.isLocked).toBe(false);
    act(() => { window.dispatchEvent(new Event('keydown')); vi.advanceTimersByTime(59 * 60_000); });
    expect(result.current.isLocked).toBe(false);                          // the keypress restarted the 60 minutes
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(result.current.isLocked).toBe(true);
    expect(localStorage.getItem('pos_locked_at')).toBeTruthy();
  });
  it('uses a shorter device choice; a device cannot switch the salon\'s lock off; only with the salon\'s lock off may it', () => {
    vi.useFakeTimers();
    writeIdleLockSettings(localStorage, { minutes: 1 });
    const a = renderHook(() => useIdleLock(() => {}));
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(a.result.current.isLocked).toBe(true);
    a.unmount(); localStorage.clear();
    writeIdleLockSettings(localStorage, { enabled: false });
    const b = renderHook(() => useIdleLock(() => {}));
    act(() => { vi.advanceTimersByTime(60 * 60_000 + 1000); });
    expect(b.result.current.isLocked).toBe(true);                         // the salon's 60 minutes still apply
    b.unmount(); localStorage.clear();
    writeIdleLockSettings(localStorage, { enabled: false });
    writeSalonLock(localStorage, { enabled: false, minutes: 60 });
    get.mockImplementation(async () => status({ posSession: true, salon: { enabled: false, minutes: 60 } }));
    const c = renderHook(() => useIdleLock(() => {}));
    act(() => { vi.advanceTimersByTime(5 * 60 * 60_000); });
    expect(c.result.current.isLocked).toBe(false);
  });
  it('a lock that outlives the threshold ends the session (full sign-in); unlocking clears it', () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-02T22:00:00Z'));
    const signOut = vi.fn();
    markLocked(localStorage, Date.now());
    const { result } = renderHook(() => useIdleLock(signOut));
    expect(result.current.isLocked).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(LONG_INACTIVITY_HOURS * 3_600_000 + 60_000); });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('pos_locked')).toBeNull();
  });
  it('reopening the app the next morning on a screen locked last night asks for full sign-in at once', () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-03T09:00:00Z'));
    markLocked(localStorage, Date.parse('2026-10-02T22:00:00Z'));
    const signOut = vi.fn();
    renderHook(() => useIdleLock(signOut));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe('Security settings — auto-lock minutes', () => {
  it('shows the real setting and saves a new choice', () => {
    render(<POSSecuritySettingsModal onClose={() => {}} />);
    const sel = screen.getByLabelText('Auto-lock after') as HTMLSelectElement;
    expect(sel.value).toBe('60');
    fireEvent.change(sel, { target: { value: '10' } });
    expect(readIdleLockSettings(localStorage).minutes).toBe(10);
    expect(screen.queryByText(/after 1 minute of inactivity/)).toBeNull();
  });
});

describe('server-side lock (Decision 35)', () => {
  it('when the screen locks, the session is locked on the server too', () => {
    vi.useFakeTimers();
    renderHook(() => useIdleLock(() => {}));
    act(() => { vi.advanceTimersByTime(60 * 60_000 + 1000); });
    expect(post).toHaveBeenCalledWith('/auth/lock');
  });
  it('a 423 from the server (another tab locked this session) locks this screen', async () => {
    const { result } = renderHook(() => useIdleLock(() => {}));
    expect(result.current.isLocked).toBe(false);
    act(() => { window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT)); });
    expect(result.current.isLocked).toBe(true);
    expect(lockState(localStorage, Date.now())).toBe('quick_pin');
  });
  it('the fetch watch turns any 423 response into that event, and leaves other responses alone', async () => {
    const seen: number[] = [];
    const orig = window.fetch;
    let status = 200;
    (window as any).fetch = vi.fn(async () => new Response('{}', { status }));
    const off = installSessionLockWatch(window as any);
    window.addEventListener(SESSION_LOCKED_EVENT, () => seen.push(1));
    await fetch('/pos/booking/state');
    expect(seen).toEqual([]);
    status = 423;
    const r = await fetch('/pos/booking/state');
    expect(r.status).toBe(423);
    await new Promise((res) => setTimeout(res, 0));
    expect(seen).toEqual([1]);
    off(); (window as any).fetch = orig;
  });
});

// Kevin, Oct 12 2026 — the server drives the lock; the device follows it.
describe('server-driven lock (Oct 12 2026)', () => {
  it('the salon value from the server caps the device timer (salon 15 → locks at 15 even with the device on 60)', async () => {
    vi.useFakeTimers();
    get.mockImplementation(async () => status({ salon: { enabled: true, minutes: 15 } }));
    const { result } = renderHook(() => useIdleLock(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(readSalonLock(localStorage)).toEqual({ enabled: true, minutes: 15 });
    await act(async () => { await vi.advanceTimersByTimeAsync(14 * 60_000); });
    expect(result.current.isLocked).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(result.current.isLocked).toBe(true);
    expect(effectiveIdleLock(localStorage)).toEqual({ enabled: true, minutes: 15 });
  });
  it('a session the server already has locked opens on the PIN pad, with the SERVER\'s lock time (the 8 hours run from it)', async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-10-12T12:00:00Z'));
    get.mockImplementation(async () => status({ locked: true, lockedAt: '2026-10-12T10:00:00.000Z' }));
    const { result } = renderHook(() => useIdleLock(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.isLocked).toBe(true);
    expect(localStorage.getItem('pos_locked_at')).toBe(String(Date.parse('2026-10-12T10:00:00Z')));
  });
  it('a person\'s activity is reported to the server at most once a minute (that is the server\'s idle clock); reads are not', async () => {
    vi.useFakeTimers();
    renderHook(() => useIdleLock(() => {}));
    const beats = () => post.mock.calls.filter((c) => c[0] === '/auth/session-activity').length;
    act(() => { window.dispatchEvent(new Event('touchstart')); });
    expect(beats()).toBe(1);
    act(() => { vi.advanceTimersByTime(20_000); window.dispatchEvent(new Event('keydown')); window.dispatchEvent(new Event('click')); });
    expect(beats()).toBe(1);
    act(() => { vi.advanceTimersByTime(41_000); });
    expect(beats()).toBe(2);                                               // the activity inside the minute is reported at its end
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(beats()).toBe(2);                                               // nobody touched it: nothing more
  });
  it('a 423 carrying the server\'s lock time locks the screen with that time', async () => {
    // relative to now (a fixed date outlives quick unlock a few hours later and the hook rightly ends the session)
    const lockedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000).toISOString();
    const { result } = renderHook(() => useIdleLock(() => {}));
    act(() => { window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT, { detail: { lockedAt } })); });
    expect(result.current.isLocked).toBe(true);
    expect(localStorage.getItem('pos_locked_at')).toBe(String(Date.parse(lockedAt)));
  });
  it('the fetch watch passes the 423 body\'s lockedAt along', async () => {
    const seen: any[] = [];
    const orig = window.fetch;
    (window as any).fetch = vi.fn(async () => new Response(JSON.stringify({ code: 'SESSION_LOCKED', lockedAt: '2026-10-12T10:00:00.000Z' }), { status: 423 }));
    const off = installSessionLockWatch(window as any);
    const h = (e: any) => seen.push(e.detail);
    window.addEventListener(SESSION_LOCKED_EVENT, h);
    const r = await fetch('/pos/booking/state');
    expect(await r.json()).toMatchObject({ code: 'SESSION_LOCKED' });     // the caller still reads the body
    await new Promise((res) => setTimeout(res, 0));
    expect(seen).toEqual([{ lockedAt: '2026-10-12T10:00:00.000Z' }]);
    window.removeEventListener(SESSION_LOCKED_EVENT, h);
    off(); (window as any).fetch = orig;
  });
});

describe('Security settings — the salon value (Oct 12 2026)', () => {
  it('shows the salon\'s value, offers only shorter-or-equal device choices, and the device cannot switch the salon\'s lock off', async () => {
    writeSalonLock(localStorage, { enabled: true, minutes: 30 });
    get.mockImplementation(async () => status({ salon: { enabled: true, minutes: 30 } }));
    render(<POSSecuritySettingsModal onClose={() => {}} />);
    expect(await screen.findByText(/Your salon locks every POS after 30 minutes/)).toBeTruthy();
    const sel = screen.getByLabelText('Auto-lock after') as HTMLSelectElement;
    expect(sel.value).toBe('30');
    expect([...sel.options].map((o) => Number(o.value))).toEqual([1, 2, 5, 10, 15, 30]);
    expect((screen.getByLabelText('Auto-lock on this device') as HTMLInputElement).disabled).toBe(true);
  });
});
