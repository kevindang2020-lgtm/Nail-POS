// strict-bodies.vitest.spec — Security Deep Scan §40 (S-A14): request bodies REFUSE unknown fields (strict mode) route by
// route, and no first-party client is broken by it.
//
// Read from the framework's own metadata: every mutating route whose body goes through ValidatedBody(schema[, opts]) —
// strict when the pipe was built with { strict: true } or the schema carries 'x-strict'. What every client sends is read
// statically (apps/api/scripts/lib/client-body-calls.mjs: the SPAs, shared packages, single-file apps, pilot / e2e scripts).
//
// THE GATE
//   1. A client call that sends a field a STRICT route does not declare fails (that call would get 400 in production).
//   2. A client call to a strict route whose body cannot be read statically (a variable, a spread) is PROVEN by the type-aware
//      proof (security/strict-bodies.typeproof.json, verdict `proven` — scripts/strict-bodies-typeproof.mjs, gated in CI by
//      check:strict-bodies-types) or is in the reviewed list security/strict-bodies.reviewed.json with the reason it is safe.
//   3. Non-strict routes: security/strict-bodies.baseline.json holds ONLY the reviewed exceptions, each with its reason
//      (Oct 27 2026: provider webhooks / envelopes, the Retell tool gateway, OAuth's ignore-unknown-parameters rule, three
//      settings bodies whose service refuses unknown keys itself, one client defect). A NEW route that reads a body is strict
//      (`@Body(ValidatedBody(SCHEMA, { strict: true }))`); an exception that became strict or is gone fails until removed; an
//      OPEN schema (keeps every field) stays only when it is bounded (S.bounded: x-maxDepth + x-maxNodes).
//   STRICT_BODIES_REPORT=1 writes security/strict-bodies.report.json: per non-strict route, whether strict mode is provably
//   safe (every caller's body read and declared), blocked (a caller sends an undeclared field — named), unverifiable, or has
//   no first-party caller.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codeRoots } from '../../test-support/code-roots';

const ROOT = process.cwd();
const REPO = resolve(ROOT, '../..');
const BASELINE = join(ROOT, 'security/strict-bodies.baseline.json');
const REVIEWED = join(ROOT, 'security/strict-bodies.reviewed.json');
const REPORT = join(ROOT, 'security/strict-bodies.report.json');
const TYPEPROOF = join(ROOT, 'security/strict-bodies.typeproof.json');
const METHOD = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const BODY = 3;   // RouteParamtypes.BODY
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });

export interface BodyRoute { key: string; method: string; path: string; strict: boolean; schema: any; file: string; controller: string; handler: string }

