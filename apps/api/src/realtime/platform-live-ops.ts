// platform-live-ops.ts — Constitution 9 Phase 20: §59 Super Admin Live Operations, §60 aggregated platform
// streams, §146 "consume aggregate realtime projections", §206 aggregate by default.
//
// The Super Admin browser is NEVER subscribed to a branch's raw stream. It subscribes to ONE platform room,
// and that room receives ONE event: `platform_ops_snapshot`, published every 10 s while someone is listening,
// carrying counts only — active tenants, connections, payment rate, queue rate, booking rate, gateway health.
// No tenant, customer or employee identity ever enters this room (§60 "not every tenant customer's identity").
//
// The rates come from a Constitution 8 consumer that INCREMENTS transient per-minute buckets from domain events
// and stores nothing — replaying it is harmless (REPLAY_SAFE) and it reads no payload fields beyond the event
// type, so a leaked identity has no path in.
import { DOMAIN_EVENTS, type DomainEvent, type EventConsumer } from '@aipowersalon/events';
import { Injectable, Optional } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { InProcessEmitter } from './realtime.gateway';
import { rooms, EVENTS } from '@aipowersalon/realtime-contracts';
import { PresenceService } from './presence';
import { evaluateRealtimeHealth } from './realtime-health';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { PlatformOpsSnapshot } from '@aipowersalon/api-contracts/platform';
import type { PlatformOpsSnapshot } from '@aipowersalon/api-contracts/platform';

/** Per-minute counters, bounded to the last 10 minutes. Counts only. */
export class RateBuckets {
  private buckets = new Map<string, Map<number, number>>();
  constructor(private readonly now: () => number = Date.now) {}
  bump(name: string): void {
    const minute = Math.floor(this.now() / 60000);
    const m = this.buckets.get(name) ?? new Map<number, number>();
    m.set(minute, (m.get(minute) ?? 0) + 1);
    for (const k of m.keys()) if (k < minute - 10) m.delete(k);
    this.buckets.set(name, m);
  }
  /** Completed previous minute (stable) or the current one if nothing completed yet. */
  perMinute(name: string): number {
    const minute = Math.floor(this.now() / 60000); const m = this.buckets.get(name);
    return m ? (m.get(minute - 1) ?? m.get(minute) ?? 0) : 0;
  }
  /** Tenants seen in the last 5 minutes — "active tenant count" (§60). */
  private activeTenants = new Map<string, number>();
  touchTenant(tenantId: string): void {
    this.activeTenants.set(tenantId, this.now());
    if (this.activeTenants.size > 20_000) this.activeTenants.delete(this.activeTenants.keys().next().value as string);
  }
  activeTenantCount(windowMs = 5 * 60_000): number {
    const since = this.now() - windowMs; let n = 0;
    for (const [t, at] of this.activeTenants) { if (at >= since) n++; else this.activeTenants.delete(t); }
    return n;
  }
}

/** Constitution 8 consumer: counts. Reads nothing from payloads. */
export class PlatformLiveOpsConsumer implements EventConsumer {
  readonly name = 'platform.live_ops_counters';
  readonly eventTypes = [DOMAIN_EVENTS.PAYMENT_CAPTURED, DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED, DOMAIN_EVENTS.APPOINTMENT_CREATED] as const;
  readonly replay = 'REPLAY_SAFE' as const;          // transient counters: a replay changes a number for a minute, nothing else
  constructor(private readonly rates: RateBuckets) {}
  async handle(e: DomainEvent<any>, _trx: Transaction<DB>): Promise<void> {
    void _trx;
    if (e.tenantId) this.rates.touchTenant(e.tenantId);
    if (e.eventType === DOMAIN_EVENTS.PAYMENT_CAPTURED) this.rates.bump('payments');
    else if (e.eventType === DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED) this.rates.bump('queue_joins');
    else if (e.eventType === DOMAIN_EVENTS.APPOINTMENT_CREATED) this.rates.bump('bookings');
  }
}


@Injectable()
export class PlatformLiveOpsService {
  readonly rates = new RateBuckets();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly bus: InProcessEmitter, @Optional() private readonly presence?: PresenceService) {}

  /** §60: the aggregate snapshot. Nothing in it identifies a tenant, customer or employee. */
  async snapshot(): Promise<PlatformOpsSnapshot> {
    const m = this.bus.metrics.snapshot();
    const p = this.presence ? await this.presence.platformView() : { connections: 0, tenants: 0 };
    const health = evaluateRealtimeHealth({
      activeConnections: this.bus.totalSubscribers(), reconnectsPerMinute: m.reconnectsPerMinute, authFailuresPerMinute: m.authFailuresPerMinute,
      latencyP95Ms: m.latencyP95Ms, eventsPerMinute: m.eventsPerMinute,
      backbone: process.env.REALTIME_REDIS_URL || process.env.REDIS_URL ? 'redis' : 'in-process',
      backbonePublishFailures: m.backbonePublishFailures, slowClientDisconnects: m.slowClientDisconnects,
    });
    return {
      at: new Date().toISOString(),
      activeTenants: this.rates.activeTenantCount(), connections: p.connections, connectedTenants: p.tenants,
      paymentsPerMinute: this.rates.perMinute('payments'), queueJoinsPerMinute: this.rates.perMinute('queue_joins'), bookingsPerMinute: this.rates.perMinute('bookings'),
      eventsPerMinute: m.eventsPerMinute, latencyP95Ms: m.latencyP95Ms, health,
    };
  }

  /** Publish one snapshot to the platform room — only if anyone is listening (§59 read-heavy metrics are aggregated, not pushed into the void). */
  async tick(): Promise<boolean> {
    if (this.bus.subscriberCount(rooms.platform()) === 0) return false;
    this.bus.toPlatform(EVENTS.platformOpsSnapshot, await this.snapshot());
    return true;
  }
  start(intervalMs = 10_000): void { if (!this.timer) { this.timer = setInterval(() => { void this.tick(); }, intervalMs); this.timer.unref?.(); } }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  /** Nest lifecycle: the ticker runs for the life of the process; it does nothing while no Super Admin is connected. */
  onModuleInit(): void { if (process.env.NODE_ENV !== 'test') this.start(); }
  onModuleDestroy(): void { this.stop(); }
}
