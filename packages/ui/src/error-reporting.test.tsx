// error-reporting.test — Constitution 11 §125–130, §197–200: the shared boundary and reporter.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { resolveClientPlatform, setCurrentScreen, AppErrorBoundary, configureErrorReporting, noteResponse, reportClientError, lastRequestReference, installGlobalErrorHandlers, resetGlobalHandlersForTests, MAX_REPORTS_PER_PAGE } from './error-reporting';

const sent: Array<{ url: string; body: any }> = [];
const headers = (id: string | null) => ({ get: (n: string) => (n === 'x-request-id' ? id : null) });
beforeEach(() => { sent.length = 0; configureErrorReporting({ app: 'pos', version: '9.9.9', apiBase: 'https://api.test/', send: (url, body) => sent.push({ url, body: JSON.parse(body) }) }); });

function Boom(): React.ReactElement { throw new Error('render exploded'); }

describe('the boundary — a crash is a recoverable screen, not a blank page', () => {
  it('renders the recovery screen instead of unmounting the app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);   // React logs caught errors; expected here
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
  });
  it('§200: never shows the error message or stack to the user', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(document.body.textContent).not.toMatch(/render exploded|at Boom/);
  });
  it('§198/§200: shows the reference of the last FAILED request, so support can find it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    noteResponse({ ok: false, headers: headers('req_01JABCDEFGHJKMNPQRST') });
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByTestId('error-reference').textContent).toBe('req_01JABCDEFGHJKMNPQRST');
  });
  it('reports the render crash, with the failed request id attached (§129)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    noteResponse({ ok: false, headers: headers('req_01JZZZZZZZZZZZZZZZZZ') });
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.test/api/v1/client-telemetry/errors');   // BUILD_PLAN Phase 12: /api/v1
    expect(sent[0].body).toMatchObject({ app: 'pos', kind: 'render', message: 'render exploded', version: '9.9.9', requestId: 'req_01JZZZZZZZZZZZZZZZZZ' });
  });
  it('"Try again" re-renders the children', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let explode = true;
    function Flaky(): React.ReactElement { if (explode) throw new Error('once'); return <p>recovered</p>; }
    render(<AppErrorBoundary><Flaky /></AppErrorBoundary>);
    explode = false;
    fireEvent.click(screen.getByText('Try again'));
    expect(screen.getByText('recovered')).toBeTruthy();
  });
});

describe('noteResponse — only the failures matter, and only well-formed ids', () => {
  it('a SUCCESSFUL response does not replace the reference', () => {
    noteResponse({ ok: false, headers: headers('req_01JAAAAAAAAAAAAAAAAA') });
    noteResponse({ ok: true, headers: headers('req_01JBBBBBBBBBBBBBBBBB') });
    expect(lastRequestReference()).toBe('req_01JAAAAAAAAAAAAAAAAA');
  });
  it('a header that is not a request id is ignored (it would be shown to the user)', () => {
    noteResponse({ ok: false, headers: headers('<img src=x onerror=alert(1)>') });
    expect(lastRequestReference()).toBeNull();
  });
  it('never throws on garbage', () => { expect(() => noteResponse(undefined)).not.toThrow(); expect(() => noteResponse({ ok: false, headers: { get: () => { throw new Error('x'); } } })).not.toThrow(); });
});

describe('the reporter — deduplicated, capped, private, never throws', () => {
  it('the same error twice is ONE report — a render loop must not flood the endpoint', () => {
    const e = new Error('same'); reportClientError('unhandled', e); reportClientError('unhandled', e);
    expect(sent).toHaveLength(1);
  });
  it(`at most ${MAX_REPORTS_PER_PAGE} reports per page load`, () => {
    for (let i = 0; i < MAX_REPORTS_PER_PAGE + 15; i++) reportClientError('unhandled', new Error(`distinct ${i}`));
    expect(sent).toHaveLength(MAX_REPORTS_PER_PAGE);
  });
  it('§130: sends the PATH only — never the query string, which can carry a token', () => {
    window.history.pushState({}, '', '/checkout/42?token=secret#frag');
    reportClientError('unhandled', new Error('q'));
    expect(sent[0].body.route).toBe('/checkout/42');
    expect(JSON.stringify(sent[0].body)).not.toMatch(/secret/);
  });
  it('message and stack are truncated before they leave the browser', () => {
    reportClientError('unhandled', Object.assign(new Error('m'.repeat(5000)), { stack: 's'.repeat(20000) }));
    expect(sent[0].body.message.length).toBeLessThanOrEqual(500);
    expect(sent[0].body.stack.length).toBeLessThanOrEqual(4000);
  });
  it('a transport that throws does not throw out of the reporter', () => {
    configureErrorReporting({ app: 'pos', version: '1', apiBase: 'x', send: () => { throw new Error('offline'); } });
    expect(() => reportClientError('unhandled', new Error('z'))).not.toThrow();
  });
  it('unconfigured, it does nothing (and does not throw)', () => {
    configureErrorReporting(null as never);
    expect(() => reportClientError('unhandled', new Error('n'))).not.toThrow();
  });
});

