// unguarded-route-check.mjs — a controller that serves tenant data must be GUARDED.
//
// ══ THE ONE THAT WOULD ACTUALLY LET A SALON READ ANOTHER SALON'S DATA ══════════════════════════════════════
//
// Every query in this codebase can carry `tenant_id` perfectly, and it buys you nothing if the route that runs it
// has no guard — because then `req.ctx` is never populated, `ctx.tenantId` is empty, and the query either returns
// nothing or (worse) is written to fall back to something.
//
// The guards are what put the tenant in the context in the first place:
//
//     TenantAuthGuard   → a salon principal, tenant from the SIGNED SESSION
//     SuperAdminGuard   → the platform, cross-tenant on purpose
//
// A controller with tenant-scoped routes and NEITHER is a controller anybody on the internet can call.
//
// Some routes are legitimately public — a booking page, a Twilio webhook, a health check. Those are the ones to
// LOOK at, which is exactly why they must be listed and reviewed rather than assumed.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(new URL('../src', import.meta.url).pathname);

// Constitution 13: domain modules live in modules/*/src and are part of the API's surface — a gate that walked only
// apps/api/src would lose sight of a controller or repository the moment it moved. Every root is walked.
const MODULE_SRC_ROOTS = (() => { const d = new URL('../../../modules', import.meta.url).pathname; try { return readdirSync(d).map((m) => `${d}/${m}/src`).filter((p) => existsSync(p)); } catch { return []; } })();


const codeLines = (s) =>
  s.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

// ── the MIDDLEWARE is the real gate, and I nearly missed it ─────────────────────────────────────────────
//
// My first version flagged 37 controllers as "unguarded — anybody on the internet can call these."
//
// **They are not.** `TenantContextMiddleware` is applied GLOBALLY in AppModule and throws
// `UnauthorizedException("No session")` when there is no signed session. Every route it covers is authenticated,
// and `req.ctx.tenantId` is taken from the SIGNED SESSION — never from the request.
//
// So a controller without `@UseGuards(TenantAuthGuard)` is not open; the guard is belt-and-braces on top of the
// middleware. Reporting 37 "open endpoints" would have sent somebody on a panicked hunt through the core of the
// product for a hole that is not there — and worse, it would have buried the ONE list that actually matters:
//
//     the middleware's `.exclude()` list — the routes it SKIPS. THAT is the public attack surface.
//
// So this checks the thing that decides: what is excluded, and is each exclusion justified.
const SCOPING_GUARDS = /TenantAuthGuard|SuperAdminGuard|CustomerAuthGuard|OwnerAuthGuard|VoiceAuthGuard|TechAuthGuard/;

