#!/usr/bin/env node
// check-mobile-transport.mjs — BUILD_PLAN Phase 13 (Constitution 6 §11–16): the four Capacitor apps reach the API through
// ONE transport (@aipowersalon/mobile-sdk createTransport) — the place that adds the bearer on native (uploads included),
// the client headers, the timeouts, GET-only retry, Idempotency-Key and error normalisation. A hand-rolled fetch in a
// screen silently loses all of that (that is how the tech app's uploads went out without a bearer).
//
//   T1 RAW        no fetch( / window.fetch / XMLHttpRequest / navigator.sendBeacon / axios in the four apps' src
//   T2 STREAM     no `new EventSource(` in the four apps (realtime goes through @aipowersalon/realtime-client with the
//                 ticketed streamUrl)
//   T3 CLIENT     each app's src/api/client.ts builds its client with createTransport({ app: '<id>' … }) — the right id
//   T4 STREAM URL each app's realtime client passes streamUrl: realtimeStreamUrl(transport, …) (native tickets, bug 1)
//
// Tests are not scanned (they stub fetch on purpose). An exception is an entry in mobile-transport.allowlist.json
// ({ file, rule, reason }); the list only shrinks — an entry that matches nothing fails until it is removed.
//
//   node apps/api/scripts/check-mobile-transport.mjs        the gate (check:mobile-transport)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
export const APPS = { 'customer-web': 'customer', 'tech-web': 'tech', 'owner-web': 'owner', 'manager-pay-web': 'manager-pay' };
export const STREAM_HOOKS = {
  'customer-web': 'src/api/useCustomerStream.ts', 'tech-web': 'src/lib/useTechStream.ts',
  'owner-web': 'src/api/useOwnerStream.ts', 'manager-pay-web': 'src/lib/useCheckoutStream.ts',
};
const ALLOW_FILE = join(HERE, 'mobile-transport.allowlist.json');
const RULES = {
  T1: /(^|[^A-Za-z0-9_$.])fetch\s*\(|\bwindow\.fetch\b|\bglobalThis\.fetch\b|\bXMLHttpRequest\b|\bnavigator\.sendBeacon\b|from\s+['"]axios['"]/,
  T2: /\bnew\s+EventSource\s*\(/,
};
const isTest = (f) => /\.(test|spec)\.[tj]sx?$/.test(f) || /\/(test|__tests__)\//.test(f);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.[tj]sx?$/.test(n) && !isTest(p)) out.push(p);
  }
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Pure: findings for a set of { file, src } (exported for the spec). */
export function scan(files) {
  const found = [];
  for (const { file, src } of files) {
    const lines = stripComments(src).split('\n');
    lines.forEach((l, i) => { for (const [rule, re] of Object.entries(RULES)) if (re.test(l)) found.push({ file, rule, line: i + 1, text: l.trim().slice(0, 140) }); });
  }
  return found;
}
export function checkClients(read) {
  const found = [];
  for (const [app, id] of Object.entries(APPS)) {
    const client = read(`apps/${app}/src/api/client.ts`);
    if (!client || !new RegExp(`createTransport\\(\\{[\\s\\S]{0,80}app:\\s*'${id}'`).test(client)) found.push({ file: `apps/${app}/src/api/client.ts`, rule: 'T3', line: 0, text: `must build its client with createTransport({ app: '${id}' })` });
    const hook = read(`apps/${app}/${STREAM_HOOKS[app]}`);
    if (!hook || !/streamUrl:\s*realtimeStreamUrl\(\s*transport\s*,/.test(hook)) found.push({ file: `apps/${app}/${STREAM_HOOKS[app]}`, rule: 'T4', line: 0, text: 'the realtime client must pass streamUrl: realtimeStreamUrl(transport, …) — native has no cookie' });
  }
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = Object.keys(APPS).flatMap((a) => walk(join(REPO, 'apps', a, 'src')).map((p) => ({ file: relative(REPO, p), src: readFileSync(p, 'utf8') })));
  const read = (rel) => { try { return readFileSync(join(REPO, rel), 'utf8'); } catch { return null; } };
  const allow = existsSync(ALLOW_FILE) ? JSON.parse(readFileSync(ALLOW_FILE, 'utf8')).entries ?? [] : [];
  const findings = [...scan(files), ...checkClients(read)];
  const allowed = (f) => allow.some((a) => a.file === f.file && a.rule === f.rule);
  const bad = findings.filter((f) => !allowed(f));
  const stale = allow.filter((a) => !findings.some((f) => f.file === a.file && f.rule === a.rule));
  for (const f of bad) console.error(`${f.rule}  ${f.file}:${f.line}  ${f.text}`);
  for (const a of stale) console.error(`STALE allowlist entry (remove it): ${a.file} ${a.rule}`);
  if (bad.length || stale.length) { console.error(`\ncheck:mobile-transport FAILED — ${bad.length} finding(s), ${stale.length} stale allowlist entr(y/ies). Use the app's api client (@aipowersalon/mobile-sdk createTransport).`); process.exit(1); }
  console.log(`check:mobile-transport: ${files.length} files in ${Object.keys(APPS).length} apps — every API call goes through the one transport; ${allow.length} allowlisted`);
}
