// request-telemetry.ts — Constitution 11 §7, §12, §29–30, §191, §200: request identity and the error boundary.
//
// TWO PIECES, one file, because they are two halves of one promise: every request gets an id, and every error
// returns it. Support can then find the exact log lines for "Reference: req_01J…" without searching by time.
//
// RequestContextMiddleware (§7, §12): mints request/correlation/trace ids, opens the AsyncLocalStorage context
// the rest of the request runs inside, and returns `x-request-id` on EVERY response (audit D2: header + error
// body, not a body envelope on 600 routes). A client may continue a workflow's chain with `x-correlation-id`.
//
// PlatformExceptionFilter (§29–30, §200): logs the exception WITH the ids, the class, the safe message and the
// stack (server side only), fingerprints it for grouping, and returns a body that carries the request id and
// never a stack trace. Expected business failures (4xx HttpExceptions) are logged at warn, not error — §201:
// "do not page operations for normal business validation".
import { toErrorEnvelope } from './error-envelope';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { runWithContext, newRequestId, sanitizeInboundId, getContext, clientInfoFrom, type TelemetryContext } from './request-context';
import { log } from './logger';
import { maskValueSecrets } from './redaction';
import { startSpan } from './tracing/span';
import { parseTraceparent } from './tracing/traceparent';
import { invalidIdClientError } from './invalid-id';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** W3C trace context (BUILD_PLAN Phase 11): adopted from the caller, answered on every response. */
export const TRACEPARENT_HEADER = 'traceparent';

/**
 * Nest's routePath is only known after routing; middleware runs before. The interceptor/filter fill `operation` later.
 *
 * Phase 11: the request IS a server span. An inbound `traceparent` (strictly parsed — client input) makes this request a
 * child of the caller's span; otherwise it starts a trace. The span ends when the response finishes (or the socket
 * closes), named by the route TEMPLATE, with the status and — once the session middleware has resolved it — the tenant
 * id. Never the URL, the query string, a header value or a body (Constitution 11 §134).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void): void {
    const requestId = newRequestId();
    // BUILD_PLAN Phase 13: the mobile transport sends its own X-Request-ID per logical request (the same id on each GET
    // retry); with no x-correlation-id it continues that chain, so a phone's retries and the server's lines share an id.
    const inbound = sanitizeInboundId(req.headers?.[CORRELATION_ID_HEADER]) ?? sanitizeInboundId(req.headers?.[REQUEST_ID_HEADER]);
    const incoming = parseTraceparent(req.headers?.[TRACEPARENT_HEADER]);
    const method = String(req.method ?? 'GET');
    const span = startSpan(method, { kind: 'server', parent: incoming ?? null, attributes: { 'http.request.method': method } });
    const ctx: TelemetryContext = {
      requestId, correlationId: inbound ?? requestId, traceId: span.traceId, spanId: span.spanId, parentSpanId: incoming?.spanId, traceSampled: span.sampled,
      service: 'api', operation: `api.${req.method} ${req.baseUrl || ''}${req.path || ''}`,
      ...clientInfoFrom(req.headers),   // Phase 13 (Constitution 6 §12): app / version / platform labels
    };
    try { res.setHeader(REQUEST_ID_HEADER, requestId); res.setHeader(TRACEPARENT_HEADER, span.traceparent()); } catch { /* headers already sent — cannot happen this early */ }
    const finish = () => {
      if (span.ended) return;
      try {
        const route = routeTemplateOf(req);
        const status = Number(res.statusCode ?? 0);
        span.updateName(`${method} ${route}`).setAttributes({
          'http.route': route, 'http.response.status_code': status, 'aipowersalon.request_id': requestId,
          'aipowersalon.tenant_id': ctx.tenantId, 'aipowersalon.actor_type': ctx.actorType,
        });
        if (status >= 500) span.setStatus('error');
      } catch { /* never fail a response on telemetry */ }
      span.end();
    };
    if (typeof res.once === 'function') { res.once('finish', finish); res.once('close', finish); }
    req.telemetry = ctx;   // for code that has the request but not the store (tests, some guards)
    runWithContext(ctx, next);
  }
}

