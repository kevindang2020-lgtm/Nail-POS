// media-lifecycle.ts — BUILD_PLAN Phase 11 (Constitution 4 §169 object lifecycle, §170 "do not store … indefinitely").
//
// The daily `media.lifecycle` job. Two duties, both idempotent:
//   1. abandoned partial uploads — MediaStorage.sweepAbandoned(now - temp_upload_hours): interrupted local-disk writes
//      (`.tmp-<hex>` files) and S3 multipart uploads that never completed;
//   2. objects of long-deleted media rows — for every table in the policy, rows soft-deleted between
//      (now - object_days - lookback_days) and (now - object_days) get their stored object (and image variants) removed.
//      The app already removes objects at delete time, best effort; this is the net that catches the failures. The
//      look-back window means a missed day is caught on the next run, and a row is re-tried a bounded number of times
//      (deleting a missing object is a no-op on S3 and on disk). The ROW is never touched — its table's own retention
//      policy (retention-policy.json `tables`) owns it. A salon under an ACTIVE tenant/branch legal hold is skipped.
//
// The policy is `classes.media` in apps/api/db/retention-policy.json. Voice recordings (§170) are not stored by
// AIPowerSalon — the voice provider holds them under its own retention (see the voice-transcription adapter).
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { runTick, recordStorageLifecycle } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, MIGRATIONS_DIR } from '@aipowersalon/database';
import { makeMediaStorage, makeSupportAttachmentStorage, type MediaStorage } from '@aipowersalon/media';

/** `store`: which MediaStorage holds the table's objects — 'media' (the public store, default) or 'support_attachments'
 *  (the PRIVATE local store in modules/support/src/help/help.module.ts). */
export interface MediaLifecycleTable { key_column: string; deleted_column: string; variants_column?: string; store?: string }
export interface MediaLifecyclePolicy { object_days: number; lookback_days: number; temp_upload_hours: number; tables: Record<string, MediaLifecycleTable> }
export interface MediaLifecycleResult {
  abandoned: number;
  tables: Array<{ table: string; rows: number; held: number; objects: number; error?: string }>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const MAX_ROWS_PER_TABLE = 5_000;   // per run; a backlog continues tomorrow (the look-back window covers it)
const EVERY_MS = 24 * 60 * 60_000;

export function mediaPolicyPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.RETENTION_POLICY_FILE || resolve(MIGRATIONS_DIR, '..', 'retention-policy.json');
}

/** classes.media from the ONE retention policy file; null when absent or malformed (the job then does nothing). */
export function loadMediaPolicy(path: string = mediaPolicyPath()): MediaLifecyclePolicy | null {
  if (!existsSync(path)) return null;
  const m = JSON.parse(readFileSync(path, 'utf8'))?.classes?.media;
  if (!m || typeof m !== 'object') return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const object_days = n(m.object_days), lookback_days = n(m.lookback_days), temp_upload_hours = n(m.temp_upload_hours);
  if (object_days === null || lookback_days === null || temp_upload_hours === null) return null;
  return { object_days, lookback_days, temp_upload_hours, tables: (m.tables ?? {}) as Record<string, MediaLifecycleTable> };
}

export class MediaLifecycleService {
  private readonly stores: Record<string, MediaStorage>;
  /** `storage`: one store for every table (tests), or the named stores ('media', 'support_attachments', …). */
  constructor(
    private readonly db: any,
    storage: MediaStorage | Record<string, MediaStorage>,
    private readonly opts: { policy?: MediaLifecyclePolicy | null; now?: () => number } = {},
  ) {
    this.stores = typeof (storage as MediaStorage).remove === 'function' ? { media: storage as MediaStorage } : storage as Record<string, MediaStorage>;
  }
  private storeFor(t: MediaLifecycleTable): MediaStorage {
    const name = t.store ?? 'media';
    const st = this.stores[name] ?? (Object.keys(this.stores).length === 1 && this.stores.media ? this.stores.media : undefined);
    if (!st) throw new Error(`no media store named ${JSON.stringify(name)}`);
    return st;
  }

