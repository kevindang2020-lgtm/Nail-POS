// event-consumer.ts — Constitution 8, Phases 9–11: the consumer contract, error classification, backoff, upcasters.
import type { Transaction } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DomainEvent, DomainEventType } from './event-contract';
import { EVENT_VERSIONS } from './event-contract';

/** §32/§89: a consumer has a name (its identity in processed_events and dead letters), subscriptions, a handler. */
export interface EventConsumer {
  readonly name: string;                     // e.g. 'loyalty.points_on_checkout' — stable forever, it is the idempotency key half
  readonly eventTypes: readonly DomainEventType[];
  /** §24: runs INSIDE the transaction the runner opens; the processed_events row commits with the handler's writes. */
  handle(event: DomainEvent<any>, trx: Transaction<DB>): Promise<void>;
  /** §29/§158: CRITICAL consumers (money, security) get more retries and priority; default STANDARD. */
  readonly critical?: boolean;
  /** §127: handler timeout in ms; a hang is a TRANSIENT failure, not a stuck worker. */
  readonly timeoutMs?: number;
  /** §44: what happens if this consumer's past events are replayed. Consumers that do not declare it are
   *  treated as NOT_REPLAYABLE — the safe default, because §43's prohibition (never re-capture a payment,
   *  re-send an SMS, re-spend a gift card) must hold for anything nobody has thought about yet. */
  readonly replay?: ReplayClass;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §51 error classification. Handlers throw ConsumerError with an explicit class when they know; unknown errors
// are classified by shape. SECURITY never retries and raises an alert (§143). PERMANENT / DATA_INTEGRITY go
// straight to the dead letter for a human (§50). Only TRANSIENT retries.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * §44 replay classification.
 *  REPLAY_SAFE                  — re-running produces the same state; no external or money effect. Projections.
 *  REPLAY_SAFE_WITH_IDEMPOTENCY — re-running is safe ONLY because a business-uniqueness constraint stops the
 *                                 second effect (e.g. loyalty_point_earnings UNIQUE(tenant, payment)). §25.
 *  NOT_REPLAYABLE               — re-running would duplicate a real-world effect: money, SMS, push. §43.
 */
export type ReplayClass = 'REPLAY_SAFE' | 'REPLAY_SAFE_WITH_IDEMPOTENCY' | 'NOT_REPLAYABLE';
export function replayClassOf(c: Pick<EventConsumer, 'replay'>): ReplayClass { return c.replay ?? 'NOT_REPLAYABLE'; }

export type ErrorClass = 'TRANSIENT' | 'PERMANENT' | 'SECURITY' | 'DATA_INTEGRITY';

export class ConsumerError extends Error {
  constructor(public readonly errorClass: ErrorClass, public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'ConsumerError';
  }
}
/** §14/§15: a handler that loads a resource which does not belong to the event's tenant throws this. */
export class TenantMismatchError extends ConsumerError {
  constructor(detail?: string) { super('SECURITY', 'tenant_mismatch', detail ?? 'resource tenant does not match event tenant'); }
}
/** §127 */
export class ConsumerTimeoutError extends ConsumerError {
  constructor(ms: number) { super('TRANSIENT', 'consumer_timeout', `handler exceeded ${ms}ms`); }
}

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08003', '08006', '40001', '40P01', '53300']);
const INTEGRITY_CODES = new Set(['23505', '23503', '23514', '23502']);   // unique / fk / check / not-null

export function classifyError(err: unknown): { errorClass: ErrorClass; code: string } {
  if (err instanceof ConsumerError) return { errorClass: err.errorClass, code: err.code };
  const e = err as any;
  const pgCode = String(e?.code ?? e?.cause?.code ?? '');
  if (TRANSIENT_CODES.has(pgCode)) return { errorClass: 'TRANSIENT', code: `pg_${pgCode.toLowerCase()}` };
  if (INTEGRITY_CODES.has(pgCode)) return { errorClass: 'DATA_INTEGRITY', code: `pg_${pgCode}` };
  if (/timeout|timed out|unavailable|temporarily/i.test(String(e?.message ?? ''))) return { errorClass: 'TRANSIENT', code: 'transient_message' };
  // Unknown → PERMANENT by default. Retrying an unknown error forever is prohibited (§225); a human looks.
  // Keep the Postgres SQLSTATE when there is one (a code, never a message — §197) so the dead letter says WHY.
  return { errorClass: 'PERMANENT', code: pgCode ? `pg_${pgCode.toLowerCase()}` : 'unclassified' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §50 retry policy: exponential backoff + jitter, capped; more attempts for CRITICAL consumers (§158).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const RETRY = { baseMs: 2_000, maxMs: 15 * 60_000, standardAttempts: 5, criticalAttempts: 12 } as const;

export function nextAttemptDelayMs(attempt: number, rand: () => number = Math.random): number {
  const exp = Math.min(RETRY.maxMs, RETRY.baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(rand() * Math.min(exp, 30_000));     // never more than 30s of jitter
  return Math.min(RETRY.maxMs, exp + jitter);
}
export function maxAttemptsFor(consumer: Pick<EventConsumer, 'critical'>): number {
  return consumer.critical ? RETRY.criticalAttempts : RETRY.standardAttempts;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §36 upcasters: transform an older-version event to the next version. Registered per (type, fromVersion);
// the runner chains them until the event reaches EVENT_VERSIONS[type]. A version the registry does not know
// (newer than current, or a gap with no upcaster) is PERMANENT — never guessed at (§34, §50).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Upcaster = (event: DomainEvent<any>) => DomainEvent<any>;
const upcasters = new Map<string, Upcaster>();
export function registerUpcaster(eventType: DomainEventType, fromVersion: number, fn: Upcaster): void {
  upcasters.set(`${eventType}@${fromVersion}`, fn);
}
export function upcastToCurrent(event: DomainEvent<any>): DomainEvent<any> {
  const target = EVENT_VERSIONS[event.eventType];
  let e = event;
  if (e.eventVersion > target) throw new ConsumerError('PERMANENT', 'event_version_unsupported', `v${e.eventVersion} > current v${target}`);
  while (e.eventVersion < target) {
    const up = upcasters.get(`${e.eventType}@${e.eventVersion}`);
    if (!up) throw new ConsumerError('PERMANENT', 'event_upcaster_missing', `${e.eventType} v${e.eventVersion} → v${e.eventVersion + 1}`);
    const next = up(e);
    if (next.eventVersion !== e.eventVersion + 1) throw new ConsumerError('PERMANENT', 'event_upcaster_invalid', 'upcaster must advance exactly one version');
    e = next;
  }
  return e;
}
/** Test seam. */
export function _resetUpcasters(): void { upcasters.clear(); }
