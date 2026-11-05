// graph.mjs — Constitution 13 §160–161, §205, §229–230: the repository's dependency facts, computed from the source.
//
// Everything here is measured; nothing is a list someone maintains by hand. Used by run.mjs (the gate) and by the
// audit. Import-graph resolution is textual (from/import/require specifiers), directory-granular for apps/api/src —
// enough to see cycles and boundary violations, and cheap enough to run on every push.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const API = join(ROOT, 'apps/api/src');
const IMP = /(?:from|import)\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;
const SKIP = /node_modules|\/dist\/|\/www\//;
const TEST = /\.(spec|test|pgtest)\./;

export function walk(dir, pred = (f) => /\.(ts|tsx)$/.test(f) && !TEST.test(f) && !f.endsWith('.d.ts')) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, pred)); else if (pred(e)) out.push(p);
  }
  return out;
}

/** Platform-shaped directories inside apps/api/src — the ones the spec turns into packages/*. */
export const PLATFORM_DIRS = new Set(['common', 'database', 'observability', 'auth', 'audit', 'realtime', 'events', 'notifications', 'communications', 'payments', 'cache', 'health', 'config']);

/** Directory-level import graph of apps/api/src. */
export function apiGraph() {
  const g = new Map();
  for (const f of walk(API)) {
    const src = relative(API, f).split('/')[0];
    if (!g.has(src)) g.set(src, new Set());
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMP)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('.')) continue;
      const tgt = resolve(dirname(f), spec);
      if (!tgt.startsWith(API)) continue;
      const d = relative(API, tgt).split('/')[0];
      if (d && d !== src && existsSync(join(API, d)) && statSync(join(API, d)).isDirectory()) g.get(src).add(d);
    }
  }
  return g;
}

/** Tarjan: strongly connected components of size > 1. */
export function cycles(g) {
  let idx = 0; const index = new Map(), low = new Map(), stack = [], on = new Set(), out = [];
  const nodes = new Set([...g.keys(), ...[...g.values()].flatMap((s) => [...s])]);
  const visit = (v) => {
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
    for (const w of g.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) out.push(c.sort()); }
  };
  for (const v of nodes) if (!index.has(v)) visit(v);
  return out.sort((a, b) => b.length - a.length);
}

/** Platform directory → domain directory edges (the ones that create the cycle). */
export function backEdges(g) {
  const out = [];
  for (const [s, ts] of g) if (PLATFORM_DIRS.has(s)) for (const t of ts) if (!PLATFORM_DIRS.has(t)) out.push(`${s} -> ${t}`);
  return out.sort();
}


/** Every code root the API's server code now lives in: apps/api/src and each domain module's src (Constitution 13).
 *  A metric that walked apps/api alone went blind as code moved into modules — mirrored API types, provider
 *  directories and inline UTC-day idioms all fell for that reason, not because the code got better. */
function serverRoots() {
  const M = join(ROOT, 'modules');
  return [API, ...(existsSync(M) ? readdirSync(M).map((m) => join(M, m, 'src')).filter((d) => existsSync(d)) : [])];
}
/** A stable name for a file across roots: <dir>/<file> for grouped modules and the API; <module>/<file> for flat. */
function serverKey(f) {
  if (f.startsWith(API + '/')) return relative(API, f);
  const m = /\/modules\/([^/]+)\/src\/(.+)$/.exec(f); return m ? (m[2].includes('/') ? m[2] : `${m[1]}/${m[2]}`) : relative(ROOT, f);
}

const PROVIDER_URL = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|api\.twilio\.com|sendgrid\.com\/v3|api\.retellai|fiserv|cardconnect|cardpointe/i;
/** Directories that contain a provider endpoint — the boundary §106/§341 restricts. */
export function providerDirs() {
  const out = new Set();
  for (const root of serverRoots()) for (const f of walk(root)) if (PROVIDER_URL.test(readFileSync(f, 'utf8'))) out.add(serverKey(f).split('/')[0]);
  return [...out].sort();
}

const SDKS = ['openai', '@anthropic-ai/sdk', '@google/generative-ai', 'twilio', 'stripe', 'remote-pay-cloud', 'remote-pay-cloud-api', 'clover-ecomm-sdk', '@clover/sdk', 'cardpointe', 'fiserv', 'square', '@sendgrid/mail'];   // wave 3 PAYI §154: + the payment-device / processor SDKs

/** wave 3 PAYI §154 / §15 / §62: a FRONTEND (any app but the API, the kiosks, the shared UI packages) that talks to a
 *  payment processor, a payment terminal or Twilio directly — a provider endpoint in its source. Absolute: the only
 *  allowed provider callers are the server-side adapters (modules/payments, packages/notifications and friends). */
