#!/usr/bin/env node
// security-audit.mjs — AI PowerSalon's automated security audit (Jul 26, 2026).
//
// Two modes, one honest report:
//   --fast  every push/PR (CI): all static security gates + committed-secret scan + quick security suites.
//   --full  nightly (1am cron) + manual: fast + every real-schema *.pgtest suite + auth/webhook/payment/security
//           suites + dependency audit.
//
// DESIGN RULE (spec §21): this script CREATES NOTHING new in the security architecture — it ORCHESTRATES the
// checks that already exist (the check:* gates, the pgtest suites, security-core) and adds only what was missing:
// a committed-secret scan, a dependency-audit summary, and a structured report with honest statuses.
//
// Statuses (spec §19): PASSED / FAILED / NOT TESTED / NOT APPLICABLE / NOT VERIFIED — never "everything is secure".
// Secrets are always REDACTED (spec §12/§18).
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const MODE = process.argv.includes('--full') ? 'full' : 'fast';
const argOf = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : null; };
const ONLY_SHARDS = argOf('shards') !== null ? argOf('shards').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4) : [1, 2, 3, 4];  // '--shards=' (empty) = run none
const SKIP = new Set((argOf('skip') || '').split(',').filter(Boolean));   // gates,secrets,census,quick,deps
const API = process.cwd().endsWith('apps/api') ? process.cwd() : join(process.cwd(), 'apps/api');
const REPO = join(API, '..', '..');
const t0 = Date.now();
const results = [];   // { area, name, status, severity, detail }
const add = (area, name, status, severity = null, detail = '') => results.push({ area, name, status, severity, detail });

// ---------- 1) STATIC SECURITY GATES (all existing; reuse) ----------
const GATES = [
  ['tenant', 'Tenant isolation (every scoped-table query carries tenant_id)', 'CRITICAL'],
  // The Kysely BUILDER shape check:tenant never saw (Constitution 13 open-items close-out). A ratchet over a frozen,
  // reviewed-later baseline: a NEW unscoped builder statement on a tenant table fails; the baseline only shrinks.
  ['tenant-builder', 'Tenant isolation, query-builder statements (ratchet: no NEW unscoped builder query)', 'CRITICAL'],
  ['perms', 'RBAC coverage (every route carries a permission)', 'HIGH'],
  ['public', 'Unguarded-route allowlist (no accidental public endpoints)', 'HIGH'],
  ['sql', 'SQL prepares against the real schema', 'HIGH'],
  ['sql:select', 'Selected columns exist (no silent undefined fields)', 'MEDIUM'],
  ['impossible', 'No impossible predicates (dead security filters)', 'MEDIUM'],
  ['crosswire', 'Cross-module wiring audit', 'MEDIUM'],
  ['di', 'Dependency-injection dead/missing providers', 'MEDIUM'],
  ['types-drift', 'DB schema ↔ Kysely types drift', 'MEDIUM'],
  ['unreached', 'Unreached routes audit', 'LOW'],
  ['dead-client', 'Dead client methods audit', 'LOW'],
  ['nav', 'Sidebar/nav wiring audit', 'LOW'],
  // The two shipped single-file HTML apps (kiosk, device manager) have no tsconfig and no suite — this gate is
  // their only check on syntax, dangling element refs, hardcoded origins and credentials. MEDIUM: a broken kiosk
  // is a salon that cannot check customers in.
  ['html', 'Single-file HTML app audit (kiosk, device manager)', 'MEDIUM'],
  // Owner decision (Jul 30 2026): no printed schedules / queues / service tickets, and no browser print
  // dialog in any frontend. Receipts (incl. the 'print' receipt channel) are unaffected.
  ['no-print', 'Removed print features stay removed (schedule/queue/service ticket)', 'MEDIUM'],
  // The API must actually BOOT. check:di is static (tokens have providers); this instantiates the real
  // AppModule, which is the only thing that catches a provider Nest cannot construct at runtime.
  ['boot', 'API boots — real Nest AppModule instantiation', 'CRITICAL'],
];
for (const [gate, label, sev] of (SKIP.has('gates') ? [] : GATES)) {
  const r = spawnSync('npm', ['run', '-s', `check:${gate}`], { cwd: API, encoding: 'utf8', timeout: 180000 });
  add('Static gates', `check:${gate} — ${label}`, r.status === 0 ? 'PASSED' : 'FAILED', r.status === 0 ? null : sev,
    r.status === 0 ? '' : (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 400));
}

