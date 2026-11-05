#!/usr/bin/env node
// audit-realtime-contract.mjs — Constitution 9 §246 "Realtime CI Contract".
//
// Fails (exit 1) when any of these is true:
//   1. DUPLICATE EVENT NAMES — two registry keys map to the same wire name, or a name appears twice.
//   2. MISSING VERSION       — a registry event has no entry in EVENT_VERSIONS (§27), or EVENT_VERSIONS names an
//                              event the registry does not have.
//   3. SCHEMA / ROUTING BREAK — a registry event has no `screensToRefetch` routing (AFFECTS) and is not on the
//                              explicit no-screen list (an unroutable event reaches clients and does nothing).
//   8. UNSUBSCRIBED ROOM — a room type that something PUBLISHES to but no stream SUBSCRIBES to. Every frame sent
//                              there is delivered to nobody. Sep 19 2026: rooms.ticket() had three publishers
//                              (Constitution 8's projection consumer) and zero subscribers for months.
//   7. DEAD CLIENT COMPARISON — an app compares a realtime event name against a literal the server never sends
//                              (a stale name, or a signal that never existed). The screen silently never refreshes.
//                              Scans only the callbacks of the realtime hooks, so ordinary status enums are not
//                              mistaken for event names.
//   6. NO PRODUCER — a registry event that nothing emits. It is versioned, routed, catalogued and possibly subscribed
//                              to, but no code path ever sends it: a screen waiting for it waits forever. FATAL since
//                              BUILD_PLAN Phase 15 (it was report-only, and settings_updated sat on that list for weeks —
//                              falsely: its producer is a shared helper in packages/realtime-contracts, which this scan
//                              never read). A producer is a server file naming the event, OR a call from server code to a
//                              package helper that emits it (`export function notifyX(rt, …) { rt?.toOwner(…, EVENTS.x, …) }`)
//                              — comments stripped, so a prose mention of the helper is not a call.
//   5. OFF-REGISTRY EMISSION — a module emits an event name the registry does not have (a `*_EVENTS` map or an
//                              emitter call literal), or casts the event argument with `event as any` to get past
//                              the EventName type. Sep 19 2026: three modules had 20 such names; the POS cash
//                              screens subscribed to routing that never existed.
//   4. CLIENT CONTRACT — packages/realtime-client/src/core.ts must RE-EXPORT the registry from @aipowersalon/realtime-contracts and carry no copy of EVENTS, AFFECTS
//                              and EVENT_VERSIONS blocks byte-for-byte (§26 one registry, §174 one client), or the
//                              package's CHANNELS map names an event the registry does not have (§175/§177).
//
// Read-only, no imports from src (it parses the files so it runs before a build). `--json` for machines.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// REALTIME_AUDIT_ROOT points the audit at a fixture tree (its tests); by default the repository this script lives in.
const ROOT = process.env.REALTIME_AUDIT_ROOT ? resolve(process.env.REALTIME_AUDIT_ROOT) : resolve(here, '../../..');
const apiCore = resolve(ROOT, 'packages/realtime-contracts/src/realtime-core.ts');   // Constitution 13 §77: the ONE registry
const pkgCore = resolve(ROOT, 'packages/realtime-client/src/core.ts');
const pkgClient = resolve(ROOT, 'packages/realtime-client/src/client.ts');
const json = process.argv.includes('--json');

const block = (s, start, end) => { const i = s.indexOf(start); if (i < 0) return null; const j = s.indexOf(end, i); return j < 0 ? null : s.slice(i, j + end.length); };
const api = readFileSync(apiCore, 'utf8');
const pkg = readFileSync(pkgCore, 'utf8');
const client = readFileSync(pkgClient, 'utf8');

const problems = [];
const eventsBlock = block(api, 'export const EVENTS = {', '} as const;');
const affectsBlock = block(api, 'const AFFECTS', '};');
const versionsBlock = block(api, 'export const EVENT_VERSIONS', '};');
if (!eventsBlock || !affectsBlock || !versionsBlock) { problems.push('registry blocks not found in realtime-core.ts'); }

