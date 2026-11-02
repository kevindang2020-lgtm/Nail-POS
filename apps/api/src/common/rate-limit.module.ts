// rate-limit.module.ts — global module exposing the per-tenant rate limiter under TENANT_RATE_LIMITER.
// Resolves to a Redis-backed limiter when RATE_LIMIT_STORE=redis + a URL is configured, else a no-op that allows
// everything (Scaling Roadmap Phase 3). Registering the guard is always safe: when disabled it's a pass-through.
import { makeMfaAttemptLimiter, makeVoiceKeyLimiter, makeAnonRateLimitStore } from './keyed-rate-limit';
import { VOICE_KEY_LIMITER, VoiceKeyRateLimitGuard, AnonRateLimitGuard } from '@aipowersalon/security/nest';
import { MFA_ATTEMPT_LIMITER, CODE_LOOKUP_STORE, InMemoryCodeLookupStore, ANON_RATE_LIMIT_STORE } from '@aipowersalon/security';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PostgresCodeLookupStore } from './code-lookup-limit.store';
import { Global, Module } from '@nestjs/common';
import { makeTenantRateLimiter, makeClientRateLimiter } from './tenant-rate-limit';

export const TENANT_RATE_LIMITER = Symbol('TENANT_RATE_LIMITER');
/** M4: the per-client (signed-in session) budget inside a location — TenantRateLimitGuard checks it before the location's. */
export const TENANT_CLIENT_RATE_LIMITER = Symbol('TENANT_CLIENT_RATE_LIMITER');
export const MFA_ATTEMPT_LIMITER_TOKEN = MFA_ATTEMPT_LIMITER;   // the package's token (Constitution 13 §94): identity injects it

@Global()
@Module({
  providers: [
    { provide: TENANT_RATE_LIMITER, useFactory: makeTenantRateLimiter },
    { provide: TENANT_CLIENT_RATE_LIMITER, useFactory: makeClientRateLimiter },
    { provide: MFA_ATTEMPT_LIMITER_TOKEN, useFactory: makeMfaAttemptLimiter },
    { provide: VOICE_KEY_LIMITER, useFactory: makeVoiceKeyLimiter },
    // Phase 14 (Constitution 12): the per-caller lookup-by-code limit (@CodeLookupLimited) — Postgres across replicas,
    // in-process without a database (tests, in-memory mode).
    { provide: CODE_LOOKUP_STORE, useFactory: (db?: AppDatabase | null) => (db ? new PostgresCodeLookupStore(db as any) : new InMemoryCodeLookupStore()), inject: [{ token: DATABASE, optional: true }] },
    // Security Deep Scan §28/§43/§44: the per-IP store behind @AnonRateLimit on public routes (Redis when configured).
    { provide: ANON_RATE_LIMIT_STORE, useFactory: () => makeAnonRateLimitStore() },
    AnonRateLimitGuard,
    VoiceKeyRateLimitGuard,   // so @UseGuards(VoiceKeyRateLimitGuard) at any controller resolves its DI dependency
  ],
  exports: [TENANT_RATE_LIMITER, TENANT_CLIENT_RATE_LIMITER, MFA_ATTEMPT_LIMITER_TOKEN, VOICE_KEY_LIMITER, VoiceKeyRateLimitGuard, CODE_LOOKUP_STORE, ANON_RATE_LIMIT_STORE, AnonRateLimitGuard],
})
export class RateLimitModule {}
