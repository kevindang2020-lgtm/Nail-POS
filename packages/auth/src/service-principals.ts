// service-principals.ts — Constitution 3 §7, §74, §81–82, §160 (Step 6, Oct 3 2026): background jobs and schedulers get
// their OWN identity. Before this, seven internal routes each trusted a different static header compared with `!==`
// (not timing-safe), and nothing said WHO was calling. Now:
//   • a fixed registry of named principals, each with the least set of scopes it needs;
//   • a short-lived token (5 minutes) signed with SERVICE_TOKEN_SECRET — a DIFFERENT key from the user-session secret,
//     so a leak of one cannot mint the other; type 'service', realm 'service' (never accepted as a user session);
//   • requireServiceCaller(req, scope, legacy): the route accepts `Authorization: Bearer svc.…` carrying the scope, or —
//     only while its old variable is still set — the legacy header (timing-safe). Remove the old variable to retire it.
// The caller mints its own token at call time (scripts/call-internal.mjs: a Railway cron command runs it in-container).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SERVICE_SCOPES = [
  'jobs.reminders.run', 'reports.scheduled.run', 'tenant_warnings.dispatch', 'hardware_payment.sweep',
  'membership_billing.run', 'ai_billing.ingest', 'backups.report',
] as const;
export type ServiceScope = (typeof SERVICE_SCOPES)[number];
/** The principals and their least-privilege scopes. A principal can do nothing outside its list. */
export const SERVICE_PRINCIPALS: Record<string, readonly ServiceScope[]> = {
  'svc.scheduler': ['jobs.reminders.run', 'reports.scheduled.run', 'tenant_warnings.dispatch', 'hardware_payment.sweep'],
  'svc.billing': ['membership_billing.run', 'ai_billing.ingest'],
  'svc.backups': ['backups.report'],
};
export const SERVICE_TOKEN_TTL_SECONDS = 300;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sign = (body: string, secret: string) => b64(createHmac('sha256', secret).update('svc:' + body).digest());

export function mintServiceToken(principal: string, opts: { secret: string; now?: number; ttlSeconds?: number }): string {
  const scopes = SERVICE_PRINCIPALS[principal]; if (!scopes) throw new Error(`unknown service principal: ${principal}`);
  if (!opts.secret || opts.secret.length < 32) throw new Error('SERVICE_TOKEN_SECRET must be at least 32 characters');
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  const body = b64(JSON.stringify({ sub: principal, scopes, iat, exp: iat + Math.min(opts.ttlSeconds ?? SERVICE_TOKEN_TTL_SECONDS, 900), typ: 'service', aud: 'service', iss: 'aipowersalon' }));
  return `svc.${body}.${sign(body, opts.secret)}`;
}
export type ServiceVerify = { ok: true; principal: string; scopes: string[] } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_type' | 'unknown_principal' | 'missing_scope' };
export function verifyServiceToken(token: string, opts: { secret: string; scope: ServiceScope; now?: number }): ServiceVerify {
  const m = /^svc\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token ?? ''));
  if (!m || !opts.secret) return { ok: false, reason: 'malformed' };
  const want = Buffer.from(sign(m[1], opts.secret)), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad_signature' };
  let p: any; try { p = JSON.parse(unb64(m[1]).toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (p.typ !== 'service' || p.aud !== 'service') return { ok: false, reason: 'wrong_type' };
  if (typeof p.exp !== 'number' || p.exp <= Math.floor((opts.now ?? Date.now()) / 1000)) return { ok: false, reason: 'expired' };
  // The registry, not the token, decides the scopes: a principal removed or narrowed here loses them at once.
  const allowed = SERVICE_PRINCIPALS[String(p.sub)];
  if (!allowed) return { ok: false, reason: 'unknown_principal' };
  if (!allowed.includes(opts.scope)) return { ok: false, reason: 'missing_scope' };
  return { ok: true, principal: String(p.sub), scopes: [...allowed] };
}
function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
export class ServiceAuthError extends Error { constructor(public status: 401 | 403 | 503, message: string) { super(message); } }
/** The one check every internal route makes. Returns who called. Throws ServiceAuthError (map it to the HTTP status). */
/** legacy: the route's OLD shared secret, read by the caller as `process.env.X` (so the secrets inventory sees the read). */
export function requireServiceCaller(req: { headers?: Record<string, any> }, scope: ServiceScope, legacy?: { name: string; secret: string | undefined; header: string }, env: NodeJS.ProcessEnv = process.env): { principal: string; via: 'service_token' | 'legacy_header' } {
  const h = req?.headers ?? {};
  const auth = String(h.authorization ?? h.Authorization ?? '');
  const secret = String(env.SERVICE_TOKEN_SECRET ?? '');
  if (/^Bearer\s+svc\./i.test(auth)) {
    if (!secret) throw new ServiceAuthError(503, 'Service tokens are not configured (SERVICE_TOKEN_SECRET).');
    const v = verifyServiceToken(auth.replace(/^Bearer\s+/i, '').trim(), { secret, scope });
    if (v.ok) return { principal: v.principal, via: 'service_token' };
    throw new ServiceAuthError(v.reason === 'missing_scope' ? 403 : 401, `service token refused: ${v.reason}`);
  }
  const legacySecret = legacy ? String(legacy.secret ?? '') : '';
  if (legacy && legacySecret && safeEqual(h[legacy.header], legacySecret)) return { principal: `legacy:${legacy.name}`, via: 'legacy_header' };
  if (!secret && !legacySecret) throw new ServiceAuthError(503, 'This internal route is not configured.');
  throw new ServiceAuthError(403, 'Forbidden');
}
