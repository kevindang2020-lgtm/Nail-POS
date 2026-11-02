// display-telemetry.vitest.spec.ts — Dual-Screen mandate §107–§108 at the display API: the state a display fetched is
// timed by its coarse mode and logged as one operation line (device id, mode, duration — never a customer field); a
// playlist the server failed to build counts as playlist_failed; reported ad displays count as impressions (a re-sent
// batch does not count twice); the request context learns the display's salon and branch from its credential.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_CHECKOUT_SETTINGS } from '@aipowersalon/checkout';
import * as obs from '@aipowersalon/observability';
import { customerDisplayEvents, customerDisplayStateSeconds, runWithContext, getContext } from '@aipowersalon/observability';
import { CustomerDisplayService, type DeviceAdsPort } from './customer-display.service';
import type { DisplayDataPort } from './customer-display.repository';
import { CustomerDisplayController } from './customer-display.controller';

const TOKEN = 'tele-token';
const DEVICE = { id: 'dev-t', tenantId: 'tenant-t', branchId: 'branch-t' };
const repo: Partial<DisplayDataPort> = {
  async deviceByToken(hash: string) { return hash === createHash('sha256').update(TOKEN).digest('hex') ? DEVICE : null; },
  async currentSessionForDevice() { return null; },
  async resolveSettings() { return { ...DEFAULT_CHECKOUT_SETTINGS }; },
  async salonName() { return 'Luxury Nails'; },
};
const ev = (event: string) => customerDisplayEvents.snapshot().find((e) => e.labels.event === event)?.value ?? 0;
const idleCount = () => customerDisplayStateSeconds.snapshot().filter((e) => e.labels.mode === 'idle').reduce((n, e: any) => n + e.value.count, 0);
const ctx = () => ({ requestId: 'req_t', correlationId: 'req_t', traceId: 't'.repeat(32), service: 'api' as const });
afterEach(() => vi.restoreAllMocks());

describe('display telemetry (§107–§108)', () => {
  it('a state fetch is timed (idle) and logged with the device id and mode only; the context gets the salon and branch', async () => {
    const lines: any[] = [];
    vi.spyOn(obs.log, 'info').mockImplementation(((msg: string, f: any) => { lines.push({ msg, ...f }); }) as any);
    const svc = new CustomerDisplayService(repo as DisplayDataPort);
    const n0 = idleCount();
    const c = ctx();
    await runWithContext(c, async () => { await svc.getDeviceState(TOKEN); expect(getContext()).toMatchObject({ tenantId: 'tenant-t', branchId: 'branch-t', actorType: 'device' }); });
    expect(idleCount() - n0).toBe(1);
    const line = lines.find((l) => l.msg === 'customer_display.operation');
    expect(line).toMatchObject({ deviceId: 'dev-t', operation: 'state', mode: 'idle', status: 'ok' });
    expect(Object.keys(line).sort()).toEqual(['deviceId', 'durationMs', 'mode', 'msg', 'operation', 'status']);
  });
  it('playlist failures and ad impressions', async () => {
    let fail = true;
    const port: DeviceAdsPort = {
      async playlistForDevice() { if (fail) throw new Error('db down'); return { enabled: false } as any; },
      async recordDisplays(_d, body: any) { return { accepted: body.displays.length, duplicate: body.batchId === 'again-again' }; },
    };
    const svc = new CustomerDisplayService(repo as DisplayDataPort, undefined, undefined, undefined, port);
    const pf0 = ev('playlist_failed'); const ai0 = ev('ad_impression');
    await expect(svc.deviceAdsPlaylist(TOKEN)).rejects.toThrow('db down');
    fail = false;
    await svc.deviceAdsPlaylist(TOKEN);
    await expect(svc.deviceAdsPlaylist('forged')).rejects.toMatchObject({ code: 'forbidden' });   // a refusal is not a failure
    expect(ev('playlist_failed') - pf0).toBe(1);
    await svc.recordDeviceAdDisplays(TOKEN, { batchId: 'batch-0001', displays: [{}, {}, {}] });
    await svc.recordDeviceAdDisplays(TOKEN, { batchId: 'again-again', displays: [{}, {}] });   // a re-sent batch
    expect(ev('ad_impression') - ai0).toBe(3);
  });
});

describe('stream (re)connects (§108)', () => {
  it('an authorised display stream counts as a reconnect; a refused one does not', async () => {
    const svc: any = { deviceValid: async (t: string) => t === 'ok', deviceRooms: async () => ['customer_display:device:x'] };
    let authorize: (() => Promise<unknown>) | null = null;
    const streams: any = { open: (_req: any, fn: () => Promise<unknown>) => { authorize = fn; return null; } };
    const c = new CustomerDisplayController(svc, streams, undefined as any);
    const r0 = ev('reconnect');
    c.deviceStream({ headers: { 'x-device-token': 'ok' } }); await authorize!();
    c.deviceStream({ headers: { 'x-device-token': 'nope' } }); await expect(authorize!()).rejects.toThrow();
    expect(ev('reconnect') - r0).toBe(1);
  });
});
