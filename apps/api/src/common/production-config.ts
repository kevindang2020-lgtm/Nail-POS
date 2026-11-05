// production-config.ts — the ONE production-configuration check, shared by the API and worker entry points
// (Constitution 13 §62: a worker must not carry a second copy of the API's rules).
import { tapToPayProductionProblems } from '@aipowersalon/checkout';
import { missingProductionKeys } from './key-ring';
import { mediaStorageConfigErrors } from '@aipowersalon/media';
import { integrationsProductionProblems } from '@aipowersalon/payments';   // wave 3 PAYI §125–§126
import { messagingProductionProblems } from '@aipowersalon/notifications';   // P-11 (wave 4 pilot): never a mock sender in production

/**
 * BUILD_PLAN Phase 11 (Constitution 4 §133, §14–16): does this deployment run more than one process? Then the state that
 * must be SHARED between processes — realtime fan-out (a worker's event reaching the API's SSE clients, an event on one
 * replica reaching a client on another), the per-tenant rate limiter, the cache invalidations — needs Redis; without it
 * each process quietly keeps its own copy and users see stale screens and per-instance limits.
 *   API_REPLICAS > 1        the host runs several API replicas (set it to the replica count on Railway)
 *   MULTI_INSTANCE=1        any other multi-process deployment
 *   PROCESS_ROLE=api|worker the API and the background worker are split into separate services
 */
export function multiProcessReasons(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const replicas = Number(String(env.API_REPLICAS ?? '').trim());
  if (Number.isFinite(replicas) && replicas > 1) out.push(`API_REPLICAS=${replicas}`);
  if (['1', 'true', 'yes', 'on'].includes(String(env.MULTI_INSTANCE ?? '').trim().toLowerCase())) out.push('MULTI_INSTANCE=1');
  const role = String(env.PROCESS_ROLE ?? '').trim().toLowerCase();
  if (role === 'api' || role === 'worker') out.push(`PROCESS_ROLE=${role} (the API and the worker run as separate services)`);
  return out;
}

/** Pure: every reason this environment must not start in production ([] = fine, and always [] outside production). */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const missing: string[] = [];
  if (env.REPO_DRIVER !== 'postgres') missing.push("REPO_DRIVER must be 'postgres' (refusing to start on the in-memory fallback in production)");
  if (!env.DATABASE_URL) missing.push('DATABASE_URL is required');
  if (!env.AUTH_SESSION_SECRET) missing.push('AUTH_SESSION_SECRET is required (signs the session cookie)');
  // Constitution 12 §41: every encryption purpose needs its own key in production — never a derived or constant one.
  for (const k of missingProductionKeys(env)) missing.push(`${k} is required (Constitution 12 §41: no derived or constant encryption keys in production)`);
  // Constitution 4 §133 (Phase 11): more than one process without Redis = split-brain realtime, limits and caches.
  const multi = multiProcessReasons(env);
  if (multi.length && !String(env.REDIS_URL ?? '').trim()) {
    missing.push(`REDIS_URL is required when the API runs as more than one process (${multi.join('; ')}): realtime events, the per-tenant rate limiter and cache invalidations are shared through Redis — without it each process keeps its own copy`);
  }
  // Agent C (Phase 11, E7): MEDIA_STORE=s3 without a bucket/region would write uploads to the container disk.
  for (const m of mediaStorageConfigErrors(env)) missing.push(m);
  // Owner & Manager Payment App mandate §211–§213: production never starts on a mock / sandbox payment provider.
  for (const m of tapToPayProductionProblems(env)) missing.push(m);
  // Payments / Twilio mandate §125–§126: raw-body webhooks, no sandbox processor hosts, a whole (not half) shared Twilio sender + its public callback base
  for (const m of integrationsProductionProblems(env)) missing.push(m);
  // P-11 (wave 4 pilot): a forced mock SMS / e-mail sender would record texts as sent while nothing leaves.
  for (const m of messagingProductionProblems(env)) missing.push(m);
  return missing;
}

// Refuse to start in production on the in-memory fallback or without the secrets that make the app safe.
// (In dev/test, REPO_DRIVER unset is allowed so the in-memory repositories can run without a database.)
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  const missing = productionConfigProblems(env);
  if (missing.length) {
    console.error('FATAL: refusing to start — invalid production configuration:\n  - ' + missing.join('\n  - ') +
      '\nSet these (see .env.production.example), or run with NODE_ENV != production for local development.');
    process.exit(1);
  }
}
