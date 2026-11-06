// display-devices.vitest.spec.ts — 23-inch dual-screen spec §8–§12, §81–§86: the customer display as a DEVICE.
// The service over the in-memory store (one store behind both ports, like the real tables): a display pairs ITSELF with a
// code the owner types into the POS; the credential is minted at pickup and handed over once; nothing but hashes is kept;
// the salon and branch come from the claimer's session, never the request; the heartbeat drives online/offline; staff see
// their branch's displays only; maintenance, revoke, refresh and registers behave as the POS promises.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { DISPLAY_ONLINE_WINDOW_MS, DISPLAY_PAIRING_TTL_SECONDS } from '@aipowersalon/api-contracts';
import { InMemoryDisplayDevices } from './display-devices.repository';
import { DisplayDevicesService, DisplayDeviceError, MAX_OPEN_PAIRINGS, cleanDisplayName, parseHeartbeat, type DisplayStaffCtx } from './display-devices.service';
import { CustomerDisplayController, PAIRING_STARTS_PER_IP_PER_MINUTE } from './customer-display.controller';
import { runDisplayDevice } from './display-devices.controller';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const T1 = 't1000000-0000-4000-8000-000000000001', T2 = 't2000000-0000-4000-8000-000000000002';
const B1 = 'b1000000-0000-4000-8000-000000000001', B2 = 'b2000000-0000-4000-8000-000000000002';
const owner = (over: Partial<DisplayStaffCtx> = {}): DisplayStaffCtx => ({ tenantId: T1, branchId: B1, userId: 'u-owner', role: 'OWNER', permissions: [], canManage: true, ...over });
const HB = { mode: 'advertisement', appVersion: '0.1.0+t', screen: { width: 1920, height: 1080, pixelRatio: 1 }, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE' };

let now = Date.parse('2026-10-06T15:00:00Z');
let mem: InMemoryDisplayDevices;
let events: { room: string; event: string; payload: any }[];
let svc: DisplayDevicesService;
beforeEach(() => {
  now = Date.parse('2026-10-06T15:00:00Z');
  mem = new InMemoryDisplayDevices(() => now);
  mem.salons.set(T1, 'Luxury Nails'); mem.branches.set(B1, { tenantId: T1, name: 'Cherry Hill' }); mem.branches.set(B2, { tenantId: T1, name: 'Voorhees' });
  events = [];
  const rt: any = {
    toTenant: (c: any, event: string, payload: any) => events.push({ room: `tenant:${c.tenantId}:branch:${c.branchId}`, event, payload }),
    toCustomerDisplayDevice: (id: string, event: string, payload: any) => events.push({ room: `device:${id}`, event, payload }),
    toCustomerDisplay() {}, toTicket() {}, toTechnician() {}, toOwner() {}, toPlatform() {},
  };
  svc = new DisplayDevicesService(mem, mem, rt, () => now);
});

async function pairOne(name = 'Front Display #1', ctx = owner(), stationId?: string) {
  const start = await svc.startPairing({ platform: 'android' });
  const view = await svc.pair(ctx, { code: start.code, name, stationId });
  const poll = await svc.pollPairing(start.pairingId, start.pollSecret);
  if (poll.status !== 'paired') throw new Error('not paired: ' + poll.status);
  return { start, view, token: poll.deviceToken, device: mem.deviceByTokenHash(sha(poll.deviceToken))! };
}

describe('the display pairs itself (§8–§12)', () => {
  it('a code for the display to show; only HASHES are kept — never the code, the poll secret or the credential', async () => {
    const s = await svc.startPairing({ platform: 'web' });
    expect(s.code).toMatch(/^\d{8}$/);
    expect(s.pollSecret.length).toBeGreaterThanOrEqual(40);
    expect(Date.parse(s.expiresAt) - now).toBe(DISPLAY_PAIRING_TTL_SECONDS * 1000);
    const stored = JSON.stringify(mem.pairings);
    expect(stored).not.toContain(s.code);
    expect(stored).not.toContain(s.pollSecret);
    expect(mem.pairings[0]).toMatchObject({ codeHash: sha(s.code), pollSecretHash: sha(s.pollSecret), platform: 'web', tenantId: null });
  });

  it('waiting → the owner claims it → the credential is minted at pickup and handed over ONCE', async () => {
    const s = await svc.startPairing({ platform: 'android' });
    expect(await svc.pollPairing(s.pairingId, s.pollSecret)).toEqual({ status: 'waiting', expiresAt: s.expiresAt });
    const v = await svc.pair(owner(), { code: s.code.slice(0, 4) + ' ' + s.code.slice(4), name: '  Front   Display #1 ' });
    expect(v).toMatchObject({ name: 'Front Display #1', branchId: B1, branchName: 'Cherry Hill', pairing: 'shared', awaitingPickup: true, state: 'OFFLINE' });
    const got = await svc.pollPairing(s.pairingId, s.pollSecret);
    expect(got).toMatchObject({ status: 'paired', deviceName: 'Front Display #1', salonName: 'Luxury Nails', branchName: 'Cherry Hill' });
    const token = (got as any).deviceToken as string;
    expect(token.length).toBeGreaterThanOrEqual(40);
    const d = mem.deviceByTokenHash(sha(token))!;
    expect(d).toMatchObject({ tenantId: T1, branchId: B1, pairingStatus: 'paired', deviceType: 'android' });
    expect(JSON.stringify(mem.devices)).not.toContain(token);                       // the hash only
    expect(await svc.pollPairing(s.pairingId, s.pollSecret)).toEqual({ status: 'expired' });   // never twice
    expect(events.some((e) => e.event === 'customer_display_device_updated' && e.payload.reason === 'connected' && e.room === `tenant:${T1}:branch:${B1}`)).toBe(true);
  });

  it('the salon and branch are the CLAIMER\'s (the signed session) — a body naming another salon or branch changes nothing', async () => {
    const s = await svc.startPairing({});
    const v = await svc.pair(owner(), { code: s.code, name: 'Desk', tenantId: T2, branchId: B2 } as any);
    const d = await mem.device(T1, v.deviceId);
    expect(d).toMatchObject({ tenantId: T1, branchId: B1 });
    expect(await mem.device(T2, v.deviceId)).toBeNull();
  });

  it('a wrong poll secret is refused; an unknown pairing is simply expired', async () => {
    const s = await svc.startPairing({});
    await expect(svc.pollPairing(s.pairingId, 'not-the-secret')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(svc.pollPairing(s.pairingId, undefined)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await svc.pollPairing('00000000-0000-4000-8000-0000000fffff', 'x')).toEqual({ status: 'expired' });
  });

  it('a code works once, only while open: a second claim, a wrong code and an expired code are all refused', async () => {
    const s = await svc.startPairing({});
    await svc.pair(owner(), { code: s.code, name: 'One' });
    await expect(svc.pair(owner(), { code: s.code, name: 'Two' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.pair(owner(), { code: '12345678', name: 'X' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.pair(owner(), { code: '1234', name: 'X' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/8-digit/) });
    const late = await svc.startPairing({});
    now += DISPLAY_PAIRING_TTL_SECONDS * 1000 + 1;
    expect(await svc.pollPairing(late.pairingId, late.pollSecret)).toEqual({ status: 'expired' });
    await expect(svc.pair(owner(), { code: late.code, name: 'Late' })).rejects.toMatchObject({ code: 'invalid' });
    expect(mem.devices.filter((d) => d.name === 'Late')).toHaveLength(0);
  });

  it('a claimed display that never collects its credential is revoked by the next housekeeping (it has no token)', async () => {
    const s = await svc.startPairing({});
    const v = await svc.pair(owner(), { code: s.code, name: 'Gone' });
    now += DISPLAY_PAIRING_TTL_SECONDS * 1000 + 1;
    await svc.startPairing({});   // housekeeping runs on every start
    expect((await mem.device(T1, v.deviceId))).toMatchObject({ pairingStatus: 'unpaired' });
    expect((await mem.device(T1, v.deviceId))?.revokedAt).toBeTruthy();
    expect(await svc.pollPairing(s.pairingId, s.pollSecret)).toEqual({ status: 'expired' });
  });

  it('a flood of open codes is refused at the ceiling (the public start is a write anyone can reach)', async () => {
    for (let i = 0; i < MAX_OPEN_PAIRINGS; i++) mem.pairings.push({ id: `p${i}`, codeHash: `h${i}`, pollSecretHash: 'x', expiresAt: new Date(now + 60_000).toISOString(), expiresMs: now + 60_000, createdAt: now, platform: null, tenantId: null, deviceId: null, claimedAt: null, consumedAt: null } as any);
    await expect(svc.startPairing({})).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('pairing needs a branch in the session, a name, and (if given) a register of THIS branch', async () => {
    const s = await svc.startPairing({});
    await expect(svc.pair(owner({ branchId: '' }), { code: s.code, name: 'X' })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/branch/) });
    await expect(svc.pair(owner(), { code: s.code, name: '   ' })).rejects.toMatchObject({ code: 'invalid' });
    const other = await svc.createStation(owner({ branchId: B2 }), { name: 'Register 9' });
    await expect(svc.pair(owner(), { code: s.code, name: 'X', stationId: other.id })).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/register/) });
    const mine = await svc.createStation(owner(), { name: 'Register 1' });
    const v = await svc.pair(owner(), { code: s.code, name: 'Desk', stationId: mine.id });
    expect(v).toMatchObject({ pairing: 'dedicated', stationId: mine.id, stationName: 'Register 1' });
  });
});

describe('the heartbeat (§85–§86)', () => {
  it('validates every field — a public client is never trusted as sent', () => {
    // G7 (Nov 5 2026): a heartbeat without an ad-policy acknowledgment parses to adPolicy null (the display did not report one)
    expect(parseHeartbeat(HB)).toEqual({ mode: 'advertisement', appVersion: '0.1.0+t', width: 1920, height: 1080, pixelRatio: 1, profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE', adPolicy: null });
    for (const bad of [{ ...HB, mode: 'party' }, { ...HB, appVersion: '' }, { ...HB, appVersion: 'x'.repeat(41) }, { ...HB, appVersion: 'v\u0007' },
      { ...HB, screen: { width: 50, height: 1080, pixelRatio: 1 } }, { ...HB, screen: { width: 1920.5, height: 1080, pixelRatio: 1 } }, { ...HB, screen: { width: 1920, height: 1080, pixelRatio: 9 } }, { ...HB, profile: 'TV' }, null]) {
      expect(() => parseHeartbeat(bad)).toThrow(DisplayDeviceError);
    }
  });

  it('online comes from the heartbeat — and OFFLINE once it ages past the window; the POS hears changes, not every beat', async () => {
    const { device } = await pairOne();
    events.length = 0;
    const ref = { id: device.id, tenantId: T1, branchId: B1 };
    expect(await svc.heartbeat(ref, HB)).toEqual({ maintenance: false });
    let v = (await svc.list(owner())).devices[0];
    expect(v).toMatchObject({ state: 'ADVERTISEMENT', online: true, mode: 'advertisement', appVersion: '0.1.0+t', profile: 'CUSTOMER_DISPLAY_23_LANDSCAPE', screen: { width: 1920, height: 1080, pixelRatio: 1 } });
    events.length = 0;
    now += 30_000;
    await svc.heartbeat(ref, HB);                                        // nothing changed: the POS is not woken
    expect(events).toEqual([]);
    await svc.heartbeat(ref, { ...HB, mode: 'check_in' });              // the mode changed: it is
    expect(events.map((e) => e.payload.reason)).toEqual(['heartbeat']);
    now += DISPLAY_ONLINE_WINDOW_MS + 1;
    v = (await svc.list(owner())).devices[0];
    expect(v).toMatchObject({ state: 'OFFLINE', online: false });
    events.length = 0;
    await svc.heartbeat(ref, { ...HB, mode: 'check_in' });              // back after a silence: the POS hears it
    expect(events.map((e) => e.payload.reason)).toEqual(['online']);
  });

  it('a revoked display\'s heartbeat is refused', async () => {
    const { device } = await pairOne();
    await svc.revoke(owner(), device.id);
    await expect(svc.heartbeat({ id: device.id, tenantId: T1, branchId: B1 }, HB)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the POS side (§81–§86)', () => {
  it('a checkout on the display is CHECKOUT (whatever it last reported), with the customer\'s FIRST name only', async () => {
    const { device } = await pairOne();
    await svc.heartbeat({ id: device.id, tenantId: T1, branchId: B1 }, HB);
    mem.seedSession({ tenantId: T1, deviceId: device.id, ticketId: 'tk1', ticketNumber: '0042', customerFirstName: 'Sophia', state: 'showing_ticket' });
    const v = (await svc.list(owner())).devices[0];
    expect(v.state).toBe('CHECKOUT');
    expect(v.session).toMatchObject({ ticketNumber: '0042', customerFirstName: 'Sophia', state: 'showing_ticket' });
  });

  it('each POS sees ITS branch\'s displays; another branch\'s or salon\'s display cannot be touched', async () => {
    const { device } = await pairOne();
    expect((await svc.list(owner({ branchId: B2 }))).devices).toEqual([]);
    for (const ctx of [owner({ branchId: B2 }), owner({ tenantId: T2 })]) {
      await expect(svc.update(ctx, device.id, { name: 'Mine now' })).rejects.toMatchObject({ code: 'not_found' });
      await expect(svc.revoke(ctx, device.id)).rejects.toMatchObject({ code: 'not_found' });
      await expect(svc.refresh(ctx, device.id)).rejects.toMatchObject({ code: 'not_found' });
    }
    expect((await mem.device(T1, device.id))?.name).toBe('Front Display #1');
  });

  it('rename, dedicate to a register / share, maintenance — each change audited', async () => {
    const { device } = await pairOne();
    const reg = await svc.createStation(owner(), { name: 'Register 1' });
    let v = await svc.update(owner(), device.id, { name: 'Window Display', stationId: reg.id });
    expect(v).toMatchObject({ name: 'Window Display', pairing: 'dedicated', stationName: 'Register 1' });
    v = await svc.update(owner(), device.id, { stationId: null, maintenance: true });
    expect(v).toMatchObject({ pairing: 'shared', maintenance: true, state: 'MAINTENANCE' });
    expect(events.some((e) => e.room === `device:${device.id}` && e.payload.reason === 'maintenance')).toBe(true);   // the display shows it
    expect(mem.audits.map((a) => a.action)).toEqual(expect.arrayContaining(['customer_display_paired', 'pos_station_created', 'customer_display_renamed', 'customer_display_register_changed', 'customer_display_maintenance_on']));
    expect(mem.audits.find((a) => a.action === 'customer_display_renamed')).toMatchObject({ actor: { tenantId: T1, userId: 'u-owner' }, metadata: { from: 'Front Display #1', to: 'Window Display' } });
    await expect(svc.update(owner(), device.id, {})).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.update(owner(), device.id, { maintenance: 'yes' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('maintenance is refused while a customer\'s checkout is on the display', async () => {
    const { device } = await pairOne();
    mem.seedSession({ tenantId: T1, deviceId: device.id, ticketId: 'tk1', ticketNumber: '1', customerFirstName: 'Ana', state: 'tip_selected' });
    await expect(svc.update(owner(), device.id, { maintenance: true })).rejects.toMatchObject({ code: 'conflict' });
    expect((await mem.device(T1, device.id))?.maintenanceAt).toBeNull();
  });

  it('revoke destroys the credential, ends the checkout on it (the POS carries on) and tells the display', async () => {
    const { device, token } = await pairOne();
    const s = mem.seedSession({ tenantId: T1, deviceId: device.id, ticketId: 'tk1', ticketNumber: '1', customerFirstName: 'Ana', state: 'showing_ticket' });
    events.length = 0;
    const r = await svc.revoke(owner(), device.id);
    expect(r).toEqual({ revoked: true, endedSessionIds: [s.id] });
    expect(mem.deviceByTokenHash(sha(token))).toBeUndefined();
    expect((await mem.device(T1, device.id))).toMatchObject({ pairingStatus: 'unpaired' });
    expect(events.map((e) => `${e.room}|${e.event}`)).toEqual([
      `device:${device.id}|customer_display_device_updated`,
      `tenant:${T1}:branch:${B1}|customer_display_canceled`,
      `tenant:${T1}:branch:${B1}|customer_display_device_updated`,
    ]);
    expect((await svc.list(owner())).devices).toEqual([]);
    await expect(svc.revoke(owner(), device.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('Refresh Display asks the display itself (its own channel) and says whether it is connected to hear it', async () => {
    const { device } = await pairOne();
    events.length = 0;
    expect(await svc.refresh(owner(), device.id)).toEqual({ requested: true, online: true });   // pickup counts as seen
    expect(events).toEqual([{ room: `device:${device.id}`, event: 'customer_display_refresh_requested', payload: { deviceId: device.id } }]);
    now += DISPLAY_ONLINE_WINDOW_MS + 1;
    expect(await svc.refresh(owner(), device.id)).toEqual({ requested: true, online: false });
  });

  it('registers: unique per branch, renamed, retired — a retired register\'s displays become shared', async () => {
    const r1 = await svc.createStation(owner(), { name: 'Register 1' });
    await expect(svc.createStation(owner(), { name: ' register 1 ' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await svc.createStation(owner({ branchId: B2 }), { name: 'Register 1' })).toMatchObject({ branchId: B2 });   // another branch may
    const { device } = await pairOne('Desk', owner(), r1.id);
    expect(await svc.renameStation(owner(), r1.id, { name: 'Front Register' })).toMatchObject({ name: 'Front Register' });
    await expect(svc.renameStation(owner({ branchId: B2 }), r1.id, { name: 'X' })).rejects.toMatchObject({ code: 'invalid' });
    expect(await svc.retireStation(owner(), r1.id)).toEqual({ retired: true, unassignedDeviceIds: [device.id] });
    expect((await svc.list(owner())).devices[0]).toMatchObject({ pairing: 'shared', stationId: null });
    expect((await svc.list(owner())).stations).toEqual([]);
  });

  it('names are one line, 1–40 characters', () => {
    expect(cleanDisplayName(' Front\n\tDisplay ')).toBe('Front Display');
    expect(() => cleanDisplayName('x'.repeat(41))).toThrow(DisplayDeviceError);
    expect(() => cleanDisplayName(42)).toThrow(DisplayDeviceError);
  });
});

describe('the public door (§8, §12) — what anyone on the internet can reach', () => {
  afterEach(() => vi.useRealTimers());
  const status = async (p: Promise<unknown>) => p.then(() => 200, (e) => (e instanceof HttpException ? e.getStatus() : -1));

  it('a network may ask for a few pairing codes a minute; the next is 429 — another network is unaffected, and a minute later it may again', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T15:00:05Z'));
    const ctl = new CustomerDisplayController(undefined as any, undefined as any, svc);
    const from = (ip: string) => ({ ip, headers: {} });
    for (let i = 0; i < PAIRING_STARTS_PER_IP_PER_MINUTE; i++) expect(await status(ctl.startPairing(from('203.0.113.7'), { platform: 'web' }) as Promise<unknown>)).toBe(200);
    const refused = () => ctl.startPairing(from('203.0.113.7'), { platform: 'web' });
    expect(refused).toThrow(HttpException);
    try { refused(); } catch (e) { expect((e as HttpException).getStatus()).toBe(429); }
    expect(await status(ctl.startPairing(from('198.51.100.20'), {}) as Promise<unknown>)).toBe(200);
    expect(mem.pairings).toHaveLength(PAIRING_STARTS_PER_IP_PER_MINUTE + 1);   // the refused asks created nothing
    vi.setSystemTime(new Date('2026-10-06T15:01:05Z'));
    expect(await status(ctl.startPairing(from('203.0.113.7'), {}) as Promise<unknown>)).toBe(200);
  });

  it('device errors become honest HTTP answers: a wrong poll secret 403, a flood 429, a foreign display 404', async () => {
    const ctl = new CustomerDisplayController(undefined as any, undefined as any, svc);
    const s = await svc.startPairing({});
    expect(await status(ctl.pollPairing(s.pairingId, { pollSecret: 'guess' }))).toBe(403);
    expect(await status(ctl.pollPairing(s.pairingId, { pollSecret: s.pollSecret }))).toBe(200);
    expect(await status(runDisplayDevice(() => Promise.reject(new DisplayDeviceError('rate_limited', 'x'))))).toBe(429);
    expect(await status(runDisplayDevice(() => Promise.reject(new DisplayDeviceError('not_found', 'x'))))).toBe(404);
    expect(await status(runDisplayDevice(() => Promise.reject(new DisplayDeviceError('conflict', 'x'))))).toBe(409);
  });
});