// ---------- 2) COMMITTED-SECRET SCAN (new; values always redacted) ----------
const SECRET_PATTERNS = [
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Stripe live key', /sk_live_[0-9a-zA-Z]{16,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['Twilio account SID + auth pattern', /AC[0-9a-f]{32}/],
  ['Twilio API key SID', /SK[0-9a-f]{32}/],
  ['GitHub token', /gh[pousr]_[0-9A-Za-z]{30,}/],
  ['Slack token', /xox[abpr]-[0-9A-Za-z-]{10,}/],
  ['Postgres URL with credentials', /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]+@/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['JWT-looking literal assigned', /(?:secret|token|password)\s*[:=]\s*['"](?:eyJ[A-Za-z0-9_-]{20,})/i],
];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|sql|md|ya?ml|env|sh|py|html|css)$/;
const isTestPath = (p) => /\.(spec|test)\.|\/test\/|\/tests\/|fixtures|\.example|mock/i.test(p);
let scanned = 0; const secretHits = [];
if (!SKIP.has('secrets')) (function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name)); continue; }
    const p = join(dir, e.name);
    if (!TEXT_EXT.test(e.name)) continue;
    if (e.name === '.env.example' || e.name === '.env') continue;
    let s; try { if (statSync(p).size > 2_000_000) continue; s = readFileSync(p, 'utf8'); } catch { continue; }
    scanned++;
    for (const [kind, re] of SECRET_PATTERNS) {
      const m = s.match(re);
      if (!m) continue;
      // Postgres URLs: a localhost/placeholder dev string is documentation, not a leak. Only flag a REAL-looking
      // host + non-placeholder password as CRITICAL; everything else is informational noise we suppress.
      if (kind === 'Postgres URL with credentials') {
        const url = m[0];
        const host = (url.match(/@([^/:\s'"`]+)/) || [])[1] || '';
        const pw = (url.match(/:\/\/[^:]+:([^@]+)@/) || [])[1] || '';
        const devHost = /^(localhost|127\.0\.0\.1|HOST|DBHost|<host>|\$\{|\.\.\.)/i.test(host);
        const placeholderPw = /^(pass|password|PASSWORD|postgres|aps|example|xxx+|<.*|\$\{|\[)/i.test(pw);
        if (devHost || placeholderPw) continue;
      }
      const line = s.slice(0, m.index).split('\n').length;
      secretHits.push({ kind, file: relative(REPO, p), line, test: isTestPath(p) });
    }
  }
})(REPO);
const realHits = secretHits.filter((h) => !h.test);
const fixtureHits = secretHits.filter((h) => h.test);
if (!SKIP.has('secrets')) add('Committed secrets', `Secret scan (${scanned} files, values never printed)`,
  realHits.length ? 'FAILED' : 'PASSED', realHits.length ? 'CRITICAL' : null,
  realHits.length ? realHits.map((h) => `${h.kind} @ ${h.file}:${h.line} [REDACTED]`).join(' | ')
                  : (fixtureHits.length ? `${fixtureHits.length} pattern hit(s) confined to test/fixture files (INFORMATIONAL)` : 'no pattern hits'));

// ---------- 2b) DENY-PATH CENSUS (spec §16 ratchet: deny-side coverage may grow, never silently shrink) ----------
if (!SKIP.has('census')) {
  const denyRe = /\.rejects\.toThrow\(\/(Forbidden|forbidden|permission|Missing permission)/;
  const scopeRe = /toThrow\(\/not found\/i\)/;
  let denyCount = 0, scopeCount = 0;
  const censusWalk = function census(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) census(join(dir, e.name)); continue; }
      if (!/\.spec\.tsx?$/.test(e.name)) continue;
      const body = readFileSync(join(dir, e.name), 'utf8');
      denyCount += (body.match(new RegExp(denyRe.source, 'g')) || []).length;
      scopeCount += (body.match(new RegExp(scopeRe.source, 'g')) || []).length;
    }
  };
  // Constitution 13: the scope-denial tests moved with their domains into modules/*/src — walking only apps/api/src the
  // census fell to 17 against its floor of 25 (this lane FAILED from the first module moves until the open-items
  // close-out found it). Every code root is counted.
  const MODS = join(API, '..', '..', 'modules');
  for (const r of [join(API, 'src'), ...(existsSync(MODS) ? readdirSync(MODS).map((m) => join(MODS, m, 'src')).filter((p) => existsSync(p)) : [])]) censusWalk(r);
  const FLOOR = { deny: 15, scope: 25 };   // measured Jul 26 2026 — raise when coverage grows, never lower
  const ok = denyCount >= FLOOR.deny && scopeCount >= FLOOR.scope;
  add('Security test suites', 'Deny-path census (RBAC-deny + tenant/branch scope-denial assertions)',
    ok ? 'PASSED' : 'FAILED', ok ? null : 'HIGH',
    `RBAC-deny ${denyCount} (floor ${FLOOR.deny}) · scope-denial ${scopeCount} (floor ${FLOOR.scope}); enforcement mechanism unit-proven in security-core; per-route exhaustive deny E2E: NOT TESTED`);
}

// ---------- 3) SECURITY TEST SUITES (existing; reuse) ----------
/** A workspace package's own vitest (its tests moved with its code — Constitution 13). Same pass/fail contract as vitest(). */
function packageTests(label, pkg, base = 'packages', args = []) {
  const r = spawnSync('npx', ['vitest', 'run', ...args], { cwd: join(API, '..', '..', base, pkg), encoding: 'utf8', timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/);
  const failed = /failed/i.test(out.match(/Tests[^\n]*/)?.[0] ?? '') || r.status !== 0;
  add('Security test suites', label, failed ? 'FAILED' : 'PASSED', failed ? 'HIGH' : null,
    m ? `${m[1]} passed` : out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300));
}
function vitest(label, args, timeoutMs) {
  const r = spawnSync('npx', ['vitest', 'run', ...args], { cwd: API, encoding: 'utf8', timeout: timeoutMs });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/);
  const failed = /failed/i.test(out.match(/Tests[^\n]*/)?.[0] ?? '') || r.status !== 0;
  add('Security test suites', label, failed ? 'FAILED' : 'PASSED', failed ? 'HIGH' : null,
    m ? `${m[1]} passed${m[2] ? `, ${m[2]} skipped` : ''}` : out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300));
}
if (!SKIP.has('quick')) packageTests('Auth/session core (quick lane) — modules/identity', 'identity', 'modules', ['src/auth/auth-session-token.vitest.spec.ts']);   // identity is a module (Constitution 13)
// The permission kernel's own tests moved with it to packages/permissions (Constitution 13); run them from there.
if (!SKIP.has('quick')) packageTests('Permission kernel (packages/permissions)', 'permissions');
if (!SKIP.has('quick')) packageTests('§20 MFA asked on every login decision (H4) — modules/identity', 'identity', 'modules', ['src/auth/mfa-bypass-regression.vitest.spec.ts']);

