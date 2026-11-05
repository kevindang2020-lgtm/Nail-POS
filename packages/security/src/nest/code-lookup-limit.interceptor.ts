// code-lookup-limit.interceptor.ts — @CodeLookupLimited(kind): the per-caller lookup limit on a route that looks
// something up BY SECRET CODE (gift card, coupon, reward code, gift claim). See ../code-lookup-limit.ts for the keys,
// weights and the front-desk load model the budgets come from.
//
// Before the handler: admit the attempt (caller / IP / salon) or refuse with 429 + Retry-After. After it: settle the
// attempt by what the handler found (hit / miss / neutral). The store is the API's Postgres store (CODE_LOOKUP_STORE,
// provided by the API's global RateLimitModule); without one (a module test) a process-wide in-memory store is used,
// so the limit is never silently absent. A store error admits the request (fail-open, like every limiter here).
import { applyDecorators, CallHandler, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger, NestInterceptor, Optional, SetMetadata, UseInterceptors } from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { clientIp } from '../client-ip';
import {
  CODE_LOOKUP_STORE, InMemoryCodeLookupStore, callerKeyFor, classifyLookupError, classifyLookupResult,
  type CodeLookupKind, type CodeLookupStore,
} from '../code-lookup-limit';

export const CODE_LOOKUP_KIND = 'aps:code_lookup_kind';
/** Optional per-route test: does THIS request name a secret code? A route that also accepts a code-less form (an offer
 *  applied by deal id, a split payment with no gift-card leg) is only admitted / counted when it does. */
export const CODE_LOOKUP_WHEN = 'aps:code_lookup_when';
export type CodeLookupWhen = (req: any) => boolean;
const fallbackStore = new InMemoryCodeLookupStore();

@Injectable()
export class CodeLookupLimitInterceptor implements NestInterceptor {
  private readonly log = new Logger('CodeLookupLimit');
  private readonly store: CodeLookupStore;
  constructor(@Optional() @Inject(CODE_LOOKUP_STORE) store?: CodeLookupStore | null) { this.store = store ?? fallbackStore; }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const kind = Reflect.getMetadata(CODE_LOOKUP_KIND, ctx.getHandler()) as CodeLookupKind | undefined;
    if (!kind) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const when = Reflect.getMetadata(CODE_LOOKUP_WHEN, ctx.getHandler()) as CodeLookupWhen | undefined;
    if (when && !when(req)) return next.handle();   // no code in this request: nothing is being guessed
    const ip = clientIp(req);
    const keys = { kind, caller: callerKeyFor(req, ip), ip, tenantId: req?.ctx?.tenantId ?? null };
    return from(this.store.admit(keys).catch((e) => { this.log.warn(`admit failed (fail-open): ${e?.message ?? e}`); return { allowed: true, attemptId: null, retryAfterMs: 0 }; })).pipe(
      mergeMap((a) => {
        if (!a.allowed) {
          const secs = Math.max(1, Math.ceil(a.retryAfterMs / 1000));
          try { ctx.switchToHttp().getResponse()?.header?.('Retry-After', String(secs)); } catch { /* best-effort */ }
          return throwError(() => new HttpException({ statusCode: 429, code: 'CODE_LOOKUP_LIMITED', message: 'Too many code lookups that did not match — wait a few minutes and try again.', retryAfterSeconds: secs }, HttpStatus.TOO_MANY_REQUESTS));
        }
        const settle = (o: 'hit' | 'miss' | 'neutral') => { if (a.attemptId) void this.store.settle(a.attemptId, o).catch((e) => this.log.warn(`settle failed: ${e?.message ?? e}`)); };
        return next.handle().pipe(
          tap((result) => settle(classifyLookupResult(result))),
          catchError((err) => { settle(classifyLookupError(err)); return throwError(() => err); }),
        );
      }),
    );
  }
}

/** Mark a route as a lookup by secret code: per-caller / IP / salon weighted limit, 429 + Retry-After when exhausted. */
export function CodeLookupLimited(kind: CodeLookupKind, opts: { when?: CodeLookupWhen } = {}): MethodDecorator {
  const marks = [SetMetadata(CODE_LOOKUP_KIND, kind)];
  if (opts.when) marks.push(SetMetadata(CODE_LOOKUP_WHEN, opts.when));
  return applyDecorators(...marks, UseInterceptors(CodeLookupLimitInterceptor));
}

/** The request body names a non-blank value at `field` (e.g. an offer's `code`). */
export const bodyHasCode = (field: string): CodeLookupWhen => (req) => { const v = req?.body?.[field]; return typeof v === 'string' && v.trim() !== ''; };
/** A split payment with at least one gift-card leg that names a code. */
export const splitHasGiftCardCode: CodeLookupWhen = (req) => Array.isArray(req?.body?.segments)
  && req.body.segments.some((s: any) => s != null && s.giftCardCode != null && String(s.giftCardCode).trim() !== '');
