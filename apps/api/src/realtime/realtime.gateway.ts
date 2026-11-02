// realtime.gateway.ts — RealtimeEmitter port + a COMPLETE in-process implementation (runs now, no infra).
// Domain services publish through this; the SSE transport (realtime.controller) subscribes per connection.
// For multi-instance prod, back InProcessEmitter's bus with socket.io/Redis behind the SAME interface.
import { Injectable } from '@nestjs/common';
import { ensureEnvelope, rooms, EVENTS, displayNudgeTicketId, type EventName } from '@aipowersalon/realtime-contracts';

import { REALTIME, type RealtimeEmitter, type Emission } from '@aipowersalon/realtime-contracts';
export { REALTIME, type RealtimeEmitter, type Emission };   // re-exported for the realtime dir's own use; the port LIVES in the package
type Ctx = { tenantId: string; branchId: string };

// ── §33 delivery metrics, kept where the events actually flow ─────────────────────────────────────────────
// Counters + a small latency reservoir. "Delivery latency" here = envelope.updatedAt → written to this node's
// subscribers; client-processed time would need client acks, which §33 marks "where practical" — not built.
export class RealtimeMetrics {
  eventsDelivered = 0;
  piiStripped = 0;                     // §12 forbidden keys removed at the port before any delivery
  eventsDropped = 0;                     // subscriber callback threw
  connectionsOpened = 0;
  connectionsClosed = 0;
  reconnects = 0;
  resyncsRequired = 0;
  authzTerminations = 0;
  slowClientDrops = 0;                   // §102: frames dropped because the connection's write buffer was over the cap
  slowClientResyncs = 0;                 // §102: RESYNC_REQUIRED sent after a slow client drained
  slowClientDisconnects = 0;
  originRejected = 0;                    // §196: credentialed opens refused for a disallowed Origin
  connectsRateLimited = 0;
  backbonePublishFailures = 0;           // §147: Redis publish failed and delivery fell back to this node only               // §149/§150: opens refused by the per-principal connect limiter             // §98: clients cut for staying over the cap past the grace period                 // §42-44: streams ended because role/branch/status changed under them                   // §33: reconnects that arrived behind the room's seq and were told to resync                        // opens that carried Last-Event-ID / reconnect hint
  private latencies: number[] = [];      // bounded reservoir of updatedAt→delivered ms
  private readonly cap = 500;
  private minuteBuckets = new Map<number, number>();   // epoch-minute → events (bounded to last 10)

  markDelivered(count: number, envelopeUpdatedAt?: string): void {
    this.eventsDelivered += count;
    const minute = Math.floor(Date.now() / 60000);
    this.minuteBuckets.set(minute, (this.minuteBuckets.get(minute) || 0) + count);
    for (const k of this.minuteBuckets.keys()) if (k < minute - 10) this.minuteBuckets.delete(k);
    if (envelopeUpdatedAt) {
      const ms = Date.now() - Date.parse(envelopeUpdatedAt);
      if (Number.isFinite(ms) && ms >= 0 && ms < 60_000) {
        this.latencies.push(ms);
        if (this.latencies.length > this.cap) this.latencies.shift();
      }
    }
  }
  /** §140/§147: per-minute rates for the signals incident detection needs (reconnect storm, auth-failure spike). */
  private rateBuckets = new Map<string, Map<number, number>>();
  mark(name: 'reconnects' | 'originRejected' | 'connectsRateLimited' | 'authzTerminations' | 'resyncsRequired' | 'slowClientDisconnects'): void {
    this[name] = (this[name] ?? 0) + 1;
    const minute = Math.floor(Date.now() / 60000);
    const m = this.rateBuckets.get(name) ?? new Map<number, number>();
    m.set(minute, (m.get(minute) ?? 0) + 1);
    for (const k of m.keys()) if (k < minute - 10) m.delete(k);
    this.rateBuckets.set(name, m);
  }
  perMinute(name: string): number {
    const minute = Math.floor(Date.now() / 60000); const m = this.rateBuckets.get(name);
    return m ? (m.get(minute - 1) ?? 0) + (m.get(minute) ?? 0) : 0;   // last ~1-2 minutes: a storm shows up immediately
  }
  eventsPerMinute(): number {
    const minute = Math.floor(Date.now() / 60000);
    return this.minuteBuckets.get(minute - 1) ?? this.minuteBuckets.get(minute) ?? 0;
  }
  percentile(p: number): number | null {
    if (!this.latencies.length) return null;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }
  snapshot() {
    return {
      eventsDelivered: this.eventsDelivered, eventsDropped: this.eventsDropped, piiStripped: this.piiStripped,
      connectionsOpened: this.connectionsOpened, connectionsClosed: this.connectionsClosed,
      reconnects: this.reconnects, eventsPerMinute: this.eventsPerMinute(),
      latencyP50Ms: this.percentile(50), latencyP95Ms: this.percentile(95), latencyP99Ms: this.percentile(99),
      // Constitution 9 counters (§140, §147)
      resyncsRequired: this.resyncsRequired, authzTerminations: this.authzTerminations,
      slowClientDrops: this.slowClientDrops, slowClientResyncs: this.slowClientResyncs, slowClientDisconnects: this.slowClientDisconnects,
      originRejected: this.originRejected, connectsRateLimited: this.connectsRateLimited, backbonePublishFailures: this.backbonePublishFailures,
      reconnectsPerMinute: this.perMinute('reconnects'),
      authFailuresPerMinute: this.perMinute('originRejected') + this.perMinute('connectsRateLimited') + this.perMinute('authzTerminations'),
    };
  }
}

