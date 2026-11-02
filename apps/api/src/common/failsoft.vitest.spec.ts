// failsoft.vitest.spec.ts — two names for the two opposite jobs `.catch(() => 0)` was doing.
//
// Every bug found in this codebase today was written the same way, with the same idiom, and the idiom was right
// about half the time:
//
//   • a POS badge counted an impossible status  → 0 forever. A badge. Survivable.
//   • branch-transfer impact hit a dropped table → "0 appointments will be affected", shown to a Super Admin
//     immediately before an IRREVERSIBLE move.
//   • the AI usage counter failed               → used 0 → `0 + 1 > limit` is false for every tenant, always →
//     every usage cap silently vanished and tenants consumed AI free.
//
// The difference is never the catch. It is what the value FEEDS. One construct served both, so the dangerous one
// could be written by accident — and repeatedly was, by people reaching for the safe-looking idiom they had seen
// everywhere else.
import { describe, it, expect } from 'vitest';
import { orZero, orEmpty, orUnknown, coalesceUnknown, UnknownValueError } from './failsoft';

const boom = () => Promise.reject(new Error('db is down'));

describe('orZero — for a value nobody decides anything from', () => {
  it('passes a real count through', async () => {
    expect(await orZero(Promise.resolve(7))).toBe(7);
  });

  it('answers 0 when the count fails — a badge must not take the page down', async () => {
    expect(await orZero(boom())).toBe(0);
  });

  it('treats null/undefined as 0', async () => {
    expect(await orZero(Promise.resolve(null))).toBe(0);
    expect(await orZero(Promise.resolve(undefined))).toBe(0);
  });
});

describe('orUnknown — for a value somebody DOES decide something from', () => {
  it('passes a real value through', async () => {
    expect(await orUnknown(Promise.resolve(42))).toBe(42);
  });

  it('answers NULL on failure — never 0, never a plausible default', async () => {
    // This is the whole file. `0` slides silently into a sum, a comparison, and a UI, and comes out the other
    // side looking like a fact. `null` cannot.
    expect(await orUnknown(boom())).toBeNull();
  });

  it('null cannot be mistaken for a quantity', async () => {
    const v = await orUnknown<number>(boom());
    // Arithmetic on it is NaN, not a wrong-but-plausible number.
    expect(Number(v) + 1).toBe(1);            // Number(null) is 0 — which is exactly why we do NOT do this...
    expect((v as any) > 0).toBe(false);       // ...and why a `>` comparison is false rather than silently true.
    // The real protection is the TYPE: `number | null` will not enter a `number` without the caller deciding.
    expect(v).toBeNull();
  });

  it('preserves a legitimate 0 — an empty branch really does have 0 appointments', async () => {
    // The point is not "0 is bad". It is that a MEASURED 0 and an UNMEASURABLE one must be different values.
    expect(await orUnknown(Promise.resolve(0))).toBe(0);
  });
});

describe('coalesceUnknown — the decision becomes visible at the call site', () => {
  it('can choose zero, explicitly', async () => {
    expect(coalesceUnknown(null, { onUnknown: 'zero' })).toBe(0);
  });

  it('can REFUSE — for a figure that must not be guessed', () => {
    expect(() => coalesceUnknown(null, { onUnknown: 'refuse' })).toThrow(UnknownValueError);
  });

  it('passes a known value through either way', () => {
    expect(coalesceUnknown(5, { onUnknown: 'refuse' })).toBe(5);
    expect(coalesceUnknown(0, { onUnknown: 'refuse' })).toBe(0);   // a measured zero is fine
  });

  it('the refusal message never pretends to know', () => {
    try { coalesceUnknown(null, { onUnknown: 'refuse' }); }
    catch (e: any) { expect(e.message).toMatch(/could not read|not safe to assume/i); }
  });
});

describe('orEmpty', () => {
  it('is the list-shaped sibling of orZero', async () => {
    expect(await orEmpty(Promise.resolve([1, 2]))).toEqual([1, 2]);
    expect(await orEmpty(boom())).toEqual([]);
  });
});