/** §30: group repeated errors by type + route template + normalised message, so 500 identical failures are one problem. */
export function fingerprint(err: { name?: string; message?: string }, routeTemplate: string, status: number): string {
  const normalised = String(err.message ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>').replace(/\b\d+\b/g, '<n>').slice(0, 200);
  return createHash('sha1').update(`${err.name ?? 'Error'}|${routeTemplate}|${status}|${normalised}`).digest('hex').slice(0, 16);
}

/** The route TEMPLATE (§37): `/customers/:id`, never `/customers/123`. Nest exposes it on the matched route. */
export function routeTemplateOf(req: any): string {
  const p = req?.route?.path;
  if (typeof p === 'string') return `${req.baseUrl || ''}${p}`;
  if (Array.isArray(p) && p.length) return `${req.baseUrl || ''}${p[0]}`;
  return 'unmatched';
}

@Catch()
export class PlatformExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req: any = http.getRequest();
    const res: any = http.getResponse();
    const ctx = getContext() ?? req?.telemetry;
    const requestId: string | undefined = ctx?.requestId;

    // Phase 12: a framework-free package's client error (http-errors convention: expose + a 4xx status — e.g.
    // @aipowersalon/media's UploadRejected) is answered as what it is, not as a 500
    const exposed = exception instanceof HttpException ? null : isExposedClientError(exception) ? exception : invalidIdError(exception);
    const isHttp = exception instanceof HttpException || !!exposed;
    const status = exception instanceof HttpException ? exception.getStatus() : exposed ? exposed.status : HttpStatus.INTERNAL_SERVER_ERROR;
    const err = exception instanceof Error ? exception : new Error(String(exception));
    const route = routeTemplateOf(req);
    const fp = fingerprint(err, route, status);

    // §201/§203: a 4xx is an expected outcome the client can act on; a 5xx is a system failure. Only the latter
    // is an ERROR line — alert rules key off level, and paging on validation errors is the fatigue §103 warns of.
    const fields = { status, route, method: req?.method, fingerprint: fp, exception: { name: err.name, message: maskValueSecrets(err.message), stack: status >= 500 ? err.stack : undefined } };
    // Log INSIDE the request's context. Express error handling can run after the async continuation the
    // middleware opened has been lost, in which case getContext() is empty — the ids are still on req.telemetry,
    // so re-enter that context rather than emit an error line nobody can find from the reference.
    const write = () => { if (status >= 500) log.error('request.failed', fields); else log.warn('request.rejected', fields); };
    if (getContext()) write(); else if (ctx) runWithContext(ctx, write); else write();

    // The body a client sees. HttpException payloads (validation details, domain codes) pass through; anything
    // unexpected becomes a generic message. The stack NEVER leaves the process (§29, §200).
    const body = exception instanceof HttpException ? normalise(exception.getResponse())
      : exposed ? { message: exposed.message, code: exposed.code, ...(exposed.details ? { details: exposed.details } : {}) }
      : { message: 'Something went wrong on our side. Please try again.', code: 'INTERNAL_ERROR' };
    // Constitution 5 §28–31: every error carries the standard envelope; today's top-level fields ride alongside it.
    const out = toErrorEnvelope({ status, body, requestId, unexpected: !isHttp });
    try {
      if (requestId) res.setHeader(REQUEST_ID_HEADER, requestId);
      res.status(status).json(out);
    } catch { /* response already started; nothing safe to do */ }
  }
}

/** w4 sweep SW-02: a malformed id the CLIENT sent (a path id that is not a uuid, a required ?serviceId= left empty) that
 *  reached PostgreSQL — 22P02 "invalid input syntax for type uuid". It is the request's fault, so it is answered as a
 *  400 INVALID_ID (logged at WARN with the database message) instead of a 500. Any other database error stays a 500. */
export function invalidIdError(e: unknown): (Error & { status: number; code: string; details?: Record<string, unknown> }) | null {
  const x = e as any;
  if (!(e instanceof Error) || x.code !== '22P02' || !/invalid input syntax for type uuid/i.test(String(x.message))) return null;
  return Object.assign(invalidIdClientError(), { name: e.name });   // the same answer a handler gives when it checks first (invalid-id.ts)
}

/** An Error a framework-free package marks safe to show: `expose === true`, a 4xx `status`, a string `code`. */
export function isExposedClientError(e: unknown): e is Error & { status: number; code: string; details?: Record<string, unknown> } {
  const x = e as any;
  return e instanceof Error && x.expose === true && Number.isInteger(x.status) && x.status >= 400 && x.status < 500 && typeof x.code === 'string';
}

function normalise(r: unknown): Record<string, unknown> {
  if (typeof r === 'string') return { message: r };
  if (r && typeof r === 'object') { const o = { ...(r as Record<string, unknown>) }; delete o.stack; return o; }
  return { message: 'Request failed' };
}