describe('§199 global handlers', () => {
  it('an uncaught error and an unhandled rejection are both reported', () => {
    resetGlobalHandlersForTests();
    const listeners: Record<string, (e: any) => void> = {};
    installGlobalErrorHandlers({ addEventListener: (t: string, fn: any) => { listeners[t] = fn; } } as never);
    listeners.error({ error: new Error('uncaught one') });
    listeners.unhandledrejection({ reason: new Error('rejected one') });
    expect(sent.map((s) => s.body.kind)).toEqual(['unhandled', 'promise']);
  });
});

import { installFetchObserver, resetFetchObserverForTests, resolveApiBase } from './error-reporting';
describe('the fetch observer — every call site covered, none edited', () => {
  it('a FAILED API response anywhere in the app becomes the reference', async () => {
    resetFetchObserverForTests(); configureErrorReporting({ app: 'pos', version: '1', apiBase: '', send: () => undefined });
    const target = { fetch: (async () => ({ ok: false, status: 500, headers: headers('req_01JOBSERVEDAAAAAAAAA') })) as never };
    installFetchObserver(target);
    await (target.fetch as any)('/pos/checkout');
    expect(lastRequestReference()).toBe('req_01JOBSERVEDAAAAAAAAA');
  });
  it('returns the IDENTICAL response object — the app sees no difference', async () => {
    resetFetchObserverForTests();
    const res = { ok: true, status: 200, headers: headers(null) };
    const target = { fetch: (async () => res) as never };
    installFetchObserver(target);
    expect(await (target.fetch as any)('/x')).toBe(res);
  });
  it('a network rejection passes through untouched', async () => {
    resetFetchObserverForTests();
    const target = { fetch: (async () => { throw new TypeError('Failed to fetch'); }) as never };
    installFetchObserver(target);
    await expect((target.fetch as any)('/x')).rejects.toThrow('Failed to fetch');
  });
  it('installing twice wraps once — no double observation', async () => {
    resetFetchObserverForTests();
    let calls = 0;
    const target = { fetch: (async () => { calls++; return { ok: true, headers: headers(null) }; }) as never };
    installFetchObserver(target); installFetchObserver(target);
    await (target.fetch as any)('/x');
    expect(calls).toBe(1);
  });
  it('resolveApiBase follows the apps\' own order: build env first', () => {
    expect(resolveApiBase({ VITE_API_BASE: 'https://api.example' })).toBe('https://api.example');
    expect(resolveApiBase({})).toBe('');
  });
  it('C6 §118: every report carries app + version + PLATFORM; web unless the Capacitor shell says ios / android', () => {
    reportClientError('unhandled', new Error('p1'));
    expect(sent[0].body).toMatchObject({ app: 'pos', version: '9.9.9', platform: 'web' });
    expect(resolveClientPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } })).toBe('ios');
    expect(resolveClientPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } })).toBe('android');
    expect(resolveClientPlatform({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } })).toBe('web');
    expect(resolveClientPlatform({})).toBe('web');
  });
  it('an app with in-memory navigation (tech / owner tab stacks) reports its CURRENT SCREEN, ids stripped by the server', () => {
    setCurrentScreen('/ticket/123');
    reportClientError('unhandled', new Error('scr'));
    expect(sent[0].body.route).toBe('/ticket/123');
    setCurrentScreen(null);
  });
});
