// code-lookup-limit.ts — the per-caller limit on lookups BY SECRET CODE (BUILD_PLAN Phase 14, Constitution 12:
// "Coupon/gift-card abuse controls implemented").
//
// A gift-card number, a coupon code, a reward code and a gift-claim token are bearer secrets: whoever can guess one can
// spend it. Gift-card numbers are 16 CSPRNG digits, so guessing one is infeasible — but coupon and reward codes are
// shorter, a wrong guess costs the guesser nothing, and the only lookup limit before this was a per-process in-memory
// counter on ONE route (POS gift-card lookup) and a per-user one on coupon codes. This is the one limit for every such
// route, shared across replicas through Postgres (migration 564), keyed three ways:
//
//   caller   the signed-in user; else the authenticated device; else the client IP
//   ip       clientIp(req) — the trusted-proxy address (never a raw X-Forwarded-For)
//   tenant   the salon the lookup ran in (null when there is none)
//
// WEIGHTED, not counted: a MISS (no such code) costs MISS_WEIGHT, a HIT (a real code) costs HIT_WEIGHT. Enumeration is a
// run of misses; a front desk is a run of hits with the odd typo. Every attempt is ADMITTED at full (miss) weight before
// the lookup runs and SETTLED afterwards — so concurrent guesses cannot all pass a check that each saw as "under budget".
//
// THE BUDGETS ARE SIZED FROM A FRONT DESK's LOAD, not guessed (code-lookup-limit.test.ts holds the model):
//   a busy salon at its peak (Mother's Day / Christmas Eve) — three stations behind one IP, each ringing up a gift-card
//   payment or sale every 90 s, each touching the card ~3 times (look up, pay, reload or re-check) and mistyping a number
//   about once every 5 transactions — scores 5 per station (30 hits × 0.1 + 2 misses) and 15 per salon / IP in 15
//   minutes. The budgets below leave ≥ 2× headroom over that for every key, while a guessing script is stopped after
//   12 misses. Inside a 15-minute window:
//     caller  12   (12 wrong guesses; 2.4× the busiest station)
//     ip      30   (a salon's stations usually share one IP; 2× the busiest salon)
//     tenant  60   (several callers guessing together at one salon; 4× the busiest salon)
// FAIL-OPEN (as every limiter here): a store error admits the lookup — the limiter can never take checkout down.

export type CodeLookupKind = 'gift_card' | 'coupon' | 'reward_code' | 'gift_claim';
export type CodeLookupOutcome = 'hit' | 'miss' | 'neutral';

export const CODE_LOOKUP_WINDOW_MS = 15 * 60_000;
export const MISS_WEIGHT = 1;
export const HIT_WEIGHT = 0.1;
export const CODE_LOOKUP_BUDGET = { caller: 12, ip: 30, tenant: 60 } as const;
export type CodeLookupDimension = keyof typeof CODE_LOOKUP_BUDGET;

export interface CodeLookupKeys { kind: CodeLookupKind; caller: string; ip: string | null; tenantId: string | null }
export interface CodeLookupScores { caller: number; ip: number; tenant: number }
export interface CodeLookupAdmission { allowed: boolean; attemptId: string | null; retryAfterMs: number; blockedBy?: CodeLookupDimension }

/** Which budget, if any, is exhausted — an attempt is admitted only while EVERY key has room for one more miss. */
export function blockedDimension(s: CodeLookupScores, k: Pick<CodeLookupKeys, 'ip' | 'tenantId'>, budget = CODE_LOOKUP_BUDGET): CodeLookupDimension | null {
  if (s.caller + MISS_WEIGHT > budget.caller) return 'caller';
  if (k.ip && s.ip + MISS_WEIGHT > budget.ip) return 'ip';
  if (k.tenantId && s.tenant + MISS_WEIGHT > budget.tenant) return 'tenant';
  return null;
}

export const weightFor = (o: Exclude<CodeLookupOutcome, 'neutral'>): number => (o === 'hit' ? HIT_WEIGHT : MISS_WEIGHT);

/** The caller key for a request: the user, else a server-authenticated device, else the IP. Never a client header. */
export function callerKeyFor(req: any, ip: string | null): string {
  const user = req?.ctx?.userId ?? req?.user?.id ?? null;
  if (user) return `user:${String(user).slice(0, 120)}`;
  if (req?.deviceId) return `device:${String(req.deviceId).slice(0, 120)}`;
  return `ip:${ip ?? 'unknown'}`;
}

