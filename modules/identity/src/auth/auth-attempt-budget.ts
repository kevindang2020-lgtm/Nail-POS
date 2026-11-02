// auth-attempt-budget.ts — Security Deep Scan C4/C12: ONE attempt budget for every credential guess that follows a
// first factor or a session — the login second factor (TOTP, recovery code, Super Admin SMS code), POST /auth/step-up,
// POST /auth/change-password and POST /auth/temp-password-login.
//
// Why it exists: the login throttle counts only WRONG PASSWORDS, so once a password was known the second factor could be
// guessed without limit (the Redis MFA limiter is a no-op unless RATE_LIMIT_STORE=redis, which production does not set),
// and step-up / change-password / temp-password-login had no limit at all. This budget lives in Postgres, so it works on
// every replica with or without Redis.
//
// HOW (Postgres): rows in the existing `auth_events` table (event_type ATTEMPT_BUDGET_SPENT, reason = the kind, user_id =
// the account). admit() runs ONE short transaction — an advisory lock per (kind, user), a count over the window, and
// either a refusal or a new row charged UP FRONT. The guess is then checked; settle(true) deletes the row (a correct
// answer never spends budget), settle(false) leaves it. So N concurrent guesses for one account admit at most as many as
// the budget has room for, and a crash between admit and settle counts as a failure (fail closed). Every time comparison
// uses the DATABASE clock, so replicas with skewed clocks agree.
//
// The failure that exhausts a budget records ATTEMPT_BUDGET_LOCKED (auth_events) and calls `onLockout` — the API wires
// that to a HIGH security event. While locked, even a CORRECT answer is refused (the lock is real, not one more wrong
// guess). The lock is a sliding window: it lifts as the oldest failure leaves it.
import { sql } from 'kysely';

export type AttemptKind = 'mfa' | 'step_up' | 'password_change' | 'temp_password_login';

export interface AttemptLimit { max: number; windowMs: number }
/** Failed guesses allowed per account per window. 10 for a 6-digit second factor (the §58 figure the Redis limiter used);
 *  5 where the guess is a password (step-up, change-password, a temporary password). */
export const ATTEMPT_LIMITS: Readonly<Record<AttemptKind, AttemptLimit>> = Object.freeze({
  mfa: { max: 10, windowMs: 15 * 60_000 },
  step_up: { max: 5, windowMs: 15 * 60_000 },
  password_change: { max: 5, windowMs: 15 * 60_000 },
  temp_password_login: { max: 5, windowMs: 15 * 60_000 },
});

export interface AttemptContext { tenantId?: string | null; ip?: string | null; sessionId?: string | null }
export interface AttemptLockout extends AttemptContext { kind: AttemptKind; userId: string; failures: number; windowMs: number }

export interface AttemptAdmission {
  /** false → over budget: refuse WITHOUT checking the guess. */
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  /** Report the outcome of the admitted guess. `true` refunds it (correct answer, or a refusal that was not a guess). */
  settle(success: boolean): Promise<void>;
}

export interface AttemptBudget {
  /** true when the budget is shared across processes (Postgres). */
  readonly durable: boolean;
  admit(kind: AttemptKind, userId: string, ctx?: AttemptContext): Promise<AttemptAdmission>;
}

export interface AttemptBudgetOptions {
  limits?: Partial<Record<AttemptKind, AttemptLimit>>;
  /** Called once, on the failure that exhausts a budget. Never awaited into the caller's error path. */
  onLockout?: (e: AttemptLockout) => unknown;
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const REFUSED = (retryAfterMs: number): AttemptAdmission => ({ allowed: false, retryAfterMs, settle: async () => undefined });

export function isAttemptBudget(v: unknown): v is AttemptBudget {
  return !!v && typeof (v as AttemptBudget).admit === 'function';
}

/** Postgres budget over `auth_events` (no migration needed: the table has no event_type CHECK). */
export class PostgresAttemptBudget implements AttemptBudget {
  readonly durable = true;
  private readonly limits: Record<AttemptKind, AttemptLimit>;
  constructor(private readonly db: any, private readonly opts: AttemptBudgetOptions = {}) {
    this.limits = { ...ATTEMPT_LIMITS, ...(opts.limits ?? {}) };
  }

