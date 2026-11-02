// network-posture.ts — Constitution 12 §50–55: what the application can check about its own network position.
//
// The network itself — TLS termination, DDoS absorption, the private network between the API and Postgres/Redis — is
// Railway's (decision D5). There is no infrastructure code in this repository to harden. What the APPLICATION can do
// is notice at boot when it has been configured in a way that defeats Railway's protections:
//   • DATABASE_URL pointing at a PUBLIC host with no `sslmode` — database traffic, credentials included, would cross
//     the internet unencrypted. Railway's private hostnames (*.railway.internal) travel its encrypted private network.
//   • A Redis URL on a public host without TLS (`rediss://`).
// These are WARNINGS (an ERROR log line and a security event), not boot refusals: an external managed database with
// `sslmode=require` in its URL is correct, and refusing to boot on a guess would be worse than a loud warning.
export interface PostureFinding { variable: string; problem: string }

const isPrivateHost = (h: string) => /\.railway\.internal$/i.test(h) || h === 'localhost' || h === '127.0.0.1' || h === '::1' || /^(10|192\.168)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);

export function networkPosture(env: NodeJS.ProcessEnv = process.env): PostureFinding[] {
  if (env.NODE_ENV !== 'production') return [];
  const out: PostureFinding[] = [];
  // Security Deep Scan D9: every database URL the processes use, not only DATABASE_URL (the worker and the migrator too)
  for (const v of ['DATABASE_URL', 'PG_WORKER_DATABASE_URL', 'MIGRATE_DATABASE_URL', 'DATABASE_READ_URL']) {
    const db = env[v]; if (!db) continue;
    try {
      const u = new URL(db);
      const mode = (u.searchParams.get('sslmode') || '').toLowerCase();
      if (!isPrivateHost(u.hostname) && !['require', 'verify-ca', 'verify-full'].includes(mode)) {
        out.push({ variable: v, problem: `public host ${u.hostname} without sslmode=require — use Railway's private URL, or append ?sslmode=require` });
      }
    } catch { out.push({ variable: v, problem: 'not a parseable URL' }); }
  }
  for (const v of ['REDIS_URL', 'CACHE_REDIS_URL', 'RATE_LIMIT_REDIS_URL', 'LOGIN_THROTTLE_REDIS_URL', 'REALTIME_REDIS_URL']) {
    const raw = env[v]; if (!raw) continue;
    try {
      const u = new URL(raw);
      if (u.protocol === 'redis:' && !isPrivateHost(u.hostname)) out.push({ variable: v, problem: `public host ${u.hostname} over plain redis:// — use the private URL, or rediss://` });
    } catch { /* a malformed Redis URL fails at connect, loudly, already */ }
  }
  // Constitution 12 §323 ("never accept a webhook without verification"): with Retell configured, its tool webhooks are
  // verified by the integration key alone unless the signing key is set — the code warns per request; say it once at boot.
  if (env.RETELL_API_KEY && !env.RETELL_WEBHOOK_SIGNING_KEY) {
    out.push({ variable: 'RETELL_WEBHOOK_SIGNING_KEY', problem: 'Retell is configured but its webhook signing key is not — voice tool calls are verified by the integration key only; set the signing key from the Retell console' });
  }
  // Uploaded photos on LOCAL DISK in production: a Railway container's filesystem is replaced on every deploy, so
  // technician avatars, portfolios and showcase photos vanish unless MEDIA_STORE=s3 or MEDIA_ROOT is a mounted volume.
  if (String(env.MEDIA_STORE ?? '').trim().toLowerCase() !== 's3' && !env.MEDIA_ROOT) {
    out.push({ variable: 'MEDIA_STORE', problem: 'uploaded photos are stored on the container disk and are LOST on every deploy — set MEDIA_STORE=s3 (with MEDIA_S3_BUCKET) or point MEDIA_ROOT at a Railway volume' });
  }
  return out;
}

/** Security Deep Scan D9 (§85): the API's database login must not be a superuser or BYPASSRLS — under one, the tenant RLS
 *  policies (migration 544) do not apply and any future injection becomes DDL / COPY … PROGRAM power. Checked once at
 *  boot; a finding is logged as a security error (production) — the fix is Kevin's: run db-provision-roles.mjs and point
 *  DATABASE_URL at aps_api and PG_WORKER_DATABASE_URL at aps_worker. */
/** `readRole` runs: select current_user as u, rolsuper as su, rolbypassrls as bypass from pg_roles where rolname = current_user */
export async function databaseRolePosture(readRole: () => Promise<Array<Record<string, unknown>>>): Promise<PostureFinding[]> {
  try {
    const rows = await readRole();
    const r = rows[0] ?? {};
    const out: PostureFinding[] = [];
    if (r.su === true) out.push({ variable: 'DATABASE_URL', problem: `the API connects as ${String(r.u)}, a SUPERUSER — run apps/api/scripts/db-provision-roles.mjs and use the aps_api login (RLS does not apply to a superuser)` });
    else if (r.bypass === true) out.push({ variable: 'DATABASE_URL', problem: `the API's login ${String(r.u)} has BYPASSRLS — tenant RLS policies do not apply` });
    return out;
  } catch (e) {
    return [{ variable: 'DATABASE_URL', problem: `could not read the database role (${e instanceof Error ? e.message : String(e)})` }];
  }
}