  async run(): Promise<MediaLifecycleResult> {
    const policy = this.opts.policy === undefined ? loadMediaPolicy() : this.opts.policy;
    const out: MediaLifecycleResult = { abandoned: 0, tables: [] };
    if (!policy) return out;
    const now = this.opts.now?.() ?? Date.now();
    for (const [name, st] of Object.entries(this.stores)) {
      if (!st.sweepAbandoned) continue;
      // Phase 14 B (Constitution 11 §152): every run counted per store — the storage dashboard shows lifecycle errors
      try { const n = await st.sweepAbandoned(new Date(now - policy.temp_upload_hours * 3_600_000)); out.abandoned += n; recordStorageLifecycle(name, 'ok', n); }
      catch (e) { recordStorageLifecycle(name, 'error'); new Logger('MediaLifecycle').warn(`abandoned-upload sweep (${name}) failed: ${(e as Error).message}`); }
    }
    const until = new Date(now - policy.object_days * 86_400_000);
    const from = new Date(until.getTime() - policy.lookback_days * 86_400_000);
    for (const [table, t] of Object.entries(policy.tables)) {
      const r = await this.runTable(table, t, from, until);
      recordStorageLifecycle(t.store ?? 'media', r.error ? 'error' : 'ok', r.objects);
      out.tables.push(r);
    }
    return out;
  }

  private async runTable(table: string, t: MediaLifecycleTable, from: Date, until: Date) {
    const res = { table, rows: 0, held: 0, objects: 0 } as MediaLifecycleResult['tables'][number];
    try {
      for (const c of [table, t.key_column, t.deleted_column, ...(t.variants_column ? [t.variants_column] : [])]) {
        if (!IDENT.test(c)) throw new Error(`invalid identifier ${JSON.stringify(c)}`);
      }
      const storage = this.storeFor(t);
      const variants = t.variants_column ? sql`, m.${sql.ref(t.variants_column)} as variants` : sql`, null::jsonb as variants`;
      // Cross-tenant by design (a platform job); the tenant id is selected so the hold check is per salon.
      const rows = (await sql<any>`select m.tenant_id, m.${sql.ref(t.key_column)} as key ${variants},
          exists (select 1 from customer_legal_holds h where h.status = 'active' and h.effective_at <= now()
                    and h.tenant_id = m.tenant_id and h.scope in ('tenant', 'branch')) as held
        from ${sql.table(table)} m
        where m.${sql.ref(t.deleted_column)} >= ${from} and m.${sql.ref(t.deleted_column)} < ${until}
        order by m.${sql.ref(t.deleted_column)} limit ${MAX_ROWS_PER_TABLE}`.execute(this.db)).rows;
      for (const r of rows) {
        if (r.held) { res.held++; continue; }
        res.rows++;
        const keys = [r.key, ...variantKeys(r.variants)].filter((k): k is string => typeof k === 'string' && k.length > 0);
        for (const k of keys) { await storage.remove(k); res.objects++; }
      }
    } catch (e) {
      res.error = (e as Error).message;
    }
    return res;
  }
}

/** The stores the job works on — the SAME roots/backends the app writes with. */
export function lifecycleStores(env: NodeJS.ProcessEnv = process.env): Record<string, MediaStorage> {
  return {
    media: makeMediaStorage(env),
    support_attachments: makeSupportAttachmentStorage(env),   // Phase 14 B: instrumented, same root as the help module
  };
}

function variantKeys(v: unknown): string[] {
  const o = typeof v === 'string' ? safeJson(v) : v;
  if (!o || typeof o !== 'object') return [];
  return Object.values(o as Record<string, any>).map((x) => x?.key).filter((k) => typeof k === 'string');
}
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

@Injectable()
export class MediaLifecycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MediaLifecycle');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (String(process.env.MEDIA_LIFECYCLE ?? '').toLowerCase() === 'off') return;
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'media.lifecycle', jobClass: 'standard', everyMs: EVERY_MS }, () => this.tick()).catch(() => undefined); }, EVERY_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await new MediaLifecycleService(this.db, lifecycleStores()).run();
      const objects = r.tables.reduce((a, x) => a + x.objects, 0);
      if (r.abandoned || objects) this.log.log(`media lifecycle: ${r.abandoned} abandoned upload(s), ${objects} object(s) of deleted rows removed`);
      for (const x of r.tables.filter((t) => t.error)) this.log.warn(`media lifecycle ${x.table}: ${x.error}`);
    } catch (e) { this.log.warn(`media lifecycle tick failed: ${(e as Error).message}`); }
    finally { this.running = false; }
  }
}
