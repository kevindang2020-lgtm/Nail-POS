// presence.ts — Constitution 9 Phase 14: §48–53 presence, §111 scale, §112 privacy, §113 connection registry,
// §153 throttling.
//
// WHAT PRESENCE IS: "a connection exists" (§48). It answers "is the branch POS connected?", "is the technician
// app online?", "how many devices does this tenant have connected?".
//
// WHAT PRESENCE IS NOT — enforced by construction, not by convention:
//   §49  not a time clock. Nothing here reads or writes clock-in tables; the entry has no "working" concept;
//        the states are connection states (ONLINE / AWAY / BACKGROUND / OFFLINE), never "present at the salon".
//   §50  not authentication. A presence entry grants nothing; authorization stays with the HTTP guards.
//   §111 not a Postgres row updated every 25 s. Entries live in an ephemeral store with a TTL (in-memory on a
//        single instance, Redis with PX expiry across instances) and vanish on their own when a device disappears.
//   §112 not visible to the wrong audience. Tenant views exclude platform staff; customers see no employee state.
//
// TTL/heartbeat (§52–53): SSE is one-way, so the "pong" is the transport equivalent — the server refreshes the
// entry every time its 25 s heartbeat is WRITTEN to a live socket (a dead socket errors on write and tears
// down, which removes the entry). A device that goes silent expires after 90 s: "do not keep user online
// forever after device disappears". Clients may additionally REPORT a state (AWAY on tab hide, BACKGROUND on
// app suspend) over HTTP; those reports are throttled to one per 10 s per connection (§153).
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { isPlatformPrincipal, isCustomerPrincipal } from '@aipowersalon/permissions';

export type PresenceState = 'ONLINE' | 'AWAY' | 'BACKGROUND';   // OFFLINE = no entry (§51)

/** §113: the connection registry entry. Deliberately no name/email — identities are looked up by actorId if a screen needs them. */
export interface PresenceEntry {
  connectionId: string;
  sessionId: string | null;
  actorId: string;             // userId
  role: string;
  deviceId: string | null;     // from X-Device-Id when the client sends one; never trusted for anything but grouping
  tenantId: string;
  branchId: string | null;
  gatewayInstance: string;     // host:pid — §7: clients never see this, operators do
  state: PresenceState;
  connectedAt: string;
  lastHeartbeatAt: string;     // §53
}

export const PRESENCE_TTL_MS = 90_000;        // §52: 3 missed 25 s heartbeats
export const PRESENCE_REPORT_MIN_MS = 10_000; // §153

/** Port. Both implementations expire entries on their own; nothing persists (§111). */
export interface PresenceStore {
  put(entry: PresenceEntry, ttlMs: number): Promise<void> | void;
  remove(tenantId: string, connectionId: string): Promise<void> | void;
  get(tenantId: string, connectionId: string): Promise<PresenceEntry | null> | PresenceEntry | null;
  listTenant(tenantId: string): Promise<PresenceEntry[]> | PresenceEntry[];
  /** Platform-wide counts only (§112, §206): never a list of every tenant's people. */
  countAll(): Promise<{ connections: number; tenants: number }> | { connections: number; tenants: number };
}

export class InMemoryPresenceStore implements PresenceStore {
  private byTenant = new Map<string, Map<string, { e: PresenceEntry; expiresAt: number }>>();
  constructor(private readonly now: () => number = Date.now) {}
  put(e: PresenceEntry, ttlMs: number): void {
    const m = this.byTenant.get(e.tenantId) ?? new Map();
    m.set(e.connectionId, { e, expiresAt: this.now() + ttlMs });
    this.byTenant.set(e.tenantId, m);
  }
  remove(tenantId: string, connectionId: string): void {
    const m = this.byTenant.get(tenantId); if (!m) return;
    m.delete(connectionId); if (m.size === 0) this.byTenant.delete(tenantId);
  }
  get(tenantId: string, connectionId: string): PresenceEntry | null {
    const r = this.byTenant.get(tenantId)?.get(connectionId);
    if (!r) return null;
    if (r.expiresAt <= this.now()) { this.remove(tenantId, connectionId); return null; }
    return r.e;
  }
  listTenant(tenantId: string): PresenceEntry[] {
    const m = this.byTenant.get(tenantId); if (!m) return [];
    const t = this.now(); const out: PresenceEntry[] = [];
    for (const [id, r] of m) { if (r.expiresAt <= t) m.delete(id); else out.push(r.e); }
    if (m.size === 0) this.byTenant.delete(tenantId);
    return out;
  }
  countAll(): { connections: number; tenants: number } {
    let connections = 0, tenants = 0;
    for (const tid of [...this.byTenant.keys()]) { const n = this.listTenant(tid).length; if (n > 0) { tenants++; connections += n; } }
    return { connections, tenants };
  }
}

/**
 * Redis-backed store for multi-instance gateways: one key per connection with PX expiry (the TTL is Redis's, so
 * a crashed gateway's entries disappear without a reaper) plus a per-tenant SET of connection ids for listing;
 * ids whose key has expired are pruned from the SET on read. Not exercised in the sandbox (no Redis) — the
 * in-memory store carries the behavioural tests and this class mirrors its contract line for line.
 */
