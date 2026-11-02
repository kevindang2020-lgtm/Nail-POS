// @aipowersalon/security/nest — the NestJS-bound half (Constitution 13 §113): the voice-key rate-limit guard. The root
// entry stays framework-free.
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import type { KeyedRateLimiter } from '../keyed-rate-limit';

export const VOICE_KEY_LIMITER = 'VOICE_KEY_LIMITER'   // a string token, like PROVIDER_SECRETS: the same value however many copies of the package load;

/** Applied after VoiceAuthGuard resolves the key onto the request (req.voiceKeyId). */
@Injectable()
export class VoiceKeyRateLimitGuard implements CanActivate {
  constructor(@Optional() @Inject(VOICE_KEY_LIMITER) private readonly limiter?: KeyedRateLimiter) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.limiter?.enabled) return true;
    const req = ctx.switchToHttp().getRequest();
    const keyId = req?.voiceKeyId;
    if (!keyId) return true;                              // VoiceAuthGuard already refused an unkeyed request
    const d = await this.limiter.hit(String(keyId));
    if (d.allowed) return true;
    const res = ctx.switchToHttp().getResponse();
    try { res?.header?.('Retry-After', String(Math.ceil(d.retryAfterMs / 1000))); } catch { /* best-effort */ }
    throw new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'Too Many Requests', message: 'Rate limit exceeded for this integration key.' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

export { CodeLookupLimitInterceptor, CodeLookupLimited, CODE_LOOKUP_KIND, CODE_LOOKUP_WHEN, bodyHasCode, splitHasGiftCardCode, type CodeLookupWhen } from './code-lookup-limit.interceptor';   // Phase 14: per-caller lookup-by-code limit
export { AnonRateLimitGuard, AnonRateLimit, ANON_RATE_LIMIT, anonLoopbackExempt } from './anon-rate-limit.guard';   // Security Deep Scan §28/§43/§44
