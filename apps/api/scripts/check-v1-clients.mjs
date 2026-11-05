#!/usr/bin/env node
// check-v1-clients.mjs — BUILD_PLAN Phase 12 (Constitution 5 §11–13, DoD #57): every frontend calls the API at
// /api/v1/<path>. The server still answers the legacy spelling (apps already installed in salons, kiosks, phones) and
// stamps Deprecation / Sunset on it, counting the hits (apps/api/src/common/api-version.ts) — this gate keeps the
// SOURCE from drifting back.
//
//   R1 BASE      an app reads VITE_API_BASE / APS_API_BASE only in its resolver file (one place decides the API origin)
//   R2 LITERAL   no legacy API path is handed straight to fetch / EventSource / sendBeacon / window.open / new URL /
//                a realtime streamPath — those bypass the client that adds /api/v1
//   R3 CONCAT    no API base is glued to a path by hand (`${apiBase}/x`, API_ORIGIN + path) — apiUrl / buildApiUrl only
//   R4 BUILDER   no app calls the unversioned buildUrl(); every app client builds with buildApiUrl / apiUrl
//   R5 PROXY     every app dev proxy (vite.config.ts) forwards /api/v1 (vite preview uses the same table)
//   R6 IN STEP   the client's unversioned list (packages/api-client/src/api-version.ts) is the server's NEVER_DEPRECATED
//   R7 COVERED   every apps/<dir> with a page or a src/ is scanned here (APPS / HTML_APPS) — an app nobody scans calls
//                whatever it likes (Phase 15: the three legacy static apps were exactly that, and are now removed)
//
// The paths that stay put (/auth/refresh — the refresh cookie's Path; /media; /platform/branding; probes; webhooks; the
// already-versioned /api/*) are decided by those two lists, not here. An exception is a line in
// apps/api/openapi/v1-clients.allowlist.txt (`<file>  <rule>  # reason`); the list only shrinks — an entry that no
// longer matches anything fails until it is removed.
//
// Not scanned: packages/api-client (it IS the rule). The three legacy static apps this gate once skipped (booking-html,
// booking-schedule-html, go-check-in-admin) were removed in BUILD_PLAN Phase 15 (Oct 10 2026); R7 fails if one returns.
//
//   node apps/api/scripts/check-v1-clients.mjs                 the gate (check:v1-clients)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
const ALLOWLIST = join(REPO, 'apps/api/openapi/v1-clients.allowlist.txt');

export const APPS = ['pos-web', 'owner-web', 'admin-web', 'tech-web', 'customer-web', 'manager-pay-web', 'customer-display'];
export const HTML_APPS = ['go-check-in-kiosk/index.html', 'go-check-in-kiosk/www/index.html', 'booking-public/index.html'];
export const PACKAGES = ['ui', 'mobile-sdk', 'realtime-client'];
/** The one file per app that may read the build-time / runtime API origin. */
export const RESOLVERS = {
  'apps/pos-web/src/api/apiBase.ts': 1, 'apps/owner-web/src/api/client.ts': 1, 'apps/admin-web/src/api/client.ts': 1,
  'apps/tech-web/src/api/client.ts': 1, 'apps/customer-web/src/api/client.ts': 1, 'apps/manager-pay-web/src/api/client.ts': 1,
  'apps/customer-display/src/api.ts': 1,
  'packages/ui/src/error-reporting.tsx': 1, 'packages/ui/src/brand/branding-client.ts': 1,
  'apps/go-check-in-kiosk/index.html': 1, 'apps/go-check-in-kiosk/www/index.html': 1, 'apps/booking-public/index.html': 1,
};
/** Each app's API client — must build with the versioned builder. */
export const CLIENTS = ['apps/pos-web/src/api/apiBase.ts', 'apps/owner-web/src/api/client.ts', 'apps/admin-web/src/api/client.ts',
  'apps/tech-web/src/api/client.ts', 'apps/customer-web/src/api/client.ts', 'apps/manager-pay-web/src/api/client.ts',
  'apps/customer-display/src/api.ts'];