// 1. names
const pairs = [...(eventsBlock ?? '').matchAll(/(\w+):\s*["']([a-z_]+)["']/g)].map((m) => [m[1], m[2]]);
const keys = pairs.map((p) => p[0]); const names = pairs.map((p) => p[1]);
for (const n of new Set(names)) if (names.filter((x) => x === n).length > 1) problems.push(`DUPLICATE EVENT NAME: "${n}" is declared more than once`);
for (const k of new Set(keys)) if (keys.filter((x) => x === k).length > 1) problems.push(`DUPLICATE EVENT KEY: ${k}`);

// 2. versions
const versioned = new Set([...(versionsBlock ?? '').matchAll(/\b([a-z_]+):\s*(\d+)\b/g)].map((m) => m[1]));
for (const n of names) if (!versioned.has(n)) problems.push(`MISSING VERSION: "${n}" has no EVENT_VERSIONS entry (§27)`);
for (const v of versioned) if (!names.includes(v)) problems.push(`STALE VERSION: EVENT_VERSIONS names "${v}" which is not in EVENTS`);

// 3. routing
const routed = new Set([...(affectsBlock ?? '').matchAll(/^\s+([a-z_]+):\s*\[/gm)].map((m) => m[1]));
// Events that legitimately carry no screen (a client applies them without a refetch, or they are aggregates).
// Constitution 10 §164: ai_job_progress / ai_job_completed are CORRELATED BY requestId, not screen-scoped —
// the client that started a job matches these against the id it is holding and resolves its own pending state.
// Routing them to a screen refetch would make every salon screen reload whenever anyone's AI draft finished.
const NO_SCREEN_OK = new Set(['platform_ops_snapshot', 'ai_job_progress', 'ai_job_completed']);
for (const n of names) if (!routed.has(n) && !NO_SCREEN_OK.has(n)) problems.push(`UNROUTED EVENT: "${n}" has no screensToRefetch entry and is not on the no-screen list`);
for (const r of routed) if (!names.includes(r)) problems.push(`ROUTING FOR UNKNOWN EVENT: AFFECTS names "${r}" which is not in EVENTS`);

// 4. client contract — one registry (Constitution 13 §77). The client package used to carry a verbatim copy checked for
// parity here; now it must re-export from @aipowersalon/realtime-contracts and define NO registry of its own.
if (!/export \{[^}]*\bEVENTS\b[^}]*\} from '@aipowersalon\/realtime-contracts'/.test(pkg)) problems.push('CLIENT CONTRACT: packages/realtime-client/src/core.ts does not re-export EVENTS from @aipowersalon/realtime-contracts');
for (const [label, start] of [['EVENTS', 'export const EVENTS = {'], ['AFFECTS', 'const AFFECTS'], ['EVENT_VERSIONS', 'export const EVENT_VERSIONS']]) {
  if (pkg.includes(start)) problems.push(`CLIENT CONTRACT COPY: packages/realtime-client/src/core.ts declares its own ${label} — the registry lives in @aipowersalon/realtime-contracts only`);
}
const channelsBlock = block(client, 'export const CHANNELS = {', '} as const;') ?? '';
const usedKeys = [...channelsBlock.matchAll(/EVENTS\.(\w+)/g)].map((m) => m[1]);
for (const k of usedKeys) if (!keys.includes(k)) problems.push(`CHANNEL NAMES UNKNOWN EVENT: CHANNELS references EVENTS.${k} which the registry does not have`);
const channelLiterals = [...channelsBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((x) => !x.includes('.'));
for (const lit of channelLiterals) if (!names.includes(lit)) problems.push(`CHANNEL LITERAL: CHANNELS uses the literal "${lit}" which is not a registry event (use EVENTS.x)`);

// 5. off-registry emission (scan every non-spec .ts under src except realtime/)
const walk = (d) => readdirSync(d).flatMap((n) => { const p = resolve(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const srcRoot = resolve(ROOT, 'apps/api/src');
// Constitution 13: most producers and emitters now live in modules/*/src. This gate walked apps/api/src only, and its
// NO PRODUCER list grew from 2 to 44 as the emitting code moved out of its sight (and fault classes 5 and 8 went blind
// the same way). Every scan below walks the API AND every module; `rel` keeps the <dir>/<file> form.
const modulesRoot = resolve(ROOT, 'modules');
const serverRoots = [srcRoot, ...(existsSync(modulesRoot) ? readdirSync(modulesRoot).map((m) => resolve(modulesRoot, m, 'src')).filter((d) => existsSync(d)) : [])];
const serverFiles = () => serverRoots.flatMap((r) => walk(r).map((f) => ({ root: r, file: f })));
for (const { root, file } of serverFiles()) {
  if (!file.endsWith('.ts') || file.includes('.spec.') || file.includes('/realtime/') || file.includes('/events/')) continue;
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(root.length + 1);
  for (const m of text.matchAll(/(\w+_EVENTS)\s*=\s*\{([^}]*)\}/g))
    for (const v of m[2].matchAll(/['"]([a-z]+(?:_[a-z]+)+)['"]/g)) if (!names.includes(v[1])) problems.push(`OFF-REGISTRY EMISSION: ${rel} ${m[1]} declares "${v[1]}" which is not a registry event`);
  for (const m of text.matchAll(/\.to(?:Tenant|Owner|Technician|Ticket|Customer|CustomerDisplay|Platform)\([^,]+,\s*['"]([a-z]+(?:_[a-z]+)+)['"]/g))
    if (!names.includes(m[1])) problems.push(`OFF-REGISTRY EMISSION: ${rel} emits literal "${m[1]}" which is not a registry event`);
  if (/\bevent as any\b/.test(text)) problems.push(`OFF-REGISTRY EMISSION: ${rel} casts \`event as any\` — type the wrapper with EventName instead`);
}

// 6. registry events with no producer anywhere (FATAL — Phase 15)
const keyByName = Object.fromEntries(pairs.map(([k, v]) => [v, k]));
const produced = new Set();
for (const { root, file } of serverFiles()) {
  if (!file.endsWith('.ts') || file.includes('.spec.') || file.endsWith('realtime-core.ts')) continue;
  const text = readFileSync(file, 'utf8');
  for (const [name, key] of Object.entries(keyByName)) {
    if (produced.has(name)) continue;
    if (new RegExp(`EVENTS\\.${key}\\b`).test(text) || new RegExp(`['"]${name}['"]`).test(text)) produced.add(name);
  }
}
// Package helpers that emit (packages/*/src, not the registry, not the client): exported functions whose body sends
// EVENTS.<key> through an emitter method. The event is produced when server code CALLS the helper.
const packagesRoot = resolve(ROOT, 'packages');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const helperEvents = {};   // helper name -> event names
if (existsSync(packagesRoot)) for (const pkgName of readdirSync(packagesRoot)) {
  const dir = resolve(packagesRoot, pkgName, 'src');
  if (!existsSync(dir) || pkgName === 'realtime-client') continue;
  for (const file of walk(dir)) {
    if (!file.endsWith('.ts') || /\.(spec|test)\.ts$/.test(file) || file.endsWith('realtime-core.ts')) continue;
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([\s\S]*?)\n\}/g)) {
      const emitted = [...m[2].matchAll(/\.to(?:Tenant|Owner|Technician|Ticket|Customer|CustomerDisplay|CustomerDisplayDevice|Platform)\??\.?\([^;]*?EVENTS\.(\w+)/g)].map((x) => pairs.find(([k]) => k === x[1])?.[1]).filter(Boolean);
      if (emitted.length) helperEvents[m[1]] = emitted;
    }
  }
}
if (Object.keys(helperEvents).length) for (const { file } of serverFiles()) {
  if (!file.endsWith('.ts') || file.includes('.spec.')) continue;
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const [fn, evs] of Object.entries(helperEvents)) if (new RegExp(`(?<![\\w.])${fn}\\s*\\(`).test(code)) for (const e of evs) produced.add(e);
}
const noProducer = names.filter((n) => !produced.has(n));
for (const n of noProducer) problems.push(`NO PRODUCER: "${n}" — nothing emits it (no server file names it, no server code calls a package helper that sends it); a screen waiting for it waits forever`);

// 7. dead client comparisons inside realtime callbacks
const CLIENT_SIGNALS = new Set(['reconcile', 'connected', 'ping', 'resync_required', 'presence_registered', 'reconnect_requested', 'forbidden', 'sequence_gap', 'slow_client', 'server_shutdown', 'reconnected', 'tab-resumed']);
const appsRoot = resolve(ROOT, 'apps');
const HOOKS = /(useOwnerStream|useTechStream|useCustomerStream|useSuperAdminStream|useRealtimeChannel|\.onEvent)\s*\(/g;
let appFiles = [];
try { appFiles = walk(appsRoot); } catch { appFiles = []; }
for (const file of appFiles) {
  if (!/\.(ts|tsx)$/.test(file) || /\.(test|spec)\./.test(file) || file.includes('/realtime-client/')) continue;
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(appsRoot.length + 1);
  HOOKS.lastIndex = 0; let h;
  while ((h = HOOKS.exec(text))) {
    const seg = text.slice(h.index, h.index + 900);
    for (const lit of seg.matchAll(/(?:===|!==|case\s+)\s*['"]([a-z]+(?:[_-][a-z]+)+)['"]/g)) {
      const n = lit[1];
      if (names.includes(n) || CLIENT_SIGNALS.has(n)) continue;
      problems.push(`DEAD CLIENT COMPARISON: ${rel} compares a realtime event against "${n}", which the server never sends`);
    }
  }
}

// 8. rooms published to but never subscribed
// Publishers call the EMITTER METHOD (toTicket(...)), not rooms.ticket(...) — detecting only the latter made this
// check vacuous on its first run: removing the one real subscriber did not fail it. Map both.
const ROOM_OF_METHOD = { toTenant: 'tenantBranch', toOwner: 'ownerTenant', toTechnician: 'technician', toTicket: 'ticket', toCustomer: 'customer', toCustomerDisplay: 'customerDisplay', toCustomerDisplayDevice: 'customerDisplayDevice', toPlatform: 'platform' };
const coreText = readFileSync(apiCore, 'utf8');
const roomKeys = [...(block(coreText, 'export const rooms = {', '};') ?? '').matchAll(/^\s+(\w+):\s*\(/gm)].map((m) => m[1]);
const pubs = {}, subs = {};
for (const { root, file } of serverFiles()) {
  if (!file.endsWith('.ts') || file.includes('.spec.')) continue;
  // Strip comments FIRST: a prose mention of `rooms.ticket(id)` in a comment made this file look like a
  // subscriber, so the check stayed green after the real subscription was deleted. Code only, from here down.
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rel = file.slice(root.length + 1);
  const isGateway = /realtime\/(realtime\.gateway|realtime-bus|realtime-core|realtime-stream)\.ts$/.test(file);
  if (isGateway) continue;                       // the gateway declares every room; it is neither pub nor sub
  // SUBSCRIBER: a file that hands rooms to the stream factory (a controller, or a service whose room helper one uses)
  const subscribes = /streams\.open\(/.test(text) || /\broom\(sessionId\)|deviceRooms?\(/.test(text);
  for (const k of roomKeys) if (subscribes && new RegExp(`rooms\\.${k}\\s*\\(`).test(text)) (subs[k] ??= []).push(rel);
  if (/customerDisplay/.test(text) && subscribes) (subs.customerDisplay ??= []).push(rel);
  // PUBLISHER: an emitter-method call, or a direct rooms.X() outside a subscriber
  for (const [method, room] of Object.entries(ROOM_OF_METHOD)) {
    // Require the LEADING DOT: `this.realtime.toTicket?.(` is a call; `toTicket?(ticketId: string` in an interface
    // is a declaration. An earlier guard tried to exclude declarations by looking backwards for the word
    // "interface" and rejected the whole consumer file, which declares the port before calling it — the check
    // passed vacuously until a mutation test caught it.
    if (new RegExp(`\\.${method}\\??\\.?\\(`).test(text)) (pubs[room] ??= []).push(rel);
  }
  for (const k of roomKeys) if (!subscribes && new RegExp(`rooms\\.${k}\\s*\\(`).test(text)) (pubs[k] ??= []).push(rel);
}
for (const k of roomKeys) {
  if ((pubs[k]?.length ?? 0) > 0 && (subs[k]?.length ?? 0) === 0)
    problems.push(`UNSUBSCRIBED ROOM: rooms.${k}() is published to (${pubs[k][0]}${pubs[k].length > 1 ? ` +${pubs[k].length - 1}` : ''}) but no stream subscribes to it — those frames reach nobody`);
}

const summary = { events: names.length, versioned: versioned.size, routed: routed.size, noProducer, channels: (channelsBlock.match(/^\s+'[a-z.]+':/gm) ?? []).length, problems };
if (json) { console.log(JSON.stringify(summary, null, 2)); }
else {
  console.log(`Realtime CI contract (§246): ${summary.events} events · ${summary.versioned} versioned · ${summary.routed} routed · ${summary.channels} client channels`);
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(problems.length ? `FAIL — ${problems.length} problem(s)` : 'OK — no duplicate names, every event versioned, routed and produced, client contract identical, channels name registry events only, no off-registry emissions');
}
process.exit(problems.length ? 1 : 0);
