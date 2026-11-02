// journal.ts — the ONE pending-mutation journal / sync engine for the mobile apps (Constitution 6 §15, §19–23, §254–257).
//
//   run(spec)  → the entry (clientMutationId + ONE Idempotency-Key, scope, resource, operation, expectedVersion, priority,
//                createdAt / expiresAt) is written to the device store BEFORE it is sent. Online: sent now. Offline (and
//                the operation allows queueing): kept as PENDING and shown to the user.
//   replay()   → on reconnect and on launch: every pending entry of the CURRENT scope, HIGH → NORMAL → LOW then oldest
//                first, is sent again with its SAME key. The server's @Idempotent() runs it once and answers a retry with
//                the stored result — so a response lost to a dropped connection or a crash never runs the action twice.
//   outcome    → APPLIED (removed) · pending (5xx / in progress / network — retried later) · EXPIRED (never sent) ·
//                CONFLICT · STALE · PERMISSION_REVOKED · RESOURCE_CHANGED · REJECTED — kept until the user dismisses it,
//                so nothing is silently overwritten (§23).
//
// It NEVER holds a payment (§19): a spec marked `financial`, or a payment / refund / cash / gift-card / redemption path,
// is refused — manager-pay charges and every money action stay online-only with their own keys. A body carrying a
// secret-named field is refused too (nothing secret is ever written to the device store).
import type { KvStore } from './storage';
import { scopeKey, type QueryScope } from './scope';
import { findSecretPaths } from './sanitize';

export const JOURNAL_PREFIX = 'aps.journal.v1';
export type SyncPriority = 'HIGH' | 'NORMAL' | 'LOW';
export type JournalStatus = 'pending' | 'applied' | 'expired' | 'conflict' | 'stale' | 'permission_revoked' | 'resource_changed' | 'rejected';

export interface MutationSpec {
  resourceType: string; resourceId: string; operation: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: Record<string, unknown>;
  expectedVersion?: number | null;
  /** 'queue': may be started offline and replayed. 'online-only': refused offline; kept only to recover a lost answer. */
  offline: 'queue' | 'online-only';
  /** Operation-specific expiry (§257). */
  ttlMs: number;
  priority?: SyncPriority;
  /** A payment / refund / redemption / financial adjustment — refused (§19). */
  financial?: boolean;
  /** A short human label for the pending list ("Start service · T-104"). */
  label?: string;
}
export interface JournalEntry extends Required<Omit<MutationSpec, 'financial' | 'label' | 'body' | 'expectedVersion'>> {
  id: string; idempotencyKey: string; app: string; scope: string;
  tenantId: string | null; branchId: string | null; actorId: string | null;
  body: Record<string, unknown> | null; expectedVersion: number | null; label: string | null;
  status: JournalStatus; createdAt: number; retryAt: number; expiresAt: number; attempts: number;
  /** The server's message for a non-applied outcome. */
  message: string | null;
}
export interface JournalRequest { method: string; path: string; body?: Record<string, unknown>; idempotencyKey: string }
export type JournalSender = (r: JournalRequest) => Promise<unknown>;
export type RunResult = { status: 'applied'; result: unknown; entry: JournalEntry } | { status: 'pending'; entry: JournalEntry };

export class JournalRefusedError extends Error { readonly code = 'JOURNAL_REFUSED'; }
export class OfflineError extends Error { readonly code = 'OFFLINE'; readonly status = 0; constructor(m = 'You are offline. This needs a live connection — try again when you are back online.') { super(m); } }

// §19: never journal money. Matched on whole path segments / words.
const FINANCIAL_PATH = /(^|[/_-])(pay|pays|payment|payments|charge|charges|refund|refunds|checkout|cash|tip|tips|gift-?cards?|redeem|redemption|wallet|tap-to-pay|void|adjustment|adjustments|payout|payouts)([/_-]|$)/i;
export const isFinancialPath = (path: string) => FINANCIAL_PATH.test(path.split('?')[0]);

const PRIORITY: Record<SyncPriority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };
const RETRY_BASE_MS = 5_000; const RETRY_MAX_MS = 5 * 60_000;
const OUTCOME_KEEP_MS = 24 * 3600_000;

function newKey(): string {
  const c: any = (globalThis as any).crypto;
  const u = c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `m-${u}`;
}
/** Did the request get an HTTP answer? (A network drop / timeout / offline has none.) */
function httpStatus(e: any): number | null {
  const s = Number(e?.status);
  return Number.isFinite(s) && s >= 100 ? s : null;
}
/** HTTP answer → outcome; null = keep pending and retry later. */
export function outcomeFor(status: number, code: string | undefined): JournalStatus | null {
  const c = String(code || '').toUpperCase();
  if (status >= 500 || status === 401 || status === 426 || status === 429 || c === 'IDEMPOTENCY_IN_PROGRESS') return null;
  if (status === 403) return 'permission_revoked';
  if (status === 404 || status === 410) return 'resource_changed';
  if (status === 412 || c.includes('STALE') || c.includes('VERSION')) return 'stale';
  if (status === 409 || c === 'IDEMPOTENCY_KEY_REUSED') return 'conflict';
  return 'rejected';
}

export interface MutationJournal {
  setScope(scope: QueryScope | null): void;
  /** `exec`: the first, live attempt (the app's typed call, given the key). Replays always use `send`. */
  run(spec: MutationSpec, exec?: (idempotencyKey: string) => Promise<unknown>): Promise<RunResult>;
  replay(): Promise<JournalEntry[]>;
  list(): Promise<JournalEntry[]>;
  dismiss(id: string): Promise<void>;
  clear(): Promise<void>;
  subscribe(fn: () => void): () => void;
}