@Injectable()
export class InProcessEmitter implements RealtimeEmitter {
  private subs = new Map<string, Array<(e: Emission) => void>>();
  public readonly metrics = new RealtimeMetrics();
  public log: Emission[] = [];          // recent emissions, capped — used by tests/diagnostics only

  // Returns a REAL teardown: removes this listener (and prunes the empty room) so an SSE disconnect can't leak.
  subscribe(room: string, fn: (e: Emission) => void): () => void {
    const arr = this.subs.get(room) || [];
    arr.push(fn);
    this.subs.set(room, arr);
    return () => {
      const cur = this.subs.get(room);
      if (!cur) return;
      const i = cur.indexOf(fn);
      if (i >= 0) cur.splice(i, 1);
      if (cur.length === 0) this.subs.delete(room);
    };
  }

  // Deliver to THIS process's subscribers for `room` (and record in the bounded log). Public so a multi-instance
  // fan-out layer (realtime-bus.ts) can push events that arrived from another node into this node's SSE clients.
  /** §32 per-room counters (single-instance path). The Redis emitter overrides with INCR so instances agree. */
  private seqs = new Map<string, number>();
  private lastSeen = new Map<string, number>();
  nextSeq(room: string): number { const n = (this.seqs.get(room) ?? 0) + 1; this.seqs.set(room, n); return n; }
  /** The highest sequence this node has DELIVERED for a room — what a reconnecting client is compared against (§36). */
  currentSeq(room: string): number { return this.lastSeen.get(room) ?? 0; }
  async currentSeqAsync(room: string): Promise<number> { return this.currentSeq(room); }

  deliverLocal(room: string, event: EventName, payload: unknown, seq?: number): void {
    const n = seq ?? this.nextSeq(room);
    if (n > (this.lastSeen.get(room) ?? 0)) this.lastSeen.set(room, n);
    const e: Emission = { room, event, payload, seq: n };
    this.log.push(e);
    if (this.log.length > 200) this.log.shift();   // bounded — never grows unbounded in a long-running process
    const listeners = this.subs.get(room) || [];
    let ok = 0;
    for (const fn of listeners) {
      try { fn(e); ok++; } catch { this.metrics.eventsDropped++; /* a broken subscriber must not break others */ }
    }
    if (ok > 0) this.metrics.markDelivered(ok, (payload as any)?.updatedAt);
  }

  private emit(room: string, event: EventName, payload: unknown): void { this.deliverLocal(room, event, payload); }

  /** §12/§19/§20 chokepoint: every payload leaves this port as a real envelope; forbidden keys never leave at all. */
  private sealed(event: EventName, payload: unknown, scope?: { tenantId?: string; branchId?: string }): unknown {
    const { envelope, piiStripped } = ensureEnvelope(event, payload, scope);
    if (piiStripped > 0) this.metrics.piiStripped += piiStripped;
    return envelope;
  }

  toTenant(ctx: Ctx, event: EventName, payload: unknown = {}): void {
    this.emit(rooms.tenantBranch(ctx.tenantId, ctx.branchId), event, this.sealed(event, payload, ctx));
    // 23-inch dual-screen spec §36–§37: a change to ONE ticket also nudges the display showing it (ids only, never re-mirrored).
    const nudge = displayNudgeTicketId(event, payload);
    if (nudge) this.toTicket(nudge, EVENTS.customerDisplayCheckoutUpdated, { ticketId: nudge });
  }
  toTechnician(technicianId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.technician(technicianId), event, this.sealed(event, payload)); }
  toTicket(ticketId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.ticket(ticketId), event, this.sealed(event, payload)); }
  toCustomerDisplay(displayId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.customerDisplay(displayId), event, this.sealed(event, payload)); }
  toCustomerDisplayDevice(deviceId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.customerDisplayDevice(deviceId), event, this.sealed(event, payload)); }
  toPaymentDevice(tenantId: string, deviceId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.paymentDevice(tenantId, deviceId), event, this.sealed(event, payload, { tenantId })); }
  toOwner(tenantId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.ownerTenant(tenantId), event, this.sealed(event, payload, { tenantId })); }
  toCustomer(customerId: string, event: EventName, payload: unknown = {}): void { this.emit(rooms.customer(customerId), event, this.sealed(event, payload)); }
  toPlatform(event: EventName, payload: unknown = {}): void { this.emit(rooms.platform(), event, this.sealed(event, payload)); }

  // test/diagnostic helper: current subscriber count for a room
  subscriberCount(room: string): number { return (this.subs.get(room) || []).length; }
  // §34/§35: totals + per-room view for System Status and tenant diagnostics. Room keys only — no tenant content.
  totalSubscribers(): number { let n = 0; for (const a of this.subs.values()) n += a.length; return n; }
  roomsSnapshot(): { room: string; subscribers: number }[] { return [...this.subs.entries()].map(([room, a]) => ({ room, subscribers: a.length })); }
}