export interface PresenceRedis {
  set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  scard(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}
export class RedisPresenceStore implements PresenceStore {
  constructor(private readonly r: PresenceRedis, private readonly prefix = 'aps:presence') {}
  private k(t: string, c: string) { return `${this.prefix}:${t}:${c}`; }
  private set(t: string) { return `${this.prefix}:set:${t}`; }
  async put(e: PresenceEntry, ttlMs: number): Promise<void> {
    await this.r.set(this.k(e.tenantId, e.connectionId), JSON.stringify(e), 'PX', ttlMs);
    await this.r.sadd(this.set(e.tenantId), e.connectionId);
  }
  async remove(tenantId: string, connectionId: string): Promise<void> {
    await this.r.del(this.k(tenantId, connectionId)); await this.r.srem(this.set(tenantId), connectionId);
  }
  async get(tenantId: string, connectionId: string): Promise<PresenceEntry | null> {
    const raw = await this.r.get(this.k(tenantId, connectionId));
    if (!raw) { await this.r.srem(this.set(tenantId), connectionId); return null; }
    try { return JSON.parse(raw) as PresenceEntry; } catch { return null; }
  }
  async listTenant(tenantId: string): Promise<PresenceEntry[]> {
    const ids = await this.r.smembers(this.set(tenantId)); const out: PresenceEntry[] = [];
    for (const id of ids) { const e = await this.get(tenantId, id); if (e) out.push(e); }
    return out;
  }
  async countAll(): Promise<{ connections: number; tenants: number }> {
    const sets = await this.r.keys(`${this.prefix}:set:*`); let connections = 0, tenants = 0;
    for (const s of sets) { const n = (await this.listTenant(s.slice(`${this.prefix}:set:`.length))).length; if (n > 0) { tenants++; connections += n; } }
    return { connections, tenants };
  }
}

export const gatewayInstance = (): string => `${hostname()}:${process.pid}`;

/** What the gateway and the read endpoints use. */
export class PresenceService {
  private lastReport = new Map<string, number>();   // §153 throttle, per connection
  constructor(private readonly store: PresenceStore, private readonly now: () => number = Date.now) {}

  /** Called when a stream opens. Returns the registry entry (its connectionId is the client's handle for reports). */
  async register(ctx: { userId: string; role: string; tenantId: string; branchId?: string | null }, sessionId: string | null, deviceId: string | null): Promise<PresenceEntry> {
    const t = new Date(this.now()).toISOString();
    const e: PresenceEntry = {
      connectionId: randomUUID(), sessionId, actorId: ctx.userId, role: ctx.role, deviceId: deviceId || null,
      tenantId: ctx.tenantId, branchId: ctx.branchId || null, gatewayInstance: gatewayInstance(), state: 'ONLINE', connectedAt: t, lastHeartbeatAt: t,
    };
    await this.store.put(e, PRESENCE_TTL_MS);
    return e;
  }
  /** §52/§53: the server heartbeat reached a live socket — extend the TTL. */
  async heartbeat(e: PresenceEntry): Promise<void> {
    e.lastHeartbeatAt = new Date(this.now()).toISOString();
    await this.store.put(e, PRESENCE_TTL_MS);
  }
  async unregister(e: PresenceEntry): Promise<void> { this.lastReport.delete(e.connectionId); await this.store.remove(e.tenantId, e.connectionId); }

  /** §51/§153: a client reports AWAY/BACKGROUND/ONLINE over HTTP. Throttled; unknown connection ⇒ false. */
  async report(tenantId: string, actorId: string, connectionId: string, state: PresenceState): Promise<'ok' | 'throttled' | 'unknown' | 'forbidden'> {
    const e = await this.store.get(tenantId, connectionId);
    if (!e) return 'unknown';
    if (e.actorId !== actorId) return 'forbidden';                     // §50/§13: you may only report your own connection
    const last = this.lastReport.get(connectionId) ?? 0;
    if (this.now() - last < PRESENCE_REPORT_MIN_MS) return 'throttled';
    this.lastReport.set(connectionId, this.now());
    e.state = state; e.lastHeartbeatAt = new Date(this.now()).toISOString();
    await this.store.put(e, PRESENCE_TTL_MS);
    return 'ok';
  }

  /**
   * §48/§112 tenant view: this tenant's connections, grouped by branch, WITHOUT platform staff and WITHOUT
   * customers' connections (a customer's app being open is the customer's business, not the salon's).
   * Field-minimal: no session ids, no gateway instance (§24, §206).
   */
  async tenantView(tenantId: string): Promise<{ total: number; byBranch: Record<string, number>; connections: Array<Pick<PresenceEntry, 'connectionId' | 'actorId' | 'role' | 'deviceId' | 'branchId' | 'state' | 'connectedAt' | 'lastHeartbeatAt'>> }> {
    const all = (await this.store.listTenant(tenantId)).filter((e) => !isPlatformPrincipal(e.role) && !isCustomerPrincipal(e.role));
    const byBranch: Record<string, number> = {};
    for (const e of all) byBranch[e.branchId ?? 'none'] = (byBranch[e.branchId ?? 'none'] ?? 0) + 1;
    return {
      total: all.length, byBranch,
      connections: all.map(({ connectionId, actorId, role, deviceId, branchId, state, connectedAt, lastHeartbeatAt }) => ({ connectionId, actorId, role, deviceId, branchId, state, connectedAt, lastHeartbeatAt })),
    };
  }
  /** §59/§146/§206 platform view: aggregate counts only, never a roster of tenants' people. */
  async platformView(): Promise<{ connections: number; tenants: number; gatewayInstance: string }> {
    const c = await this.store.countAll();
    return { ...c, gatewayInstance: gatewayInstance() };
  }
}
