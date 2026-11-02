// version-precondition.vitest.spec — Constitution 5 §57–58: ETag / If-Match are two spellings of expectedVersion.
import { describe, it, expect } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import { parseIfMatch, versionOf, VersionPreconditionInterceptor } from './version-precondition';

const ctxOf = (method: string, headers: any, body?: any) => {
  const req: any = { method, headers, body }; const res: any = { headers: {}, setHeader(k: string, v: string) { this.headers[k] = v; } };
  return { req, res, ctx: { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any };
};
const ic = new VersionPreconditionInterceptor();

describe('If-Match parsing and the version of a body', () => {
  it('"12" and W/"12" are version 12; * is "any"; a hash or junk is invalid; absent is none', () => {
    expect(parseIfMatch('"12"')).toEqual({ kind: 'version', version: 12 }); expect(parseIfMatch('W/"12"')).toEqual({ kind: 'version', version: 12 });
    expect(parseIfMatch('*')).toEqual({ kind: 'any' }); expect(parseIfMatch(undefined)).toEqual({ kind: 'none' });
    for (const v of ['12', '"abc"', 'W/"1a2b-3c"', '"-1"', '"1.5"']) expect(parseIfMatch(v).kind).toBe('invalid');
  });
  it('one item with a whole-number version or recordVersion has one; lists, strings, fractions do not', () => {
    expect(versionOf({ id: 'a', version: 3 })).toBe(3); expect(versionOf({ recordVersion: 0 })).toBe(0);
    for (const b of [[{ version: 1 }], { version: '3' }, { version: 1.5 }, { version: -1 }, null, 'x']) expect(versionOf(b)).toBeNull();
  });
});

describe('the interceptor', () => {
  it('a GET of a versioned item carries ETag "N"; a list does not', async () => {
    const a = ctxOf('GET', {}); await lastValueFrom(ic.intercept(a.ctx, { handle: () => of({ id: 'appt1', version: 13 }) }));
    expect(a.res.headers.ETag).toBe('"13"');
    const b = ctxOf('GET', {}); await lastValueFrom(ic.intercept(b.ctx, { handle: () => of([{ version: 1 }]) }));
    expect(b.res.headers.ETag).toBeUndefined();
  });
  it('If-Match becomes expectedVersion for the route’s own check (also on an empty body)', () => {
    const a = ctxOf('PATCH', { 'if-match': '"12"' }, { notes: 'x' }); ic.intercept(a.ctx, { handle: () => of(1) });
    expect(a.req.body).toEqual({ notes: 'x', expectedVersion: 12 });
    const b = ctxOf('DELETE', { 'if-match': 'W/"4"' }, undefined); ic.intercept(b.ctx, { handle: () => of(1) });
    expect(b.req.body.expectedVersion).toBe(4);
    const c = ctxOf('PATCH', { 'if-match': '"12"' }, { expectedVersion: 12 }); ic.intercept(c.ctx, { handle: () => of(1) });
    expect(c.req.body.expectedVersion).toBe(12);
  });
  it('If-Match: * and no header leave the body alone', () => {
    for (const h of [{ 'if-match': '*' }, {}]) { const a = ctxOf('PATCH', h, { notes: 'x' }); ic.intercept(a.ctx, { handle: () => of(1) }); expect(a.req.body).toEqual({ notes: 'x' }); }
  });
  it('a non-version If-Match, or one that disagrees with expectedVersion, is refused — never silently ignored', () => {
    expect(() => ic.intercept(ctxOf('PATCH', { 'if-match': 'W/"1a-2b"' }, {}).ctx, { handle: () => of(1) })).toThrow(/version from this API/);
    expect(() => ic.intercept(ctxOf('PATCH', { 'if-match': '"12"' }, { expectedVersion: 11 }).ctx, { handle: () => of(1) })).toThrow(/disagree/);
  });
});
