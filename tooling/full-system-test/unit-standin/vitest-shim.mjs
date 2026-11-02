// a minimal vitest stand-in: describe / it / expect with the matchers these specs use. Runs tests sequentially.
import { isDeepStrictEqual, inspect } from 'node:util';
const tests = []; const stack = [];
export const describe = (n, fn) => { stack.push(n); fn(); stack.pop(); };
export const it = (n, fn) => tests.push({ name: [...stack, n].join(' › '), fn });
export const test = it;
const fmt = (n, row, i) => String(n).replace(/%[sdifjo#%]/g, (m) => m === '%#' ? String(i) : m === '%%' ? '%' : (Array.isArray(row) ? inspect(row.shift?.() ?? '') : inspect(row))).replace(/\$(\w+)/g, (_, k) => (row && typeof row === 'object' && k in row ? String(row[k]) : '$' + k));
const each = (reg) => (rows) => (n, fn) => rows.forEach((r, i) => reg(fmt(n, Array.isArray(r) ? [...r] : r, i), () => (Array.isArray(r) ? fn(...r) : fn(r))));
const skipT = () => {}; const SKIPPED = []; const skipped = (n) => SKIPPED.push(n);
for (const f of [describe, it]) { f.skip = (n) => skipped(n); f.todo = (n) => skipped(n); f.only = f; f.concurrent = f; f.sequential = f;
  f.skipIf = (c) => (c ? (n) => skipped(n) : f); f.runIf = (c) => (c ? f : (n) => skipped(n)); f.each = each(f); }
globalThis.__SKIPPED = SKIPPED;
const mockFn = (impl = () => undefined) => { let cur = impl; const f = function (...a) { f.mock.calls.push(a); return cur.apply(this, a); };
  f.mock = { calls: [] }; f.mockImplementation = (i) => { cur = i; return f; }; f.mockResolvedValue = (v) => { cur = async () => v; return f; }; f.mockReturnValue = (v) => { cur = () => v; return f; }; return f; };
const globals = []; const spies = [];
export const vi = {
  fn: mockFn,
  useRealTimers: () => vi,
  mock: () => { throw new Error('HARNESS: vi.mock (module mocking) is not supported by the stand-in'); },
  useFakeTimers: () => { throw new Error('HARNESS: fake timers are not supported by the stand-in'); },
  clearAllMocks: () => vi, resetAllMocks: () => vi,   // the stand-in only has real timers; switching back to them is a no-op
  spyOn: (obj, k) => { const orig = obj[k]; const f = mockFn(function (...a) { return orig.apply(this, a); }); f.mockRestore = () => { obj[k] = orig; }; obj[k] = f; spies.push(f); return f; },
  stubGlobal: (k, v) => { globals.push([k, globalThis[k]]); globalThis[k] = v; },
  unstubAllGlobals: () => { while (globals.length) { const [k, v] = globals.pop(); globalThis[k] = v; } },
  restoreAllMocks: () => { while (spies.length) spies.pop().mockRestore(); },
};
export const beforeEach = (fn) => { (globalThis.__beforeEach ??= []).push(fn); };
export const afterEach = (fn) => { (globalThis.__afterEach ??= []).push(fn); };
export const beforeAll = (fn) => { (globalThis.__beforeAll ??= []).push(fn); };
export const afterAll = (fn) => { (globalThis.__afterAll ??= []).push(fn); };
const ASYM = Symbol('asym');
const objectContaining = (o) => ({ [ASYM]: (v) => v !== null && typeof v === 'object' && matchObj(v, o) });
const stringContaining = (s) => ({ [ASYM]: (v) => typeof v === 'string' && v.includes(s) });
const any = (C) => ({ [ASYM]: (v) => v != null && (v.constructor === C || v instanceof C) });
const eq = (a, b) => { if (b && b[ASYM]) return b[ASYM](a); if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((x, i) => eq(a[i], x));
  if (b && typeof b === 'object' && !(b instanceof Date) && !Buffer.isBuffer(b)) { if (!a || typeof a !== 'object') return false; const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined); return ka.length === kb.length && kb.every((k) => eq(a[k], b[k])); }
  return isDeepStrictEqual(a, b); };
const matchObj = (a, b) => { if (b && b[ASYM]) return b[ASYM](a); if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((x, i) => matchObj(a[i], x)); if (b && typeof b === 'object') return a != null && typeof a === 'object' && Object.keys(b).every((k) => matchObj(a[k], b[k])); return isDeepStrictEqual(a, b); };
const fail = (m) => { throw new Error(m); };
function matchers(v, not = false, label = '') {
  const ok = (c, m) => { if (c === not) fail((label ? `[${label}] ` : '') + (not ? 'NOT ' : '') + m); };
  const s = (x) => inspect(x, { depth: 4 });
  const m = {
    toBe: (e) => ok(Object.is(v, e), `expected ${s(v)} toBe ${s(e)}`),
    toEqual: (e) => ok(eq(v, e), `expected ${s(v)} toEqual ${s(e)}`),
    toStrictEqual: (e) => ok(isDeepStrictEqual(v, e), `expected ${s(v)} toStrictEqual ${s(e)}`),
    toMatchObject: (e) => ok(matchObj(v, e), `expected ${s(v)} toMatchObject ${s(e)}`),
    toBeDefined: () => ok(v !== undefined, 'expected defined'), toBeUndefined: () => ok(v === undefined, `expected undefined, got ${s(v)}`),
    toBeNull: () => ok(v === null, `expected null, got ${s(v)}`), toBeTruthy: () => ok(!!v, `expected truthy ${s(v)}`), toBeFalsy: () => ok(!v, `expected falsy ${s(v)}`),
    toBeGreaterThan: (n) => ok(v > n, `${v} > ${n}`), toBeLessThan: (n) => ok(v < n, `${v} < ${n}`), toBeGreaterThanOrEqual: (n) => ok(v >= n, `${v} >= ${n}`), toBeLessThanOrEqual: (n) => ok(v <= n, `${v} <= ${n}`),
    toContain: (e) => ok(typeof v === 'string' ? v.includes(e) : [...v].some((x) => Object.is(x, e)), `expected ${s(v)} toContain ${s(e)}`),
    toHaveLength: (n) => ok(v?.length === n, `expected length ${n}, got ${v?.length}`),
    toHaveProperty: (k, val) => ok(v != null && k in Object(v) && (val === undefined || eq(v[k], val)), `expected property ${k}`),
    toMatch: (re) => ok(typeof re === 'string' ? String(v).includes(re) : re.test(String(v)), `expected ${s(v)} toMatch ${re}`),
    toBeCloseTo: (n, d = 2) => ok(Math.abs(v - n) < 10 ** -d / 2, `expected ${v} toBeCloseTo ${n}`),
    toBeNaN: () => ok(Number.isNaN(v), `expected NaN, got ${s(v)}`),
    toContainEqual: (e) => ok([...v].some((x) => eq(x, e)), `expected ${s(v)} toContainEqual ${s(e)}`),
    toHaveBeenLastCalledWith: (...a) => ok(eq(v?.mock?.calls?.at(-1), a), `expected last call with ${s(a)}`),
    toHaveBeenNthCalledWith: (k, ...a) => ok(eq(v?.mock?.calls?.[k - 1], a), `expected call ${k} with ${s(a)}`),
    toBeTypeOf: (t) => ok(typeof v === t, `expected typeof ${t}, got ${typeof v}`),
    toSatisfy: (fn) => ok(!!fn(v), 'expected to satisfy'),
    toBeOneOf: (xs) => ok(xs.some((x) => eq(v, x)), `expected one of ${s(xs)}`),
    toBeInstanceOf: (C) => ok(v instanceof C, `expected instance of ${C?.name}`),
    toHaveBeenCalled: () => ok((v?.mock?.calls?.length ?? 0) > 0, 'expected a call'), toHaveBeenCalledTimes: (n) => ok(v?.mock?.calls?.length === n, `expected ${n} calls, got ${v?.mock?.calls?.length}`),
    toHaveBeenCalledWith: (...a) => ok((v?.mock?.calls ?? []).some((c) => eq(c, a)), `expected call with ${s(a)}`),
    toThrowError: (e) => m.toThrow(e),
    toThrow: (e) => { let thrown = null; try { v(); } catch (x) { thrown = x ?? new Error('thrown'); }
      const msgOk = thrown && (e === undefined || (e instanceof RegExp ? e.test(thrown.message) : typeof e === 'string' ? thrown.message.includes(e) : thrown instanceof e));
      ok(!!msgOk, `expected throw ${e ?? ''}, got ${thrown ? thrown.message : 'no throw'}`); },
  };
  return m;
}
export function expect(v, label) {
  const m = matchers(v, false, label); m.not = matchers(v, true, label);
  m.resolves = new Proxy({}, { get: (_, k) => async (...a) => matchers(await v, false, label)[k](...a) });
  m.rejects = new Proxy({}, { get: (_, k) => async (...a) => { let e, threw = false; try { await v; } catch (x) { e = x; threw = true; } if (!threw) fail('expected rejection'); return k === 'toThrow' ? matchers(() => { throw e; }, false, label).toThrow(...a) : matchers(e, false, label)[k](...a); } });
  return m;
}
const arrayContaining = (xs) => ({ [ASYM]: (v) => Array.isArray(v) && xs.every((x) => v.some((y) => eq(y, x))) });
expect.arrayContaining = arrayContaining;
expect.objectContaining = objectContaining; expect.stringContaining = stringContaining; expect.any = any;
expect.assertions = () => {}; expect.hasAssertions = () => {};
expect.anything = () => ({ [ASYM]: (v) => v !== null && v !== undefined });
expect.stringMatching = (re) => ({ [ASYM]: (v) => typeof v === "string" && (re instanceof RegExp ? re.test(v) : v.includes(re)) });
process.on('beforeExit', async () => {
  if (globalThis.__ran) return; globalThis.__ran = true;
  let pass = 0; const fails = [];
  for (const f of globalThis.__beforeAll ?? []) await f();
  for (const t of tests) { try { for (const f of globalThis.__beforeEach ?? []) await f(); await t.fn(); for (const f of globalThis.__afterEach ?? []) await f(); pass++; } catch (e) { fails.push(`✗ ${t.name}\n    ${String(e?.message ?? e).split('\n')[0]}`); } }
  console.log(fails.join('\n')); console.log(`${process.env.SPEC_NAME ?? 'spec'}: skipped ${SKIPPED.length}`); console.log(`${process.env.SPEC_NAME ?? 'spec'}: ${pass} passed, ${fails.length} failed (of ${tests.length})`);
  process.exitCode = fails.length ? 1 : 0;
});
