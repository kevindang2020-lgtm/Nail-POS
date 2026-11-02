// anon-rate-limit.guard.ts — @AnonRateLimit(max, windowMs, { bucket? }): the per-IP limit on a PUBLIC route
// (Security Deep Scan §28 / §43 / §44). See ../anon-rate-limit.ts for the key, the store choice and fail-open.
//
// The store is the API's (ANON_RATE_LIMIT_STORE, provided by the global RateLimitModule: Redis across replicas or the
// in-process log); without one (a module test) a process-wide in-memory store is used, so the limit is never silently
// absent. The decorator's arguments are also read by apps/api/scripts/attack-surface.mjs, which derives the attack
// surface's rate column from them — keep them literal numbers / expressions of numbers.
import { applyDecorators, CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Optional, SetMetadata, UseGuards } from '@nestjs/common';
import { clientIp } from '../client-ip';
import { ANON_RATE_LIMIT_STORE, InMemoryAnonRateLimitStore, anonRateLimitEnabled, anonRateLimitKey, type AnonRateLimitSpec, type AnonRateLimitStore } from '../anon-rate-limit';

export const ANON_RATE_LIMIT = 'aps:anon_rate_limit';
const fallbackStore = new InMemoryAnonRateLimitStore();
const EVALUATED = Symbol.for('aps.anonRateLimit.evaluated');

@Injectable()
export class AnonRateLimitGuard implements CanActivate {
  private readonly store: AnonRateLimitStore;
  constructor(@Optional() @Inject(ANON_RATE_LIMIT_STORE) store?: AnonRateLimitStore | null) { this.store = store ?? fallbackStore; }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http' || !anonRateLimitEnabled()) return true;
    const req = ctx.switchToHttp().getRequest();
    // A route may carry a class-level AND a method-level budget; the guard is then attached twice — evaluate both
    // budgets once, on the first run.
    if (req?.[EVALUATED]) return true;
    const specs = [Reflect.getMetadata(ANON_RATE_LIMIT, ctx.getHandler()), Reflect.getMetadata(ANON_RATE_LIMIT, ctx.getClass())]
      .filter((x): x is AnonRateLimitSpec => !!x && typeof x.max === 'number');
    if (!specs.length) return true;
    if (req) req[EVALUATED] = true;
    const ip = clientIp(req);
    // Outside production a loopback caller is the developer / a local proof script (every one shares 127.0.0.1 with
    // trust-proxy 0); production resolves the real client through the trusted proxy, so loopback is never exempt there.
    if (anonLoopbackExempt(ip)) return true;
    const route = `${String(req?.method ?? '').toUpperCase()} ${String(req?.route?.path ?? req?.path ?? '')}`;
    for (const spec of specs) {
      let d;
      try { d = await this.store.hit(anonRateLimitKey(spec.bucket ?? route, ip), spec.max, spec.windowMs); } catch { continue; }   // fail-open
      if (d.allowed) continue;
      const secs = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
      try { ctx.switchToHttp().getResponse()?.header?.('Retry-After', String(secs)); } catch { /* best-effort */ }
      throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, code: 'RATE_LIMITED', error: 'Too Many Requests', message: 'Too many requests from this network — wait a moment and try again.', retryAfterSeconds: secs, scope: 'ip' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

export function anonLoopbackExempt(ip: string | null, env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== 'production' && !!ip && (ip === '::1' || /^127\./.test(ip));
}

/** Per-IP budget on a public route: `max` requests per `windowMs` per client address (per `bucket` when routes share one). */
export function AnonRateLimit(max: number, windowMs: number, opts: { bucket?: string } = {}): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(ANON_RATE_LIMIT, { max, windowMs, bucket: opts.bucket } satisfies AnonRateLimitSpec), UseGuards(AnonRateLimitGuard));
}