// Constitution 12 §205: the security GUARDS run on every push, not only nightly. Each one fails the build when a change
// re-opens something a phase closed — an allow-by-default route, an unlisted secret, a plaintext secret column, a
// sessionless route answering 401, a forgeable client IP, a loosened CSP, a cross-tenant realtime room. Until this
// lane existed they ran only in the nightly battery, so a regression merged first and failed the next morning.
// Keep this list in step with C12_GUARDS in c12-guards.vitest.spec.ts (a test holds them identical).
export const C12_GUARDS = [
  'src/common/authz-declared.vitest.spec.ts',        // §27 deny by default: every route declares its authorization
  'src/common/realm.guard.vitest.spec.ts',           // §6 customer ≠ staff, every route swept
  'src/common/sessionless-routes.vitest.spec.ts',    // §62 self-authenticating routes reach their handlers (H5)
  'src/common/client-ip.vitest.spec.ts',             // §50 the client IP cannot be forged (H7)
  'src/common/security-headers.vitest.spec.ts',      // §251 API headers on every response (H2)
  'src/common/app-headers.vitest.spec.ts',           // §251 app CSPs generated, current and tight
  'src/common/api-hardening.vitest.spec.ts',         // §64 mass assignment, §69 GET never mutates, §72 SSRF
  'src/common/key-ring.vitest.spec.ts',              // §41 no derived or constant keys in production (H1)
  'src/common/network-posture.vitest.spec.ts',       // §50–55 boot posture warnings
  'src/common/data-classification.pgtest.vitest.spec.ts', // §13 no plaintext secret columns
  'src/common/secrets-inventory.pgtest.vitest.spec.ts',   // §44 the secrets inventory cannot go stale
  'src/common/tenant-consistency.pgtest.vitest.spec.ts',  // §32 a crossed salon id cannot be written
  'src/common/audit-append-only.pgtest.vitest.spec.ts',   // §187 the audit trail cannot be rewritten (H3)
  'src/common/otp-race.pgtest.vitest.spec.ts',       // §112 one-time codes single-use under concurrency (H8)
  'src/realtime/realtime-isolation.vitest.spec.ts',  // §34 realtime / cache / job isolation
  'src/common/cross-tenant-suite.pgtest.vitest.spec.ts', // §299 IDOR: salon B asks each domain for salon A's real id
  'src/common/platform-lockdown.pgtest.vitest.spec.ts',  // §198 a platform lockdown actually locks the platform (M13)
  'src/common/security-runbooks.vitest.spec.ts',         // §310 every control a runbook names exists
  'src/common/card-data.pgtest.vitest.spec.ts',          // §84–86 no card number / CVV column, ever
  'src/common/secure-random.vitest.spec.ts',             // H9 no security value from Math.random()
  'src/common/ephemeral-grants.pgtest.vitest.spec.ts',   // durable single-use grants; token hashed at rest
  'src/common/fraud-owner-alert.pgtest.vitest.spec.ts',  // owners told of fraud; the employee named cannot see it
  'src/common/absolute-prohibitions.vitest.spec.ts',     // §323 the forty "never" rules, as tests
  'src/common/legacy-cipher-rows.vitest.spec.ts',        // C13 §81: rows sealed by the original cipher modules still open
  'src/common/idor-route-coverage.vitest.spec.ts',       // §286/§299 Phase 14: every tenant GET-by-id route in the manifest has an IDOR case
  'src/common/dod-predicates.vitest.spec.ts',            // Phase 14: every DoD line (§303/§324/§396) is removable evidence, never a bare true
];
if (!SKIP.has('quick')) vitest('Constitution 12 security guards (every push)', C12_GUARDS, 600000);
if (MODE === 'full') {
  // The full sweep REUSES the proven acceptance execution shape — the 4-shard battery — instead of inventing a
  // new mega-run. Every real-schema pgtest suite (tenant/branch isolation, provenance, payments) plus every unit
  // and integration suite runs exactly the way the standard acceptance battery runs them, one shard at a time,
  // with per-shard results in the report. (First-run lesson: a single vitest invocation over all pgtest files at
  // once thrashes — 419-migration boot per file under worker contention — and yields no incremental evidence.)
  for (const k of ONLY_SHARDS) {
    vitest(`Full test battery shard ${k}/4 (includes all real-schema pgtest isolation suites)`, [`--shard=${k}/4`], 420000);
  }
}