  async admit(kind: AttemptKind, userId: string, ctx: AttemptContext = {}): Promise<AttemptAdmission> {
    // Every account this budget protects is a users row (uuid). Anything else has no account to lock — refuse rather
    // than admit an unbounded guess.
    if (!isUuid(userId)) return REFUSED(this.limits[kind].windowMs);
    const { max, windowMs } = this.limits[kind];
    const win = `${Math.round(windowMs)} milliseconds`;
    let admitted: { id: string; spent: number } | null = null;
    let retryAfterMs = 0;
    try {
      await this.db.transaction().execute(async (trx: any) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${'attempt-budget:' + kind + ':' + userId}, 0))`.execute(trx);
        const r: any = (await sql`select count(*)::int as n,
                                         greatest(1000, extract(epoch from (min(occurred_at) + ${win}::interval - now())) * 1000)::float8 as wait_ms
                                    from auth_events
                                   where event_type = 'ATTEMPT_BUDGET_SPENT' and user_id = ${userId}::uuid and reason = ${kind}
                                     and occurred_at > now() - ${win}::interval`.execute(trx)).rows[0];
        const spent = Number(r?.n ?? 0);
        if (spent >= max) { retryAfterMs = Math.ceil(Number(r?.wait_ms ?? windowMs)); return; }
        const ins: any = (await sql`insert into auth_events (event_type, outcome, user_id, tenant_id, session_id, ip, reason, metadata)
                                    values ('ATTEMPT_BUDGET_SPENT', 'failure', ${userId}::uuid, ${isUuid(ctx.tenantId) ? ctx.tenantId : null}::uuid,
                                            ${isUuid(ctx.sessionId) ? ctx.sessionId : null}::uuid, ${ctx.ip ? String(ctx.ip).slice(0, 64) : null}, ${kind}, '{}'::jsonb)
                                    returning id`.execute(trx)).rows[0];
        admitted = { id: String(ins.id), spent: spent + 1 };
      });
    } catch (err) {
      // FAIL CLOSED: a budget that cannot be read cannot be enforced, and this guards credentials. The sign-in / step-up
      // being attempted needs this same database, so this refuses nothing that could have succeeded anyway.
      process.emitWarning(`attempt-budget unavailable (${kind}); refusing the attempt: ${(err as Error)?.message ?? String(err)}`);
      return REFUSED(Math.min(windowMs, 60_000));
    }
    if (!admitted) return REFUSED(retryAfterMs || windowMs);
    const { id, spent } = admitted as { id: string; spent: number };
    let settled = false;
    return {
      allowed: true, retryAfterMs: 0,
      settle: async (success: boolean) => {
        if (settled) return; settled = true;
        if (success) { await sql`delete from auth_events where id = ${id}::uuid and event_type = 'ATTEMPT_BUDGET_SPENT'`.execute(this.db); return; }
        if (spent < max) return;
        // this failure exhausted the budget: say so once, where the Security Center and the user's own activity can see it
        await sql`insert into auth_events (event_type, outcome, user_id, tenant_id, session_id, ip, reason, metadata)
                  values ('ATTEMPT_BUDGET_LOCKED', 'failure', ${userId}::uuid, ${isUuid(ctx.tenantId) ? ctx.tenantId : null}::uuid,
                          ${isUuid(ctx.sessionId) ? ctx.sessionId : null}::uuid, ${ctx.ip ? String(ctx.ip).slice(0, 64) : null}, ${kind},
                          ${JSON.stringify({ failures: spent, windowMinutes: Math.round(windowMs / 60_000) })}::jsonb)`.execute(this.db);
        notifyLockout(this.opts.onLockout, { kind, userId, failures: spent, windowMs, ...ctx });
      },
    };
  }
}

/** Single-process budget for tests and database-less dev. Same semantics, no persistence. */
export class InMemoryAttemptBudget implements AttemptBudget {
  readonly durable = false;
  private readonly limits: Record<AttemptKind, AttemptLimit>;
  private readonly spent = new Map<string, number[]>();
  constructor(private readonly opts: AttemptBudgetOptions & { now?: () => number } = {}) {
    this.limits = { ...ATTEMPT_LIMITS, ...(opts.limits ?? {}) };
  }
  private now(): number { return this.opts.now ? this.opts.now() : Date.now(); }
  async admit(kind: AttemptKind, userId: string, ctx: AttemptContext = {}): Promise<AttemptAdmission> {
    const { max, windowMs } = this.limits[kind];
    const key = kind + '|' + userId;
    const t = this.now();
    const live = (this.spent.get(key) ?? []).filter((x) => x > t - windowMs);
    if (live.length >= max) { this.spent.set(key, live); return REFUSED(Math.max(1000, live[0] + windowMs - t)); }
    live.push(t); this.spent.set(key, live);
    const n = live.length; let settled = false;
    return {
      allowed: true, retryAfterMs: 0,
      settle: async (success: boolean) => {
        if (settled) return; settled = true;
        if (success) { const a = this.spent.get(key) ?? []; const i = a.indexOf(t); if (i >= 0) a.splice(i, 1); return; }
        if (n >= max) notifyLockout(this.opts.onLockout, { kind, userId, failures: n, windowMs, ...ctx });
      },
    };
  }
}

/**
 * Adapter for the older Redis KeyedRateLimiter shape (enabled / isBlocked / hit) — kept so a caller that still injects
 * one keeps its behaviour. NOT atomic (check, then count), which is why the API wires PostgresAttemptBudget instead.
 */
export function attemptBudgetFromLimiter(l: { enabled: boolean; isBlocked(key: string): Promise<boolean>; hit(key: string): Promise<unknown> }): AttemptBudget {
  return {
    durable: false,
    async admit(_kind: AttemptKind, userId: string): Promise<AttemptAdmission> {
      if (!l.enabled) return { allowed: true, retryAfterMs: 0, settle: async () => undefined };
      if (await l.isBlocked(userId)) return REFUSED(15 * 60_000);
      return { allowed: true, retryAfterMs: 0, settle: async (success: boolean) => { if (!success) await l.hit(userId); } };
    },
  };
}

/** Run one guess under the budget: refused while locked (the guess is never checked), refunded when correct. */
export async function guardedAttempt(budget: AttemptBudget | null | undefined, kind: AttemptKind, userId: string, ctx: AttemptContext,
  check: () => Promise<boolean>): Promise<{ ok: boolean; locked: boolean; retryAfterMs: number }> {
  if (!budget) return { ok: await check(), locked: false, retryAfterMs: 0 };
  const a = await budget.admit(kind, userId, ctx);
  if (!a.allowed) return { ok: false, locked: true, retryAfterMs: a.retryAfterMs };
  let ok = false;
  try { ok = await check(); }
  finally { await a.settle(ok); }
  return { ok, locked: false, retryAfterMs: 0 };
}

/** The recorder a lockout goes to (structurally the Security Center's SecurityEvents — identity does not depend on its type). */
export interface LockoutSecurityEvents {
  record(e: { type: 'LOGIN_FAILED_BURST'; severity: 'HIGH'; tenantId: string | null; actorType: string; actorId: string; resourceType: string; resourceId: string; ip: string | null; reason: string }): Promise<boolean>;
}
/** Security Deep Scan C4: an exhausted attempt budget is a HIGH security event (LOGIN_FAILED_BURST raised to HIGH — the
 *  catalog has no dedicated type yet; adding one needs a migration of the security_events CHECK constraint). */
export function attemptLockoutRecorder(events?: LockoutSecurityEvents | null): ((e: AttemptLockout) => Promise<boolean>) | undefined {
  if (!events) return undefined;
  return (e) => events.record({ type: 'LOGIN_FAILED_BURST', severity: 'HIGH', tenantId: e.tenantId ?? null, actorType: 'user', actorId: e.userId,
    resourceType: 'user', resourceId: e.userId, ip: e.ip ?? null,
    reason: `${e.kind} attempt budget exhausted: ${e.failures} failed attempts in ${Math.round(e.windowMs / 60_000)} min; locked for this window` });
}

function notifyLockout(cb: AttemptBudgetOptions['onLockout'], e: AttemptLockout): void {
  if (!cb) return;
  try {
    const r = cb(e) as { catch?: (f: (x: unknown) => unknown) => unknown } | undefined;
    if (r && typeof r.catch === 'function') r.catch((err: unknown) => process.emitWarning(`attempt-budget lockout sink failed: ${String(err)}`));
  } catch (err) {
    process.emitWarning(`attempt-budget lockout sink failed: ${String(err)}`);
  }
}
