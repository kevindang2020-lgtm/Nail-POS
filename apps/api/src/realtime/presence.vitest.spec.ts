// presence.vitest.spec — Constitution 9 Phase 14: §48–53 presence semantics, §111 ephemeral TTL, §112 privacy,
// §113 registry, §153 throttling — and the §49 invariant that presence is NOT a time clock.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { firstValueFrom, take, toArray } from 'rxjs';
import { InMemoryPresenceStore, PresenceService, PRESENCE_TTL_MS, PRESENCE_REPORT_MIN_MS } from './presence';
import { PresenceController, PlatformPresenceController } from './presence.controller';
import { InProcessEmitter } from './realtime.gateway';
import { RealtimeController } from './realtime.controller';
import { RealtimeStreamFactory } from './realtime-stream';

const clock = (start = 1_000_000) => { let t = start; return { now: () => t, tick: (ms: number) => { t += ms; } }; };
const owner = { userId: 'u-owner', role: 'OWNER', tenantId: 't-1', branchId: 'b-1' };
const tech = { userId: 'u-tech', role: 'TECHNICIAN', tenantId: 't-1', branchId: 'b-2' };
const sa = { userId: 'u-sa', role: 'SUPER_ADMIN', tenantId: 't-1', branchId: null };
const cust = { userId: 'u-cust', role: 'CUSTOMER', tenantId: 't-1', branchId: null };

describe('§113 registry + §52 TTL', () => {
  it('registers a connection with the fields §113 names, counts it, and expires it after 90s without a heartbeat', async () => {
    const c = clock(); const svc = new PresenceService(new InMemoryPresenceStore(c.now), c.now);
    const e = await svc.register(owner, 'sess-1', 'ipad-front');
    expect(e).toMatchObject({ actorId: 'u-owner', role: 'OWNER', tenantId: 't-1', branchId: 'b-1', deviceId: 'ipad-front', sessionId: 'sess-1', state: 'ONLINE' });
    expect(e.gatewayInstance).toMatch(/:\d+$/);
    expect((await svc.tenantView('t-1')).total).toBe(1);
    c.tick(PRESENCE_TTL_MS - 1); expect((await svc.tenantView('t-1')).total).toBe(1);
    c.tick(2);                   expect((await svc.tenantView('t-1')).total).toBe(0);     // §52: gone on its own
  });
  it('§53 a heartbeat extends the TTL and records lastHeartbeatAt; unregister removes immediately', async () => {
    const c = clock(); const svc = new PresenceService(new InMemoryPresenceStore(c.now), c.now);
    const e = await svc.register(tech, null, null);
    c.tick(60_000); await svc.heartbeat(e);
    c.tick(60_000); expect((await svc.tenantView('t-1')).total).toBe(1);                  // 120s total but heartbeat at 60s
    expect((await svc.tenantView('t-1')).connections[0].lastHeartbeatAt).toBe(new Date(1_000_000 + 60_000).toISOString());
    await svc.unregister(e); expect((await svc.tenantView('t-1')).total).toBe(0);
  });
});

describe('§51/§153 state reports', () => {
  it('a client may report its OWN connection; a second report inside 10s is throttled; another user is forbidden', async () => {
    const c = clock(); const svc = new PresenceService(new InMemoryPresenceStore(c.now), c.now);
    const e = await svc.register(owner, null, null);
    expect(await svc.report('t-1', 'u-owner', e.connectionId, 'AWAY')).toBe('ok');
    expect((await svc.tenantView('t-1')).connections[0].state).toBe('AWAY');
    expect(await svc.report('t-1', 'u-owner', e.connectionId, 'ONLINE')).toBe('throttled');
    c.tick(PRESENCE_REPORT_MIN_MS);
    expect(await svc.report('t-1', 'u-owner', e.connectionId, 'ONLINE')).toBe('ok');
    expect(await svc.report('t-1', 'u-tech', e.connectionId, 'AWAY')).toBe('forbidden');     // §13/§50
    expect(await svc.report('t-1', 'u-owner', 'no-such-conn', 'AWAY')).toBe('unknown');
    expect(await svc.report('t-2', 'u-owner', e.connectionId, 'AWAY')).toBe('unknown');      // §19: tenant-scoped lookup
  });
});

describe('§112 privacy', () => {
  it('the tenant view excludes platform staff and customers; the platform view is counts only', async () => {
    const c = clock(); const svc = new PresenceService(new InMemoryPresenceStore(c.now), c.now);
    await svc.register(owner, null, null); await svc.register(tech, null, null); await svc.register(sa, null, null); await svc.register(cust, null, null);
    const v = await svc.tenantView('t-1');
    expect(v.total).toBe(2);
    expect(v.connections.map((x) => x.role).sort()).toEqual(['OWNER', 'TECHNICIAN']);
    expect(v.byBranch).toEqual({ 'b-1': 1, 'b-2': 1 });
    expect(Object.keys(v.connections[0])).not.toContain('sessionId');                        // §206 field-minimal
    expect(Object.keys(v.connections[0])).not.toContain('gatewayInstance');
    const p = await svc.platformView();
    expect(p).toMatchObject({ connections: 4, tenants: 1 });
    expect(p).not.toHaveProperty('connections.0');                                           // no roster
  });
  it('a CUSTOMER calling the tenant endpoint is refused', async () => {
    const svc = new PresenceService(new InMemoryPresenceStore());
    const ctrl = new PresenceController(svc);
    await expect(ctrl.tenant({ ctx: cust })).rejects.toThrow(/customers/);
    const platform = new PlatformPresenceController(svc);
    expect(await platform.platform()).toMatchObject({ connections: 0, tenants: 0 });
  });
});

describe('§49 presence is NOT a time clock — enforced at the source', () => {
  it('the presence module never mentions clock-in, time-clock, shifts or attendance', () => {
    for (const f of ['src/realtime/presence.ts', 'src/realtime/presence.controller.ts']) {
      const src = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(src).not.toMatch(/clock[_-]?in|time[_-]?clock|clockIn|shift|attendance|punch/i);
    }
  });
});

describe('Phase 14 on the real stream', () => {
  const ctx = { tenantId: 't-1', branchId: 'b-1', userId: 'u-owner', role: 'OWNER', permissions: [] };
  it('opening a stream registers presence and tells the client its connectionId; closing it unregisters', async () => {
    const svc = new PresenceService(new InMemoryPresenceStore());
    const bus = new InProcessEmitter(); const ctrl = new RealtimeController(new RealtimeStreamFactory(bus, undefined, null, svc));
    const out: any[] = await firstValueFrom(ctrl.stream({ ctx, headers: { 'x-device-id': 'kiosk-1' }, sessionId: 's-9' }).pipe(take(2), toArray()));
    expect(out.map((f) => f.data.event).sort()).toEqual(['connected', 'presence_registered']);
    const reg = out.find((f) => f.data.event === 'presence_registered');
    expect(reg.data.connectionId).toMatch(/^[0-9a-f-]{36}$/);
    // take(2) completed the subscription → teardown ran → the entry is gone
    expect((await svc.tenantView('t-1')).total).toBe(0);
  });
});
