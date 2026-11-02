#!/usr/bin/env node
// attack-surface.mjs — Security Deep Scan mandate §3: SECURITY_ATTACK_SURFACE.md is GENERATED from the code, never typed.
//
// Source of truth: the OpenAPI route manifest (apps/api/openapi/manifest.txt — `check:openapi` keeps it equal to every
// @Controller/@Get/@Post… in apps/api/src and modules/*/src) joined with the route collector (scripts/audit-routes.js) for
// the file:line of each handler. Writes:
//   docs/security/attack-surface-routes.csv   every HTTP route: method, path, file:line, realm, auth, permission, step-up,
//                                             idempotency, guards, class, body limit, rate limit
//   docs/security/SECURITY_ATTACK_SURFACE.md  the counts, every PUBLIC route, webhooks, uploads, streams, service
//                                             endpoints, step-up routes — plus the non-HTTP surface (workers, schedulers,
//                                             DB connections, outbound integrations) from the list below.
//   node apps/api/scripts/attack-surface.mjs           write both
//   node apps/api/scripts/attack-surface.mjs --check   fail when the committed files differ from the code (CI)
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(API, '..', '..');
const OUT_MD = join(ROOT, 'docs/security/SECURITY_ATTACK_SURFACE.md');
const OUT_CSV = join(ROOT, 'docs/security/attack-surface-routes.csv');
const require = createRequire(import.meta.url);
const { routes } = require('./audit-routes.js');

const manifest = new Map();
for (const l of readFileSync(join(API, 'openapi/manifest.txt'), 'utf8').split('\n')) {
  if (!l || l.startsWith('#')) continue;
  const [m, p, ...rest] = l.split(/\s+/);
  const kv = {}; const flags = new Set();
  for (const t of rest) { const i = t.indexOf('='); if (i > 0) kv[t.slice(0, i)] = t.slice(i + 1); else if (t) flags.add(t); }
  manifest.set(`${m} ${p}`, { kv, flags });
}
const toMan = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const fileLine = new Map();
const lines = new Map();
function lineOf(rel, handler) {
  const abs = existsSync(join(API, 'src', rel)) ? join(API, 'src', rel) : join(ROOT, rel);
  if (!existsSync(abs)) return 0;
  if (!lines.has(abs)) lines.set(abs, readFileSync(abs, 'utf8').split('\n'));
  const re = new RegExp('(^|[\\s)])(async\\s+)?' + String(handler).replace(/[$]/g, '\\$') + '\\s*\\(');
  const L = lines.get(abs);
  for (let i = 0; i < L.length; i++) if (re.test(L[i]) && !/^\s*(\/\/|\*)/.test(L[i])) return i + 1;
  return 0;
}
// S-A10 (Security Deep Scan §28/§43/§44): the rate column is READ FROM THE DECORATORS where a route declares its limit —
// @AnonRateLimit(max, windowMs, { bucket }) (method and/or class), @CodeLookupLimited(kind), the voice-key guard — and
// only then from the reviewed family table below. A numeric argument may be a product of literals (`5 * 60_000`).
const num = (expr) => { const parts = String(expr).split('*').map((x) => Number(x.trim().replace(/_/g, ''))); return parts.every((n) => Number.isFinite(n)) ? parts.reduce((a, b) => a * b, 1) : NaN; };
const win = (ms) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000} h` : ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`);
function anonSpec(d) {
  const m = /^\s*([\d_\s*]+?)\s*,\s*([\d_\s*]+?)\s*(?:,\s*\{\s*bucket:\s*'([^']+)'\s*\})?\s*$/.exec(String(d.args ?? ''));
  if (!m) return `AnonRateLimit (${String(d.args ?? '').trim()}) per IP`;
  return `AnonRateLimit ${num(m[1])} / ${win(num(m[2]))} per IP${m[3] ? ` (bucket ${m[3]})` : ''}`;
}
function rateFromDecorators(r) {
  const out = [];
  for (const d of r.decorators || []) if (d.name === 'AnonRateLimit') out.push(anonSpec(d));
  for (const d of r.classDecorators || []) if (d.name === 'AnonRateLimit') out.push(`${anonSpec(d)} [class]`);
  for (const d of [...(r.decorators || []), ...(r.classDecorators || [])]) {
    if (d.name === 'CodeLookupLimited') out.push(`CodeLookupLimited(${String(d.args ?? '').split(',')[0].trim()}): weighted 12 caller / 30 IP / 60 salon per 15 min (Postgres)`);
    if (d.name === 'UseGuards' && /VoiceKeyRateLimitGuard/.test(String(d.args ?? ''))) out.push('VoiceKeyRateLimitGuard 120 / min per key');
  }
  return out.length ? out.join(' + ') : null;
}
for (const r of routes) {
  const rel = r.file.startsWith('modules') ? r.file : 'apps/api/src/' + r.file;
  const decs = [...(r.decorators || []).map((d) => `${d.name}(${d.args ?? ''})`), ...(r.classDecorators || []).map((d) => `${d.name}(${d.args ?? ''})`)].join(' ');
  fileLine.set(`${r.method} ${toMan(r.path)}`, { at: `${rel}:${lineOf(r.file, r.handler)}`, upload: /FileInterceptor|FilesInterceptor/.test(decs), rate: rateFromDecorators(r) });
}

