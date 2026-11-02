// request-telemetry.vitest.spec — Constitution 11 §7, §29–30, §200–201 at the boundary, with fakes shaped like
import { describe, it, expect } from 'vitest';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { RequestContextMiddleware, PlatformExceptionFilter, fingerprint, routeTemplateOf, REQUEST_ID_HEADER } from './request-telemetry';
import { getContext } from './request-context';
import { setLogSink, type LogRecord } from './logger';

const fakeRes = () => { const h: Record<string, string> = {}; let code = 0; let body: any; return { setHeader: (k: string, v: string) => { h[k] = v; }, status: (c: number) => { code = c; return { json: (b: any) => { body = b; } }; }, get: () => ({ h, code, body }) }; };
const host = (req: any, res: any) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) }) as any;

describe('§7 the middleware mints identity and returns it', () => {
  it('sets x-request-id on the response and opens a context for the handler', () => {
    const mw = new RequestContextMiddleware();
    const res = fakeRes();
    let insideId: string | undefined;
    mw.use({ method: 'GET', path: '/x', headers: {} }, res, () => { insideId = getContext()?.requestId; });
    expect(insideId).toMatch(/^req_/);
    expect(res.get().h[REQUEST_ID_HEADER]).toBe(insideId);
  });
  it('continues a client-supplied correlation chain, but never free text', () => {
    const mw = new RequestContextMiddleware();
    let corr: string | undefined;
    mw.use({ method: 'GET', path: '/x', headers: { 'x-correlation-id': 'booking-abc-123' } }, fakeRes(), () => { corr = getContext()?.correlationId; });
    expect(corr).toBe('booking-abc-123');
    mw.use({ method: 'GET', path: '/x', headers: { 'x-correlation-id': 'not an id' } }, fakeRes(), () => { corr = getContext()?.correlationId; });
    expect(corr).toMatch(/^req_/);
  });
});

describe('BUILD_PLAN Phase 13 (Constitution 6 §12): the mobile client headers land in the request context', () => {
  it('app / version / platform labels are recorded when well-formed, dropped when not; the device id never is', () => {
    const mw = new RequestContextMiddleware();
    let c: any;
    mw.use({ method: 'GET', path: '/x', headers: { 'x-client-type': 'tech', 'x-client-version': '1.4.0', 'x-client-platform': 'ios', 'x-device-id': 'abcdef0123456789' } }, fakeRes(), () => { c = getContext(); });
    expect(c).toMatchObject({ clientApp: 'tech', clientVersion: '1.4.0', clientPlatform: 'ios' });
    expect(JSON.stringify(c)).not.toContain('abcdef0123456789');
    mw.use({ method: 'GET', path: '/x', headers: { 'x-client-type': 'Tech App<script>', 'x-client-version': 'latest', 'x-client-platform': 'windows' } }, fakeRes(), () => { c = getContext(); });
    expect(c.clientApp).toBeUndefined(); expect(c.clientVersion).toBeUndefined(); expect(c.clientPlatform).toBeUndefined();
  });
  it("the transport's X-Request-ID continues the correlation chain when no x-correlation-id is sent", () => {
    const mw = new RequestContextMiddleware();
    let corr: string | undefined;
    mw.use({ method: 'GET', path: '/x', headers: { 'x-request-id': 'cli_0f0e0d0c-aaaa' } }, fakeRes(), () => { corr = getContext()?.correlationId; });
    expect(corr).toBe('cli_0f0e0d0c-aaaa');
    mw.use({ method: 'GET', path: '/x', headers: { 'x-request-id': 'cli_x', 'x-correlation-id': 'booking-abc-123' } }, fakeRes(), () => { corr = getContext()?.correlationId; });
    expect(corr).toBe('booking-abc-123');
  });
});