const FRONTEND_PROVIDER = /api\.twilio\.com|messaging\.twilio\.com|verify\.twilio\.com|sendgrid\.com\/v3|cardconnect\.com|cardpointe\.com|bolt[-.]?(uat|prod)?\.cardpointe|scl\.clover\.com|api\.clover\.com|sandbox\.dev\.clover\.com|commercehub|fiserv\.com/i;
/** A file counts when a provider host appears in CODE — not in a comment, a placeholder hint or help text. */
const providerCallIn = (text) => text.split('\n').some((l) => FRONTEND_PROVIDER.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l) && !/placeholder\s*=/.test(l) && !/^\s*(title|aria-label|children)\s*=/.test(l));
export function frontendProviderCalls() {
  const out = [];
  for (const app of readdirSync(join(ROOT, 'apps'))) {
    if (app === 'api') continue;
    const dir = join(ROOT, 'apps', app, 'src');
    if (!existsSync(dir)) continue;
    for (const f of walk(dir)) if (providerCallIn(readFileSync(f, 'utf8'))) out.push(relative(ROOT, f));
  }
  for (const pkg of ['ui', 'api-client', 'realtime-client', 'mobile-sdk', 'web-push']) {
    const dir = join(ROOT, 'packages', pkg, 'src');
    if (!existsSync(dir)) continue;
    for (const f of walk(dir)) if (providerCallIn(readFileSync(f, 'utf8'))) out.push(relative(ROOT, f));
  }
  return [...new Set(out)].sort();
}
/** Direct provider-SDK imports anywhere outside an allowed adapter directory (§107). */
export function sdkImports(allowed = new Set()) {
  const out = [];
  for (const base of ['apps', 'packages', 'modules']) for (const f of walk(join(ROOT, base))) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMP)) { const s = m[1] ?? m[2]; if (SDKS.some((k) => s === k || s.startsWith(k + '/'))) { const rel = relative(ROOT, f); if (![...allowed].some((a) => rel.startsWith(a))) out.push(`${rel} imports ${s}`); } }
  }
  return out.sort();
}

