#!/usr/bin/env node
// audit-realtime-infra-duplicates.mjs — before landing Constitution 9 on another tree (Power-Salon-main), find
// every realtime concept that tree ALREADY has, so the merge reuses and hardens instead of adding a second
// gateway, a second client, a second registry, or a second authorization version (Kevin's rule: no *_v2 without an
// architectural reason).
//
//   node scripts/audit-realtime-infra-duplicates.mjs                      # this tree
//   node scripts/audit-realtime-infra-duplicates.mjs --root=/path/to/tree # any tree (read-only)
//   … --json                                                              # machine-readable
//
// Read-only, no imports from src. Control: in this tree every concept resolves to the ONE implementation this arc
// left (one factory, one package, one registry, one authz source) — REALTIME_MERGE_GUIDE.md says what to do when
// the other tree has a second one.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv.find((a) => a.startsWith('--root='))?.slice(7) ?? new URL('../../..', import.meta.url).pathname;
const JSON_OUT = process.argv.includes('--json');
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build', '.next']);

const CONCEPTS = [
  // `expected` = what THIS tree legitimately has after Constitution 9. More than that in a merged tree = a duplicate to resolve.
  // Patterns match DEFINITIONS (a class, a registry, an endpoint), never consumers — importing a concept is not duplicating it.
  { key: 'sse_endpoint',       label: 'SSE stream endpoints (@Sse)',                 expected: 6, re: /@Sse\(\s*['"][^'"]*['"]\s*\)/g,                                              ext: /\.ts$/ },
  { key: 'handrolled_stream',  label: 'SSE endpoint NOT using RealtimeStreamFactory', expected: 0, re: /@Sse\(/g, ext: /\.ts$/, unless: /RealtimeStreamFactory/ },
  { key: 'websocket',          label: 'WebSocket / Socket.IO gateway or client',      expected: 0, re: /@WebSocketGateway|from\s+['"](socket\.io|socket\.io-client|ws)['"]|new WebSocket\(/g, ext: /\.(ts|tsx|js|mjs)$/ },
  { key: 'stream_factory',     label: 'Stream factory / gateway class',               expected: 1, re: /\bclass\s+\w*(StreamFactory|RealtimeGateway|RealtimeHub)\w*\b/g,               ext: /\.ts$/ },
  { key: 'event_registry',     label: 'Client event registry (EVENTS map)',           expected: 2, re: /export const EVENTS\s*=\s*\{/g,                                              ext: /\.(ts|tsx)$/ },
  { key: 'event_versions',     label: 'Realtime EVENT_VERSIONS map',                  expected: 2, re: /export const EVENT_VERSIONS\s*:\s*Record<EventName/g,                       ext: /\.(ts|tsx)$/ },
  { key: 'screen_routing',     label: 'Event → screen routing (AFFECTS definition)',  expected: 2, re: /\bconst AFFECTS\s*:/g,                                                      ext: /\.(ts|tsx)$/ },
  { key: 'seq_tracker',        label: 'SequenceTracker class',                        expected: 1, re: /\bclass SequenceTracker\b/g,                                                ext: /\.(ts|tsx)$/ },
  { key: 'seq_key',            label: 'Redis sequence key definition',                expected: 1, re: /aps:rt:seq:/g,                                                             ext: /\.ts$/ },
  { key: 'redis_fanout',       label: 'Redis fan-out emitter class',                  expected: 1, re: /\bclass\s+\w*(RedisRealtimeEmitter|RealtimeBus)\w*\b/g,                    ext: /\.ts$/ },
  { key: 'presence',           label: 'Presence store / service classes',             expected: 1, re: /\bclass\s+PresenceService\b/g,                                              ext: /\.ts$/ },
  // BUILD_PLAN Phase 9: users / tenants.authorization_version (migration 530, trigger-bumped) IS the one authorization
  // version — the stream source (KyselyAuthzVersionSource) and the HTTP request path both READ it — so its name is no
  // longer a duplicate signal; any OTHER version column or a second source class still is.
  { key: 'authz_version',      label: 'Authorization version (column or source)',     expected: 1, re: /\bclass\s+\w*AuthzVersionSource\b|\b(authz_version|permissions_version|permission_version|role_version)\b/g, ext: /\.(ts|sql)$/ },
  { key: 'session_guard',      label: 'Session-revocation stream guard definition',   expected: 1, re: /export function untilSessionRevoked/g,                                     ext: /\.ts$/ },
  { key: 'connect_limiter',    label: 'Connect limiter class',                        expected: 1, re: /\bclass\s+\w*(ConnectLimiter|ConnectionLimiter|ReconnectLimiter)\w*\b/g,    ext: /\.(ts|tsx)$/ },
  { key: 'slow_client',        label: 'Slow-client gate class',                       expected: 1, re: /\bclass\s+\w*(SlowClientGate|Backpressure)\w*\b/g,                          ext: /\.ts$/ },
  { key: 'origin_allowlist',   label: 'Origin allow-list definition',                 expected: 1, re: /export function computeAllowedOrigins|const allowedOrigins\s*=\s*\[/g,       ext: /\.ts$/ },
  { key: 'client_package',     label: 'Shared realtime client (createRealtimeClient)', expected: 1, re: /export function createRealtimeClient/g,                                  ext: /\.(ts|tsx)$/ },
  { key: 'handrolled_client',  label: 'Hand-rolled EventSource client (outside the package)', expected: 0, re: /new EventSource\(/g, ext: /\.(ts|tsx)$/, exclude: /packages\/realtime-client\// },
  { key: 'fallback_poll',      label: 'FallbackPoller class',                         expected: 1, re: /\bclass FallbackPoller\b/g,                                                 ext: /\.(ts|tsx)$/ },
  { key: 'platform_stream',    label: 'Platform live-ops service',                    expected: 1, re: /\bclass PlatformLiveOpsService\b/g,                                         ext: /\.ts$/ },
  { key: 'health_eval',        label: 'Realtime health evaluator',                    expected: 1, re: /export function evaluateRealtimeHealth/g,                                  ext: /\.ts$/ },
  { key: 'contract_gate',      label: 'Realtime CI contract gate script',             expected: 1, re: /Realtime CI Contract/g,                                                    ext: /\.mjs$/ },
];

function walk(dir, out = []) {
  let entries; try { entries = readdirSync(dir); } catch { return out; }
  for (const n of entries) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(ROOT).filter((f) => !/\.(spec|test)\.tsx?$/.test(f) && !f.includes('/scripts/audit-realtime-infra-duplicates'));
const findings = {};
for (const c of CONCEPTS) findings[c.key] = { label: c.label, files: new Map() };
for (const f of files) {
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  for (const c of CONCEPTS) {
    if (!c.ext.test(f)) continue;
    if (c.exclude && c.exclude.test(f)) continue;
    if (c.unless && c.unless.test(text)) continue;
    c.re.lastIndex = 0; let m; const lines = [];
    while ((m = c.re.exec(text))) { lines.push(text.slice(0, m.index).split('\n').length); if (lines.length > 3) break; }
    if (lines.length) findings[c.key].files.set(f.slice(ROOT.length).replace(/^\//, ''), lines);
  }
}
const out = {}; for (const [k, v] of Object.entries(findings)) { const c = CONCEPTS.find((x) => x.key === k); out[k] = { label: v.label, expected: c.expected, count: v.files.size, files: Object.fromEntries(v.files) }; }
if (JSON_OUT) { console.log(JSON.stringify({ root: ROOT, findings: out }, null, 2)); process.exit(0); }
console.log(`Constitution 9 realtime-infrastructure duplicate audit — ${ROOT}\n`);
let dupes = 0;
for (const [, v] of Object.entries(out)) {
  const over = v.count > v.expected; if (over) dupes++;
  console.log(`${over ? '⚠' : ' '} ${v.label.padEnd(56)} ${String(v.count).padStart(2)} found · ${v.expected} expected`);
  if (over || v.count === 0 && v.expected > 0) for (const [f, lines] of Object.entries(v.files).slice(0, 8)) console.log(`      ${f}:${lines.join(',')}`);
}
console.log(dupes ? `\n${dupes} concept(s) exceed what Constitution 9 left in its own tree — read REALTIME_MERGE_GUIDE.md: reuse the other tree's or replace it, never keep both.` : '\nOK — no concept exceeds the expected count (this is the control result in the Constitution 9 tree).');
process.exit(dupes ? 1 : 0);