async function bodyRoutes(): Promise<BodyRoute[]> {
  const out = new Map<string, BodyRoute>();
  for (const f of codeRoots().flatMap((r) => walk(r)).filter((x) => /@Controller\(/.test(readFileSync(x, 'utf8')) && /ValidatedBody\(/.test(readFileSync(x, 'utf8')))) {
    const mod: any = await import(f);
    for (const exp of Object.values(mod) as any[]) {
      if (typeof exp !== 'function' || !Reflect.hasMetadata('__controller__', exp)) continue;
      const prefixes = ([] as string[]).concat(Reflect.getMetadata('path', exp) ?? '');
      for (const name of Object.getOwnPropertyNames(exp.prototype)) {
        const h = exp.prototype[name];
        if (typeof h !== 'function' || Reflect.getMetadata('method', h) === undefined) continue;
        const method = METHOD[Reflect.getMetadata('method', h)] ?? 'ALL';
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
        const args = Reflect.getMetadata('__routeArguments__', exp, name) ?? {};
        const pipe = Object.entries(args).filter(([k]) => Number(k.split(':')[0]) === BODY).flatMap(([, v]: any) => v.pipes ?? []).find((p: any) => p && p.schema && typeof p.transform === 'function');
        if (!pipe) continue;
        const strict = !!(pipe.opts?.strict || pipe.schema?.['x-strict']);
        for (const pre of prefixes) for (const sub of ([] as string[]).concat(Reflect.getMetadata('path', h) ?? '')) {
          const path = ('/' + [pre, sub].filter(Boolean).join('/')).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
          const key = `${method} ${path}`;
          out.set(key, { key, method, path, strict, schema: pipe.schema, file: f.replace(REPO + '/', ''), controller: exp.name, handler: name });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const lib: any = await import('../../scripts/lib/client-body-calls.mjs');
const BASELINE_NOTE = 'Security Deep Scan §40 (S-A14): the body routes that do NOT refuse unknown fields, each a reviewed exception with its reason. Every other body route is strict — see strict-bodies.vitest.spec.ts.';
const json = (p: string, d: any) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);

/** Per route: the client calls reaching it and the verdict. */
export async function analyse() {
  const routes = await bodyRoutes();
  const calls = lib.allClientCalls(REPO);
  const unresolved = calls.filter((c: any) => !c.path);
  // each resolved call reaches its MOST specific route (a literal segment beats a :param)
  const target = new Map<any, string>();
  for (const c of calls) {
    if (!c.path) continue;
    const cands = routes.filter((r) => r.method === c.method && lib.pathMatches(c.path, r.path));
    if (!cands.length) continue;
    const best = Math.max(...cands.map((r) => lib.matchScore(c.path, r.path)));
    for (const r of cands) if (lib.matchScore(c.path, r.path) === best) target.set(c, (target.get(c) ? target.get(c) + '\n' : '') + r.key);
  }
  const res = routes.map((r) => {
    const reach = calls.filter((c: any) => c.path && (target.get(c) ?? '').split('\n').includes(r.key));
    const segs = r.path.replace(/:[^/]+/g, '*');
    const vague = unresolved.filter((c: any) => c.method === r.method && lib.fragmentsOf(c.pathExpr).some((fr: string) => fr.split('/').length > 2 && (segs + '/').includes(fr + '/')));
    const bad: string[] = []; const unverifiable: string[] = [];
    for (const c of reach) {
      const u = lib.undeclaredKeys(r.schema, c.shape);
      if (u === 'unverifiable') unverifiable.push(`${c.file}:${c.line}`);
      else for (const k of u) bad.push(`${c.file}:${c.line} sends "${k}"`);
    }
    for (const c of vague) unverifiable.push(`${c.file}:${c.line} (path not resolved: ${String(c.pathExpr).slice(0, 60)})`);
    return { ...r, callers: reach.length, bad, unverifiable };
  });
  // a route no parsed call reaches but whose path is MENTIONED in a client (a fetch(), a generic dispatcher) is not "no caller"
  const text = lib.clientFiles(REPO).map((f: string) => readFileSync(f, 'utf8')).join('\n');
  for (const r of res) {
    if (r.callers || r.unverifiable.length) continue;
    const segs = r.path.split('/').slice(1);
    if (!segs.length) continue;
    const re = new RegExp('[\'"`]' + (r.path.replace(/\/api\/v\d+/, '').split('/').slice(1).map((sg: string) => sg.startsWith(':') ? '[^/\'"`\\s]+' : sg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')).replace(/^/, '(?:/api/v1)?/') + '(?:[\'"`?]|$)', 'm');
    const reTail = segs.length > 1 && segs.slice(-2).every((x: string) => !x.startsWith(':')) ? new RegExp('/' + segs.slice(-2).map((sg: string) => sg.startsWith(':') ? '[^/]+' : sg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '[\'"`?]') : null;
    if (re.test(text) || (reTail && reTail.test(text))) r.unverifiable.push('path mentioned in a client but the call was not parsed');
  }
  return { routes: res, calls: calls.length, unresolved: unresolved.length };
}

const A = await analyse();
// the live injection pass (scripts/live-injection-pass.mjs) needs every body route's declared fields: BODY_SCHEMAS_OUT=<file>
if (process.env.BODY_SCHEMAS_OUT) writeFileSync(process.env.BODY_SCHEMAS_OUT, JSON.stringify(Object.fromEntries(A.routes.map((r) => [r.key, r.schema])), null, 0));

describe('S-A14 strict request bodies (§40)', () => {
  it('no first-party client sends an undeclared field to a strict route', () => {
    const broken = A.routes.filter((r) => r.strict && r.bad.length).map((r) => `${r.key}: ${r.bad.join('; ')}`);
    expect(broken, 'these callers would get 400 "is not an allowed field" — declare the field in the schema or stop sending it').toEqual([]);
  });

  it('a strict route whose caller body cannot be read statically is proven by the type-aware proof or reviewed', () => {
    const reviewed: Record<string, string> = json(REVIEWED, {});
    const proof: Record<string, { verdict: string }> = json(TYPEPROOF, { routes: {} }).routes;
    const open = A.routes.filter((r) => r.strict && r.unverifiable.length && !reviewed[r.key] && proof[r.key]?.verdict !== 'proven').map((r) => `${r.key} (type proof: ${proof[r.key]?.verdict ?? 'none'}): ${r.unverifiable.join('; ')}`);
    expect(open, 'regenerate the type proof (node scripts/strict-bodies-typeproof.mjs) or add the route to security/strict-bodies.reviewed.json with the reason every field it sends is declared').toEqual([]);
    const short = Object.entries(reviewed).filter(([, why]) => typeof why !== 'string' || why.trim().length < 40).map(([k]) => k);
    expect(short, 'a reviewed entry says WHY every field the callers send is declared').toEqual([]);
  });

  it('non-strict routes are only the reviewed exceptions (new body routes are strict)', () => {
    const now = A.routes.filter((r) => !r.strict).map((r) => r.key);
    if (process.env.STRICT_BODIES_WRITE === '1' || !existsSync(BASELINE)) {
      const prev: Record<string, string> = json(BASELINE, { exceptions: {} }).exceptions ?? {};
      writeFileSync(BASELINE, JSON.stringify({ note: BASELINE_NOTE, exceptions: Object.fromEntries(now.map((k) => [k, prev[k] ?? 'TODO: why this route may not refuse unknown fields'])) }, null, 1) + '\n');
    }
    if (process.env.STRICT_BODIES_REPORT === '1') {
      const cat = (r: any) => (r.bad.length ? 'blocked' : r.unverifiable.length ? 'unverifiable' : r.callers ? 'safe' : 'no-caller');
      writeFileSync(REPORT, JSON.stringify({
        generated: 'STRICT_BODIES_REPORT=1 vitest run src/common/strict-bodies.vitest.spec.ts', calls: A.calls, unresolvedCalls: A.unresolved,
        strict: A.routes.filter((r) => r.strict).length, total: A.routes.length,
        nonStrict: A.routes.filter((r) => !r.strict).map((r) => ({ key: r.key, verdict: lib.openSchema(r.schema) ? 'open-schema' : cat(r), callers: r.callers, file: r.file, handler: `${r.controller}.${r.handler}`, bad: r.bad, unverifiable: r.unverifiable })),
      }, null, 1) + '\n');
    }
    const exceptions: Record<string, string> = json(BASELINE, { exceptions: {} }).exceptions ?? {};
    const fresh = now.filter((k) => !exceptions[k]);
    const stale = Object.keys(exceptions).filter((k) => !now.includes(k));
    expect(fresh, 'a NEW route that reads a body must refuse unknown fields: @Body(ValidatedBody(SCHEMA, { strict: true }))').toEqual([]);
    expect(stale, 'these exceptions are strict now (or gone) — remove them from security/strict-bodies.baseline.json').toEqual([]);
    const unexplained = Object.entries(exceptions).filter(([, why]) => typeof why !== 'string' || why.trim().length < 40 || /^TODO/.test(why)).map(([k]) => k);
    expect(unexplained, 'every exception carries the reviewed reason it may not refuse unknown fields').toEqual([]);
    // an OPEN schema (kept whole) stays only when it is bounded in depth and in keys + items (S.bounded)
    const unbounded = A.routes.filter((r) => !r.strict && lib.openSchema(r.schema) && !(Number(r.schema['x-maxDepth']) > 0 && Number(r.schema['x-maxNodes']) > 0)).map((r) => r.key);
    expect(unbounded, 'wrap the open schema in S.bounded(schema, maxDepth, maxNodes)').toEqual([]);
  });

  it('the scanner reads what clients send (self-test)', () => {
    expect(lib.normalizePath('`/api/v1/pos/tickets/${id}/refund?x=1`')).toBe('/pos/tickets/*/refund');
    expect(lib.pathMatches('/pos/tickets/*/refund', '/pos/tickets/:ticketId/refund')).toBe(true);
    const s = lib.objectShape('{ a: 1, b, "c-d": { e: x }, f() {} }');
    expect(Object.keys(s.keys).sort()).toEqual(['a', 'b', 'c-d', 'f']);
    expect(lib.objectShape('{ ...rest, a }').open).toBe(true);
    expect(lib.undeclaredKeys({ type: 'object', properties: { a: {} } }, lib.objectShape('{ a: 1, z: 2 }'))).toEqual(['z']);
    expect(lib.undeclaredKeys({ type: 'object', properties: { a: {} } }, null)).toBe('unverifiable');
    expect(A.routes.length).toBeGreaterThan(1000);
    expect(A.calls).toBeGreaterThan(1000);
  });
});
