// config.test.tsx — BUILD_PLAN Phase 13 B (Constitution 6 §52–57, §219–220): the shared AppConfigGate. Fetch on launch and
// on resume; a hard update screen for UPDATE_REQUIRED (from /app-config OR any API call's 426); a dismissible banner for
// UPDATE_RECOMMENDED; maintenance / module notices; useRemoteFlag. A failed fetch never blocks the app.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AppConfigGate, useRemoteFlag, useModuleNotice, appConfigPath, resetAppConfig } from './index';
import { UPDATE_REQUIRED_EVENT } from './events';
import type { AppConfigResponse } from '@aipowersalon/api-contracts';

const base = (over: Partial<AppConfigResponse> = {}): AppConfigResponse => ({
  app: 'tech', platform: 'ios', version: '1.4.0',
  update: { state: 'SUPPORTED', minimumVersion: null, recommendedVersion: null, latestVersion: null, storeUrl: null, message: null },
  flags: { update_prompts: true, maintenance_banner: true }, modules: [],
  maintenance: { active: false, mode: null, message: null, banner: null }, breakGlass: { mode: 'off', message: null },
  refreshAfterSeconds: 300, serverTime: '2026-10-09T00:00:00Z', ...over,
});
const STORE = 'https://apps.apple.com/app/id1';
afterEach(() => { cleanup(); resetAppConfig(); vi.useRealTimers(); });

function Flagged() { const on = useRemoteFlag('deals', false); const ai = useModuleNotice('ai'); return <p>deals:{String(on)} ai:{ai ? ai.message : 'ok'}</p>; }

describe('appConfigPath', () => {
  it('asks /app-config for this app, platform and version (the transport adds /api/v1)', () => {
    expect(appConfigPath('manager-pay', 'ios', '1.0.0')).toBe('/app-config?app=manager-pay&platform=ios&version=1.0.0');
    expect(appConfigPath('tech', 'web', undefined)).toBe('/app-config?app=tech&platform=web');
  });
});

describe('AppConfigGate', () => {
  it('UPDATE_REQUIRED from /app-config replaces the app with the update screen and its store link', async () => {
    const fetchConfig = vi.fn(async () => base({ update: { state: 'UPDATE_REQUIRED', minimumVersion: '1.5.0', recommendedVersion: null, latestVersion: '1.7.0', storeUrl: STORE, message: 'Security update required.' } }));
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={fetchConfig}><p>the app</p></AppConfigGate>);
    expect(await screen.findByRole('heading', { name: /update required/i })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByText('Security update required.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /update now/i }).getAttribute('href')).toBe(STORE);
    expect(screen.getByText(/1\.4\.0/)).toBeTruthy();
    expect(fetchConfig).toHaveBeenCalledWith('/app-config?app=tech&platform=ios&version=1.4.0');
  });

  it('a 426 from ANY API call (the transport event) flips to the update screen', async () => {
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={async () => base()}><p>the app</p></AppConfigGate>);
    expect(await screen.findByText('the app')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent(UPDATE_REQUIRED_EVENT, { detail: { code: 'UPDATE_REQUIRED', message: 'Please update.', storeUrl: STORE, minimumVersion: '1.5.0' } })); });
    expect(screen.getByRole('heading', { name: /update required/i })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('a 426 event without the UPDATE_REQUIRED code is ignored', async () => {
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={async () => base()}><p>the app</p></AppConfigGate>);
    await screen.findByText('the app');
    act(() => { window.dispatchEvent(new CustomEvent(UPDATE_REQUIRED_EVENT, { detail: { code: 'SOMETHING_ELSE' } })); });
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('UPDATE_RECOMMENDED is a dismissible banner above a working app (unless the flag turns prompts off)', async () => {
    const rec = base({ update: { state: 'UPDATE_RECOMMENDED', minimumVersion: '1.0.0', recommendedVersion: '1.6.0', latestVersion: '1.6.0', storeUrl: STORE, message: null } });
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={async () => rec}><p>the app</p></AppConfigGate>);
    expect(await screen.findByText(/a new version .*1\.6\.0/i)).toBeTruthy();
    expect(screen.getByText('the app')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/a new version/i)).toBeNull();
    cleanup(); resetAppConfig();
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={async () => ({ ...rec, flags: { update_prompts: false } })}><p>the app</p></AppConfigGate>);
    await screen.findByText('the app');
    await act(async () => {});
    expect(screen.queryByText(/a new version/i)).toBeNull();
  });

  it('maintenance, the announcement banner, break-glass and module notices are shown; the app keeps working', async () => {
    const cfg = base({ maintenance: { active: true, mode: 'read_only', message: 'Read-only until 9pm.', banner: 'New features Monday' },
      modules: [{ module: 'ai', available: false, message: 'AI automation is temporarily unavailable.' }], flags: { maintenance_banner: true, deals: true } });
    render(<AppConfigGate app="owner" version="1.4.0" platform="android" fetchConfig={async () => cfg}><Flagged /></AppConfigGate>);
    expect(await screen.findByText('Read-only until 9pm.')).toBeTruthy();
    expect(screen.getByText('New features Monday')).toBeTruthy();
    expect(screen.getAllByText('AI automation is temporarily unavailable.').length).toBeGreaterThan(0);
    expect(screen.getByText(/deals:true ai:AI automation/)).toBeTruthy();
  });

  it('a failed fetch never blocks the app; flags fall back to the caller\'s default', async () => {
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={async () => { throw new Error('offline'); }}><Flagged /></AppConfigGate>);
    expect(await screen.findByText('deals:false ai:ok')).toBeTruthy();
  });

  it('fetches again when the app returns to the foreground (resume), at most once a minute', async () => {
    let n = 0;
    const fetchConfig = vi.fn(async () => { n++; return n >= 2 ? base({ update: { state: 'UPDATE_REQUIRED', minimumVersion: '1.5.0', recommendedVersion: null, latestVersion: null, storeUrl: STORE, message: null } }) : base(); });
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    render(<AppConfigGate app="tech" version="1.4.0" platform="ios" fetchConfig={fetchConfig}><p>the app</p></AppConfigGate>);
    await screen.findByText('the app');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });   // 0 s later: throttled
    expect(fetchConfig).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 61_000);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(screen.getByRole('heading', { name: /update required/i })).toBeTruthy());
    expect(fetchConfig).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});