// Everything the global middleware EXCLUDES. These are the only genuinely public routes.
const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
const excludeBlock = /\.exclude\(([\s\S]*?)\)\s*\.forRoutes/.exec(appModule);
const excluded = excludeBlock
  ? [...excludeBlock[1].matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
  : [];

// Routes that are PUBLIC BY DESIGN. Each is listed, and each has a reason — because "it's fine, it's public" is the
// sentence people say right before they ship an open endpoint.
const PUBLIC_BY_DESIGN = [
  { match: /webhooks?\//i,            why: 'a provider webhook — the caller is Twilio/Fiserv, not a person. Tenant is resolved from the SIGNED payload, never from the request.' },
  { match: /health|readyz|livez/i,    why: 'a health probe — returns no tenant data' },
  { match: /^metrics$/,               why: 'BUILD_PLAN Phase 11: the Prometheus scrape — METRICS_TOKEN bearer (constant-time compare), 404 in production without one; no tenant data (labels are route templates, job types, providers)' },
  { match: /auth\/|login|password|activate|webauthn/i, why: 'authentication — you cannot require a session to create one' },
  { match: /public/i,                 why: 'an explicitly public surface (a booking page on a signed link)' },
  { match: /^\.well-known$|^app-links$/, why: 'BUILD_PLAN Phase 13 D (Constitution 6 §64–65): the universal-link / App Link association files and the not-installed web fallback redirect — env-built, no tenant or user data (mobile-links/mobile-links.controller.ts)' },
  { match: /internal\//i,             why: 'internal service-to-service, network-restricted' },
  { match: /^app-config$/,           why: 'BUILD_PLAN Phase 13 B: a mobile app\'s version thresholds, flag booleans, module notices and maintenance text — read before sign-in and by a build the API already refuses (the update screen needs the store link). Platform-wide data only, no tenant data; a session is used only if already present (tenant rollouts); rate-limited per address and per instance (mobile-config/app-config.controller.ts)' },
  { match: /^client-telemetry$/,      why: 'crash reports from the web apps -- a crash on the login screen must be reportable, so no session can be required. Returns only 204, stores nothing, reads no tenant data, takes tenant only from a session the request already carries; body is allow-listed, length-capped, redacted and rate-limited (observability/client-errors.controller.ts)' },
];

const unguarded = [];
const publicByDesign = [];

for (const file of [SRC, ...MODULE_SRC_ROOTS].flatMap((r) => walk(r))) {
  if (!/\.controller\.ts$/.test(file) && !/\.module\.ts$/.test(file)) continue;
  const raw = readFileSync(file, 'utf8');
  const src = codeLines(raw);
  if (!/@Controller\s*\(/.test(src)) continue;

  // Split into controller classes — one file can hold several, with different guards.
  const ctlRe = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)([\s\S]*?)(?=@Controller\s*\(|$)/g;
  let m;
  while ((m = ctlRe.exec(src))) {
    const prefix = m[1] ?? '';
    const body = m[2];

    // Does the class carry a scoping guard? Look BEFORE the @Controller too — decorators can be either side.
    const head = src.slice(Math.max(0, m.index - 400), m.index + 400);
    const guarded = SCOPING_GUARDS.test(head) || SCOPING_GUARDS.test(body.slice(0, 400));

    // Does it actually expose routes?
    const routes = [...body.matchAll(/@(Get|Post|Put|Patch|Delete)\s*\(/g)].length;
    if (!routes) continue;

    if (guarded) continue;

    const rel = file.replace(SRC + '/', '');
    const pub = PUBLIC_BY_DESIGN.find((p) => p.match.test(prefix) || p.match.test(rel));
    if (pub) { publicByDesign.push({ file: rel, prefix, routes, why: pub.why }); continue; }

    unguarded.push({ file: rel, prefix, routes });
  }
}

// ── the public surface: the middleware's exclude list ───────────────────────────────────────────────────
console.log('PUBLIC SURFACE — routes the global session middleware SKIPS\n');
if (!excluded.length) {
  console.error('Could not read the .exclude() list from app.module.ts — refusing to report on a gate I cannot see.');
  process.exit(2);
}

// Anything excluded that is NOT one of these shapes is a route serving data with no session at all.
const JUSTIFIED = [
  { re: /^media\//,                     why: 'static media' },
  { re: /^customer\/salons/,            why: 'PUBLIC salon discovery — a customer browsing salons before they have an account. This is a booking site; the menu is meant to be public.' },
  { re: /^customer\/techs/,             why: 'public technician profiles (the same reasoning)' },
  { re: /^customer\/deals\/(nearby|public\/:id(\/estimate)?)$/, why: 'BUILD_PLAN Phase 5, bug 20: PUBLIC deal browsing — a guest sees live deals near them, one deal’s terms and a discounted ESTIMATE from catalog prices (nothing is reserved or applied). Budgeted per client address in the controller (DealsPublicLimiter: 60/min, a view counted once per address per 30 min); saved / wallet / booking stay behind the session.' },
  { re: /^customer\/auth\//,            why: 'sign-up and activation — PRE-AUTH by definition: you cannot require a session to create one' },
  { re: /^auth\/webauthn\/(status|authenticate)/, why: 'biometric SIGN-IN is pre-auth. Enrollment is NOT — it stays behind the session.' },
  { re: /^auth\/biometric\/(status|login)$/, why: 'BUILD_PLAN Phase 13 D (Constitution 6 §37): Face ID SIGN-IN with the device credential is pre-auth (a 256-bit secret bound to the device id, rotated per use, reuse revokes it; off unless FACE_ID_ENABLED). Enrollment and revoke stay behind the session.' },
  { re: /^app-links\/\(\.\*\)$/, why: 'BUILD_PLAN Phase 13 D (Constitution 6 §65): a universal link opened on a phone without the app — 302 to the env-configured web app with the parsed closed-list route (never an open redirect: the target host is env-only); no data read.' },
  { re: /^\.well-known\/(apple-app-site-association|assetlinks\.json)$/, why: 'BUILD_PLAN Phase 13 D (Constitution 6 §65): the universal-link / App Link association files Apple and Google fetch without a session. Built from env (Team ID, bundle ids, signing-cert SHA-256) — no tenant or user data; 404 when not configured.' },
  { re: /^public\/alert-ack$/,          why: 'BUILD_PLAN Phase 14 C (Constitution 11 §265): the on-call acknowledgement link from a page email / SMS. Its signed (HMAC), single-use (nonce hash, one conditional UPDATE), 2-hour token IS the credential; GET only renders a confirmation page (mail scanners prefetch), POST acknowledges one alert. No tenant data; 404-shaped page for anything invalid (observability/oncall.ts).' },
  { re: /^public\//,                    why: 'an explicitly public marketing surface (leads, applications)' },
  { re: /^webhooks?\//,                 why: 'a provider webhook — the caller is Twilio, not a person. The tenant is resolved from the SIGNED payload, never from the request.' },
  { re: /^app-config$/,                why: 'BUILD_PLAN Phase 13 B (Constitution 6 §55, §219): mobile app config — version thresholds + store link, flag booleans, module notices, maintenance text. No tenant data; rate-limited; GET only.' },
  { re: /^client-telemetry\/events$/,   why: 'mobile analytics + perf marks (Constitution 6 §116–119, BUILD_PLAN Phase 13). Launch timing and login-screen events precede any session. The shared allowlist (api-contracts sanitizeTelemetryBatch) keeps only listed events / props with closed-set values; per-IP and per-instance rate limits; stores nothing; always 204.' },
  { re: /^client-telemetry\/errors$/,   why: 'crash reports from the web apps (Constitution 11 Phase 12a). A crash on the login screen must be reportable, so no session can be required. Allow-listed app/kind, length-capped, scrubbed, per-IP and per-instance rate limits, always 204.' },
  { re: /^integrations\/inbound\/:connectionId$/, why: 'a provider webhook for a connected integration: the provider signature (x-signature) IS the authentication, verified in the ingest service against that connection\'s secret; the connection id names which secret, it grants nothing.' },
  { re: /^health|^readyz|^livez/,       why: 'health probe — returns no tenant data' },
  { re: /^metrics$/,                    why: 'BUILD_PLAN Phase 11: Prometheus scrape (GET only) — authenticated by the METRICS_TOKEN bearer in the handler (constant-time), answers 404 in production when no token is configured; no tenant data' },
  { re: /^api\/|^internal\//,           why: 'service-to-service, separately authenticated' },
  { re: /^voice\/(tool|calls\/:callId\/outcome)$/, why: 'BUILD_PLAN Phase 5: the voice provider\'s tool webhook and call-outcome callback — VoiceAuthGuard (hashed vk_ integration key → tenant + branch) + VoiceKeyRateLimitGuard, and the Retell signature when configured. Service-to-service; no user session exists.' },
  { re: /^go-check-in|^customer-display|^mobile-checkout/, why: 'in-salon device surfaces, separately keyed' },
  { re: /^community\//,                 why: 'the public community surface' },
  { re: /^auth\//,                      why: 'login, logout and password reset are PRE-AUTH by definition. NOTE: auth/admin/reset-user-password is excluded from the middleware but verifies the session ITSELF (sessionFromRequest) and 401s without one — it is authenticated, just not by the middleware.' },
  { re: /^jobs\//,                      why: 'a scheduled job. Protected by an x-jobs-secret header, and it FAILS CLOSED: with JOBS_SECRET unset it returns 503 rather than running. Without that, anyone could trigger a reminder run — SMS sent on the tenant\'s bill.' },
  { re: /^oauth\/(token|revoke)$/,     why: 'Constitution 3 Step 10d: the OAuth token and revocation endpoints are called by the PARTNER APP, which has no salon session by definition. The credential is the one-time code + PKCE verifier (+ client secret) or the rotating refresh token, verified in OAuthService; revoke always answers 200 (RFC 7009) and reveals nothing.' },
  { re: /^platform\/branding/,          why: 'the platform logo and theme. No tenant data.' },
];

const unjustified = [];
for (const path of excluded) {
  const j = JUSTIFIED.find((x) => x.re.test(path));
  if (j) console.log(`  OK   ${path}\n         ${j.why}`);
  else { console.log(`  ??   ${path}   ← NOT a reviewed public shape`); unjustified.push(path); }
}

console.log(`\n${excluded.length} public routes, ${unjustified.length} unreviewed.`);

if (unjustified.length) {
  console.log('\nAn excluded route serves data with NO SESSION AT ALL. Each one must be justified.');
  process.exit(1);
}

console.log('\nEverything else requires a signed session, and tenantId comes ONLY from that session.');
console.log('Client-supplied tenantId/branchId are STRIPPED for every non-super-admin role.');
process.exit(0);

if (unguarded.length) {
  console.log(`\n${'='.repeat(96)}`);
  console.log(`UNGUARDED CONTROLLERS SERVING ROUTES: ${unguarded.length}`);
  console.log('='.repeat(96));
  console.log('\nNo TenantAuthGuard, no SuperAdminGuard. `req.ctx` is never populated — so there is no tenant to');
  console.log('scope by, and anybody on the internet can call these.\n');
  for (const u of unguarded) {
    console.log(`  ${u.file}`);
    console.log(`     @Controller('${u.prefix}')  — ${u.routes} route(s), NO scoping guard\n`);
  }
  process.exit(1);
}

console.log('\nOK — every controller serving routes carries a scoping guard, or is public by design and reviewed.');
if (publicByDesign.length) {
  console.log('\nPublic by design:');
  for (const p of publicByDesign) console.log(`  ${p.prefix || p.file}\n     ${p.why}`);
}
process.exit(0);
