#!/usr/bin/env node
// audit-event-producers.mjs — Constitution 8 §7 / §18: the domain-event PRODUCER gate (BUILD_PLAN Phase 15).
//
// The realtime contract gate (audit-realtime-contract.mjs) has long checked that every realtime event is emitted by
// something. The domain-event registry (packages/events/src/event-contract.ts) had no equivalent: five events sat in the
// registry for weeks with nothing recording them (CONSTITUTIONS_STATUS C8), and a consumer subscribed to one would wait
// forever. The architecture tests only listed them in a shrink-only baseline, and counted ANY mention of the name —
// a comment, a consumer's own subscription — as a producer.
//
// Fails (exit 1) when any of these is true:
//   1. NO PRODUCER      — a registry event that no OUTBOX PRODUCER records. A producer is a non-test server file
//                         (apps/api/src, modules/*/src, packages/*/src) that names the event (DOMAIN_EVENTS.<KEY> or its
//                         quoted value) in CODE — comments stripped, and every CONSUMING position removed (`eventTypes =
//                         [...]`, a `[DOMAIN_EVENTS.X]:` projection-map key, `case DOMAIN_EVENTS.X:`, an `=== / !==`
//                         comparison) — inside a server root (the API, or one module / package) that writes the outbox
//                         (`createDomainEvent(` + `.write(`/`.writeAll(` in one file). Producers pass the type through their
//                         own helpers (`this.emit(ctx, DOMAIN_EVENTS.X, …)`, `postEvent(…)`, `{ event: { type } }`), so the
//                         envelope is often built one file away; the root-level outbox requirement keeps a name that is only
//                         mentioned (a label map, a client vocabulary) in a root with no outbox from counting.
//                         The only escape is a reviewed entry in event-producers.reserved.json with a reason.
//   2. STALE RESERVATION — a reserved entry that is produced after all, is not a registry event, has no reason, or
//                         has a consumer subscribed to it (a reserved event cannot be waited on).
//   3. OFF-REGISTRY SUBSCRIPTION — a consumer subscribes (eventTypes / projection-map key / case) to DOMAIN_EVENTS.<KEY>
//                         that the registry does not have, or to a quoted name that is not a registry event.
//   4. RETIRED NAME     — a name in RETIRED below is still in the registry, or still referenced by any code file
//                         (apps, modules, packages, tooling — .ts/.tsx/.mjs/.js/.json, tests included: the zero-importer
//                         rule). Retiring a name means nothing is left that could produce, consume or display it.
//   5. CATALOG STALE    — docs/EVENT_CATALOG.md does not match what this script generates (`--write-catalog`).
//
// Read-only, parses the sources (runs before a build). `--json` for machines, `--write-catalog` regenerates the catalog.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.EVENT_AUDIT_ROOT ? resolve(process.env.EVENT_AUDIT_ROOT) : resolve(here, '../../..');
const json = process.argv.includes('--json');
const writeCatalog = process.argv.includes('--write-catalog');
const CATALOG = resolve(ROOT, 'docs/EVENT_CATALOG.md');
const RESERVED_FILE = resolve(ROOT, 'apps/api/scripts/event-producers.reserved.json');

/** Retired by BUILD_PLAN Phase 15 (Oct 10 2026, the plan default for Kevin's open choice): declared by Constitution 8 ahead
 *  of producers that never came. A visit starts when the customer checks in (checkin.customer_checked_in) and its service
 *  starts (service.started); a checkout has no "started" fact the platform acts on (the ticket's ready_for_checkout handoff
 *  is the fact); card authorization and capture are one step on every processor path in use (payment.captured). */
export const RETIRED = [
  { key: 'VISIT_STARTED', name: 'visit.started', retired: '2026-10-10', use: 'checkin.customer_checked_in / service.started' },
  { key: 'CHECKOUT_STARTED', name: 'checkout.started', retired: '2026-10-10', use: 'ticket.ready_for_checkout' },
  { key: 'PAYMENT_AUTHORIZED', name: 'payment.authorized', retired: '2026-10-10', use: 'payment.captured' },
];

const walk = (d) => readdirSync(d).flatMap((n) => {
  if (n === 'node_modules' || n === 'dist' || n.startsWith('.')) return [];
  const p = resolve(d, n); return statSync(p).isDirectory() ? walk(p) : [p];
});
const rel = (f) => relative(ROOT, f);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// ── the registry ──────────────────────────────────────────────────────────────────────────────────────────────
const contractPath = resolve(ROOT, 'packages/events/src/event-contract.ts');
const contract = readFileSync(contractPath, 'utf8');
const start = contract.indexOf('export const DOMAIN_EVENTS = {');
const block = contract.slice(start, contract.indexOf('} as const;', start));
const pairs = [...stripComments(block).matchAll(/^\s+([A-Z_]+):\s*'([a-z_.]+)'/gm)].map((m) => [m[1], m[2]]);
const KEYS = new Set(pairs.map(([k]) => k));
const NAMES = new Set(pairs.map(([, v]) => v));
const nameOf = Object.fromEntries(pairs);