// ── the API's path vocabulary: the first segment of every route in the committed manifest ─────────────────────────
export function apiSegments(manifestText) {
  const segs = new Set();
  for (const l of manifestText.split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const path = l.split(/\s+/)[1] || '';
    const seg = path.split('/')[1];
    if (seg && !seg.startsWith('{')) segs.add(seg);
  }
  return [...segs].sort();
}

// ── R6: the two exemption lists, as sets of alternatives ──────────────────────────────────────────────────────────
export function alternationOf(src, constName) {
  const m = new RegExp(`const ${constName} = \\/\\^\\\\\\/\\(([^)]*)\\)`).exec(src);
  if (!m) return null;
  return m[1].split('|').map((s) => s.replace(/\\/g, '')).sort();
}

const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /\/(test|__tests__|__mocks__)\//.test(p);
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) continue;
    const p = join(dir, n); const st = statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|jsx|mjs)$/.test(n) && !isTest(p)) out.push(p);
  }
  return out;
}
export function sourceFiles(repo = REPO) {
  const files = [];
  for (const a of APPS) files.push(...walk(join(repo, 'apps', a, 'src')));
  for (const p of PACKAGES) files.push(...walk(join(repo, 'packages', p, 'src')));
  for (const h of HTML_APPS) if (existsSync(join(repo, 'apps', h))) files.push(join(repo, 'apps', h));
  return files;
}

/** R7: app directories this gate does not scan (anything under apps/ with an index.html or a src/, other than the API). */
export function unscannedApps(repo = REPO) {
  const dir = join(repo, 'apps');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((a) => a !== 'api' && statSync(join(dir, a)).isDirectory()
    && (existsSync(join(dir, a, 'index.html')) || existsSync(join(dir, a, 'src')))
    && !APPS.includes(a) && !HTML_APPS.some((h) => h.startsWith(a + '/'))).sort();
}

/** Comment lines out of the way (a rule quoted in a comment is not a call). Keeps line numbers. */
const stripComments = (s) => s.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');

