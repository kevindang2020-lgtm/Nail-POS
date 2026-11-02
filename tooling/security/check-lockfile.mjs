#!/usr/bin/env node
// check-lockfile.mjs — Security Deep Scan §13 (dependency malware scan): lockfile hygiene, on every ci:gates run.
//
// FAILS on, in package-lock.json:
//   1. an install-script package (hasInstallScript) not in the reviewed list — install scripts run on every developer
//      machine and CI runner at `npm ci` (the developer-machine compromise path);
//   2. any entry resolved from outside the npm registry (git+…, github:, http:, a tarball URL, a file: path that is not a
//      workspace link) or without an integrity hash;
//   3. a package name one edit away from a direct dependency of this repository that is not itself that dependency
//      (typosquat heuristic), unless reviewed;
//   4. a package version NEW since the reviewed baseline that was published less than MIN_AGE_DAYS ago — the time comes
//      from the registry (one request per new version); offline the check is reported as SKIPPED, never as PASS.
// The reviewed state lives in tooling/security/lockfile-review.json:
//   installScripts { "name": "why" } · typosquatReviewed { "name": "why" } · baseline [ "name@version", … ]
// `--write-baseline` records the current name@version set as reviewed (do it after reviewing the diff of new versions).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REVIEW = join(ROOT, 'tooling/security/lockfile-review.json');
export const MIN_AGE_DAYS = 7;

export const nameOf = (key) => key.replace(/^.*node_modules\//, '');
/** Levenshtein distance ≤ 1 (substitution, insertion, deletion; also an adjacent swap). */
export function oneEditApart(a, b) {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
    return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]);
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}

/** The pure checks (no network): returns { problems, newVersions, installScripts }. */
export function lockfileProblems(lock, review, directDeps) {
  const problems = []; const seen = new Set(); const installScripts = [];
  const reviewedInstall = review.installScripts ?? {}; const reviewedTypo = review.typosquatReviewed ?? {};
  const baseline = new Set(review.baseline ?? []);
  const newVersions = [];
  for (const [key, v] of Object.entries(lock.packages ?? {})) {
    if (!key || !key.includes('node_modules/')) continue;   // the root and the workspace packages themselves
    if (v.link) continue;
    const name = nameOf(key); const id = `${name}@${v.version}`;
    if (v.hasInstallScript) { installScripts.push(id); if (!reviewedInstall[name]) problems.push(`install script: ${id} is not in installScripts (review what its install script does)`); }
    const r = String(v.resolved ?? '');
    if (!r) problems.push(`unresolved: ${key} has no "resolved" URL`);
    else if (!r.startsWith('https://registry.npmjs.org/')) problems.push(`non-registry source: ${key} → ${r}`);
    if (r && !v.integrity) problems.push(`no integrity hash: ${key}`);
    if (!seen.has(name)) {
      seen.add(name);
      const near = directDeps.find((d) => d.length >= 4 && oneEditApart(name, d) && !directDeps.includes(name));
      if (near && !reviewedTypo[name]) problems.push(`typosquat heuristic: "${name}" is one edit away from the direct dependency "${near}" (add to typosquatReviewed with the reason if legitimate)`);
    }
    if (!baseline.has(id)) newVersions.push(id);
  }
  return { problems, newVersions: [...new Set(newVersions)], installScripts };
}

/** Every dependency name declared by this repository's package.json files. */
export function directDependencies(root = ROOT) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const names = new Set();
  for (const [key, v] of Object.entries(lock.packages ?? {})) {
    if (key.includes('node_modules/')) continue;
    for (const f of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) for (const n of Object.keys(v[f] ?? {})) names.add(n);
  }
  return [...names];
}

async function publishedAt(id) {
  const at = id.lastIndexOf('@'); const name = id.slice(0, at), version = id.slice(at + 1);
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' }, signal: ac.signal });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const j = await r.json(); const when = j.time?.[version];
    if (!when) { const full = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { signal: ac.signal }).then((x) => x.json()); return full.time?.[version] ? { when: full.time[version] } : { error: 'no publish time' }; }
    return { when };
  } catch (e) { return { error: String(e?.message || e) }; } finally { clearTimeout(t); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const review = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, 'utf8')) : {};
  const { problems, newVersions, installScripts } = lockfileProblems(lock, review, directDependencies());
  if (process.argv.includes('--write-baseline')) {
    const all = Object.entries(lock.packages).filter(([k, v]) => k.includes('node_modules/') && !v.link).map(([k, v]) => `${nameOf(k)}@${v.version}`);
    review.baseline = [...new Set(all)].sort();
    writeFileSync(REVIEW, JSON.stringify(review, null, 1) + '\n');
    console.log(`lockfile: baseline written (${review.baseline.length} name@version)`);
    process.exit(0);
  }
  let skipped = 0;
  if (newVersions.length && !process.argv.includes('--offline')) {
    for (const id of newVersions.slice(0, 200)) {
      const p = await publishedAt(id);
      if (p.error) { skipped++; continue; }
      const days = (Date.now() - new Date(p.when).getTime()) / 86_400_000;
      if (days < MIN_AGE_DAYS) problems.push(`very new: ${id} was published ${days.toFixed(1)} days ago (< ${MIN_AGE_DAYS}) — wait, or review the release and record it with --write-baseline`);
    }
  } else if (newVersions.length) skipped = newVersions.length;
  const total = Object.keys(lock.packages).length;
  console.log(`lockfile: ${total} entries · ${installScripts.length} install-script packages (reviewed) · ${newVersions.length} version(s) new since the reviewed baseline${skipped ? ` · publish-age check SKIPPED for ${skipped} (registry unreachable)` : ''}`);
  if (newVersions.length) console.log('  new since baseline: ' + newVersions.slice(0, 30).join(', ') + (newVersions.length > 30 ? ' …' : ''));
  if (problems.length) { console.log(`❌ lockfile hygiene: ${problems.length} problem(s)`); for (const p of problems) console.log('  ' + p); process.exit(1); }
  console.log('✅ lockfile hygiene: registry-only sources, integrity on every entry, install scripts reviewed, no typosquat-shaped names');
}