const problems = [];

// ── server files ──────────────────────────────────────────────────────────────────────────────────────────────
const modulesRoot = resolve(ROOT, 'modules');
const packagesRoot = resolve(ROOT, 'packages');
const serverRoots = [
  resolve(ROOT, 'apps/api/src'),
  ...(existsSync(modulesRoot) ? readdirSync(modulesRoot).map((m) => resolve(modulesRoot, m, 'src')) : []),
  ...(existsSync(packagesRoot) ? readdirSync(packagesRoot).map((p) => resolve(packagesRoot, p, 'src')) : []),
].filter((d) => existsSync(d));
const isTest = (f) => /\.(spec|test)\.tsx?$/.test(f) || /\.vitest\./.test(f) || /\/testing\//.test(f);
const serverFiles = serverRoots.flatMap(walk).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !isTest(f) && f !== contractPath);

// subscription positions: removed before looking for production, collected for check 3
const SUB_ARRAY = /eventTypes\s*(?::[^=\n]*)?=\s*\[([\s\S]*?)\]/g;
const MAP_KEY = /\[\s*DOMAIN_EVENTS\.([A-Z_]+)\s*\]\s*:/g;
const CASE = /case\s+DOMAIN_EVENTS\.([A-Z_]+)\s*:/g;
const CMP_L = /[!=]==\s*DOMAIN_EVENTS\.([A-Z_]+)\b/g;
const CMP_R = /DOMAIN_EVENTS\.([A-Z_]+)\s*[!=]==/g;

