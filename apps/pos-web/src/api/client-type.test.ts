// client-type.test — Kevin, Oct 12 2026: the POS auto-lock is enforced by the SERVER on POS device sessions. The server knows a
// session is the POS's because the POS signs in (and calls) with X-Client-Type: pos — through the one shared client.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './client';
import { authApi } from './authApi';

afterEach(() => { vi.unstubAllGlobals(); });
const capture = () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => { calls.push({ url: String(u), headers: (init?.headers ?? {}) as Record<string, string> }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }));
  return calls;
};

describe('the POS identifies itself to the API', () => {
  it('sign-in carries X-Client-Type: pos (the session is stored as a POS device session)', async () => {
    const calls = capture();
    await authApi.login({ portal: 'tenant', salonCode: 'S', identifier: 'a@b.c', password: 'x' });
    expect(calls[0].url).toContain('/auth/login');
    expect(calls[0].headers['X-Client-Type']).toBe('pos');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
  });
  it('every shared-client call carries it — reads, writes, uploads', async () => {
    const calls = capture();
    await api.get('/pos/customers');
    await api.post('/auth/session-activity');
    await api.upload('/pos/customers/import', new FormData());
    expect(calls.map((c) => c.headers['X-Client-Type'])).toEqual(['pos', 'pos', 'pos']);
    expect(calls[1].headers['Content-Type']).toBeUndefined();          // no body → no JSON content type, as before
  });
});

// Oct 21 2026 (Oct 19 audit item "posHttp()"): fourteen POS api modules carried their own raw-fetch http() — none of them
// sent X-Client-Type (so checkout, queue, booking and check-in calls fed the server's POS idle clock nothing) and none
// told the shell about a 401 (a dead session surfaced as a per-screen error). All of them go through posHttp() now.
import { posCheckoutApi } from './posCheckoutApi';
import { posQueueApi } from './posQueueApi';
import { posBookingApi } from './posBookingApi';
import { posCheckInApi } from './posCheckInApi';
import { posTechQueueApi } from './posTechQueueApi';
import { posServingApi } from './posServingApi';
import { posServiceDoneApi } from './posServiceDoneApi';
import { posCashDrawerApi } from './posCashDrawerApi';
import { posCashHandoffApi } from './posCashHandoffApi';
import { posSkipLineApi } from './posSkipLineApi';
import { posTechAppointmentsApi } from './posTechAppointmentsApi';
import { posTurnQueueApi } from './posTurnQueueApi';
import { posLiveTechnicianScheduleApi } from './posLiveTechnicianScheduleApi';
import { posAIQueueAssignmentApi } from './posAIQueueAssignmentApi';

describe('every POS api module goes through the one posHttp()', () => {
  const firstCall = async (fn: () => Promise<unknown>) => { const calls = capture(); await fn().catch(() => undefined); return calls[0]; };
  it('X-Client-Type: pos on checkout, queue, booking, check-in, tech queue, serving, service done, cash, skip-line, tech appointments, turn queue, live schedule, AI queue calls', async () => {
    const modules: [string, () => Promise<unknown>][] = [
      ['checkout', () => posCheckoutApi.state()], ['queue', () => posQueueApi.state()], ['booking', () => posBookingApi.state()], ['check-in', () => posCheckInApi.state()],
      ['tech-queue', () => posTechQueueApi.state()], ['serving', () => posServingApi.state()], ['service-done', () => posServiceDoneApi.state()], ['cash-drawer', () => posCashDrawerApi.state()],
      ['cash-handoff', () => posCashHandoffApi.state()], ['skip-line', () => posSkipLineApi.state()], ['tech-appointments', () => posTechAppointmentsApi.state()], ['turn-queue', () => posTurnQueueApi.board()],
      ['live-schedule', () => posLiveTechnicianScheduleApi.state()], ['ai-queue', () => posAIQueueAssignmentApi.overview()],
    ];
    for (const [name, fn] of modules) {
      const c = await firstCall(fn);
      expect(c, name).toBeTruthy();
      expect(c.headers['X-Client-Type'], name).toBe('pos');
    }
  });
  it('a 401 from any of them announces the dead session to the shell (aps:unauthorized) and is a 401 error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"Session expired"}', { status: 401 })));
    const heard = vi.fn(); window.addEventListener('aps:unauthorized', heard);
    await expect(posQueueApi.state()).rejects.toMatchObject({ status: 401 });
    await expect(posCheckoutApi.state()).rejects.toMatchObject({ status: 401 });
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener('aps:unauthorized', heard);
  });
});