/** Rate limits that are specific to a route family (read from the code, Oct 23 2026). Everything else: TenantRateLimitGuard. */
const RATE = [
  [/^\/auth\/login$/, 'login throttle 5 / 15 min per (portal, salon, identifier, IP) + credential-stuffing detector (LOGIN_THROTTLE_STORE)'],
  [/^\/auth\/(step-up|mfa\/(enroll|confirm)|change-password|temp-password-login|change-temporary-password)$/, 'Postgres attempt budget: 5 failures / 15 min per account (auth-attempt-budget.ts)'],
  [/^\/auth\/(super-admin\/forgot-password|password-reset)/, 'reset counts in Postgres per identifier + IP'],
  [/^\/public\/mfa-recovery/, '5 failures burn the recovery token'],
  [/^\/public\/website/, '5 / min per IP, 10-minute lock'],
  [/^\/(public\/)?go-check-in|^\/kiosk/, 'kiosk: per-session caps + salon-wide 300 sessions / 600 lookups per 15 min'],
  [/^\/(voice|api\/ai-receptionist)/, 'VoiceKeyRateLimitGuard 120 / min per key (RATE_LIMIT_STORE=redis)'],
  [/^\/webhooks\/|^\/integrations\/inbound\//, 'provider-signed; no rate limit (signature first, before any work)'],
  // Reviewed public routes whose limit is not a decorator (Security Deep Scan §28, Oct 26 2026):
  [/^\/customer\/auth\/activation\//, 'OTP source throttle + resend cooldown (customer-activation.service.ts)'],
  [/^\/app-config$/, 'per-IP + per-instance WindowLimiter (app-config.controller.ts)'],
  [/^\/client-telemetry\//, 'per-IP + per-instance WindowLimiter; always 204 (client-errors / client-events controllers)'],
  [/^\/(internal|jobs)\//, 'service secret (no anonymous access); not rate limited'],
  [/^\/(health(\/|$)|metrics$)/, 'probe / metrics token — not rate limited by design (edge WAF REQUIRES KEVIN)'],
  [/^\/(\.well-known\/|app-links\/|media\/)/, 'static / cacheable content — not rate limited by design (edge WAF REQUIRES KEVIN)'],
  // Weekly Paycheck 17.5 (Oct 27 2026): the pay-stub PDF — its own per-person window on top of the tenant bucket
  [/\/pay-stub\.pdf$/, 'PayStubRateLimiter 60 / min per (salon, user), per instance (payroll-paystub.ts) + TenantRateLimitGuard'],
];
const rateFor = (path, isPublic, realm, declared) => [declared, RATE.find(([re]) => re.test(path))?.[1]].filter(Boolean).join(' + ') || null
  || (isPublic ? 'route-specific limiter or none (TenantRateLimitGuard skips anonymous calls; edge WAF REQUIRES KEVIN)'
    : realm === 'super_admin' ? 'none (TenantRateLimitGuard skips platform users; protected by MFA + step-up)' : 'TenantRateLimitGuard (tenant / branch bucket; RATE_LIMIT_STORE=redis for multi-replica)');
const FORM = /^\/(api\/v1\/)?(webhooks|voice|voice-transcription|api\/ai-receptionist)(\/|$)/i;

const rows = [];
for (const [key, { kv, flags }] of [...manifest.entries()].sort((a, b) => a[0].split(' ')[1].localeCompare(b[0].split(' ')[1]) || a[0].localeCompare(b[0]))) {
  const [method, path] = key.split(' ');
  const auth = kv.auth ?? '?'; const realm = kv.realm ?? '?';
  const isPublic = /public|none/.test(auth);
  const fl = fileLine.get(key) ?? { at: '?', upload: false };
  const cls = /^\/webhooks\/|\/webhook$|\/inbound$/.test(path) ? 'webhook'
    : fl.upload ? 'upload'
    : /\/stream$|\/events$/.test(path) && method === 'GET' ? 'stream'
    : /^\/(internal|jobs)\//.test(path) ? 'service'
    : isPublic ? 'public' : realm === 'super_admin' ? 'platform' : 'session';
  const body = !['POST', 'PUT', 'PATCH'].includes(method) ? '' : fl.upload ? 'multipart (upload policy size cap)'
    : `JSON ${isPublic ? 'PUBLIC_BODY_LIMIT 256 KB' : 'MAX_BODY_SIZE 25 MB (credentialed) / 256 KB (anonymous)'}${FORM.test(path) ? ' + form-encoded' : ''}`;
  rows.push({ method, path, at: fl.at, realm, auth, perm: kv.perm ?? (kv.derived ? `derived:${kv.derived}` : ''), stepUp: flags.has('step-up') ? 'yes' : '', idem: kv.idempotency ?? '', guards: kv.guards ?? '', cls, body, rate: rateFor(path, isPublic, realm, fl.rate) });
}

const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const csv = ['method,path,file:line,realm,auth,permission,step_up,idempotency,guards,class,body_limit,rate_limit',
  ...rows.map((r) => [r.method, r.path, q(r.at), r.realm, r.auth, q(r.perm), r.stepUp, q(r.idem), q(r.guards), r.cls, q(r.body), q(r.rate)].join(','))].join('\n') + '\n';

const count = (f) => rows.filter(f).length;
const table = (list, cols) => list.length ? [`| ${cols.map((c) => c[0]).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...list.map((r) => `| ${cols.map((c) => String(c[1](r)).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n') : '_none_';
const realms = [...new Set(rows.map((r) => r.realm))].sort();
const workers = existsSync(join(API, 'src/jobs')) ? readdirSync(join(API, 'src/jobs')).filter((f) => /\.ts$/.test(f) && !/spec/.test(f)) : [];

const md = `# SECURITY_ATTACK_SURFACE.md — every way in (mandate §3)

**Generated** by \`node apps/api/scripts/attack-surface.mjs\` from the OpenAPI route manifest (which \`check:openapi\` keeps
equal to the code) — do not edit by hand; \`--check\` fails CI when this file drifts. Full per-route table:
[attack-surface-routes.csv](attack-surface-routes.csv) (${rows.length} rows: method, path, file:line, realm, auth, permission,
step-up, idempotency, guards, class, body limit, rate limit). Hosting is Railway (no AWS): there is no cloud WAF, IMDS or IAM layer.

## 1. Counts

| | routes |
|---|---|
| all HTTP routes | ${rows.length} |
${realms.map((r) => `| realm \`${r}\` | ${count((x) => x.realm === r)} |`).join('\n')}
| public (no session; each one reviewed by \`check:public\`) | ${count((r) => /public|none/.test(r.auth))} |
| integration key / OAuth (\`auth=api_key\`) | ${count((r) => r.auth === 'api_key')} |
| with \`@RequireStepUp\` (fresh password + code) | ${count((r) => r.stepUp)} |
| with an idempotency contract | ${count((r) => r.idem)} |
| webhooks | ${count((r) => r.cls === 'webhook')} |
| multipart uploads | ${count((r) => r.cls === 'upload')} |
| server-sent event streams | ${count((r) => r.cls === 'stream')} |
| service / scheduler endpoints (\`/internal\`, \`/jobs\`) | ${count((r) => r.cls === 'service')} |

## 2. Layers every request passes (in order)

1. **Edge** — Railway's proxy (TLS). *No WAF / bot / DDoS layer exists yet: REQUIRES KEVIN (Cloudflare or equivalent in front of api / admin / app hosts).*
2. **Express** (apps/api/src/main.ts) — exact trust-proxy hop count; security headers (CSP \`default-src 'none'\`, HSTS, nosniff, frame-ancestors none, no-store on authenticated); CORS: credentialed app origins only, marketing site non-credentialed (\`common/allowed-origins.ts\`); CSRF origin check on every cookie-authenticated unsafe method (\`csrfVerdict\`, CSRF_REJECTED); body parsers per request (\`common/request-body-limits.ts\`: 256 KB anonymous, 25 MB credentialed, form bodies only on provider callback paths); platform lockdown + maintenance break-glass.
3. **TenantContextMiddleware** — deny by default: every route except the reviewed public list needs a signed, unrevoked session (session row re-read, fail CLOSED on platform and money routes), authorization version re-derived per request, tenant / branch from the session only (client tenantId / branchId stripped).
4. **Global guards** — RealmGuard (customer ≠ staff ≠ platform), RolePermissionGuard (default-deny), PlatformDomainGuard (every /super-admin route keyed), StepUpGuard (critical actions — gate \`check:critical-step-up\`), SuspendedAccessGuard, MfaEnrollmentGuard, TenantRateLimitGuard.
5. **ValidatedBody** schemas (unknown fields stripped, prototype keys refused) — \`check:validated-bodies\`.
6. **Domain services** — \`scoped()\` tenant + branch predicates, lifecycle state machines, idempotency keys, unknown payment ≠ declined.
7. **PostgreSQL** — tenant_id on every tenant table, same-tenant triggers, optional RLS (\`DB_TENANT_RLS\`), least-privilege roles (\`db-provision-roles.mjs\`; boot posture check warns on a superuser / BYPASSRLS login).

## 3. Public routes (no session)

${table(rows.filter((r) => /public|none/.test(r.auth)), [['method', (r) => r.method], ['path', (r) => `\`${r.path}\``], ['handler', (r) => r.at], ['class', (r) => r.cls], ['rate limit', (r) => r.rate]])}

## 4. Webhooks (authenticity before any effect)

${table(rows.filter((r) => r.cls === 'webhook'), [['method', (r) => r.method], ['path', (r) => `\`${r.path}\``], ['handler', (r) => r.at], ['auth', (r) => r.auth]])}

Authenticity: payment webhooks — per-tenant HMAC over the raw body, timing-safe, processor bound to the merchant's configured processor, event claim before effects (E7); bank deposits — path token + timestamped signature; Twilio — tenant resolved from the To number / message first, then THAT tenant's token (E2); integrations — signature + replay window.

## 5. Uploads

${table(rows.filter((r) => r.cls === 'upload'), [['method', (r) => r.method], ['path', (r) => `\`${r.path}\``], ['handler', (r) => r.at], ['permission', (r) => r.perm]])}

All uploads go through \`packages/media/src/upload-policy.ts\` (size, magic bytes, extension + MIME family, pixel cap, metadata strip, random server key, quota). Malware scan: ClamAV when \`CLAMAV_HOST\` is set; in production a non-image document that could not be scanned is refused (\`SCAN_UNAVAILABLE\`) unless \`UNSCANNED_DOCUMENTS=allow\`. Base64-in-JSON uploads ride the credentialed 25 MB JSON limit.

## 6. Streams (SSE)

${table(rows.filter((r) => r.cls === 'stream'), [['path', (r) => `\`${r.path}\``], ['handler', (r) => r.at], ['realm', (r) => r.realm], ['auth', (r) => r.auth]])}

