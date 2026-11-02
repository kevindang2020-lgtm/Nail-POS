// the slice of rxjs the interceptors and specs use
export class Observable { constructor(sub) { this._sub = sub; }
  subscribe(o) { const obs = typeof o === 'function' ? { next: o } : (o ?? {}); let done = false;
    const safe = { next: (v) => { if (!done) obs.next?.(v); }, error: (e) => { if (!done) { done = true; obs.error?.(e); } }, complete: () => { if (!done) { done = true; obs.complete?.(); } } };
    try { this._sub(safe); } catch (e) { safe.error(e); } return { unsubscribe() { done = true; } }; }
  pipe(...ops) { return ops.reduce((o, op) => op(o), this); } }
export const of = (...vs) => new Observable((s) => { for (const v of vs) s.next(v); s.complete(); });
export const from = (x) => new Observable((s) => { if (x && typeof x.then === 'function') x.then((v) => { s.next(v); s.complete(); }, (e) => s.error(e)); else { for (const v of x) s.next(v); s.complete(); } });
export const throwError = (f) => new Observable((s) => s.error(typeof f === 'function' ? f() : f));
export const map = (fn) => (src) => new Observable((s) => src.subscribe({ next: (v) => { try { s.next(fn(v)); } catch (e) { s.error(e); } }, error: (e) => s.error(e), complete: () => s.complete() }));
export const tap = (o) => (src) => new Observable((s) => src.subscribe({ next: (v) => { (typeof o === 'function' ? o : o?.next)?.(v); s.next(v); }, error: (e) => { o?.error?.(e); s.error(e); }, complete: () => { o?.complete?.(); s.complete(); } }));
export const catchError = (fn) => (src) => new Observable((s) => src.subscribe({ next: (v) => s.next(v), error: (e) => { try { fn(e, src).subscribe(s); } catch (x) { s.error(x); } }, complete: () => s.complete() }));
export const mergeMap = (fn) => (src) => new Observable((s) => src.subscribe({ next: (v) => from(Promise.resolve(fn(v)).then((r) => r instanceof Observable ? lastValueFrom(r) : r)).subscribe({ next: (x) => s.next(x), error: (e) => s.error(e) }), error: (e) => s.error(e), complete: () => setTimeout(() => s.complete(), 0) }));
export const switchMap = mergeMap, concatMap = mergeMap;
export const lastValueFrom = (o) => new Promise((res, rej) => { let v, has = false; o.subscribe({ next: (x) => { v = x; has = true; }, error: rej, complete: () => has ? res(v) : rej(new Error('no elements')) }); });
export const firstValueFrom = (o) => new Promise((res, rej) => { let d = false; o.subscribe({ next: (x) => { if (!d) { d = true; res(x); } }, error: rej, complete: () => { if (!d) rej(new Error('no elements')); } }); });