// ---------- 4) DEPENDENCY AUDIT (full mode; no auto-upgrades — spec §13) ----------
if (MODE === 'full' && !SKIP.has('deps')) {
  for (const ws of ['apps/api', 'apps/pos-web', 'apps/admin-web', 'apps/manager-pay-web', 'apps/customer-display', 'packages/ui']) {
    const dir = join(REPO, ws);
    if (!existsSync(join(dir, 'package.json'))) continue;
    try {
      // STATUS is driven by RUNTIME dependencies only (--omit=dev): a vulnerable test runner cannot be reached in
      // production. Dev-dep findings are still REPORTED in the detail — never hidden (spec §20) — just not gating.
      const prod = JSON.parse(execSync('npm audit --omit=dev --json --audit-level=none || true', { cwd: dir, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }));
      const all = JSON.parse(execSync('npm audit --json --audit-level=none || true', { cwd: dir, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }));
      const pv = prod.metadata?.vulnerabilities ?? {}; const av = all.metadata?.vulnerabilities ?? {};
      const highNames = Object.entries(prod.vulnerabilities ?? {}).filter(([, d]) => ['critical', 'high'].includes(d.severity)).map(([n]) => n).slice(0, 14).join(',');
      const gating = (pv.critical ?? 0) > 0;   // runtime CRITICAL gates; runtime HIGHs are listed and tracked, majors deferred per §13
      add('Dependencies', `npm audit — ${ws}`, gating ? 'FAILED' : 'PASSED', gating ? 'CRITICAL' : null,
        `runtime critical:${pv.critical ?? 0} high:${pv.high ?? 0}${highNames ? ` [${highNames}]` : ''} · incl. dev: critical:${av.critical ?? 0} high:${av.high ?? 0} (semver-safe fixes applied; major-version fixes deferred per §13 — no auto-upgrades)`);
    } catch (e) {
      add('Dependencies', `npm audit — ${ws}`, 'NOT VERIFIED', null, `audit could not run: ${String(e.message).slice(0, 120)}`);
    }
  }
}