export function createMutationJournal(o: { app: string; store: KvStore; send: JournalSender; isOnline: () => boolean; now?: () => number }): MutationJournal {
  const now = o.now ?? Date.now;
  const prefix = `${JOURNAL_PREFIX}:${o.app}:`;
  let scope: QueryScope | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => { try { f(); } catch { /* a listener never breaks the journal */ } });
  const inflight = new Set<string>();
  let replaying: Promise<JournalEntry[]> | null = null;

  const save = async (e: JournalEntry) => { await o.store.set(prefix + e.id, JSON.stringify(e)); };
  const drop = async (id: string) => { await o.store.remove(prefix + id); };
  async function all(): Promise<JournalEntry[]> {
    const keys = (await o.store.keys()).filter((k) => k.startsWith(prefix));
    const out: JournalEntry[] = [];
    for (const k of keys) { const raw = await o.store.get(k); if (!raw) continue; try { out.push(JSON.parse(raw)); } catch { await o.store.remove(k); } }
    return out;
  }
  const mine = (e: JournalEntry) => !!scope && e.scope === scopeKey(scope);

  /** Send one entry and settle it. Returns the settled entry (+ result when applied); throws only for `throwRejection`. */
  async function attempt(e: JournalEntry, throwRejection: boolean, exec?: (key: string) => Promise<unknown>): Promise<{ entry: JournalEntry; result?: unknown }> {
    inflight.add(e.id);
    try {
      const result = exec ? await exec(e.idempotencyKey) : await o.send({ method: e.method, path: e.path, body: e.body ?? undefined, idempotencyKey: e.idempotencyKey });
      await drop(e.id);
      return { entry: { ...e, status: 'applied', attempts: e.attempts + 1 }, result };
    } catch (err: any) {
      const status = httpStatus(err);
      const outcome = status == null ? null : outcomeFor(status, err?.code);
      if (outcome == null) {                                    // no answer, or a retryable one → keep it, same key
        const attempts = e.attempts + 1;
        // No answer at all (offline / dropped / timed out): the next reconnect or launch may resend at once. A retryable
        // ANSWER (5xx, in progress, rate limited) backs off exponentially so a struggling server is not hammered.
        const retryAt = status == null ? now() : now() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1));
        const next: JournalEntry = { ...e, attempts, retryAt, message: err?.message ?? null };
        await save(next);
        return { entry: next };
      }
      if (throwRejection) { await drop(e.id); throw err; }       // the screen that started it shows the error itself
      const settled: JournalEntry = { ...e, status: outcome, attempts: e.attempts + 1, message: err?.message ?? null };
      await save(settled);
      return { entry: settled };
    } finally { inflight.delete(e.id); emit(); }
  }

  const journal: MutationJournal = {
    setScope(s) { scope = s; emit(); },

    async run(spec, exec) {
      if (spec.financial || isFinancialPath(spec.path)) throw new JournalRefusedError('Payments and other money actions are never queued — they need a live server confirmation.');
      if (spec.body && findSecretPaths(spec.body).length) throw new JournalRefusedError('This action carries a secret and cannot be stored on the device.');
      if (!scope) throw new JournalRefusedError('Not signed in.');
      const online = o.isOnline();
      if (!online && spec.offline === 'online-only') throw new OfflineError();
      const t = now();
      const e: JournalEntry = {
        id: newKey(), idempotencyKey: newKey(), app: o.app, scope: scopeKey(scope),
        tenantId: scope.tenantId, branchId: scope.branchId, actorId: scope.userId,
        resourceType: spec.resourceType, resourceId: spec.resourceId, operation: spec.operation,
        method: spec.method, path: spec.path, body: spec.body ?? null, expectedVersion: spec.expectedVersion ?? null,
        offline: spec.offline, ttlMs: spec.ttlMs, priority: spec.priority ?? 'NORMAL', label: spec.label ?? null,
        status: 'pending', createdAt: t, retryAt: t, expiresAt: t + spec.ttlMs, attempts: 0, message: null,
      };
      await save(e);                                            // crash-safe: on the device before it leaves it
      emit();
      if (!online) return { status: 'pending', entry: e };
      const r = await attempt(e, true, exec);
      return r.entry.status === 'applied' ? { status: 'applied', result: r.result, entry: r.entry } : { status: 'pending', entry: r.entry };
    },

    replay() {
      if (replaying) return replaying;                          // single-flight: two reconnect events send once
      replaying = (async () => {
        const settled: JournalEntry[] = [];
        if (!scope || !o.isOnline()) return settled;
        const due = (await all()).filter((e) => mine(e) && e.status === 'pending' && !inflight.has(e.id))
          .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority] || a.createdAt - b.createdAt);
        for (const e of due) {
          if (now() >= e.expiresAt) { const x: JournalEntry = { ...e, status: 'expired', message: 'Not sent — it waited too long and may no longer be right. Please check and try again.' }; await save(x); settled.push(x); emit(); continue; }
          if (now() < e.retryAt) { settled.push(e); continue; }
          if (!o.isOnline()) break;
          if (inflight.has(e.id)) continue;                     // a live run() of the same entry is still sending
          settled.push((await attempt(e, false)).entry);
        }
        // tidy: settled outcomes older than a day go
        for (const e of await all()) if (e.status !== 'pending' && now() - e.createdAt > OUTCOME_KEEP_MS) await drop(e.id);
        return settled;
      })().finally(() => { replaying = null; });
      return replaying;
    },

    async list() { return (await all()).filter(mine).sort((a, b) => a.createdAt - b.createdAt); },
    async dismiss(id) { await drop(id); emit(); },
    async clear() { for (const e of await all()) await drop(e.id); emit(); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
  return journal;
}