// ── classifying what a lookup found ──────────────────────────────────────────────────────────────────────────────
// A MISS is "no such code" — and only that. Every route's own miss wording is listed here and pinned by a test that runs
// the real services with an unknown code (apps/api code-lookup-limit routes spec), so a reworded message cannot silently
// turn misses into free attempts.
const MISS_MESSAGES = [
  /gift card not found/i,
  /^invalid gift card$/i,
  /isn[’']t valid here/i,
  /reward code was not found/i,
];
const MISS_REASON_CODES = new Set(['unknown_code', 'not_found']);

function messageOf(e: any): string {
  const r = typeof e?.getResponse === 'function' ? e.getResponse() : null;
  if (typeof r === 'string') return r;
  if (r && typeof r.message === 'string') return r.message;
  return String(e?.message ?? '');
}
function bodyOf(e: any): any { return typeof e?.getResponse === 'function' ? e.getResponse() : null; }

/** A handler's RESULT: `{ found: false }` / `{ ok: false, reason: 'not_found' }` are misses; anything else a hit. */
export function classifyLookupResult(result: any): CodeLookupOutcome {
  if (result && typeof result === 'object') {
    if (result.found === false) return 'miss';
    if (result.ok === false && MISS_REASON_CODES.has(String(result.reason ?? ''))) return 'miss';
    if (result.ok === false) return 'hit';   // a real code in a state that refuses it (claimed, expired) — it exists
  }
  return 'hit';
}
/** A handler's ERROR: a 404, or a 400 whose message / reason code says "no such code", is a miss; any other error
 *  (validation, permission, a paid ticket, a 5xx) says nothing about the code and does not count. */
export function classifyLookupError(e: any): CodeLookupOutcome {
  const status = typeof e?.getStatus === 'function' ? e.getStatus() : Number(e?.status ?? 0);
  if (status === 404) return 'miss';
  if (status !== 400 && status !== 409) return 'neutral';
  const body = bodyOf(e);
  if (body && Array.isArray(body.reasons) && body.reasons.some((x: any) => MISS_REASON_CODES.has(String(x?.code ?? '')))) return 'miss';
  const msg = messageOf(e);
  if (MISS_MESSAGES.some((re) => re.test(msg.trim()))) return 'miss';
  return status === 409 ? 'hit' : 'neutral';   // 409 = the code exists but is used / expired / cancelled
}

// ── the store port + an in-process implementation (tests, in-memory mode) ─────────────────────────────────────────
export interface CodeLookupStore {
  /** Admit (or refuse) one attempt, recording it at miss weight when admitted. Atomic per key. */
  admit(keys: CodeLookupKeys): Promise<CodeLookupAdmission>;
  /** Settle an admitted attempt: hit / miss reweights it, neutral removes it. */
  settle(attemptId: string, outcome: CodeLookupOutcome): Promise<void>;
}
export const CODE_LOOKUP_STORE = 'CODE_LOOKUP_STORE';   // a string token: the same value however many copies load

interface MemRow { id: string; keys: CodeLookupKeys; weight: number; at: number }
export class InMemoryCodeLookupStore implements CodeLookupStore {
  private rows: MemRow[] = [];
  private seq = 0;
  constructor(private readonly now: () => number = () => Date.now(), private readonly budget = CODE_LOOKUP_BUDGET, private readonly windowMs = CODE_LOOKUP_WINDOW_MS) {}
  async admit(keys: CodeLookupKeys): Promise<CodeLookupAdmission> {
    const t = this.now(); const since = t - this.windowMs;
    this.rows = this.rows.filter((r) => r.at > since);
    const sum = (f: (r: MemRow) => boolean) => this.rows.filter(f).reduce((n, r) => n + r.weight, 0);
    const s: CodeLookupScores = {
      caller: sum((r) => r.keys.caller === keys.caller),
      ip: keys.ip ? sum((r) => r.keys.ip === keys.ip) : 0,
      tenant: keys.tenantId ? sum((r) => r.keys.tenantId === keys.tenantId) : 0,
    };
    const dim = blockedDimension(s, keys, this.budget);
    if (dim) {
      const mine = this.rows.filter((r) => (dim === 'caller' ? r.keys.caller === keys.caller : dim === 'ip' ? r.keys.ip === keys.ip : r.keys.tenantId === keys.tenantId));
      const oldest = Math.min(...mine.map((r) => r.at));
      return { allowed: false, attemptId: null, retryAfterMs: Math.max(1_000, oldest + this.windowMs - t), blockedBy: dim };
    }
    const id = String(++this.seq);
    this.rows.push({ id, keys, weight: MISS_WEIGHT, at: t });
    return { allowed: true, attemptId: id, retryAfterMs: 0 };
  }
  async settle(attemptId: string, outcome: CodeLookupOutcome): Promise<void> {
    const i = this.rows.findIndex((r) => r.id === attemptId);
    if (i < 0) return;
    if (outcome === 'neutral') this.rows.splice(i, 1);
    else this.rows[i].weight = weightFor(outcome);
  }
}
