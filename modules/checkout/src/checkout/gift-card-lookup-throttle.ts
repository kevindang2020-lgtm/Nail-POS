// gift-card-lookup-throttle.ts — failed-lookup throttle for gift-card lookups (spec §13/§23: rate-limit lookups, guard
// against number guessing / excessive failed lookups). Scores timestamps with the shared pure rateLimitDecision; this
// port just supplies/records them, keyed per tenant+user. In-memory by default (per-process); a persistent adapter
// (Redis/Postgres) can replace it without touching the service.
export interface GiftCardLookupThrottle {
  recentFailures(key: string): Promise<number[]>; // epoch-ms timestamps of recent FAILED lookups for this key
  recordFailure(key: string): Promise<void>;
}

export class InMemoryGiftCardLookupThrottle implements GiftCardLookupThrottle {
  private m = new Map<string, number[]>();
  private readonly windowMs: number;
  constructor(windowMs = 15 * 60_000) { this.windowMs = windowMs; }
  async recentFailures(key: string): Promise<number[]> {
    const now = Date.now();
    const arr = (this.m.get(key) || []).filter((t) => now - t < this.windowMs);
    this.m.set(key, arr);
    return arr;
  }
  async recordFailure(key: string): Promise<void> {
    const arr = await this.recentFailures(key);
    arr.push(Date.now());
    this.m.set(key, arr);
  }
}
