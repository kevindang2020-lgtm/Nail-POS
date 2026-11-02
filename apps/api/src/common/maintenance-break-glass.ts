// maintenance-break-glass.ts — BUILD_PLAN Phase 11 (Constitution 4 §139): the maintenance switch that works when the
// database does not.
//
// Super Admin maintenance (modules/super-admin/src/super-admin-maintenance) lives in the database and FAILS OPEN when it
// cannot be read — correct for planned maintenance, useless in the incident that needs it most: Postgres down, a
// migration half-applied, a data-corruption bug writing bad rows. MAINTENANCE_BREAK_GLASS is an environment switch the
// operator flips on the host (Railway → Variables → redeploy/restart). It is read from process.env on every request,
// touches nothing external, and runs as plain Express middleware BEFORE every Nest middleware (session, tenant context,
// the DB-backed maintenance check), so it answers even when each of those would hang or throw.
//
//   MAINTENANCE_BREAK_GLASS=off        (default) nothing.
//   MAINTENANCE_BREAK_GLASS=read_only  every non-GET/HEAD answers 503 MAINTENANCE_READ_ONLY — except /health/*, sign-out
//                                      (a person must always be able to leave) and CORS preflight. Webhooks get the 503
//                                      too: payment / SMS providers QUEUE and RETRY a 5xx, so nothing is lost and nothing
//                                      is written while the data is in doubt.
//   MAINTENANCE_BREAK_GLASS=full       everything but /health/* and /metrics answers 503 MAINTENANCE_FULL with the message.
//   MAINTENANCE_BREAK_GLASS_MESSAGE    optional text shown to people (no secrets — it goes to every client).
//
// There is deliberately no Super Admin bypass: the role lives in the database this switch must not depend on. Super Admin
// keeps reading in read_only mode; in full mode the platform is closed to everyone until the variable is cleared.

import type { BreakGlassMode } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

const DEFAULT_MESSAGE = 'AIPowerSalon is in emergency maintenance. Please try again in a few minutes.';

/** The mode named by the environment. Unknown values are reported by breakGlassConfigProblem and treated as 'off'
 *  (an emergency typo must not close the platform; the boot log says so loudly). */
export function breakGlassMode(env: NodeJS.ProcessEnv = process.env): BreakGlassMode {
  const v = String(env.MAINTENANCE_BREAK_GLASS ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (v === 'read_only' || v === 'readonly') return 'read_only';
  if (v === 'full' || v === 'on') return 'full';
  return 'off';
}
export function breakGlassConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = String(env.MAINTENANCE_BREAK_GLASS ?? '').trim();
  if (!raw || raw.toLowerCase() === 'off' || breakGlassMode(env) !== 'off') return null;
  return `MAINTENANCE_BREAK_GLASS="${raw}" is not off | read_only | full — ignored (the platform stays OPEN)`;
}
export function breakGlassMessage(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.MAINTENANCE_BREAK_GLASS_MESSAGE ?? '').trim().slice(0, 500) || DEFAULT_MESSAGE;
}

const HEALTH = /^\/(health|readyz|livez)(\/|$|\?)/;
const METRICS = /^\/metrics(\/|$|\?)/;
const SIGN_OUT = /^\/auth\/logout(\/|$|\?)/;   // the one sign-out route (identity auth.controller) for every app
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export type BreakGlassDecision = { allow: true } | { allow: false; status: 503; body: { statusCode: 503; code: 'MAINTENANCE_READ_ONLY' | 'MAINTENANCE_FULL'; error: 'Service Unavailable'; message: string; maintenance: true; mode: BreakGlassMode; breakGlass: true } };

/** Pure: may this request proceed under the break-glass mode? */
export function breakGlassDecision(mode: BreakGlassMode, method: string, path: string, message = DEFAULT_MESSAGE): BreakGlassDecision {
  if (mode === 'off') return { allow: true };
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '/');
  if (HEALTH.test(p)) return { allow: true };
  if (m === 'OPTIONS') return { allow: true };   // CORS preflight — lets the browser read the 503 below
  if (mode === 'full') {
    if (METRICS.test(p)) return { allow: true };
    return { allow: false, status: 503, body: { statusCode: 503, code: 'MAINTENANCE_FULL', error: 'Service Unavailable', message, maintenance: true, mode, breakGlass: true } };
  }
  if (SAFE.has(m)) return { allow: true };
  if (SIGN_OUT.test(p)) return { allow: true };
  return { allow: false, status: 503, body: { statusCode: 503, code: 'MAINTENANCE_READ_ONLY', error: 'Service Unavailable', message: `${message} Changes are paused; you can still view information.`, maintenance: true, mode, breakGlass: true } };
}

export const BREAK_GLASS_RETRY_AFTER_SECONDS = 120;

/** Express middleware. Reads the environment on EVERY request (no cache, no I/O). */
export function breakGlassMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return function breakGlass(req: any, res: any, next: () => void): void {
    const mode = breakGlassMode(env);
    if (mode === 'off') return next();
    const path = String(req.path ?? req.url ?? '/').split('?')[0];
    const d = breakGlassDecision(mode, req.method, path, breakGlassMessage(env));
    if (d.allow) return next();
    res.statusCode = d.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Retry-After', String(BREAK_GLASS_RETRY_AFTER_SECONDS));
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(d.body));
  };
}

/** What System Operations shows. */
export function breakGlassStatus(env: NodeJS.ProcessEnv = process.env): { mode: BreakGlassMode; message: string | null; problem: string | null } {
  const mode = breakGlassMode(env);
  return { mode, message: mode === 'off' ? null : breakGlassMessage(env), problem: breakGlassConfigProblem(env) };
}