// ---------- 5) HONEST OUT-OF-REACH LIST (spec §19: never guess) ----------
add('Environment', 'Fiserv/CardPointe/Bolt live + sandbox behavior', 'NOT VERIFIED', null, 'no processor credentials in this environment; UAT script exists (bolt_uat_roundtrip.py) for when creds arrive');
add('Environment', 'Production CORS / TLS / reverse-proxy rate limiting', 'NOT VERIFIED', null, 'infra-level controls live outside the repo; verify on the deployed host');
add('Environment', 'SMS delivery + Twilio webhook against live account', 'NOT VERIFIED', null, 'TWILIO_* credentials are owner-side');
add('Environment', 'Physical device flows (ASUS touchscreen, Bolt terminal, iPhone TTP)', 'NOT VERIFIED', null, 'hardware unavailable in this environment');

// ---------- 6) REPORT ----------
if (argOf('merge') === 'append') {
  const mergePath = join(REPO, '.security-audit-partial.json');
  const prev = existsSync(mergePath) ? JSON.parse(readFileSync(mergePath, 'utf8')) : [];
  // env NOT-VERIFIED lines are re-added by every run — keep them out of the partial so finalize shows them once
  writeFileSync(mergePath, JSON.stringify(prev.concat(results.filter((r) => r.area !== 'Environment')), null, 2));
}
if (argOf('merge') === 'finalize') {
  const mergePath = join(REPO, '.security-audit-partial.json');
  if (existsSync(mergePath)) { const seen = new Set(results.map((r) => r.area + '|' + r.name)); results.unshift(...JSON.parse(readFileSync(mergePath, 'utf8')).filter((r) => !seen.has(r.area + '|' + r.name))); }
}
const counts = { PASSED: 0, FAILED: 0, 'NOT VERIFIED': 0, 'NOT TESTED': 0, 'NOT APPLICABLE': 0 };
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
const failedLines = results.filter((r) => r.status === 'FAILED');
const stamp = new Date().toISOString();
const lines = [];
lines.push(`# AI PowerSalon — Security Audit Report`);
lines.push(``);
lines.push(`Mode: **${MODE}** · Generated: ${stamp} · Duration: ${Math.round((Date.now() - t0) / 1000)}s`);
lines.push(`Result: **${failedLines.length === 0 ? 'NO FAILED CHECKS' : failedLines.length + ' FAILED CHECK(S)'}** — ` +
  `PASSED ${counts.PASSED} · FAILED ${counts.FAILED} · NOT VERIFIED ${counts['NOT VERIFIED']}`);
lines.push(``);
lines.push(`> Honesty rule (spec §19): a green run means "these listed checks passed", never "everything is secure".`);
lines.push(`> Secrets are always redacted. Severities appear only on FAILED findings.`);
lines.push(``);
let lastArea = '';
for (const r of results) {
  if (r.area !== lastArea) { lines.push(`## ${r.area}`); lastArea = r.area; }
  const sev = r.severity ? ` **[${r.severity}]**` : '';
  lines.push(`- ${r.status === 'PASSED' ? '✅' : r.status === 'FAILED' ? '❌' : '⚠️'} **${r.status}**${sev} — ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
lines.push(``);
lines.push(`## How to run`);
lines.push('- Every push/PR (CI): `npm run security:fast` — static gates + secret scan + quick security suites.');
lines.push('- Nightly 1am + manual: `npm run security:full` — adds every real-schema pgtest suite and the dependency audit.');
writeFileSync(join(REPO, 'SECURITY_REPORT.md'), lines.join('\n') + '\n');

console.log(lines.slice(2, 5).join('\n'));
for (const f of failedLines) console.log(`FAILED [${f.severity}] ${f.name} — ${f.detail}`);
console.log(`Report written: SECURITY_REPORT.md (${results.length} checks)`);
process.exit(failedLines.length === 0 ? 0 : 1);
