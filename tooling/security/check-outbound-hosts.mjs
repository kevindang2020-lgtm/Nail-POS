#!/usr/bin/env node
// check-outbound-hosts.mjs — Security Deep Scan §12 (outbound destination inventory; flag unknown domains / IPs), on every
// ci:gates run.
//
// Extracts every literal http(s):// host (and bare IP literal URL) from PRODUCT code — the API (apps/api/src), the domain
// modules (modules/*/src), the workspace packages (packages/*/src) and the client apps (apps/*/src, the single-file apps'
// index.html / *.js) — with comments stripped, tests / specs / type declarations excluded. Each host must be in the reviewed
// allowlist tooling/security/outbound-hosts.allowlist.json ({ host: "who / why" }, wildcard "*.example.com" allowed). A
// host that is not there FAILS (a new provider, a typo, or an exfiltration endpoint all look the same until reviewed);
// an allowlisted host no longer present is reported (prune it). Tenant-supplied URLs (webhooks, processor base URLs) are
// not literals — they go through packages/security safe-outbound / PROCESSOR_URL_POLICIES at run time.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOW = join(ROOT, 'tooling/security/outbound-hosts.allowlist.json');
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'ios', 'android', 'www', '__fixtures__', 'fixtures', 'test', 'tests', 'test-support', 'scripts']);

function walk(d, out = []) {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    if (SKIP.has(f)) continue;
    const p = join(d, f); const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs|html)$/.test(f) && !/\.(test|spec)\.|vitest\.spec|pgtest|\.d\.ts$|\.min\.js$|\.stories\./.test(f)) out.push(p);
  }
  return out;
}
export function productFiles(root = ROOT) {
  const files = [];
  walk(join(root, 'apps/api/src'), files);
  for (const m of readdirSync(join(root, 'modules'))) walk(join(root, 'modules', m, 'src'), files);
  for (const p of readdirSync(join(root, 'packages'))) walk(join(root, 'packages', p, 'src'), files);
  for (const a of readdirSync(join(root, 'apps')).filter((x) => x !== 'api')) {
    walk(join(root, 'apps', a, 'src'), files);
    for (const f of existsSync(join(root, 'apps', a)) ? readdirSync(join(root, 'apps', a)) : []) if (/\.(html|js)$/.test(f) && !/config|\.min\./.test(f)) files.push(join(root, 'apps', a, f));
  }
  return files;
}

/** Remove // and /* *\/ comments (outside strings) so a link in a comment is not counted as egress. */
export function stripComments(src) {
  let out = ''; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1;
      for (; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === q) break; if (q !== '`' && src[j] === '\n') break; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '<' && src.startsWith('<!--', i)) { const e = src.indexOf('-->', i + 4); i = e < 0 ? src.length : e + 3; continue; }
    out += c; i++;
  }
  return out;
}

/** Hosts in one source text (lower-cased; a template placeholder host is skipped). */
export function hostsIn(src) {
  const hosts = new Set();
  for (const m of stripComments(src).matchAll(/\b(?:https?|wss?):\/\/(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::\d+)?/g)) {
    const h = m[1].toLowerCase().replace(/\.$/, '');
    if (!h || h.includes('${') || !/[a-z0-9]/.test(h)) continue;
    hosts.add(h);
  }
  return hosts;
}
export const allowed = (host, allow) => Object.keys(allow).some((k) => k === host || (k.startsWith('*.') && (host.endsWith(k.slice(1)) || host === k.slice(2))));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')).hosts ?? {} : {};
  const where = new Map();
  for (const f of productFiles()) for (const h of hostsIn(readFileSync(f, 'utf8'))) { if (!where.has(h)) where.set(h, []); where.get(h).push(relative(ROOT, f)); }
  if (process.argv.includes('--list')) { for (const [h, fs] of [...where].sort()) console.log(`${h}  ${fs.length} file(s): ${fs.slice(0, 3).join(', ')}`); process.exit(0); }
  const unknown = [...where].filter(([h]) => !allowed(h, allow));
  const stale = Object.keys(allow).filter((k) => ![...where.keys()].some((h) => allowed(h, { [k]: 1 })));
  console.log(`outbound hosts: ${where.size} literal hosts in ${productFiles().length} product files · ${Object.keys(allow).length} reviewed${stale.length ? ` · ${stale.length} allowlisted host(s) no longer referenced (prune): ${stale.join(', ')}` : ''}`);
  if (unknown.length) {
    console.log(`❌ outbound hosts: ${unknown.length} host(s) not in tooling/security/outbound-hosts.allowlist.json — review each (who is it, why does product code reach it) and add it with the reason:`);
    for (const [h, fs] of unknown) console.log(`  ${h}  ← ${fs.slice(0, 4).join(', ')}${fs.length > 4 ? ` (+${fs.length - 4})` : ''}`);
    process.exit(1);
  }
  console.log('✅ outbound hosts: every literal destination in product code is reviewed');
}
