// metrics.vitest.spec — BUILD_PLAN Phase 11 (Constitution 4 §101, Constitution 11 §188): GET /metrics, the Prometheus
// scrape. The 401/404/200 matrix, the exposition body, and that the route reaches its handler without a session.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { metricsAccess, MetricsController } from './metrics.controller';

const TOKEN = 'scrape-token-for-tests-0123456789';

describe('who may scrape /metrics', () => {
  it.each([
    // [env, authorization header, expected]
    [{ NODE_ENV: 'production' }, undefined, 'not_found'],                       // production, no token configured → the route does not exist
    [{ NODE_ENV: 'production' }, `Bearer ${TOKEN}`, 'not_found'],                // …even when a caller guesses a header
    [{ NODE_ENV: 'development' }, undefined, 'open'],                             // dev, no token → open (local Prometheus)
    [{ NODE_ENV: 'production', METRICS_TOKEN: TOKEN }, undefined, 'unauthorized'],
    [{ NODE_ENV: 'production', METRICS_TOKEN: TOKEN }, 'Bearer nope', 'unauthorized'],
    [{ NODE_ENV: 'production', METRICS_TOKEN: TOKEN }, `Basic ${TOKEN}`, 'unauthorized'],
    [{ NODE_ENV: 'production', METRICS_TOKEN: TOKEN }, `Bearer ${TOKEN}x`, 'unauthorized'],
    [{ NODE_ENV: 'production', METRICS_TOKEN: TOKEN }, `Bearer ${TOKEN}`, 'ok'],
    [{ NODE_ENV: 'production', METRICS_TOKEN: TOKEN }, `bearer  ${TOKEN}`, 'ok'],
    [{ NODE_ENV: 'development', METRICS_TOKEN: TOKEN }, undefined, 'unauthorized'],   // a configured token is required everywhere
    [{ NODE_ENV: 'production', METRICS_TOKEN: '   ' }, undefined, 'not_found'],       // blank = unset
  ] as const)('%j with %s → %s', (env, auth, expected) => expect(metricsAccess(auth, env as any)).toBe(expected));
});

describe('MetricsController', () => {
  const res = () => { const r: any = { headers: {}, code: 200, body: '' }; r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; }; r.status = (c: number) => { r.code = c; return r; }; r.send = (b: string | Buffer) => { r.body = String(b); return r; }; return r; };
  const withEnv = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
    const saved = { ...process.env };
    Object.assign(process.env, env); for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try { return fn(); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  };

  it('200: Prometheus text exposition of the process registry', () => {
    const r = res();
    withEnv({ METRICS_TOKEN: TOKEN, NODE_ENV: 'production' }, () => new MetricsController().scrape({ headers: { authorization: `Bearer ${TOKEN}` } }, r));
    expect(r.code).toBe(200);
    expect(r.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(r.body).toContain('# TYPE aipowersalon_build_info gauge');
    expect(r.body).toContain('# TYPE aipowersalon_trace_spans_dropped_total counter');
  });
  it('401 names the scheme (WWW-Authenticate) and leaks no metric', () => {
    const r = res();
    let err: unknown;
    try { withEnv({ METRICS_TOKEN: TOKEN, NODE_ENV: 'production' }, () => new MetricsController().scrape({ headers: { authorization: 'Bearer wrong' } }, r)); } catch (e) { err = e; }
    expect((err as HttpException).getStatus()).toBe(401);
    expect(r.headers['www-authenticate']).toBe('Bearer realm="metrics"');
    expect(r.body).toBe('');
  });
  it('404 in production without a token', () => {
    let err: unknown;
    try { withEnv({ METRICS_TOKEN: undefined, NODE_ENV: 'production' }, () => new MetricsController().scrape({ headers: {} }, res())); } catch (e) { err = e; }
    expect((err as HttpException).getStatus()).toBe(404);
  });
});

describe('/metrics is reachable without a session (the token is its authentication)', () => {
  it('is excluded from the session middleware for GET only', () => {
    const app = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
    const block = app.slice(app.indexOf('.apply(TenantContextMiddleware)'), app.indexOf(".forRoutes('*')", app.indexOf('.apply(TenantContextMiddleware)')));
    expect(block).toContain("{ path: 'metrics', method: RequestMethod.GET }");
    expect(block).not.toMatch(/path: 'metrics', method: RequestMethod\.(POST|ALL)/);
  });
});