describe('§29/§200 the exception filter: reference to the client, stack to the log, never the reverse', () => {
  const run = (exc: unknown, req: any = { method: 'POST', route: { path: '/appointments' } }) => {
    const lines: LogRecord[] = []; setLogSink({ write: (r) => lines.push(r) });
    const res = fakeRes();
    try { new PlatformExceptionFilter().catch(exc, host({ ...req, telemetry: { requestId: 'req_TEST', correlationId: 'req_TEST', traceId: 'x', service: 'api' } }, res)); }
    finally { setLogSink(null); }
    return { ...res.get(), lines };
  };

  it('an unexpected error returns 500 with a reference and a generic message — no stack, no internal message', () => {
    const { code, body, h } = run(new Error('pg: relation "secret_table" does not exist'));
    expect(code).toBe(500);
    expect(body.reference).toBe('req_TEST');
    expect(body.requestId).toBe('req_TEST');
    expect(h[REQUEST_ID_HEADER]).toBe('req_TEST');
    expect(JSON.stringify(body)).not.toMatch(/secret_table|at .*\.ts:\d+|stack/);
  });

  it('…but the LOG line has the class, the message and the stack, with the ids and a fingerprint', () => {
    const { lines } = run(new Error('pg: relation "secret_table" does not exist'));
    const l = lines.find((x) => x.msg === 'request.failed')!;
    expect(l.level).toBe('error');
    expect(l.requestId).toBe('req_TEST');
    expect((l.exception as any).message).toContain('secret_table');
    expect(typeof (l.exception as any).stack).toBe('string');
    expect(l.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('§201: a 4xx HttpException is logged at WARN, not ERROR — business failures must not page anyone', () => {
    const { code, body, lines } = run(new HttpException({ message: 'Slot already taken', code: 'APPOINTMENT_CONFLICT' }, HttpStatus.CONFLICT));
    expect(code).toBe(409);
    expect(body).toMatchObject({ message: 'Slot already taken', code: 'APPOINTMENT_CONFLICT', reference: 'req_TEST' });
    expect(lines[0].msg).toBe('request.rejected');
    expect(lines[0].level).toBe('warn');
    expect((lines[0].exception as any).stack).toBeUndefined();
  });

  it('a secret inside an exception message is masked in the log', () => {
    const { lines } = run(new Error('twilio auth failed: Bearer abcdefghijklmnop123'));
    expect(JSON.stringify(lines)).not.toContain('abcdefghijklmnop123');
  });

  it('an HttpException payload that carries a stack has it stripped before the client sees it', () => {
    const { body } = run(new HttpException({ message: 'x', stack: 'Error: at file.ts:1' }, 400));
    expect(body.stack).toBeUndefined();
  });

  // w4 sweep SW-02: a malformed id (a missing ?serviceId= sent as '', a path id that is not a uuid) reached PostgreSQL and
  // came back as a 500 on 20 routes. It is the CLIENT's input — a 400 the client can act on, logged at WARN.
  it('a PostgreSQL "invalid input syntax for type uuid" (22P02) is a 400 INVALID_ID, not a 500', () => {
    const pgErr = Object.assign(new Error('invalid input syntax for type uuid: ""'), { code: '22P02' });
    const { code, body, lines } = run(pgErr);
    expect(code).toBe(400);
    expect(body).toMatchObject({ code: 'INVALID_ID' });
    expect(JSON.stringify(body)).not.toMatch(/syntax|uuid: ""/);
    expect(lines[0].level).toBe('warn');
  });
  it('…but any OTHER database error stays a 500 (a broken query is not the client\'s fault)', () => {
    const { code } = run(Object.assign(new Error('column "x" does not exist'), { code: '42703' }));
    expect(code).toBe(500);
    // Security Deep Scan §163 (Oct 27 2026): a class-22 DATA exception (a non-uuid id, a bad date / integer) is the client's
    // malformed value — the local injection pass drove dozens of routes to 500 with it — so it is a 400 now (see below)
    const { code: c2 } = run(Object.assign(new Error('invalid input syntax for type integer: "a"'), { code: '22P02' }));
    expect(c2).toBe(400);
  });
});

describe('Security Deep Scan §163: database errors never reach the client (found by the local injection pass)', () => {
  const run = (exc: unknown) => {
    setLogSink({ write: () => undefined }); const res = fakeRes();
    try { new PlatformExceptionFilter().catch(exc, host({ method: 'POST', route: { path: '/x' }, telemetry: { requestId: 'req_I', correlationId: 'req_I', traceId: 'x', service: 'api' } }, res)); }
    finally { setLogSink(null); }
    return res.get();
  };
  const pg = (code: string, message: string) => Object.assign(new Error(message), { code });
  it('a PostgreSQL data exception (bad date / integer / timestamp / too long) is 400 INVALID_INPUT with no database text', () => {
    for (const e of [pg('22007', 'invalid input syntax for type date: "\' OR \'1\'=\'1"'), pg('22P02', 'invalid input syntax for type integer: "x"'), pg('22001', 'value too long for type character varying(40)')]) {
      const { code, body } = run(e);
      expect(code).toBe(400); expect(body.code).toBe('INVALID_INPUT');
      expect(JSON.stringify(body)).not.toMatch(/invalid input syntax|too long|OR '1'/);
    }
  });
  it('a handler that wrapped the database message into an HttpException (500 or 400) does not echo it', () => {
    const w500 = run(new HttpException({ message: 'invalid input syntax for type uuid: "\' OR \'1\'=\'1"' }, 500));
    expect(w500.code).toBe(400); expect(JSON.stringify(w500.body)).not.toMatch(/invalid input syntax|OR '1'/);
    const w400 = run(new BadRequestException('invalid input syntax for type uuid: "abc"'));
    expect(w400.code).toBe(400); expect(JSON.stringify(w400.body)).not.toMatch(/invalid input syntax|abc/);
    const fk = run(new HttpException('insert or update on table "x" violates foreign key constraint "x_fk"', 500));
    expect(fk.code).toBe(500); expect(JSON.stringify(fk.body)).not.toMatch(/foreign key|"x"/);
  });
  it('an ordinary domain message is untouched', () => {
    const { code, body } = run(new BadRequestException('Pick a branch first.'));
    expect(code).toBe(400); expect(JSON.stringify(body)).toMatch(/Pick a branch first/);
  });
});

describe('§30 fingerprints group repeats and ignore the ids inside messages', () => {
  it('the same failure on two different rows has ONE fingerprint', () => {
    const a = fingerprint(new Error('row 123e4567-e89b-12d3-a456-426614174000 missing, retry 3'), '/tickets/:id', 500);
    const b = fingerprint(new Error('row 9f1c2b3a-1111-2222-3333-444455556666 missing, retry 7'), '/tickets/:id', 500);
    expect(a).toBe(b);
  });
  it('a different route or status is a different problem', () => {
    const e = new Error('boom');
    expect(fingerprint(e, '/a', 500)).not.toBe(fingerprint(e, '/b', 500));
    expect(fingerprint(e, '/a', 500)).not.toBe(fingerprint(e, '/a', 503));
  });
  it('§37: the route TEMPLATE is used, never the raw URL', () => {
    expect(routeTemplateOf({ baseUrl: '', route: { path: '/customers/:id' }, url: '/customers/123' })).toBe('/customers/:id');
    expect(routeTemplateOf({ url: '/customers/123' })).toBe('unmatched');
  });
});
