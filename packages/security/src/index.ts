// @aipowersalon/security — encryption primitives and display masking shared by the API (Constitution 13 §81).
// Pure: no environment, no database, no logging. Keys come from the caller (the API's key ring).
export { seal, open, openWith, parse, looksSealed, type WireFormat } from './aes-gcm';
export { maskEmail, maskPhone, maskSecret, maskSecretTail, secretLast4 } from './mask';
export * from './secure-random';   // moved from apps/api/src/common/secure-random.ts (Constitution 13 §219)
export { PROVIDER_SECRETS, MFA_SECRETS, PAYMENT_SECRETS, SECRET_SEALERS, SECURITY_POSTURE, PLATFORM_LOCKDOWN, type SecurityPosturePort, type PlatformLockdownPort, type ProviderSecrets, type PaymentSecrets, type SecretSealers, type SealPurpose } from './provider-secrets';   // the port modules seal provider credentials through (Constitution 13 §94)
export * from './client-ip';   // moved from apps/api/src/common/client-ip.ts (Constitution 13 §219)
export { RedisKeyedRateLimiter, NoopKeyedRateLimiter, mfaAttemptLimiter, voiceKeyLimiter, MFA_ATTEMPT_LIMITER, type KeyedRateLimiter, type KeyedRateLimitRedis, type KeyedLimitDecision, type KeyedRateLimitOptions } from './keyed-rate-limit';   // the pure limiter; the guard is ./nest
export * from './code-lookup-limit';   // Phase 14 (Constitution 12): the per-caller lookup-by-code limit — budgets, classifier, store port
