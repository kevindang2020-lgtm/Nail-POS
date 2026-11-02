// ai-checkout-upsell.idempotency.ts — durable idempotency for charge-producing actions (§46/§47). The uniqueness
// boundary is tenant + branch + checkout + operation + targetId + client key. Contract:
//   • same key + same normalized payload  → return the ORIGINAL result (never execute twice)
//   • same key + different payload         → IDEMPOTENCY_CONFLICT
//   • failed before commit                 → retry allowed
//   • success                              → not executed again
// The store is a port so the real module backs it with a DB unique constraint (survives retries/worker redelivery/
// double-clicks across instances); the in-memory impl below is for tests. `runOnce` is the pure orchestration.

export function idempotencyKey(parts: { tenantId: string; branchId: string; checkoutId: string; operation: string; targetId: string; clientKey: string }): string {
  return [parts.tenantId, parts.branchId, parts.checkoutId, parts.operation, parts.targetId, parts.clientKey].join('|');
}

export function payloadHash(payload: unknown): string {
  const s = stableStringify(payload);
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v as any).sort().map(k => JSON.stringify(k) + ':' + stableStringify((v as any)[k])).join(',') + '}';
}

export type BeginResult = { status: 'new' } | { status: 'done'; result: unknown } | { status: 'conflict' };
export interface IdempotencyStore {
  begin(key: string, hash: string): Promise<BeginResult>;   // reserve the key; report done/conflict for a prior attempt
  complete(key: string, result: unknown): Promise<void>;    // commit the successful result
  fail(key: string): Promise<void>;                         // release a pre-commit failure so a retry can proceed
}

/** Run `fn` at most once per (key, payload). Returns the original result on a duplicate; conflicts on payload mismatch. */
export async function runOnce<T>(store: IdempotencyStore, key: string, payload: unknown, fn: () => Promise<T>): Promise<T> {
  const hash = payloadHash(payload);
  const b = await store.begin(key, hash);
  if (b.status === 'done') return b.result as T;
  if (b.status === 'conflict') throw new Error('IDEMPOTENCY_CONFLICT');
  try { const r = await fn(); await store.complete(key, r); return r; }
  catch (e) { await store.fail(key); throw e; }
}

/** In-memory store for tests: one instance shared across "requests" simulates the DB row. Handles concurrent submits:
 *  a loser that finds a fresh pending row waits for the in-flight winner rather than re-executing (exactly-once). */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, { hash: string; done: boolean; result?: unknown }>();
  constructor(private readonly pollMs = 5, private readonly pollMax = 200) {}
  async begin(key: string, hash: string): Promise<BeginResult> {
    const cur = this.m.get(key);
    if (!cur) { this.m.set(key, { hash, done: false }); return { status: 'new' }; }
    if (cur.hash !== hash) return { status: 'conflict' };
    if (cur.done) return { status: 'done', result: cur.result };
    // pending: a concurrent attempt holds the key — wait for it rather than double-execute.
    for (let i = 0; i < this.pollMax; i++) {
      await new Promise(r => setTimeout(r, this.pollMs));
      const c = this.m.get(key);
      if (!c) return { status: 'new' };                       // winner failed + released → we may proceed
      if (c.hash !== hash) return { status: 'conflict' };
      if (c.done) return { status: 'done', result: c.result }; // winner committed → return its result
    }
    return { status: 'new' };                                  // timed out → assume crashed winner; take over
  }
  async complete(key: string, result: unknown): Promise<void> { const c = this.m.get(key); if (c) { c.done = true; c.result = result; } }
  async fail(key: string): Promise<void> { const c = this.m.get(key); if (c && !c.done) this.m.delete(key); }
}
