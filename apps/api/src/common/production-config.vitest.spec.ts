// production-config.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §133): production refuses to boot when the API
// runs as more than one process without REDIS_URL (split-brain realtime, per-process rate limits and caches), with a
// boot error that says why. The base rules (DB, session secret, encryption keys) are unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { productionConfigProblems, multiProcessReasons, assertProductionConfig } from './production-config';
import { KEY_SOURCES } from './key-ring';

/** A production env that passes every base rule (keys are random 32-byte values, never real secrets). */
function okEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', REPO_DRIVER: 'postgres', DATABASE_URL: 'postgres://x@localhost/db', AUTH_SESSION_SECRET: 's'.repeat(40), PAYMENTS_WEBHOOK_RAW_BODY: '1', MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-east-1' };   // wave 3 PAYI §126: raw-body webhooks are part of the base
  for (const src of Object.values(KEY_SOURCES)) if (src.required) env[src.env] = randomBytes(32).toString('base64');
  return { ...env, ...extra };
}
const redisProblem = (env: NodeJS.ProcessEnv) => productionConfigProblems(env).find((p) => p.startsWith('REDIS_URL is required'));

describe('productionConfigProblems — Redis required when multi-process', () => {
  it('the base production env passes; outside production nothing is checked', () => {
    expect(productionConfigProblems(okEnv())).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: 'development', PROCESS_ROLE: 'api' })).toEqual([]);
  });
  it('API_REPLICAS > 1, MULTI_INSTANCE=1 and a split PROCESS_ROLE each require REDIS_URL, naming the reason', () => {
    expect(redisProblem(okEnv({ API_REPLICAS: '2' }))).toMatch(/API_REPLICAS=2/);
    expect(redisProblem(okEnv({ MULTI_INSTANCE: '1' }))).toMatch(/MULTI_INSTANCE=1/);
    expect(redisProblem(okEnv({ PROCESS_ROLE: 'api' }))).toMatch(/PROCESS_ROLE=api/);
    expect(redisProblem(okEnv({ PROCESS_ROLE: 'worker' }))).toMatch(/PROCESS_ROLE=worker/);
  });
  it('one replica, PROCESS_ROLE=all (or unset), or REDIS_URL set → no Redis problem', () => {
    expect(redisProblem(okEnv({ API_REPLICAS: '1' }))).toBeUndefined();
    expect(redisProblem(okEnv({ PROCESS_ROLE: 'all' }))).toBeUndefined();
    expect(redisProblem(okEnv({ API_REPLICAS: '3', PROCESS_ROLE: 'api', REDIS_URL: 'redis://redis.railway.internal:6379' }))).toBeUndefined();
    expect(multiProcessReasons({ API_REPLICAS: 'abc' })).toEqual([]);
  });
  it('the base rules still apply (no DB → refused)', () => {
    expect(productionConfigProblems(okEnv({ DATABASE_URL: '' }))).toContain('DATABASE_URL is required');
  });
  it('MEDIA_STORE=s3 without a bucket is refused (agent C\'s check, called from here)', () => {
    expect(productionConfigProblems(okEnv({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: '', MEDIA_S3_REGION: 'us-east-1' })).some((p) => /MEDIA_S3_BUCKET/.test(p))).toBe(true);
  });
  it('production without MEDIA_STORE=s3 is refused (Mandate §210)', () => {
    expect(productionConfigProblems(okEnv({ MEDIA_STORE: '' })).some((p) => /MEDIA_STORE must be 's3'/.test(p))).toBe(true);
  });
});

describe('assertProductionConfig — the boot error', () => {
  afterEach(() => vi.restoreAllMocks());
  it('exits 1 with a message that names REDIS_URL and the multi-process reason', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error('exit ' + code); }) as any);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => assertProductionConfig(okEnv({ API_REPLICAS: '2' }))).toThrow('exit 1');
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(err.mock.calls[0][0])).toMatch(/FATAL: refusing to start[\s\S]*REDIS_URL is required[\s\S]*API_REPLICAS=2/);
  });
  it('a valid env boots (no exit)', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as any);
    assertProductionConfig(okEnv({ API_REPLICAS: '2', REDIS_URL: 'redis://r:6379' }));
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('productionConfigProblems — provider environment (wave 3 PAYI §125–§126)', () => {
  it('a sandbox processor host, a half-configured Twilio sender and a missing raw-body flag each refuse to boot', () => {
    expect(productionConfigProblems(okEnv({ PAYMENTS_WEBHOOK_RAW_BODY: '' })).join()).toMatch(/PAYMENTS_WEBHOOK_RAW_BODY=1 is required/);
    expect(productionConfigProblems(okEnv({ CARDPOINTE_BASE_URL: 'https://isv-uat.cardconnect.com/cardconnect/rest' })).join()).toMatch(/sandbox \/ UAT host/);
    expect(productionConfigProblems(okEnv({ TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32) })).join()).toMatch(/set together/);
  });
});

describe('productionConfigProblems — mock senders (P-11, wave 4 pilot)', () => {
  it('forcing the mock SMS / e-mail senders in production is a startup refusal that names them', () => {
    const p = productionConfigProblems(okEnv({ MESSAGING_MOCK_SENDERS: '1' }));
    expect(p.some((x) => /MockSmsSender/.test(x) && /MockEmailSender/.test(x))).toBe(true);
    expect(productionConfigProblems(okEnv())).toEqual([]);   // an unconfigured channel is not a refusal (it degrades to not_configured)
  });
});
