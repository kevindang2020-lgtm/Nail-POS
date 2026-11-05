// ai-usage-unknown.vitest.spec.ts — "we could not read the usage" is NOT "the usage is zero".
//
// ── The bug ─────────────────────────────────────────────────────────────────────────────────────────────
// `KyselyAiAccessRepo.loadSnapshot()` read the tenant's consumption with:
//
//     .catch(() => 0)
//
// A failed count therefore looked EXACTLY like a tenant who had consumed nothing. And the gate decides the limit
// with `s.usage.used + requested > limit` — so with `used: 0`, that is false for every tenant, on every package,
// always.
//
// **One flaky query silently removed EVERY tenant's usage cap.** They kept consuming AI past their limit, for
// free, until a human happened to notice. Nothing errored. Nothing alerted. The number was simply wrong, and it
// was wrong in the direction that costs money.
//
// ── The fix, and why it is not "fail closed" ────────────────────────────────────────────────────────────
// Blocking a paying tenant because a COUNT timed out is the worse error — that is the same reasoning as the
// entitlement guard, which also fails open on a lookup failure. So the call is still ALLOWED.
//
// What changes is that the uncertainty is no longer laundered into a number: `usageUnknown` says so out loud, and
// `limitExceeded: false` now means "unknown", not "within limit". A caller can log it, alert on it, or refuse to
// bill against it. It cannot mistake it for a fact.
import { describe, it, expect } from 'vitest';
import { evaluateAiAccess, type AiAccessSnapshot } from './ai-access-gate';

const snap = (over: Partial<AiAccessSnapshot> = {}): AiAccessSnapshot => ({
  tenantStatus: 'active',
  supportMode: false,
  packageEnabled: true,
  subscription: { status: 'active', trialEndsAt: null },
  usage: { used: 0, limit: 500, overageEnabled: false },
  hasPermission: true,
  pastDuePolicy: 'block',
  ...over,
} as AiAccessSnapshot);

describe('a KNOWN usage still enforces the limit', () => {
  it('denies a tenant at their cap', () => {
    const d = evaluateAiAccess(snap({ usage: { used: 500, limit: 500, overageEnabled: false } } as any));
    expect(d.allowed).toBe(false);
    expect(d.limitExceeded).toBe(true);
  });

  it('allows a tenant under their cap', () => {
    const d = evaluateAiAccess(snap({ usage: { used: 10, limit: 500, overageEnabled: false } } as any));
    expect(d.allowed).toBe(true);
    expect(d.limitExceeded).toBe(false);
    expect(d.usageUnknown).toBeFalsy();
  });
});

describe('an UNKNOWN usage is not a zero usage', () => {
  it('allows the call — a paying tenant must not be cut off because a COUNT timed out', () => {
    const d = evaluateAiAccess(snap({ usageUnknown: true, usage: { used: 0, limit: 500, overageEnabled: false } } as any));
    expect(d.allowed).toBe(true);
  });

  it('but says SO — the uncertainty is visible instead of laundered into a number', () => {
    const d = evaluateAiAccess(snap({ usageUnknown: true } as any));
    expect(d.usageUnknown).toBe(true);
    // `limitExceeded: false` here means UNKNOWN. The flag is what stops a caller reading it as "within limit".
    expect(d.limitExceeded).toBe(false);
  });

  it('reports remaining as NULL — and emphatically NOT -1, which means "unlimited"', () => {
    // My first cut of this fix returned -1. In this codebase -1 means UNLIMITED, so a billing screen would have
    // told the tenant they had NO CAP — a confident lie, in the one direction that costs money. That is the same
    // failure as `.catch(() => 0)` wearing a different number.
    //
    // `null` cannot be mistaken for a quantity. Any caller doing arithmetic on it fails loudly rather than
    // rendering a comfortable falsehood. The typechecker found the one consumer the moment it changed.
    const d = evaluateAiAccess(snap({ usageUnknown: true } as any));
    expect(d.remainingUsage).toBeNull();
    expect(d.remainingUsage).not.toBe(-1);
  });

  it('a genuinely UNLIMITED package still reports -1 — the two are different facts', () => {
    const d = evaluateAiAccess(snap({ usage: { used: 9_999, limit: 0, overageEnabled: false } } as any));
    expect(d.allowed).toBe(true);
    expect(d.remainingUsage).toBe(-1);      // no cap
    expect(d.usageUnknown).toBeFalsy();     // and we know it
  });

  it('an unknown usage NEVER silently denies either — it is not a back-door block', () => {
    for (const limit of [0, 1, 500, 10_000]) {
      const d = evaluateAiAccess(snap({ usageUnknown: true, usage: { used: 0, limit, overageEnabled: false } } as any));
      expect(d.allowed, `limit=${limit}`).toBe(true);
    }
  });

  it('the OTHER gates still apply — unknown usage does not excuse an unpaid tenant', () => {
    // The usage flag must not become a way past the subscription check. It is evaluated at step 6, after tenant
    // status, package enablement, and subscription status have all had their say.
    const d = evaluateAiAccess(snap({ usageUnknown: true, subscription: null } as any));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('not_subscribed');
  });

  it('and a suspended tenant is still suspended', () => {
    const d = evaluateAiAccess(snap({ usageUnknown: true, tenantStatus: 'suspended' } as any));
    expect(d.allowed).toBe(false);
  });
});
