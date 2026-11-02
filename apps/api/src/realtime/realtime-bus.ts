// realtime-bus.ts — multi-instance fan-out for the SSE push bus, behind the SAME RealtimeEmitter interface the
// in-process bus uses (realtime.gateway.ts). With multiple API nodes, an EventSource is connected to exactly ONE node,
// so a payment/queue change handled on node A must reach subscribers parked on node B. This wraps the per-node
// InProcessEmitter (which owns the SSE subscriber registry + local delivery) with a Redis pub/sub layer:
//
//   emit  →  PUBLISH {room,event,payload} to one channel
//   every node's SUBSCRIBE handler  →  deliverLocal(room, …) to ITS OWN connected clients
//
// Because every node (including the one that emitted) delivers only when the message comes back over the channel,
// each connection receives the event exactly once — no origin tagging or de-dup needed. A publish failure falls back
// to local delivery so a Redis hiccup degrades (this node's clients still update) instead of dropping the event.
//
// The Redis surface is abstracted behind RealtimePubSub so the emitter is unit-tested with an in-memory fake (two
// emitters sharing one fake bus = two API nodes) — no live Redis required. makeRealtimePubSub() wires real ioredis.
import { RealtimeEmitter, Emission, ensureEnvelope, rooms, EventName, EVENTS, displayNudgeTicketId } from '@aipowersalon/realtime-contracts';
import type { OnModuleDestroy } from '@nestjs/common';
import { InProcessEmitter } from './realtime.gateway';

type Ctx = { tenantId: string; branchId: string };

// Minimal pub/sub port. publish() must invoke every subscribed handler on the channel across all connected nodes
// (that is exactly Redis PUBLISH/SUBSCRIBE semantics — the publisher's own subscriber is included).
export interface RealtimePubSub {
  publish(channel: string, message: string): Promise<unknown> | unknown;
  /** §31–32: an ATOMIC per-room counter shared by every gateway instance (Redis INCR). Optional: a bus without
   *  it falls back to the origin node's local counter, which is only correct for a single instance. */
  nextSeq?(room: string): Promise<number> | number;
  /** §36/§236: the room's CURRENT sequence from the shared counter — authoritative even on a gateway that just restarted with an empty local memory. */
  currentSeq?(room: string): Promise<number> | number;
  subscribe(channel: string, handler: (message: string) => void): Promise<void> | void;
  close?(): Promise<unknown> | unknown;
}

export class RedisRealtimeEmitter implements RealtimeEmitter, OnModuleDestroy {
  private started = false;
  constructor(
    private readonly local: InProcessEmitter,
    private readonly pubsub: RealtimePubSub,
    private readonly channel = 'aps:realtime',
  ) {}