/** Findings for ONE file's text. `rel` is its repo-relative path; `segs` the API's first segments (legacy prefixes). */
export function scanSource(rel, text, segs, unversioned = []) {
  const out = [];
  const code = stripComments(text);
  const lines = code.split('\n');
  const keep = new Set(unversioned.filter((u) => !u.includes('/')));
  const SEG = segs.filter((s) => s !== 'api' && !keep.has(s)).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const isHtml = rel.endsWith('.html');
  const literal = new RegExp(`(?:\\b(?:fetch|EventSource|HeaderEventSource|sendBeacon|open|URL)\\(\\s*|streamPath:\\s*)['"\`](?:\\$\\{[^}]*\\})?\\/(?:${SEG})(?:[\\/?'"\`]|$)`);
  const htmlLiteral = new RegExp(`['"\`]\\/(?:${SEG})\\/`);
  // a base glued to /api/v1 or to a path that stays put (the shared list) is fine
  const ok = ['api\\/v1', ...unversioned.map((u) => u.replace(/\//g, '\\/'))].join('|');
  const tmpl = new RegExp(isHtml ? `\\$\\{\\s*API\\s*\\}(?!\\/(?:${ok})\\b)` : `\\$\\{[^}]*\\b(apiBase|API_BASE|API_ORIGIN)\\b[^}]*\\}(?!\\/(?:${ok})\\b)`);
  const plus = new RegExp(`\\b(apiBase\\(\\)|apiBase|API_BASE|API_ORIGIN)\\s*\\+(?!\\s*['"\`]\\/(?:${ok})\\b)`);
  lines.forEach((l, i) => {
    const at = `${rel}:${i + 1}`;
    if (/\.(VITE_API_BASE|APS_API_BASE)\b/.test(l) && !RESOLVERS[rel]) out.push({ rule: 'R1', at, rel, line: l.trim() });
    if (literal.test(l) || (isHtml && htmlLiteral.test(l))) out.push({ rule: 'R2', at, rel, line: l.trim() });
    if (tmpl.test(l) || plus.test(l)) out.push({ rule: 'R3', at, rel, line: l.trim() });
    if (/(^|[^A-Za-z])buildUrl\(/.test(l) && rel.startsWith('apps/')) out.push({ rule: 'R4', at, rel, line: l.trim() });
  });
  // A mobile app client built on createTransport (@aipowersalon/mobile-sdk) builds every URL with buildApiUrl inside it.
  if (CLIENTS.includes(rel) && !/\bbuildApiUrl\(|\bcreateTransport\(/.test(code)) out.push({ rule: 'R4', at: rel, rel, line: 'the app client does not build with buildApiUrl' });
  return out;
}

export function scanProxies(repo = REPO) {
  const out = [];
  for (const a of APPS) {
    const p = join(repo, 'apps', a, 'vite.config.ts');
    if (!existsSync(p)) continue;
    const s = readFileSync(p, 'utf8');
    if (/proxy\s*:/.test(s) && !/['"^]\^?\/api\/v1/.test(s)) out.push({ rule: 'R5', at: `apps/${a}/vite.config.ts`, rel: `apps/${a}/vite.config.ts`, line: 'the dev proxy does not forward /api/v1' });
  }
  return out;
}

export function readAllowlist(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [spec, reason = ''] = l.split(/\s+#\s*/);
    const [file, rule] = spec.trim().split(/\s+/);
    return { file, rule, reason: reason.trim(), raw: l };
  });
}

export function evaluate(repo = REPO) {
  const segs = apiSegments(readFileSync(join(repo, 'apps/api/openapi/manifest.txt'), 'utf8'));
  const findings = [];
  const server = alternationOf(readFileSync(join(repo, 'apps/api/src/common/api-version.ts'), 'utf8'), 'NEVER_DEPRECATED');
  const client = alternationOf(readFileSync(join(repo, 'packages/api-client/src/api-version.ts'), 'utf8'), 'UNVERSIONED');
  for (const f of sourceFiles(repo)) findings.push(...scanSource(relative(repo, f), readFileSync(f, 'utf8'), segs, client ?? []));
  findings.push(...scanProxies(repo));
  for (const a of unscannedApps(repo)) findings.push({ rule: 'R7', at: `apps/${a}`, rel: `apps/${a}`, line: 'an app this gate does not scan — add it to APPS / HTML_APPS (or remove it: the Phase 15 legacy apps must not come back)' });
  if (!server || !client) findings.push({ rule: 'R6', at: 'api-version.ts', rel: '-', line: 'cannot read NEVER_DEPRECATED / UNVERSIONED' });
  else if (server.join('|') !== client.join('|')) findings.push({ rule: 'R6', at: 'api-version.ts', rel: '-', line: `server [${server.join('|')}] ≠ client [${client.join('|')}]` });
  const allow = existsSync(ALLOWLIST) ? readAllowlist(readFileSync(ALLOWLIST, 'utf8')) : [];
  const allowed = (f) => allow.some((a) => a.file === f.rel && a.rule === f.rule);
  const failures = findings.filter((f) => !allowed(f));
  const stale = allow.filter((a) => !findings.some((f) => f.rel === a.file && f.rule === a.rule));
  const unexplained = allow.filter((a) => !a.reason);
  return { segs, findings, failures, stale, unexplained, files: sourceFiles(repo).length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { failures, stale, unexplained, files, findings } = evaluate();
  console.log(`check:v1-clients: ${files} source files in ${APPS.length} apps + kiosk + booking-public + ${PACKAGES.length} packages; ${findings.length} finding(s), ${findings.length - failures.length} allow-listed`);
  const list = (t, xs, fmt) => { if (xs.length) { console.error(`\n${t} (${xs.length}):`); for (const x of xs.slice(0, 50)) console.error('  ' + fmt(x)); } };
  list('Calls that do not go to /api/v1 — use the app client (api.get / apiUrl / buildApiUrl)', failures, (f) => `${f.rule}  ${f.at}  ${f.line.slice(0, 160)}`);
  list('Allowlist entries that match nothing any more — remove them', stale, (a) => a.raw);
  list('Allowlist entries without a reason', unexplained, (a) => a.raw);
  process.exit(failures.length + stale.length + unexplained.length ? 1 : 0);
}
