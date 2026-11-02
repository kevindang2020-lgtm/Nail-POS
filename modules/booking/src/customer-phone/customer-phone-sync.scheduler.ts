// customer-phone-sync.scheduler.ts — the phone module's background work: session expiry and synchronisation retries.
//
// ── Why this must exist ─────────────────────────────────────────────────────────────────────────────────
//
// The state machine models `synchronization_failed` as RETRYABLE and still `isProven`, and that is the right
// model: the customer answered the SMS. That fact is banked. A crashed job, a timeout, a full disk -- none of them
// un-happen it, and sending the customer back to the start would make them re-verify a number they already proved,
// for a failure that was never theirs. But a state nothing drains is just a nicer word for "lost".
//
// BUILD_PLAN Phase 3: the work runs on the ONE job queue (Phase 2) —
//   • `customer.phone.sync`            a failed synchronisation, retried with backoff + jitter, dead-lettered after
//                                       8 attempts (visible and retryable on Super Admin → Jobs & Dead Letters);
//   • `customer.phone.session_expiry`  queued when a change starts, closes it at its deadline if nobody finished it
//                                       (audit E2: an abandoned session used to block the customer forever).
// This scheduler is the safety net, single-owner across processes (runTick): every 5 minutes it closes anything past
// its deadline a lost job missed, and makes sure every failed synchronisation has its job. It used to be OFF unless
// CUSTOMER_PHONE_SYNC_CRON_ENABLED was set — so in practice nothing drained anything. It is now ON unless that
// variable is explicitly `off`.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { DATABASE, registerJobHandler, jobHandlerFor, type AppDatabase } from '@aipowersalon/database';
import { KyselyPhoneStore, KyselySyncPort, PHONE_JOB, SYNC_MAX_ATTEMPTS } from './customer-phone.kysely';
import { KyselyPhoneNotifier } from './customer-phone-notify';
import { runsBackgroundJob } from '@aipowersalon/config';
import { OutboxWriter } from '@aipowersalon/events';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;      // every 5 minutes
const BATCH = 200;

/** On unless explicitly turned off (`CUSTOMER_PHONE_SYNC_CRON_ENABLED=off|0|false|no`). */
export function phoneSyncCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CUSTOMER_PHONE_SYNC_CRON_ENABLED ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

/** Registers the phone module's job handlers (idempotent — a second module instance in tests reuses the first). */
export function registerPhoneJobHandlers(db: AppDatabase | null): void {
  if (!db) return;
  const store = new KyselyPhoneStore(db, new OutboxWriter());
  const sync = new KyselySyncPort(db);
  if (!jobHandlerFor(PHONE_JOB.expiry)) registerJobHandler(PHONE_JOB.expiry, async (payload, ctx) => {
    const expired = await store.expireSession(String(ctx.tenantId ?? ''), String(payload.sessionId ?? ''));
    return { expired };
  });
  if (!jobHandlerFor(PHONE_JOB.sync)) registerJobHandler(PHONE_JOB.sync, async (payload, ctx) => {
    try {
      await store.runSync(String(ctx.tenantId ?? ''), String(payload.sessionId ?? ''), sync);   // throws → retried
    } catch (e) {
      // "Alert tenant administrators if the failure persists" (spec): on the LAST attempt the managers are told —
      // the job then goes dead and stays visible (Super Admin → Jobs & Dead Letters) for a retry.
      if (ctx.attempt >= SYNC_MAX_ATTEMPTS && ctx.tenantId) {
        await new KyselyPhoneNotifier(db).staffAlert({ tenantId: ctx.tenantId, severity: 'high',
          title: 'A customer\u2019s new phone number did not reach all their records',
          body: 'The number was verified and is active, but some linked records (the customer app account) could not be updated after several attempts. Support has the failed job.',
          metadata: { sessionId: payload.sessionId ?? null } });
      }
      throw e;
    }
    return { synchronized: true };
  });
}

@Injectable()
export class CustomerPhoneSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CustomerPhoneSync');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  onModuleInit(): void {
    registerPhoneJobHandlers(this.db);              // every process: a worker anywhere may pick the job up
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!phoneSyncCronEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'customer.phone.sync', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();     // never the reason a process refuses to shut down
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public so ops can run it by hand, and so it is testable without waiting five minutes. */
  async tick(): Promise<{ expired: number; syncQueued: number }> {
    if (this.running || !this.db) return { expired: 0, syncQueued: 0 };
    this.running = true;
    try {
      const store = new KyselyPhoneStore(this.db, new OutboxWriter());
      const expired = await store.expireStaleSessions(BATCH);
      const failed = await store.syncFailedSessions(BATCH);
      for (const f of failed) await store.scheduleSyncRetry(f.tenantId, f.sessionId);   // idempotent per session
      if (expired || failed.length) this.log.log(`closed ${expired} expired phone change(s); ${failed.length} synchronisation(s) on the queue`);
      return { expired, syncQueued: failed.length };
    } catch (e: any) {
      // A failed sweep must not kill the timer. It will try again; a crashed scheduler would leave every future
      // failure stranded, which is the exact outcome it exists to prevent.
      this.log.warn(`phone sweep failed: ${e?.message ?? e}`);
      return { expired: 0, syncQueued: 0 };
    } finally {
      this.running = false;
    }
  }
}