  // Begin receiving fan-out from other nodes. Idempotent. NEVER rejects: the caller fires it with `void`, and an
  // unhandled rejection here crashed a worker booted while Redis was unreachable (BUILD_PLAN Phase 11). A failed
  // subscribe leaves this node on local delivery (its own SSE clients still get every event it emits) and is retried
  // on the next fan-out, so the node rejoins the bus once Redis is back.
  private lastInitWarn = 0;
  async init(): Promise<void> {
    if (this.started) return;
    try {
      await this.pubsub.subscribe(this.channel, (message) => this.onMessage(message));
      this.started = true;
    } catch (e) {
      this.local.metrics.backbonePublishFailures++;
      const now = Date.now();
      if (now - this.lastInitWarn > 60_000) { this.lastInitWarn = now; console.warn(`[realtime] bus subscribe failed — this node delivers locally until Redis is reachable: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
    }
  }

  private onMessage(message: string): void {
    let e: Emission | null = null;
    try { e = JSON.parse(message) as Emission; } catch { return; }            // ignore malformed payloads
    if (!e || typeof e.room !== 'string' || typeof e.event !== 'string') return;
    this.local.deliverLocal(e.room, e.event as EventName, e.payload, e.seq);   // → this node's connected SSE clients, same seq on every node
  }

  // --- SSE transport surface: delegate to the per-node local registry (RealtimeController calls these via REALTIME) ---
  subscribe(room: string, fn: (e: Emission) => void): () => void { return this.local.subscribe(room, fn); }
  currentSeq(room: string): number { return this.local.currentSeq(room); }
  /** Prefer the shared counter (survives a gateway restart); fall back to what this node has delivered. */
  async currentSeqAsync(room: string): Promise<number> {
    if (this.pubsub.currentSeq) { try { const n = Number(await this.pubsub.currentSeq(room)); if (Number.isFinite(n)) return Math.max(n, this.local.currentSeq(room)); } catch { /* fall through */ } }
    return this.local.currentSeq(room);
  }
  get metrics() { return this.local.metrics; }
  subscriberCount(room: string): number { return this.local.subscriberCount(room); }

  // --- RealtimeEmitter surface: publish to the channel; on failure, at least serve this node's own clients ---
  /** Same §12/§19/§20 chokepoint as the local emitter — the envelope is created HERE, once, on the origin node,
   *  then crosses the bus as-is, so every node delivers one identity and dedupe works everywhere. */
  private sealed(event: EventName, payload: unknown, scope?: { tenantId?: string; branchId?: string }): unknown {
    const { envelope, piiStripped } = ensureEnvelope(event, payload, scope);
    if (piiStripped > 0) this.local.metrics.piiStripped += piiStripped;
    return envelope;
  }

  private fanout(room: string, event: EventName, payload: unknown): void {
    if (!this.started) void this.init();   // rejoin the bus after a failed start (never throws)
    // §31: the sequence is minted ONCE, here on the origin node, before the message crosses the bus — so every
    // instance delivers the same seq for the same emission and a client on any gateway can detect a gap.
    // A synchronous counter (local, or a fake bus in tests) keeps delivery synchronous — callers have always
    // been able to assert right after toTenant(); only a genuinely async counter (Redis INCR) defers by one tick.
    const seqP = this.pubsub.nextSeq ? this.pubsub.nextSeq(room) : this.local.nextSeq(room);
    const send = (seq: number) => {
      const message = JSON.stringify({ room, event, payload, seq } as Emission);
      let pub: unknown;
      try { pub = this.pubsub.publish(this.channel, message); }
      catch { this.local.metrics.backbonePublishFailures++; this.local.deliverLocal(room, event, payload, seq); return; }   // synchronous publish failure
      // async rejection (network drop after the call): same local fallback, once
      Promise.resolve(pub).catch(() => { this.local.metrics.backbonePublishFailures++; this.local.deliverLocal(room, event, payload, seq); });
    };
    if (typeof seqP === 'number') { send(seqP); return; }
    seqP.then(send).catch(() => this.local.deliverLocal(room, event, payload));    // counter unavailable: local seq, still delivered
  }

  toTenant(ctx: Ctx, event: EventName, payload: unknown = {}): void {
    this.fanout(rooms.tenantBranch(ctx.tenantId, ctx.branchId), event, this.sealed(event, payload, ctx));
    // 23-inch dual-screen spec §36–§37: a change to ONE ticket also nudges the display showing it (ids only, never re-mirrored).
    const nudge = displayNudgeTicketId(event, payload);
    if (nudge) this.toTicket(nudge, EVENTS.customerDisplayCheckoutUpdated, { ticketId: nudge });
  }
  toTechnician(technicianId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.technician(technicianId), event, this.sealed(event, payload)); }
  toTicket(ticketId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.ticket(ticketId), event, this.sealed(event, payload)); }
  toCustomerDisplay(displayId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.customerDisplay(displayId), event, this.sealed(event, payload)); }
  toCustomerDisplayDevice(deviceId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.customerDisplayDevice(deviceId), event, this.sealed(event, payload)); }
  toPaymentDevice(tenantId: string, deviceId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.paymentDevice(tenantId, deviceId), event, this.sealed(event, payload, { tenantId })); }
  toOwner(tenantId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.ownerTenant(tenantId), event, this.sealed(event, payload, { tenantId })); }
  toCustomer(customerId: string, event: EventName, payload: unknown = {}): void { this.fanout(rooms.customer(customerId), event, this.sealed(event, payload)); }
  toPlatform(event: EventName, payload: unknown = {}): void { this.fanout(rooms.platform(), event, this.sealed(event, payload)); }

  async onModuleDestroy(): Promise<void> { try { await this.pubsub.close?.(); } catch { /* shutting down */ } }
}

// Real ioredis pub/sub. SUBSCRIBE needs a dedicated connection (a subscriber-mode client can't issue PUBLISH), so we
// open two: one for publishing, one for subscribing. Only called when REALTIME_BUS=redis and a URL is configured.
export function makeRealtimePubSub(url: string): RealtimePubSub {
  // Imported lazily via the shared helper so non-Redis deployments never load ioredis.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
  const pub = makeIoredis(url, 'realtime');
  const sub = makeIoredis(url, 'realtime');
  return {
    publish: (channel, message) => pub.publish(channel, message),
    nextSeq: (room) => pub.incr(`aps:rt:seq:${room}`),          // §32 atomic, cross-instance, per room
    currentSeq: async (room) => Number((await pub.get(`aps:rt:seq:${room}`)) ?? 0),   // §236 authoritative after a restart
    subscribe: async (channel, handler) => {
      sub.on('message', (ch: string, msg: string) => { if (ch === channel) handler(msg); });
      await sub.subscribe(channel);
    },
    close: async () => { try { await sub.quit(); } finally { await pub.quit(); } },
  };
}
