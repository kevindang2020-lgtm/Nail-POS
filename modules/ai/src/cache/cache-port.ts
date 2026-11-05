// cache-port.ts — a small cache abstraction so hot per-tenant reads (e.g. Copilot settings) can be shared across API
// nodes instead of each process holding its own Map. Same shape as the login-throttle seam: a port with an in-memory
// default (per-process, unchanged single-node behaviour) and a Redis-backed implementation (cache-redis.ts) for
// cross-instance correctness. Invalidation is by NAMESPACE via a version counter: bumping the namespace's version makes
// all its keys unreachable at once (old entries expire lazily via TTL) — no SCAN, and a bump on one node is seen by all.
export interface CachePort {
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string, ttlMs: number): Promise<void>;
  invalidate(namespace: string): Promise<void>;
}

export class InMemoryCache implements CachePort {
  private versions = new Map<string, number>();
  private store = new Map<string, { v: string; exp: number }>();
  constructor(private readonly max = 50_000) {}

  private ver(ns: string): number { return this.versions.get(ns) ?? 0; }
  private full(ns: string, key: string): string { return `${ns}#v${this.ver(ns)}#${key}`; }

  async get(ns: string, key: string): Promise<string | null> {
    const hit = this.store.get(this.full(ns, key));
    if (hit && hit.exp > Date.now()) return hit.v;
    return null;
  }
  async set(ns: string, key: string, value: string, ttlMs: number): Promise<void> {
    if (this.store.size >= this.max) this.store.clear();   // crude bound; entries are cheap to rebuild
    this.store.set(this.full(ns, key), { v: value, exp: Date.now() + ttlMs });
  }
  async invalidate(ns: string): Promise<void> { this.versions.set(ns, this.ver(ns) + 1); }
}
