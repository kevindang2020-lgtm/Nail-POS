// integration-scheduler.service.ts — one bounded maintenance pass ("tick") that ties the engines together. A real
// deployment invokes tick() on an interval (via the app's scheduler/cron); the tick itself is pure orchestration over
// the existing audited services, so it's fully testable in isolation. Each pass, bounded by `limit`:
//   1. Scheduled syncs — enqueue an incremental sync for every active+valid, sync-capable connection whose
//      next_sync_at is due, and advance next_sync_at.
//   2. Drain the sync queue (bounded) — run the freshly-enqueued + backlogged jobs through the engine.
//   3. Drain the inbound webhook queue (bounded).
//   4. Proactive token refresh — refresh OAuth connections whose access token expires within the window, so
//      authentication self-heals before it lapses.
// No secret is ever touched here; every underlying action is audited by the service it calls.

import { sql } from 'kysely';
import { getProvider } from './adapters/provider-registry';
import type { SyncEngineService } from './sync-engine.service';
import type { WebhookIngestService } from './webhook-ingest.service';
import type { IntegrationLifecycleService } from './integration-lifecycle.service';

type Actor = { id?: string; role?: string };
export type TickOptions = { limit?: number; syncIntervalSeconds?: number; tokenRefreshWindowSeconds?: number };
export type TickResult = { ok: boolean; scheduledEnqueued: number; syncDrained: number; webhookDrained: number; tokensRefreshed: number; refreshFailures: number };

export type SchedulerFinders = {
  dueScheduled: (limit: number) => Promise<{ id: string; provider_key: string }[]>;
  expiringOAuth: (windowSeconds: number, limit: number) => Promise<{ id: string }[]>;
  advanceNextSync: (id: string, intervalSeconds: number) => Promise<void>;
};

export class IntegrationSchedulerService {
  constructor(
    private readonly db?: any,
    private readonly sync?: SyncEngineService,
    private readonly webhooks?: WebhookIngestService,
    private readonly lifecycle?: IntegrationLifecycleService,
    private readonly finders?: SchedulerFinders,
  ) {}

  private defaultFinders(): SchedulerFinders {
    return {
      dueScheduled: async (limit) => (await sql<any>`select id::text as id, provider_key from integration_connections
        where connection_status = 'active' and authentication_status = 'valid'
          and next_sync_at is not null and next_sync_at <= now()
        order by next_sync_at asc limit ${limit}`.execute(this.db).catch(() => ({ rows: [] }))).rows ?? [],
      expiringOAuth: async (window, limit) => (await sql<any>`select id::text as id from integration_connections
        where auth_method = 'oauth2' and authentication_status = 'valid'
          and token_expires_at is not null and token_expires_at <= now() + (${window} || ' seconds')::interval
        order by token_expires_at asc limit ${limit}`.execute(this.db).catch(() => ({ rows: [] }))).rows ?? [],
      advanceNextSync: async (id, interval) => { await sql`update integration_connections set next_sync_at = now() + (${interval} || ' seconds')::interval, updated_at = now() where id = ${id}::uuid`.execute(this.db).catch(() => undefined); },
    };
  }

  async tick(actor: Actor, opts: TickOptions = {}): Promise<TickResult> {
    const res: TickResult = { ok: true, scheduledEnqueued: 0, syncDrained: 0, webhookDrained: 0, tokensRefreshed: 0, refreshFailures: 0 };
    if (!this.db && !this.finders) return { ...res, ok: false };
    const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
    const interval = Math.max(60, opts.syncIntervalSeconds ?? 3600);
    const window = Math.max(60, opts.tokenRefreshWindowSeconds ?? 900);
    const find = this.finders ?? this.defaultFinders();

    // 1) scheduled syncs — enqueue for due, sync-capable connections, then advance next_sync_at
    if (this.sync) {
      const due = await find.dueScheduled(limit);
      for (const c of due) {
        if (!getProvider(c.provider_key)?.syncCapable) continue;
        const enq = await this.sync.enqueueSync(actor, c.id, { syncType: 'scheduled' });
        if (enq.ok) res.scheduledEnqueued++;
        await find.advanceNextSync(c.id, interval);
      }
      // 2) drain the sync queue
      const drained: any = await this.sync.drainDueJobs(actor, limit);
      res.syncDrained = drained.processed ?? 0;
    }

    // 3) drain the inbound webhook queue
    if (this.webhooks) {
      const wd: any = await this.webhooks.drainWebhookQueue(actor, limit);
      res.webhookDrained = wd.processed ?? 0;
    }

    // 4) proactive token refresh for soon-to-expire OAuth connections
    if (this.lifecycle) {
      const expiring = await find.expiringOAuth(window, limit);
      for (const c of expiring) {
        const r = await this.lifecycle.refreshAuthentication(actor, c.id);
        if (r.ok) res.tokensRefreshed++; else res.refreshFailures++;
      }
    }
    return res;
  }
}