Rooms are derived from the session server-side; revocation and authorization changes are re-checked every 15 s and end the stream; display / device streams re-check their token every 15 s (C11).

## 7. Service and scheduler endpoints

${table(rows.filter((r) => r.cls === 'service'), [['method', (r) => r.method], ['path', (r) => `\`${r.path}\``], ['handler', (r) => r.at], ['auth', (r) => r.auth]])}

Service callers present a short-lived scoped service token (\`SERVICE_TOKEN_SECRET\`, timing-safe, fails closed). Durable jobs run in the worker (apps/api/src/worker.ts) — ${workers.length} job files under apps/api/src/jobs; tenant comes from job metadata, never from a request.

## 8. Critical actions protected by step-up

${table(rows.filter((r) => r.stepUp), [['method', (r) => r.method], ['path', (r) => `\`${r.path}\``], ['realm', (r) => r.realm]])}

## 9. Non-HTTP surface

| Surface | Where | Control |
|---|---|---|
| PostgreSQL | DATABASE_URL (API), PG_WORKER_DATABASE_URL (worker), MIGRATE_DATABASE_URL (deploy) | TLS required for non-private hosts (boot check on every *DATABASE_URL); least-privilege roles aps_api / aps_worker (REQUIRES KEVIN to switch); port 5432 never public (REQUIRES KEVIN to confirm the old external DB is closed) |
| Redis (optional) | REDIS_URL | rate-limit / login-throttle store across replicas; private network only |
| Object storage | MEDIA_STORE=s3, PRIVATE_FILES_* | private bucket, signed URLs ≤ 1 h, presigned PUT ≤ 10 min, server-chosen keys |
| ClamAV | CLAMAV_HOST (Railway private network) | REQUIRES KEVIN to deploy |
| Outbound — tenant / admin supplied URLs | webhooks, processor base URLs | \`packages/security/src/safe-outbound.ts\`: https only, the connection's own DNS answer checked against every special-purpose range, no redirects, timeout + size cap; processor hosts allowlisted (\`PROCESSOR_URL_POLICIES\`) |
| Outbound — fixed providers | Twilio, SendGrid, OpenAI, Anthropic, Google (Gemini, Maps, FCM, Business Profile), Apple APNs, Retell, CardPointe / Fiserv, Clover | hosts hard-coded or from env; provider secrets server-side only |
| Mobile shells | Capacitor 8.5.3 (customer, tech, owner, manager-pay; display + kiosk on iPad) | https scheme, no cleartext in release, tokens in Keychain / Keystore, FLAG_SECURE |
| CI/CD | .github/workflows (SHA-pinned actions), Railway build from Dockerfile | least-privilege token, gated image publish, Trivy, SBOM, gitleaks, CodeQL, npm audit gate |
`;

if (process.argv.includes('--check')) {
  const same = existsSync(OUT_MD) && existsSync(OUT_CSV) && readFileSync(OUT_MD, 'utf8') === md && readFileSync(OUT_CSV, 'utf8') === csv;
  if (!same) { console.error('❌ attack-surface: docs/security/SECURITY_ATTACK_SURFACE.md is stale — run node apps/api/scripts/attack-surface.mjs'); process.exit(1); }
  console.log(`✅ attack-surface: ${rows.length} routes, documentation current`);
} else {
  writeFileSync(OUT_MD, md); writeFileSync(OUT_CSV, csv);
  console.log(`attack-surface: ${rows.length} routes → docs/security/SECURITY_ATTACK_SURFACE.md + attack-surface-routes.csv`);
}
