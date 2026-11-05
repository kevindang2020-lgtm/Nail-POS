// display-ads-device.vitest.spec.ts — 23-inch dual-screen spec §47, §62, §108, §113: the customer display's advertising
// routes. The device route proves WHICH display is asking (its own credential); tenant, branch and device come from that
// row and are handed to advertising — nothing the display sends can choose another salon or branch. Without advertising
// wired the display simply gets "no ads" (it shows the salon's branded panel), never an error.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DisplayAdError } from '@aipowersalon/marketing';
import { CustomerDisplayService, DisplayError, type DeviceAdsPort } from './customer-display.service';
import type { DisplayDataPort } from './customer-display.repository';

const TOKEN = 'ads-device-token';
const DEVICE = { id: 'dev-9', tenantId: 'tenant-9', branchId: 'branch-9' };
const repo: Partial<DisplayDataPort> = {
  async deviceByToken(hash: string) { return hash === createHash('sha256').update(TOKEN).digest('hex') ? DEVICE : null; },
  async currentSessionForDevice() { throw new Error('ads must not need the checkout session'); },
};
function harness(ads?: Partial<DeviceAdsPort>) {
  const calls: { fn: string; d: unknown; body?: unknown }[] = [];
  const port: DeviceAdsPort | undefined = ads ? {
    async playlistForDevice(d) { calls.push({ fn: 'playlist', d }); return ads.playlistForDevice!(d); },
    async recordDisplays(d, body) { calls.push({ fn: 'record', d, body }); return ads.recordDisplays!(d, body); },
  } : undefined;
  return { svc: new CustomerDisplayService(repo as DisplayDataPort, undefined, undefined, undefined, port), calls };
}
const PLAYLIST = { enabled: true, offReason: null, ads: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, playlistVersion: 'v1', generatedAt: '2026-10-06T00:00:00Z', refreshAfterSeconds: 900 };

describe('customer display — advertising routes', () => {
  it('no or a forged device token → forbidden (and advertising is never consulted)', async () => {
    const h = harness({ playlistForDevice: async () => PLAYLIST as any, recordDisplays: async () => ({ accepted: 0, duplicate: false }) });
    for (const t of [undefined, '', 'forged']) {
      await expect(h.svc.deviceAdsPlaylist(t)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(h.svc.recordDeviceAdDisplays(t, { batchId: 'x', displays: [] })).rejects.toBeInstanceOf(DisplayError);
    }
    expect(h.calls).toEqual([]);
  });
  it('the playlist is asked for with the DEVICE ROW\'s tenant, branch and id — the request carries none of them', async () => {
    const h = harness({ playlistForDevice: async () => PLAYLIST as any, recordDisplays: async () => ({ accepted: 2, duplicate: false }) });
    expect(await h.svc.deviceAdsPlaylist(TOKEN)).toEqual(PLAYLIST);
    const body = { batchId: 'batch-1234', displays: [{ adId: 'a', shownAt: 'x', durationMs: 1 }], tenantId: 'someone-else', branchId: 'elsewhere' };
    expect(await h.svc.recordDeviceAdDisplays(TOKEN, body)).toEqual({ accepted: 2, duplicate: false });
    expect(h.calls.map((c) => c.d)).toEqual([{ deviceId: 'dev-9', tenantId: 'tenant-9', branchId: 'branch-9' }, { deviceId: 'dev-9', tenantId: 'tenant-9', branchId: 'branch-9' }]);
  });
  it('a malformed report is a 400 (invalid), not a 500', async () => {
    const h = harness({ playlistForDevice: async () => PLAYLIST as any, recordDisplays: async () => { throw new DisplayAdError('VALIDATION_FAILED', 'batchId must be 8–64 letters'); } });
    await expect(h.svc.recordDeviceAdDisplays(TOKEN, {})).rejects.toMatchObject({ code: 'invalid', message: 'batchId must be 8–64 letters' });
  });
  it('§113: with no advertising wired the display gets "no ads" (its branded panel) — never an error', async () => {
    const h = harness();
    const p = await h.svc.deviceAdsPlaylist(TOKEN);
    expect(p).toMatchObject({ enabled: false, offReason: 'not_available', ads: [] });
    expect(await h.svc.recordDeviceAdDisplays(TOKEN, { batchId: 'batch-1234', displays: [] })).toEqual({ accepted: 0, duplicate: false });
  });
});
