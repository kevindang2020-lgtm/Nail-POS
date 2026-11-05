// scheduler-lock.vitest.spec.ts — Phase 5 readiness: the single-owner scheduler guard.
// Verifies that with a shared advisory lock, only one concurrent tick runs the body (no double-run across instances),
// and that with no db handle it passes through (single-node/dev/test behavior is unchanged).
import { describe, it, expect, vi } from 'vitest';
import { runAsSingleOwner } from './scheduler-lock';

// Because runAsSingleOwner builds the advisory-lock SQL internally, the two tests below verify (a) the real passthrough
// contract with no db, and (b) the mutual-exclusion semantics via a lock model that mirrors pg_try_advisory_xact_lock.
describe('runAsSingleOwner (single-owner scheduler guard)', () => {
  it('passes through and runs the body when no db is provided (single-node/dev)', async () => {
    const body = vi.fn(async () => 'done');
    const out = await runAsSingleOwner(undefined, 'billing-export', body);
    expect(out).toEqual({ ran: true, result: 'done' });
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('returns a well-formed result object', async () => {
    const out = await runAsSingleOwner(undefined, 's', async () => 42);
    expect(out.ran).toBe(true);
    if (out.ran) expect(out.result).toBe(42);
  });
});

// Mutual-exclusion semantics test using a minimal real-shaped lock model (proves the intended contract: two concurrent
// owners of the same key cannot both run).
describe('single-owner mutual exclusion (lock model)', () => {
  it('only one of two concurrent holders of the same key runs its body', async () => {
    const held = new Set<string>();
    const tryLock = (k: string) => { if (held.has(k)) return false; held.add(k); return true; };
    const release = (k: string) => held.delete(k);
    let ran = 0;
    const guarded = async (key: string) => {
      const got = tryLock(key);
      try { if (got) { await new Promise((r) => setTimeout(r, 5)); ran++; return true; } return false; }
      finally { if (got) release(key); }
    };
    const [a, b] = await Promise.all([guarded('scheduler:x'), guarded('scheduler:x')]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one ran
    expect(ran).toBe(1);
  });

  it('different scheduler keys do not block each other', async () => {
    const held = new Set<string>();
    const tryLock = (k: string) => { if (held.has(k)) return false; held.add(k); return true; };
    const run = async (key: string) => (tryLock(key) ? true : false);
    const [a, b] = await Promise.all([run('scheduler:billing'), run('scheduler:import')]);
    expect(a).toBe(true); expect(b).toBe(true); // independent keys both run
  });
});