const producers = Object.fromEntries(pairs.map(([k]) => [k, []]));
const consumers = Object.fromEntries(pairs.map(([k]) => [k, []]));
const rootOf = (f) => serverRoots.find((r) => f.startsWith(r + '/'));
const outboxRoots = new Set();
const mentions = [];   // [file, remaining code]
for (const f of serverFiles) {
  const code = stripComments(readFileSync(f, 'utf8'));
  if (/createDomainEvent\s*\(/.test(code) && /\.write(All)?\s*\(/.test(code)) outboxRoots.add(rootOf(f));
  if (!/DOMAIN_EVENTS\.|eventTypes/.test(code) && !pairs.some(([, v]) => code.includes(v))) continue;
  let rest = code;
  const subscribed = new Set();
  for (const m of code.matchAll(SUB_ARRAY)) {
    for (const k of m[1].matchAll(/DOMAIN_EVENTS\.([A-Z_]+)/g)) subscribed.add(k[1]);
    for (const q of m[1].matchAll(/['"]([a-z_]+\.[a-z_.]+)['"]/g)) {
      if (!NAMES.has(q[1])) problems.push(`OFF-REGISTRY SUBSCRIPTION: ${rel(f)} subscribes to "${q[1]}", which is not a registry event`);
      else subscribed.add(pairs.find(([, v]) => v === q[1])[0]);
    }
    rest = rest.replace(m[0], '');
  }
  for (const re of [MAP_KEY, CASE, CMP_L, CMP_R]) for (const m of code.matchAll(re)) { subscribed.add(m[1]); rest = rest.split(m[0]).join(''); }
  for (const k of subscribed) {
    if (!KEYS.has(k)) problems.push(`OFF-REGISTRY SUBSCRIPTION: ${rel(f)} subscribes to DOMAIN_EVENTS.${k}, which the registry does not have`);
    else consumers[k].push(rel(f));
  }
  mentions.push([f, rest]);
}
for (const [f, rest] of mentions) {
  if (!outboxRoots.has(rootOf(f))) continue;
  for (const [k, v] of pairs) {
    if (new RegExp(`DOMAIN_EVENTS\\.${k}\\b`).test(rest) || rest.includes(`'${v}'`) || rest.includes(`"${v}"`)) producers[k].push(rel(f));
  }
}

// ── reservations ──────────────────────────────────────────────────────────────────────────────────────────────
let reserved = [];
if (existsSync(RESERVED_FILE)) reserved = JSON.parse(readFileSync(RESERVED_FILE, 'utf8')).reserved ?? [];
const reservedNames = new Set();
for (const r of reserved) {
  if (!NAMES.has(r.event)) { problems.push(`STALE RESERVATION: "${r.event}" is not a registry event`); continue; }
  if (!r.reason || String(r.reason).trim().length < 20) problems.push(`STALE RESERVATION: "${r.event}" has no reviewed reason`);
  const k = pairs.find(([, v]) => v === r.event)[0];
  if (producers[k].length) problems.push(`STALE RESERVATION: "${r.event}" is produced (${producers[k][0]}) — remove the reservation`);
  if (consumers[k].length) problems.push(`STALE RESERVATION: "${r.event}" is reserved but ${consumers[k][0]} subscribes to it — a consumer would wait forever`);
  reservedNames.add(r.event);
}

const noProducer = pairs.filter(([k, v]) => !producers[k].length && !reservedNames.has(v)).map(([, v]) => v);
for (const v of noProducer) {
  const k = pairs.find(([, x]) => x === v)[0];
  problems.push(`NO PRODUCER: "${v}" (DOMAIN_EVENTS.${k}) — nothing records it through the outbox${consumers[k].length ? `; ${consumers[k][0]} waits for it forever` : ''}. Produce it, retire it (RETIRED), or reserve it with a reason`);
}

// ── retired names: the zero-importer rule ─────────────────────────────────────────────────────────────────────
for (const r of RETIRED) {
  if (KEYS.has(r.key) || NAMES.has(r.name)) problems.push(`RETIRED NAME: ${r.key} / "${r.name}" (retired ${r.retired}) is still in the registry`);
}
const self = fileURLToPath(import.meta.url);
const codeRoots = ['apps', 'modules', 'packages', 'tooling'].map((d) => resolve(ROOT, d)).filter((d) => existsSync(d));
const CODE_EXT = /\.(ts|tsx|mjs|cjs|js|json)$/;
for (const f of codeRoots.flatMap(walk)) {
  if (!CODE_EXT.test(f) || f === self || /package-lock\.json$/.test(f) || /\/(android|ios)\//.test(f) || /\.min\.js$/.test(f)) continue;
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (text.length > 3_000_000) continue;
  for (const r of RETIRED) {
    if (text.includes(r.name) || new RegExp(`\\b${r.key}\\b`).test(text)) problems.push(`RETIRED NAME: ${rel(f)} still references "${r.name}" (retired ${r.retired}; use ${r.use})`);
  }
}

// ── the catalog ───────────────────────────────────────────────────────────────────────────────────────────────
function catalog() {
  const byDomain = new Map();
  for (const [k, v] of pairs) { const d = v.split('.')[0]; if (!byDomain.has(d)) byDomain.set(d, []); byDomain.get(d).push([k, v]); }
  const out = [
    '# Domain event catalog',
    '',
    '<!-- GENERATED by apps/api/scripts/audit-event-producers.mjs --write-catalog. Do not edit by hand; the',
    '     check:event-producers gate fails when this file is stale. -->',
    '',
    `Registry: \`packages/events/src/event-contract.ts\` — **${pairs.length} events**, ${byDomain.size} domains. Every event has at`,
    'least one outbox producer (a file that builds the envelope and writes it in the business transaction) or a reviewed',
    `reservation (\`apps/api/scripts/event-producers.reserved.json\`: ${reserved.length}). Consumers are the files that subscribe to it.`,
    '',
    '| Event | Producers | Consumers |',
    '| --- | --- | --- |',
  ];
  for (const [, list] of [...byDomain.entries()]) for (const [k, v] of list) {
    const p = producers[k].length ? producers[k].map((x) => `\`${x}\``).join('<br>') : (reservedNames.has(v) ? '_reserved_' : '**none**');
    const c = consumers[k].length ? consumers[k].map((x) => `\`${x}\``).join('<br>') : '—';
    out.push(`| \`${v}\` | ${p} | ${c} |`);
  }
  out.push('', '## Retired', '', '| Event | Retired | Use instead |', '| --- | --- | --- |');
  for (const r of RETIRED) out.push(`| \`${r.name}\` | ${r.retired} | ${r.use} |`);
  return out.join('\n') + '\n';
}
const generated = catalog();
if (writeCatalog) writeFileSync(CATALOG, generated);
else if (!existsSync(CATALOG) || readFileSync(CATALOG, 'utf8') !== generated) problems.push('CATALOG STALE: docs/EVENT_CATALOG.md does not match the registry / producers — run `node apps/api/scripts/audit-event-producers.mjs --write-catalog`');

const produced = pairs.filter(([k]) => producers[k].length).length;
const summary = { events: pairs.length, produced, reserved: reserved.length, retired: RETIRED.length, noProducer, problems };
if (json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`Domain-event producers (C8 §7/§18): ${summary.events} events · ${produced} produced through the outbox · ${summary.reserved} reserved · ${summary.retired} retired`);
  for (const p of problems) console.log('  ✗ ' + p);
  console.log(problems.length ? `FAIL — ${problems.length} problem(s)` : 'OK — every registry event has an outbox producer, every subscription names a registry event, no retired name is referenced');
}
process.exit(problems.length ? 1 : 0);
