import { describe, it, expect } from 'vitest';
import { GoCheckInService } from './go-check-in.service';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { sha256Hex, isTokenExpired, deviceTokenExpiry, selectableBranchIds, isBranchAllowed, resolveSessionBranch } from './go-check-in.dto';

const T = 'tenant-X'; const BR = 'branch-X1';
function svcRepo() { const repo = new InMemoryGoCheckInRepository(); return { repo, svc: new GoCheckInService(repo as any) }; }

describe('Go Check-In Super Admin device lifecycle (§21)', () => {
  it('creates a Go Check-In setup for a tenant (slug + URL + one-time token)', async () => {
    const { svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'Lobby iPad', branchId: BR, baseUrl: 'https://x.example.com' });
    expect(d.deviceId).toBeTruthy();
    expect(d.checkinSlug).toMatch(/^[a-z0-9]+$/);
    expect(d.publicUrl).toBe(`https://x.example.com/go-check-in/${d.checkinSlug}`);
    expect(d.deviceToken.length).toBeGreaterThan(10);
  });

  it('assigns the branch and lists the device', async () => {
    const { svc } = svcRepo();
    await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    const { devices } = await svc.listDevices(T);
    expect(devices.length).toBe(1);
    expect(devices[0].branchId).toBe(BR);
    expect(devices[0].status).toBe('active');
  });

  it('disables Go Check-In so a disabled device cannot start a session', async () => {
    const { repo, svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    await repo.upsertSettings(T, { enabled: true });
    await svc.disableDevice(T, d.deviceId);
    const dev = await repo.deviceById(T, d.deviceId);
    expect(dev!.status).toBe('disabled');
    await expect(svc.startSession(d.checkinSlug)).rejects.toMatchObject({ status: 403 });
  });

  it('regenerates the token so the old token stops resolving', async () => {
    const { repo, svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    const oldHash = (await repo.deviceById(T, d.deviceId))!.deviceTokenHash!;
    const r = await svc.regenerateToken(T, d.deviceId);
    expect(r.deviceToken).not.toBe(d.deviceToken);
    expect(await repo.deviceByTokenHash(oldHash)).toBeNull();          // old token dead
    expect(await repo.deviceByTokenHash(sha256Hex(r.deviceToken))).not.toBeNull(); // new token live
  });

  it('surfaces Go Check-In logs to Super Admin', async () => {
    const { svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    const { logs } = await svc.logs(T, 50);
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThan(0); // device creation is audited
  });

  it('master enable/disable + feature toggles round-trip', async () => {
    const { svc } = svcRepo();
    let s = await svc.updateSettings(T, { enabled: true, walkinCheckinEnabled: false });
    expect(s.enabled).toBe(true); expect(s.walkinCheckinEnabled).toBe(false);
    s = await svc.getSettings(T);
    expect(s.enabled).toBe(true); expect(s.walkinCheckinEnabled).toBe(false);
  });
});

describe('Go Check-In device token expiry (§4)', () => {
  it('isTokenExpired: null never expires; past is expired; future is not', () => {
    expect(isTokenExpired(null)).toBe(false);
    expect(isTokenExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isTokenExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(deviceTokenExpiry(0)).toBeInstanceOf(Date); // default TTL > 0 → a real future date
  });

  it('new device tokens carry a future expiry, surfaced in the list', async () => {
    const { svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    expect(d.tokenExpiresAt).toBeTruthy();
    expect(new Date(d.tokenExpiresAt!).getTime()).toBeGreaterThan(Date.now());
    const { devices } = await svc.listDevices(T);
    expect(devices[0].tokenExpiresAt).toBe(d.tokenExpiresAt);
  });

  it('an expired pairing token locks the kiosk out and flips the device to expired', async () => {
    const { repo, svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    await repo.upsertSettings(T, { enabled: true });
    await repo.setDeviceToken(T, d.deviceId, sha256Hex('x'), new Date(Date.now() - 1000)); // force past expiry
    await expect(svc.startSession(d.checkinSlug)).rejects.toMatchObject({ status: 403, code: 'device_token_expired' });
    expect((await repo.deviceById(T, d.deviceId))!.status).toBe('expired');
  });

  it('regenerating the token re-activates an expired device and it resolves again', async () => {
    const { repo, svc } = svcRepo();
    const d = await svc.createDevice(T, { deviceName: 'A', branchId: BR });
    await repo.upsertSettings(T, { enabled: true });
    await repo.setDeviceToken(T, d.deviceId, sha256Hex('x'), new Date(Date.now() - 1000));
    await expect(svc.startSession(d.checkinSlug)).rejects.toMatchObject({ code: 'device_token_expired' });
    const r = await svc.regenerateToken(T, d.deviceId);
    expect(new Date(r.tokenExpiresAt!).getTime()).toBeGreaterThan(Date.now());
    expect((await repo.deviceById(T, d.deviceId))!.status).toBe('active');
    const s = await svc.startSession(d.checkinSlug); // now resolves
    expect(s.sessionId).toBeTruthy();
  });
});

describe('Go Check-In multi-branch device (§4)', () => {
  it('selectable set = default ∪ allowed (deduped); allow check is membership', () => {
    const dev = { branchId: 'A', allowedBranchIds: ['B', 'A', 'C'] };
    expect(selectableBranchIds(dev)).toEqual(['A', 'B', 'C']);
    expect(isBranchAllowed(dev, 'B')).toBe(true);
    expect(isBranchAllowed(dev, 'Z')).toBe(false);
    expect(resolveSessionBranch(dev, 'C')).toEqual({ ok: true, branchId: 'C' });
    expect(resolveSessionBranch(dev, 'Z')).toEqual({ ok: false });
    expect(resolveSessionBranch(dev, undefined)).toEqual({ ok: true, branchId: 'A' });
  });

  async function multiDevice() {
    const repo = new InMemoryGoCheckInRepository();
    repo.seedSalon(T, 'LUXE', BR, 'Cherry Hill');
    (repo as any).branchNames.set('br-2', 'Marlton');
    (repo as any).branchNames.set('br-3', 'Voorhees');
    const svc = new GoCheckInService(repo as any);
    const d = await svc.createDevice(T, { deviceName: 'Front Desk', branchId: BR, allowedBranchIds: ['br-2', 'br-3'] });
    await repo.upsertSettings(T, { enabled: true });
    return { repo, svc, d };
  }

  it('start-session honors an allowed branch and carries it on the session (not the default)', async () => {
    const { repo, svc, d } = await multiDevice();
    const s = await svc.startSession(d.checkinSlug, 'br-2');
    expect((await repo.sessionById(s.sessionId))!.branchId).toBe('br-2');
  });

  it('start-session REJECTS a branch outside the allow-list and starts nothing', async () => {
    const { svc, d } = await multiDevice();
    await expect(svc.startSession(d.checkinSlug, 'br-NOPE')).rejects.toMatchObject({ status: 403, code: 'CHECKIN_BRANCH_MISMATCH' });
  });

  it('start-session with no choice falls back to the default branch', async () => {
    const { repo, svc, d } = await multiDevice();
    const s = await svc.startSession(d.checkinSlug);
    expect((await repo.sessionById(s.sessionId))!.branchId).toBe(BR);
  });

  it('getConfig exposes the selectable branches with the default flagged + names resolved', async () => {
    const { svc, d } = await multiDevice();
    const cfg = await svc.getConfig(d.checkinSlug);
    expect(cfg.branches?.map((b) => b.id)).toEqual([BR, 'br-2', 'br-3']);
    expect(cfg.branches?.find((b) => b.isDefault)?.id).toBe(BR);
    expect(cfg.branches?.find((b) => b.id === 'br-2')?.name).toBe('Marlton');
  });

  it('single-branch device is unaffected: a non-default branch is rejected, default is used, no picker', async () => {
    const repo = new InMemoryGoCheckInRepository(); repo.seedSalon(T, 'LUXE', BR, 'Cherry Hill');
    const svc = new GoCheckInService(repo as any);
    const d = await svc.createDevice(T, { deviceName: 'Solo', branchId: BR }); // no allowed list
    await repo.upsertSettings(T, { enabled: true });
    await expect(svc.startSession(d.checkinSlug, 'br-2')).rejects.toMatchObject({ code: 'CHECKIN_BRANCH_MISMATCH' });
    expect((await repo.sessionById((await svc.startSession(d.checkinSlug)).sessionId))!.branchId).toBe(BR);
    expect((await svc.getConfig(d.checkinSlug)).branches ?? []).toEqual([]);
  });

  it('updateDevice can set the default + allowed branches (default deduped out of allowed)', async () => {
    const { repo, svc, d } = await multiDevice();
    await svc.updateDevice(T, d.deviceId, { branchId: 'br-2', allowedBranchIds: ['br-2', 'br-3', BR] });
    const dev = await repo.deviceById(T, d.deviceId);
    expect(dev!.branchId).toBe('br-2');
    expect(dev!.allowedBranchIds).toEqual(['br-3', BR]); // 'br-2' (now the default) removed from additional
  });
});
