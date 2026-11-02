// realtime.module.ts — provides the event bus + the SSE transport. @Global so domain modules can inject the emitter
// (via the REALTIME token) in their useFactory `inject` arrays without importing this module.
//
// Single instance (default): REALTIME resolves to the in-process bus — identical behavior to before.
// Multiple instances (REALTIME_BUS=redis + a Redis URL): REALTIME resolves to a Redis fan-out that wraps the SAME
// per-node InProcessEmitter (so the SSE controller's subscribe()/local delivery are unchanged; only emit fans out
// across nodes). See realtime-bus.ts.
import { attachRealtimeTelemetry } from '@aipowersalon/observability';
import { Global, Module } from '@nestjs/common';
import { InProcessEmitter } from './realtime.gateway';
import { REALTIME } from '@aipowersalon/realtime-contracts';
import { RealtimeController } from './realtime.controller';
import { RedisRealtimeEmitter, makeRealtimePubSub } from './realtime-bus';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { KyselyAuthzVersionSource } from './authz-revalidation';
import { PresenceService, InMemoryPresenceStore, RedisPresenceStore } from './presence';
import { PlatformLiveOpsService } from './platform-live-ops';
import { PresenceController, PlatformPresenceController } from './presence.controller';
import { RealtimeStreamFactory } from './realtime-stream';
import { StreamTicketService, StreamTicketMiddleware } from './stream-tickets';   // BUILD_PLAN Phase 13: native realtime tickets
import { StreamTicketController } from './stream-ticket.controller';

@Global()
@Module({
  controllers: [RealtimeController, PresenceController, PlatformPresenceController, StreamTicketController],
  providers: [
    InProcessEmitter,
    {
      provide: REALTIME,
      useFactory: (local: InProcessEmitter) => {
        // Constitution 11 §50-51: the gateway's own counters into the metrics registry. Same numbers, one more
        // reader, no second counter. The local emitter holds the counters whichever backbone is in use.
        attachRealtimeTelemetry({ snapshot: () => local.metrics.snapshot(), activeConnections: () => local.totalSubscribers() });
        const url = process.env.REALTIME_REDIS_URL || process.env.REDIS_URL;
        if ((process.env.REALTIME_BUS || '').toLowerCase() === 'redis' && url) {
          const emitter = new RedisRealtimeEmitter(local, makeRealtimePubSub(url), process.env.REALTIME_CHANNEL || 'aps:realtime');
          void emitter.init(); // subscribe to the channel; failures fall back to local delivery
          return emitter;
        }
        return local; // default: single-node in-process bus
      },
      inject: [InProcessEmitter],
    },
    // Constitution 9 §42/§127/§128: the source of "what does this user's authorization look like right now",
    // read from the same rows the HTTP guards read. Absent without a DB (unit harness) → streams behave as before.
    // Phase 14: ephemeral presence registry — Redis (PX expiry) when REALTIME_REDIS_URL is set, else in-memory.
    // Nothing here is persisted (§111).
    {
      provide: PresenceService,
      useFactory: () => {
        const url = process.env.REALTIME_REDIS_URL || process.env.REDIS_URL;
        if (url) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily: ioredis is only needed when REDIS_URL is set
            const { makeIoredis } = require('@aipowersalon/cache') as typeof import('@aipowersalon/cache');
            return new PresenceService(new RedisPresenceStore(makeIoredis(url, 'realtime') as any));
          } catch { /* fall through to in-memory */ }
        }
        return new PresenceService(new InMemoryPresenceStore());
      },
    },
    RealtimeStreamFactory,
    StreamTicketService, StreamTicketMiddleware,
    { provide: 'AUTHZ_VERSION_SOURCE', inject: [DATABASE], useFactory: (db: AppDatabase | null) => (db ? new KyselyAuthzVersionSource(db) : null) },
    // B-14 remainder (Oct 20 2026): the platform live-ops projection (rate buckets + 10 s ticker) is a realtime concern — provided
    // HERE, once, so the event consumer that feeds its rates (events/consumers) and the Super Admin screens that read it share
    // one instance without the events layer importing the Super Admin system-status module (the one platform→domain back-edge)
    { provide: PlatformLiveOpsService, inject: [InProcessEmitter, PresenceService], useFactory: (bus: InProcessEmitter, presence: PresenceService) => new PlatformLiveOpsService(bus, presence) },
  ],
  exports: [InProcessEmitter, REALTIME, 'AUTHZ_VERSION_SOURCE', PresenceService, RealtimeStreamFactory, StreamTicketService, StreamTicketMiddleware, PlatformLiveOpsService],
})
export class RealtimeModule {}