/** Any import from a frontend app or package into apps/api (§109 — the monorepo is not a shared runtime). */
export function frontendToBackend() {
  const out = [];
  for (const app of readdirSync(join(ROOT, 'apps'))) {
    if (app === 'api') continue;
    for (const f of walk(join(ROOT, 'apps', app, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(IMP)) {
        const s = m[1] ?? m[2];
        if (s === '@aipowersalon/api' || s.startsWith('@aipowersalon/api/') || (s.startsWith('.') && resolve(dirname(f), s).startsWith(join(ROOT, 'apps/api')))) out.push(relative(ROOT, f));
      }
    }
  }
  for (const f of walk(join(ROOT, 'packages'))) for (const m of readFileSync(f, 'utf8').matchAll(IMP)) { const s = m[1] ?? m[2]; if (s.startsWith('.') && resolve(dirname(f), s).startsWith(join(ROOT, 'apps'))) out.push(relative(ROOT, f)); }
  return [...new Set(out)].sort();
}

/** Deep imports into another workspace package's internals (§98): `@aipowersalon/x/src/...` or `../../packages/x/src/...`. */
export function deepImports() {
  const out = [];
  for (const base of ['apps', 'packages', 'modules']) for (const f of walk(join(ROOT, base))) {
    // apps/*/scripts are dev verification harnesses that deliberately drive a module's INTERNALS (repositories, the
    // Kysely types) against PGlite — test tooling, which §93 lets depend on everything. Production code may not.
    if (/\/apps\/[^/]+\/scripts\//.test(f)) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(IMP)) {
      const s = m[1] ?? m[2];
      if (/^@aipowersalon\/[^/]+\/src\//.test(s) || /packages\/[^/]+\/src\//.test(s) || /modules\/[^/]+\/src\//.test(s)) out.push(`${relative(ROOT, f)}: ${s}`);
    }
  }
  return out.sort();
}

/** Byte-identical source files present in two or more apps (§207 duplicate inventory). */
export function identicalAcrossApps() {
  const byHash = new Map();
  for (const app of readdirSync(join(ROOT, 'apps'))) for (const f of walk(join(ROOT, 'apps', app, 'src'))) {
    const buf = readFileSync(f); if (buf.length < 400) continue;
    const h = createHash('md5').update(buf).digest('hex');
    if (!byHash.has(h)) byHash.set(h, []); byHash.get(h).push({ app, rel: relative(join(ROOT, 'apps', app, 'src'), f) });
  }
  return [...byHash.values()].filter((v) => new Set(v.map((x) => x.app)).size > 1).map((v) => ({ file: v[0].rel, apps: [...new Set(v.map((x) => x.app))].sort() })).sort((a, b) => b.apps.length - a.apps.length || a.file.localeCompare(b.file));
}

/** Constitution 13 §388 / BUILD_PLAN Phase 15 (Oct 10 2026): removed under the zero-importer rule (D8) — each had a wired
 *  replacement (go-check-in-admin → admin-web /check-in-devices; booking-html → customer-web Book; booking-schedule-html →
 *  pos-web /tenant/booking) or was superseded history (_MERGE_ARTIFACTS, HANDOFF → git history at 62a1875d, and
 *  NEW_CHAT_HANDOFF_2026-10-05.md / START-HERE.md / docs/handoff). Absolute rule: none of them may come back. */
export const RETIRED_PATHS = ['apps/booking-html', 'apps/booking-schedule-html', 'apps/go-check-in-admin', '_MERGE_ARTIFACTS', 'HANDOFF'];
export function retiredPathsPresent(root = ROOT) { return RETIRED_PATHS.filter((p) => existsSync(join(root, p))); }

export function nestedLockfiles() {
  const out = [];
  for (const base of ['apps', 'packages', 'modules']) { const d = join(ROOT, base); if (!existsSync(d)) continue; for (const e of readdirSync(d)) if (existsSync(join(d, e, 'package-lock.json'))) out.push(`${base}/${e}/package-lock.json`); }
  return out.sort();
}


const EXPORTED_TYPE = /^export (?:interface|type) ([A-Z][A-Za-z0-9]*)\b/gm;
const exportedTypeNames = (dirs, pred) => { const out = new Map(); for (const d of dirs) for (const f of walk(d, pred)) for (const m of readFileSync(f, 'utf8').matchAll(EXPORTED_TYPE)) { if (!out.has(m[1])) out.set(m[1], []); out.get(m[1]).push(relative(ROOT, f)); } return out; };
const frontendApps = () => readdirSync(join(ROOT, 'apps')).filter((a) => a !== 'api' && existsSync(join(ROOT, 'apps', a, 'src')));

/** §13–15: the contracts package is the one definition of an API type — so a frontend re-declaring any of them is a defect. */
export function contractRedeclarations() {
  const contracts = exportedTypeNames([join(ROOT, 'packages/api-contracts/src')], (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const out = [];
  for (const app of frontendApps()) for (const [name, where] of exportedTypeNames([join(ROOT, 'apps', app, 'src')])) if (contracts.has(name)) out.push(`${where[0]} re-declares ${name}`);
  return out.sort();
}

/** The backlog: exported frontend type names that mirror an exported apps/api type (ratchets down as domains migrate). */
/** Constitution 13 Phase 8: every interval scheduler in server code decides at start-up whether THIS process runs it
 *  (runsBackgroundJob from @aipowersalon/config), so the API can run as a pure web process and workers as separate
 *  processes. The process-LOCAL schedulers run in every process by design and are named here with their reason. */
export const PROCESS_LOCAL_SCHEDULERS = {
  'observability/http-metrics.ts': 'flushes THIS process\'s request metrics',
  'realtime/platform-live-ops.ts': 'realtime presence held in THIS process',
  'super-admin-database/slow-query-flush.scheduler.ts': 'flushes THIS process\'s in-memory slow-query samples (BUILD_PLAN Phase 10)',
  'observability/process-heartbeat.ts': 'reports THIS process\'s build, memory / CPU and registry digest (BUILD_PLAN Phase 14 B)',
  'observability/security-signals.ts': 'reads THIS process\'s webhook-rejection counters and ITS view of MAINTENANCE_BREAK_GLASS; the incident write is deduplicated fleet-wide (BUILD_PLAN Phase 14 C)',
};
export function ungatedSchedulers() {
  const out = [];
  for (const root of serverRoots()) for (const f of walk(root)) {
    const src = readFileSync(f, 'utf8');
    if (!/\bsetInterval\(/.test(src)) continue;
    const key = serverKey(f);
    if (PROCESS_LOCAL_SCHEDULERS[key]) continue;
    if (!/\brunsBackgroundJob\(\s*'(critical|standard|ai|report|import|reconciliation)'\s*\)/.test(src)) out.push(key);
  }
  return out.sort();
}

/** Constitution 13 Phase 9 (§280, §343): a domain module reaches realtime ONLY through the RealtimeEmitter port — never
 *  a room string, never rooms.* (room naming belongs to the gateway), never the gateway/bus itself. */
export function moduleRealtimeLeaks() {
  const out = [];
  const M = join(ROOT, 'modules');
  if (!existsSync(M)) return out;
  for (const m of readdirSync(M)) for (const f of walk(join(M, m, 'src'))) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
    const key = serverKey(f);
    if (/\brooms\.[a-zA-Z]+\(/.test(src)) out.push(`${key}: rooms.*`);
    // a room string HANDED to realtime (not a cache key or an event correlation id, which share the "ticket:<id>" shape)
    if (/\b(?:room|rooms|emit\w*|publish\w*|broadcast\w*|subscribe\w*)\s*[:(=,]\s*['"`](?:tenant|branch|technician|ticket|customer|customer-display|owner|platform):\$\{/.test(src)) out.push(`${key}: room string`);
    if (/realtime\.gateway|realtime-bus|InProcessEmitter|RedisRealtimeEmitter/.test(src)) out.push(`${key}: gateway/bus`);
  }
  return out.sort();
}
/** §343: the target is domain event -> realtime projection; a domain service calling the emitter port directly is the
 *  pattern to shrink. Counted per file (shrink-only baseline) so each conversion to an event + projection lowers it. */
export function moduleDirectEmissions() {
  // UNGATED direct emitter calls only. A call inside `if (!this.repo.emitsDomainEvents?.()) { ... }` (or below an early
  // `if (this.emitsDomainEvents()) return;`) is the dual path: the domain event + projection deliver it whenever the
  // publisher is on, and the direct push is the fallback when it is off (6f3b0ed). Counting those as §343 debt made the
  // number unreachable. Same guard logic as scripts/audit-realtime-pushes.mjs, over every module file.
  const GUARD = /if\s*\(\s*!\s*this\.(\w+\??\.)?emitsDomainEvents\s*\??\s*\.?\s*\(\s*\)\s*\)/;   // `this.payroll?.emitsDomainEvents?.()` — an optional collaborator counts
  const EARLY = /if\s*\(\s*this\.(\w+\??\.)?emitsDomainEvents\s*\??\s*\.?\s*\(\s*\)\s*\)\s*return\s*;/;
  // toCustomerDisplayDevice is optional on the port, so its calls are `?.(` — counted too, or the new channel is a blind spot
  const CALL = /\.(toTenant|toTechnician|toTicket|toCustomerDisplay|toOwner|toPlatform|toCustomer)\(|\.toCustomerDisplayDevice\??\.?\(/g;
  const out = [];
  const M = join(ROOT, 'modules');
  if (!existsSync(M)) return out;
  for (const m of readdirSync(M)) for (const f of walk(join(M, m, 'src'))) {
    const lines = readFileSync(f, 'utf8').split('\n');
    let guardDepth = null, depth = 0, n = 0, prev = '';
    for (const line of lines) {
      if (GUARD.test(line)) guardDepth = depth;
      if (EARLY.test(line)) guardDepth = depth - 1;
      const calls = (line.match(CALL) || []).length;
      // not debt: (a) a one-line private wrapper's own body (its CALL SITES are what get counted — counting both was
      // double); (b) a push marked `§343 exempt: <reason>` on its line or the line above — a momentary screen signal
      // ("processing…", "total recalculated") that is not a business fact and has no business being a durable event.
      const wrapperDef = /^\s*(?:private|protected|public)\s+(?:async\s+)?\w+\s*\([^)]*\)[^{]*\{.*\b(?:realtime|rt)\??\.to\w+\(/.test(line);
      const exempt = /§343 exempt: \S/.test(line) || /§343 exempt: \S/.test(prev);
      if (calls && guardDepth === null && !wrapperDef && !exempt) n += calls;
      prev = line;
      for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') { depth--; if (guardDepth !== null && depth <= guardDepth) guardDepth = null; } }
    }
    if (n) out.push(`${serverKey(f)}:${n}`);
  }
  return out.sort();
}

/** Constitution 13 Phase 11: a CI gate that walks the API's source must also walk the modules. Six gates went blind as
 *  code moved (the SQL gate prepared 119 of 2,178 statements and still passed); this makes the blind spot a CI failure.
 *  Signal: the script walks a directory tree AND names apps/api's src, so it must also name a module root in CODE (a
 *  comment mentioning "modules" does not count — full-line and block comments are stripped first). */
export function blindGateScripts() {
  const out = [];
  const files = new Set();
  for (const [pkg, base] of [[join(ROOT, 'apps/api/package.json'), join(ROOT, 'apps/api')], [join(ROOT, 'package.json'), ROOT]]) {
    if (!existsSync(pkg)) continue;
    for (const cmd of Object.values(JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {})) for (const m of String(cmd).matchAll(/node\s+([\w./-]+\.mjs)/g)) files.add(join(base, m[1]));
  }
  for (const f of files) {
    if (!existsSync(f)) continue;
    // strip comment LINES only (//, /**, *, */): a regex over block comments is fooled by globs like 'src/**/*.ts'
    const code = readFileSync(f, 'utf8').replace(/^\s*(\/\/|\/\*|\*).*$/gm, '');
    const walks = /readdirSync|function walk|\bwalk\(/.test(code);
    const apiSrc = /['"]\.\.\/src\/?['"]|join\(\s*\w+\s*,\s*'src'\s*\)/.test(code);
    // a PATH to the modules ('../../../modules', 'modules/<m>/src', join(ROOT, 'modules')) — not the word in a message
    const moduleRoot = /['"`][^'"`\n]*(?:\/modules\b|\bmodules\/)[^'"`\n]*['"`]|['"`]modules['"`]/.test(code);
    if (walks && apiSrc && !moduleRoot) out.push(relative(ROOT, f));
  }
  return out.sort();
}

/** Domain events DECLARED in the event contract that no code records — the domain-event twin of the realtime gate's
 *  NO PRODUCER class. A consumer or projection waiting on one waits forever (followup.customer_replied had a projection
 *  mapping and no producer). Producer = any non-consumer server file naming DOMAIN_EVENTS.<KEY> or the event's value.
 *  Shrink-only: a NEW declared-but-unproduced event fails; producing one lowers it. */
export function unproducedDomainEvents() {
  const contract = join(ROOT, 'packages/events/src/event-contract.ts');
  if (!existsSync(contract)) return [];
  const c = readFileSync(contract, 'utf8');
  const start = c.indexOf('export const DOMAIN_EVENTS = {');
  const block = c.slice(start, c.indexOf('} as const;', start));
  const pairs = [...block.matchAll(/^\s+([A-Z_]+):\s*'([a-z_.]+)'/gm)].map((m) => [m[1], m[2]]);
  const CONSUMER = /events\/consumers\/|platform-live-ops|consumer\.ts$|event-ops|event-replay/;
  const texts = [];
  for (const root of [...serverRoots(), join(ROOT, 'packages')]) for (const f of walk(root)) {
    if (f.endsWith('event-contract.ts') || CONSUMER.test(f) || /\.(spec|test)\.ts$/.test(f)) continue;
    texts.push(readFileSync(f, 'utf8'));
  }
  const all = texts.join('\n');
  return pairs.filter(([k, v]) => !new RegExp(`DOMAIN_EVENTS\\.${k}\\b`).test(all) && !all.includes(`'${v}'`) && !all.includes(`"${v}"`) && !all.includes('`' + v + '`')).map(([k]) => k).sort();
}

/** A provider built from DATABASE_READ (the read-REPLICA handle) must not construct a class that WRITES. Today the read
 *  handle falls back to the primary because no replica is configured, so such a repository works — until
 *  DATABASE_REPLICA_URL is set, and every write it makes fails on a read-only replica. Eleven were found this way
 *  (time clock, invoices, reviews, referrals, social, salon promotions, five deposit-reconciliation repositories). */
export function writersOnReadReplica() {
  const out = [];
  for (const root of serverRoots()) for (const f of walk(root)) {
    if (!f.endsWith('.module.ts')) continue;
    const src = readFileSync(f, 'utf8');
    for (const line of src.split('\n')) {
      if (!/inject:\s*\[\s*DATABASE_READ\b/.test(line)) continue;
      for (const [, cls] of line.matchAll(/new (Kysely\w+)\(/g)) {
        const dir = dirname(f);
        for (const g of walk(dir)) {
          const t = readFileSync(g, 'utf8');
          if (!new RegExp(`export class ${cls}\\b`).test(t)) continue;
          const body = t.slice(t.search(new RegExp(`export class ${cls}\\b`)));
          const end = body.search(/\nexport class /);
          const cls_src = end > 0 ? body.slice(0, end) : body;
          if (/\.(insertInto|updateTable|deleteFrom)\(|\b(INSERT INTO|DELETE FROM)\b|\bUPDATE \w+ SET\b/.test(cls_src)) out.push(`${serverKey(f)} -> ${cls}`);
        }
      }
    }
  }
  return [...new Set(out)].sort();
}

export function mirroredApiTypes() {
  // The API's contract surface is apps/api/src AND every domain module (Constitution 13 moved most API types into
  // modules/*/src). Counting apps/api alone made this metric fall from 104 to 9 largely because the API's own types left
  // it — the check had gone blind, not the apps clean.
  const M = join(ROOT, 'modules');
  const moduleSrcs = existsSync(M) ? readdirSync(M).map((m) => join(M, m, 'src')).filter((d) => existsSync(d)) : [];
  const apiNames = exportedTypeNames([API, ...moduleSrcs]);
  const out = [];
  for (const app of frontendApps()) for (const [name] of exportedTypeNames([join(ROOT, 'apps', app, 'src')])) if (apiNames.has(name)) out.push(`${app}:${name}`);
  return out.sort();
}

/** §13 puts runtime contracts (pagination bounds, error codes, enums) beside the types, so the package is built like
 *  the others and apps/api consumes it compiled (dist — so its runtime code cannot move the API's rootDir). What must
 *  hold instead (§111: browser-safe, dependency-free): NOTHING in it imports from outside the package — no node
 *  built-ins, no packages, no relative path that leaves src/. */
export function contractsExternalImports() {
  const d = join(ROOT, 'packages/api-contracts/src');
  const out = [];
  for (const f of walk(d, (x) => /\.(ts|tsx)$/.test(x) && !/\.test\.ts$/.test(x))) for (const m of readFileSync(f, 'utf8').matchAll(IMP)) {
    const s = m[1] ?? m[2];
    if (!s.startsWith('.') || !resolve(dirname(f), s).startsWith(d)) out.push(`${relative(ROOT, f)} imports ${s}`);
  }
  return out.sort();
}

/** §14 / §361: customer-facing apps may import only customer-safe contract realms. */
// §14, §361–364: customer apps see only the customer realm; tenant apps (POS, owner, tech, tap-to-pay) never the platform realm.
const REALM_FORBIDDEN = { 'customer-web': ['tenant', 'platform'], 'customer-display': ['tenant', 'platform'], 'pos-web': ['platform'], 'owner-web': ['platform'], 'tech-web': ['platform'], 'manager-pay-web': ['platform'] };
export function realmViolations() {
  const out = [];
  for (const [app, bad] of Object.entries(REALM_FORBIDDEN)) for (const f of walk(join(ROOT, 'apps', app, 'src'))) for (const m of readFileSync(f, 'utf8').matchAll(IMP)) {
    const s = m[1] ?? m[2]; const r = /^@aipowersalon\/api-contracts\/([a-z-]+)/.exec(s);
    if (r && bad.includes(r[1])) out.push(`${relative(ROOT, f)} imports the ${r[1]} realm`);
  }
  return out.sort();
}


/** §91: the test package must never become a production dependency — only *.test.ts / *.spec.ts files may import it. */
export function productionImportsOfTesting() {
  const out = [];
  for (const base of ['apps', 'packages', 'modules']) for (const f of walk(join(ROOT, base))) {
    if (/\.(test|spec)\.(ts|tsx)$/.test(f) || f.includes('/packages/testing/')) continue;
    for (const m of readFileSync(f, 'utf8').matchAll(IMP)) { const s = m[1] ?? m[2]; if (/^@aipowersalon\/testing(\/|$)/.test(s)) out.push(relative(ROOT, f)); }
  }
  return out.sort();
}

/** A test that finds migrations relative to its own file or the working directory resolves nowhere once its domain is
 *  a module: beforeAll throws and vitest reports the whole file SKIPPED, not failed (gift-card clearing, sms-packages).
 *  The one place migrations are located is MIGRATIONS_DIR from @aipowersalon/database. */
export function relativeMigrationLocators() {
  const out = [];
  for (const base of ['apps/api/src', 'modules', 'packages']) for (const f of walk(join(ROOT, base), (x) => /\.(ts|mts|mjs)$/.test(x))) {
    if (f.includes('/packages/database/') || f.includes('/packages/testing/')) continue;   // the two that define it
    const s = readFileSync(f, 'utf8');
    if (/(?:__dirname|process\.cwd\(\))[^;\n]*migrations|['"`](?:\.\.\/)+db\/migrations/.test(s)) out.push(relative(ROOT, f));
  }
  return out.sort();
}

/** The Dockerfile's RUNTIME stage must ship every workspace the API depends on: node_modules/@aipowersalon/* are
 *  symlinks into packages/ and modules/, so a runtime stage that copies node_modules but not those directories boots
 *  into "Cannot find module". Returns the API's workspace dependencies whose base directory the runtime stage does not copy. */
export function runtimeStageMissingWorkspaces() {
  const df = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  const stages = df.split(/^FROM /m);
  const run = stages[stages.length - 1];
  const copied = [...run.matchAll(/^COPY --from=\S+\s+(\S+)/gm)].map((m) => m[1].replace(/\/$/, ''));
  const deps = Object.keys(JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8')).dependencies ?? {}).filter((d) => d.startsWith('@aipowersalon/'));
  const out = [];
  for (const d of deps) {
    const short = d.slice('@aipowersalon/'.length);
    const base = existsSync(join(ROOT, 'modules', short)) ? 'modules' : 'packages';
    const dir = `/app/${base}/${short}`;
    if (!copied.some((c) => dir === c || dir.startsWith(c + '/'))) out.push(`${d} (${dir})`);
  }
  return out.sort();
}

/** Compiled output beside its source (x.js / x.d.ts next to x.ts in a package's or module's src/) is shadowed at BUILD
 *  time but WINS at test time: Vite resolves .js before .ts, so tests ran a stale compiled mask.js that predated
 *  secretLast4 ("secretLast4 is not a function") while tsc checked the source. Committed by accident in e7eb38a. */
export function compiledSiblingsInSrc() {
  const out = [];
  for (const base of ['packages', 'modules']) {
    if (!existsSync(join(ROOT, base))) continue;
    for (const p of readdirSync(join(ROOT, base))) {
      const src = join(ROOT, base, p, 'src');
      if (!existsSync(src)) continue;
      for (const f of walk(src, (x) => /\.(js|d\.ts)$/.test(x))) {
        const stem = f.replace(/\.d\.ts$/, '').replace(/\.js$/, '');
        if (existsSync(stem + '.ts') || existsSync(stem + '.tsx')) out.push(relative(ROOT, f));
      }
    }
  }
  return out.sort();
}

/** §105: domain modules may depend on each other's public entries, never in a cycle. build-modules.mjs refuses a cycle
 *  at build time; this makes it an architecture failure too (tech into workforce and customer into customers each
 *  closed one — queue <-> workforce, customers <-> queue). Returns each cycle found, as "a -> b -> a". */
export function moduleCycles() {
  const M = join(ROOT, 'modules');
  if (!existsSync(M)) return [];
  const mods = readdirSync(M).filter((m) => existsSync(join(M, m, 'package.json')));
  const pkg = (m) => JSON.parse(readFileSync(join(M, m, 'package.json'), 'utf8'));
  const byName = new Map(mods.map((m) => [pkg(m).name, m]));
  const deps = new Map(mods.map((m) => [m, Object.keys(pkg(m).dependencies ?? {}).filter((d) => byName.has(d)).map((d) => byName.get(d))]));
  const out = new Set(); const state = new Map();
  const visit = (m, path) => {
    if (state.get(m) === 'done') return;
    if (state.get(m) === 'on') { const c = path.slice(path.indexOf(m)); out.add([...c, m].join(' -> ')); return; }
    state.set(m, 'on');
    for (const d of deps.get(m)) visit(d, [...path, m]);
    state.set(m, 'done');
  };
  for (const m of mods.sort()) visit(m, []);
  return [...out].sort();
}

/** §72: no app implements its own currentTenant logic. A production file that hand-builds a system/worker context
 *  ({ userId: 'system…', role: 'system' | 'SYSTEM' }) instead of calling systemContext() from @aipowersalon/tenant-context.
 *  Ratcheted: the remaining hand-built shapes (audit actors, typed recon contexts) are in the baseline and may only shrink. */
export function handBuiltSystemContexts() {
  const out = [];
  for (const base of ['apps/api/src', 'modules', 'packages']) for (const f of walk(join(ROOT, base))) {
    if (f.includes('/packages/tenant-context/')) continue;
    const s = readFileSync(f, 'utf8');
    if (/role:\s*['"](system|SYSTEM)['"]/.test(s) && !/messages:\s*\[/.test(s)) out.push(relative(ROOT, f));
  }
  return out.sort();
}

/** Every workspace package must be in the root lockfile — otherwise `npm ci` refuses the tree and runtime requires fail. */
export function unregisteredWorkspaces() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const base of ['apps', 'packages', 'modules']) {
    const d = join(ROOT, base); if (!existsSync(d)) continue;
    for (const e of readdirSync(d)) if (existsSync(join(d, e, 'package.json')) && !lock.packages?.[`${base}/${e}`]) out.push(`${base}/${e}`);
  }
  return out.sort();
}

/** §87: ad-hoc date logic. toISOString().slice(0, 10) is the UTC day, not a salon's day — named as utcDate() in
 *  @aipowersalon/date-time and ratcheted down here; businessDate(tz) is the salon's day. */
export function inlineUtcDayIdioms() {
  const out = [];
  for (const root of serverRoots()) for (const f of walk(root)) { const n = (readFileSync(f, 'utf8').match(/toISOString\(\)\.slice\(0,\s*10\)/g) || []).length; if (n) out.push(`${serverKey(f)}:${n}`); }
  return out.sort();
}

/**
 * Unit 9 (Oct 6 2026): the DATABASE's or the SERVER's day — `date_trunc('day'|'week'|'month'|'year', now())`, `current_date`,
 * `now()::date`, `setHours(0, 0, 0, 0)`, `at time zone 'UTC'`, a timestamp's `created_at::date` — is UTC, not a salon's: after 8 pm in New York it is already tomorrow. Salon-facing
 * code uses the branch's day (dayStartMs / monthStartMs / businessDate from @aipowersalon/date-time, or `at time zone`).
 * What remains is platform-wide (Super Admin) or not yet moved; ratcheted per file — a file may only go down.
 */
const SERVER_UTC_DAY = /date_trunc\(\s*'(?:day|week|month|year)'\s*,\s*(?:now\(\)|current_date|current_timestamp)\s*\)|\bcurrent_date\b|\bnow\(\)::date\b|\.setHours\(0,\s*0,\s*0,\s*0\)|\bat\s+time\s+zone\s+'utc'|\w_at::date\b/gi;
export function serverUtcDayIdioms() {
  const out = {};
  for (const root of serverRoots()) for (const f of walk(root)) {
    const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1').replace(/--[^\n`]*/g, '');
    const n = (code.match(SERVER_UTC_DAY) || []).length; if (n) out[serverKey(f)] = n;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** §105: a domain module depends on packages only — never on apps/ (and never on another module by relative path). */
export function modulesImportingApps() {
  const out = [];
  const md = join(ROOT, 'modules'); if (!existsSync(md)) return out;
  for (const f of walk(md)) for (const m of readFileSync(f, 'utf8').matchAll(IMP)) {
    const s = m[1] ?? m[2];
    if (s === '@aipowersalon/api' || s.startsWith('@aipowersalon/api/') || (s.startsWith('.') && resolve(dirname(f), s).startsWith(join(ROOT, 'apps')))) out.push(`${relative(ROOT, f)}: ${s}`);
    if (s.startsWith('.') && resolve(dirname(f), s).startsWith(md) && !resolve(dirname(f), s).startsWith(dirname(f).split('/src/')[0])) out.push(`${relative(ROOT, f)}: ${s} (relative import into another module)`);
  }
  return out.sort();
}

export function measure() {
  const g = apiGraph(); const sccs = cycles(g);
  return {
    apiDirs: g.size, apiEdges: [...g.values()].reduce((a, s) => a + s.size, 0),
    largestCycle: sccs[0]?.length ?? 0, cycleCount: sccs.length,
    backEdges: backEdges(g), providerDirs: providerDirs(), sdkImports: sdkImports(), frontendProviderCalls: frontendProviderCalls(),
    frontendToBackend: frontendToBackend(), deepImports: deepImports(),
    identicalGroups: identicalAcrossApps(), nestedLockfiles: nestedLockfiles(), retiredPathsPresent: retiredPathsPresent(),
    contractRedeclarations: contractRedeclarations(), mirroredApiTypes: mirroredApiTypes(), ungatedSchedulers: ungatedSchedulers(), moduleRealtimeLeaks: moduleRealtimeLeaks(), moduleDirectEmissions: moduleDirectEmissions(), blindGateScripts: blindGateScripts(), unproducedDomainEvents: unproducedDomainEvents(), writersOnReadReplica: writersOnReadReplica(),
    contractsExternalImports: contractsExternalImports(), realmViolations: realmViolations(),
    unregisteredWorkspaces: unregisteredWorkspaces(), inlineUtcDayIdioms: inlineUtcDayIdioms(), serverUtcDayIdioms: serverUtcDayIdioms(), modulesImportingApps: modulesImportingApps(), productionImportsOfTesting: productionImportsOfTesting(), relativeMigrationLocators: relativeMigrationLocators(), runtimeStageMissingWorkspaces: runtimeStageMissingWorkspaces(), compiledSiblingsInSrc: compiledSiblingsInSrc(), moduleCycles: moduleCycles(), handBuiltSystemContexts: handBuiltSystemContexts(),
  };
}
